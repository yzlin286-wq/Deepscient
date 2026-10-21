#!/usr/bin/env python3
"""作图执行器：按期刊物理尺寸出图，同时落矢量与位图。

stdin 收 JSON，stdout 出 JSON。

设计上的几条硬规则（都来自期刊的实际退稿理由）
  1. 尺寸用毫米。期刊的栏宽是 85 mm / 180 mm 这种物理量，「5 英寸」在排版时会缩放，
     缩放后的字号就不合规了。所以先定物理尺寸，再按尺寸反推字号。
  2. 字号在缩放后必须 ≥ 6 pt。这里直接按目标尺寸排版，不靠事后缩放。
  3. 同时出 PDF（投稿）+ PNG（预览）+ SVG（可改）。TIFF 需要额外依赖，给了就出，没给就说明原因。
  4. 调色板默认色盲友好，且不用红绿对立。
  5. 误差棒必须说明含义（SD / SEM / 95% CI），由 spec 显式传入，不给默认值。
"""

import json
import math
import os
import sys

import numpy as np

PALETTES = {
    "okabe-ito": ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442", "#000000"],
    "grayscale": ["#111111", "#444444", "#777777", "#999999", "#BBBBBB", "#DDDDDD"],
    "nature": ["#3C5488", "#E64B35", "#00A087", "#4DBBD5", "#F39B7F", "#8491B4"],
    "viridis": None,
}

MM_PER_INCH = 25.4


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, default=str))
    sys.stdout.flush()
    sys.exit(0)


def fail(message, **extra):
    out = {"ok": False, "error": message}
    out.update(extra)
    emit(out)


def mm_to_in(mm):
    return float(mm) / MM_PER_INCH


def as_float_list(values):
    out = []
    for v in values:
        if v is None or v == "":
            out.append(np.nan)
            continue
        try:
            out.append(float(v))
        except (TypeError, ValueError):
            out.append(np.nan)
    return np.asarray(out, dtype=float)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import rcParams

    raw = sys.stdin.read()
    try:
        req = json.loads(raw) if raw.strip() else {}
    except Exception as exc:  # noqa: BLE001
        fail(f"请求不是合法 JSON：{exc}")

    kind = str(req.get("kind") or "").strip()
    if not kind:
        fail("必须给 kind（bar / line / scatter / box / violin / hist / heatmap / paired / curve）")

    style = req.get("style") or {}
    width_mm = float(style.get("widthMm") or 85.0)
    height_mm = float(style.get("heightMm") or 60.0)
    dpi = int(style.get("dpi") or 600)
    font_size = float(style.get("fontSize") or 7.0)
    palette_name = str(style.get("palette") or "okabe-ito")
    if palette_name not in PALETTES:
        palette_name = "okabe-ito"
    colors = PALETTES[palette_name]
    if colors is None:
        fail("viridis 需要按数值着色，请改用 kind=heatmap 或换成 okabe-ito 调色板", palette=[k for k in PALETTES])
    if width_mm < 40 or width_mm > 200:
        fail(f"宽度 {width_mm} mm 不合理；常见栏宽 85 mm（单栏）/ 180 mm（双栏）")
    if font_size < 6:
        fail("字号小于 6 pt 在印刷后不可读，多数期刊直接退稿")
    if palette_name != "grayscale" and style.get("printFriendly") and False:
        pass

    rcParams.update({
        "font.size": font_size,
        "axes.labelsize": font_size,
        "axes.titlesize": font_size + 1,
        "xtick.labelsize": font_size - 0.5,
        "ytick.labelsize": font_size - 0.5,
        "legend.fontsize": font_size - 0.5,
        "axes.linewidth": 0.6,
        "xtick.major.width": 0.6,
        "ytick.major.width": 0.6,
        "xtick.direction": "out",
        "ytick.direction": "out",
        "figure.dpi": 150,
        "savefig.bbox": "tight",
        "savefig.pad_inches": 0.02,
        "pdf.fonttype": 42,
        "ps.fonttype": 42,
        "svg.fonttype": "none",
    })

    fig, ax = plt.subplots(figsize=(mm_to_in(width_mm), mm_to_in(height_mm)))
    data = req.get("data") or {}
    labels = style.get("labels") or []
    xlabel = style.get("xlabel") or ""
    ylabel = style.get("ylabel") or ""
    title = style.get("title") or ""
    error_type = style.get("errorType") or ""
    note = None

    if kind in ("bar", "line", "scatter", "violin", "box", "hist", "paired", "curve", "heatmap"):
        pass
    else:
        fail(f"不支持的图类型：{kind}", supported=["bar", "line", "scatter", "box", "violin", "hist", "heatmap", "paired", "curve"])

    series = {k: as_float_list(v) for k, v in data.items()}

    if kind in ("bar", "line", "scatter"):
        keys = [k for k in ("y", "x") if k in series]
        if kind in ("bar", "line") and "y" not in series and len(series) >= 1:
            # 允许 g1/g2/g3 这样的分组列
            groups = [(k, v) for k, v in series.items() if np.isfinite(v).any()]
            if not groups:
                fail("没有可用数据列")
            positions = np.arange(len(groups))
            means = [np.nanmean(v) for _, v in groups]
            sems = [np.nanstd(v, ddof=1) / math.sqrt(np.isfinite(v).sum()) for _, v in groups]
            errors = []
            for _, v in groups:
                sd = np.nanstd(v, ddof=1)
                n = int(np.isfinite(v).sum())
                if error_type == "sd":
                    errors.append(sd)
                elif error_type == "sem":
                    errors.append(sd / math.sqrt(max(n, 1)))
                elif error_type in ("ci95", "ci"):
                    errors.append(1.96 * sd / math.sqrt(max(n, 1)))
                else:
                    errors.append(0.0)
            if kind == "bar":
                ax.bar(positions, means, yerr=errors if error_type else None, capsize=2,
                       color=[colors[i % len(colors)] for i in range(len(groups))], width=0.6,
                       error_kw={"elinewidth": 0.6, "capthick": 0.6})
            else:
                ax.errorbar(positions, means, yerr=errors if error_type else None, marker="o",
                            color=colors[0], linewidth=0.9, markersize=3, capsize=2)
            if not error_type:
                note = "未给 errorType，图上没有误差棒。报告里必须有离散度：sd / sem / ci95 三选一。"
            ax.set_xticks(positions)
            ax.set_xticklabels(labels if len(labels) == len(groups) else [k for k, _ in groups])
            ax.set_ylabel(ylabel or "值")
        else:
            y = series.get("y")
            x = series.get("x")
            if y is None:
                fail("bar/line/scatter 需要 data.y（及可选 data.x）")
            if kind == "scatter":
                if x is None:
                    x = np.arange(len(y))
                ax.scatter(x, y, s=8, color=colors[0], edgecolors="none", alpha=0.85)
                if style.get("fitLine"):
                    mask = np.isfinite(x) & np.isfinite(y)
                    if mask.sum() >= 2:
                        k, b = np.polyfit(x[mask], y[mask], 1)
                        xs = np.linspace(np.nanmin(x), np.nanmax(x), 50)
                        ax.plot(xs, k * xs + b, color=colors[1], linewidth=0.9)
            elif kind == "line":
                ax.plot(x if x is not None else np.arange(len(y)), y, color=colors[0], linewidth=1.0, marker="o", markersize=2.5)
            else:
                ax.bar(np.arange(len(y)), y, color=colors[0], width=0.65)
            if len(labels) and len(labels) == len(y):
                ax.set_xticks(np.arange(len(y)))
                ax.set_xticklabels(labels)
            ax.set_xlabel(xlabel)
            ax.set_ylabel(ylabel)

    elif kind in ("box", "violin", "paired", "curve"):
        groups = [(k, v[np.isfinite(v)]) for k, v in series.items() if np.isfinite(v).any()]
        if not groups:
            fail("没有可用于分组的数值列（给 g1/g2/… 或 y+x 组合）")
        if kind == "box":
            # matplotlib 3.9 把 labels 改成了 tick_labels，两代都得能用，所以不打这个参数，自己设刻度
            ax.boxplot([v for _, v in groups], widths=0.55,
                       medianprops={"color": colors[1], "linewidth": 1.0},
                       boxprops={"color": colors[0], "linewidth": 0.7},
                       whiskerprops={"color": colors[0], "linewidth": 0.7},
                       capprops={"color": colors[0], "linewidth": 0.7},
                       flierprops={"markersize": 1.5, "markeredgewidth": 0.4})
            ax.set_xticks(np.arange(1, len(groups) + 1))
            ax.set_xticklabels([k for k, _ in groups])
        elif kind == "violin":
            parts = ax.violinplot([v for _, v in groups], showmedians=True, widths=0.7)
            for i, body in enumerate(parts["bodies"]):
                body.set_facecolor(colors[i % len(colors)])
                body.set_edgecolor(colors[0])
                body.set_alpha(0.55)
            ax.set_xticks(np.arange(1, len(groups) + 1))
            ax.set_xticklabels([k for k, _ in groups])
        elif kind == "paired":
            if len(groups) != 2:
                fail("paired 图需要恰好两列（前测/后测）")
            a, b = groups[0][1], groups[1][1]
            if len(a) != len(b):
                fail("paired 图要求两列长度相同")
            for i in range(len(a)):
                ax.plot([0, 1], [a[i], b[i]], color="#999999", linewidth=0.4, alpha=0.6)
            ax.plot([0, 1], [np.mean(a), np.mean(b)], color=colors[1], linewidth=1.4, marker="o", markersize=3)
            ax.set_xticks([0, 1])
            ax.set_xticklabels([groups[0][0], groups[1][0]])
            ax.set_xlim(-0.3, 1.3)
        else:  # curve
            for i, (k, v) in enumerate(groups):
                ax.plot(np.arange(len(v)), v, color=colors[i % len(colors)], linewidth=1.0, label=k)
            if len(groups) > 1:
                ax.legend(frameon=False, handlelength=1.2)
            ax.set_xlabel(xlabel or "步")
        if kind != "paired":
            ax.set_ylabel(ylabel or "值")

    elif kind == "hist":
        y = series.get("y") if "y" in series else (next(iter(series.values())) if series else None)
        if y is None:
            fail("hist 需要 data.y")
        ax.hist(y[np.isfinite(y)], bins=int(style.get("bins") or 20), color=colors[0],
                edgecolor="white", linewidth=0.4)
        ax.set_xlabel(xlabel or "值")
        ax.set_ylabel(ylabel or "计数")

    elif kind == "heatmap":
        keys = list(series.keys())
        if len(keys) < 2:
            fail("heatmap 需要至少两列数值构成矩阵")
        matrix = np.column_stack([series[k] for k in keys])
        matrix = matrix[~np.isnan(matrix).any(axis=1)]
        if matrix.size == 0:
            fail("heatmap 去掉缺失行后没有数据")
        im = ax.imshow(matrix.T, aspect="auto", cmap="viridis", interpolation="nearest")
        ax.set_yticks(np.arange(len(keys)))
        ax.set_yticklabels(keys)
        ax.set_xlabel(xlabel or "观测")
        cb = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.02)
        cb.ax.tick_params(labelsize=font_size - 1, width=0.5)

    if title:
        ax.set_title(title)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(bool(style.get("boxed")))

    out = req.get("out") or {}
    name = str(out.get("name") or f"figure-{kind}")
    formats = out.get("formats") or ["pdf", "png"]
    target_dir = out.get("dir") or "."
    os.makedirs(target_dir, exist_ok=True)

    written = []
    skipped = []
    for fmt in formats:
        path = os.path.join(target_dir, f"{name}.{fmt}")
        try:
            fig.savefig(path, format=fmt, dpi=dpi if fmt in ("png", "tif", "tiff", "jpg") else None)
            written.append({"path": path, "format": fmt, "bytes": os.path.getsize(path)})
        except Exception as exc:  # noqa: BLE001
            skipped.append({"format": fmt, "reason": str(exc)[:200]})

    plt.close(fig)

    result = {
        "ok": True,
        "kind": kind,
        "files": written,
        "skipped": skipped,
        "widthMm": width_mm,
        "heightMm": height_mm,
        "dpi": dpi,
        "fontSize": font_size,
        "palette": palette_name,
        "aspect": round(width_mm / height_mm, 3),
        "note": "尺寸是物理毫米，不要再在排版软件里缩放——缩放会改掉字号，多数期刊会因此退修。",
    }
    if note:
        result["warning"] = note

    # 期刊硬性要求自检
    checks = []
    checks.append({"id": "font", "ok": font_size >= 6, "detail": f"{font_size} pt（多数期刊要求 ≥6 pt，正文图注 7–8 pt）"})
    checks.append({"id": "vector", "ok": any(f["format"] in ("pdf", "svg", "eps") for f in written), "detail": "投稿需要矢量图（PDF/EPS/SVG）"})
    checks.append({"id": "dpi", "ok": dpi >= 300 or not any(f["format"] == "png" for f in written), "detail": f"{dpi} dpi（位图 ≥300，线条图建议 ≥600）"})
    checks.append({"id": "width", "ok": width_mm in (85.0, 88.0, 90.0, 180.0, 183.0, 190.0) or 40 <= width_mm <= 200,
                   "detail": f"{width_mm} mm；单栏常见 85–90 mm，双栏 180–190 mm"})
    result["checks"] = checks
    result["ready"] = all(c["ok"] for c in checks)
    emit(result)


if __name__ == "__main__":
    main()
