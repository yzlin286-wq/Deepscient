#!/usr/bin/env python3
"""样本量与最小可检测效应（MDE）计算。

stdin 收一个 JSON 请求，stdout 出一个 JSON 结果。**永远只输出 JSON**：
出错也走 {"ok": false, "error": ...}，不把 traceback 甩给上层——上层是给研究生看的，
一行 traceback 对他没有任何用处，一句「效应量超出可计算范围」才有。

请求字段
  kind        ttest | paired | anova | proportions | correlation | mde
  alpha       默认 0.05
  power       默认 0.80
  effect      效应量。ttest/paired 用 Cohen's d；anova 用 Cohen's f；
              proportions 用 {p1, p2}；correlation 用 r；mde 时忽略
  ratio       组间分配比（默认 1.0）
  k_groups    anova 的组数（默认 2）
  design_effect  聚类设计效应，乘在最终 n 上（默认 1.0）
  n           mde 模式下的已有样本量（每组）
  tails       1 | 2（默认 2）

输出字段
  ok, kind, n_per_group, n_total, alpha, power, effect, effect_kind,
  achieved_power, design_effect, method, note
"""

import json
import math
import sys


def fail(message, **extra):
    out = {"ok": False, "error": message}
    out.update(extra)
    print(json.dumps(out, ensure_ascii=False))
    sys.exit(0)


def main():
    try:
        raw = sys.stdin.read()
        req = json.loads(raw) if raw.strip() else {}
    except Exception as exc:  # noqa: BLE001
        fail(f"请求不是合法 JSON：{exc}")

    try:
        from statsmodels.stats.power import (
            FTestAnovaPower,
            NormalIndPower,
            TTestIndPower,
            TTestPower,
        )
        from statsmodels.stats.proportion import proportion_effectsize
    except Exception as exc:  # noqa: BLE001
        fail(f"statsmodels 不可用：{exc}")

    kind = str(req.get("kind") or "ttest").lower()
    alpha = float(req.get("alpha") or 0.05)
    power = float(req.get("power") or 0.80)
    ratio = float(req.get("ratio") or 1.0)
    k_groups = int(req.get("k_groups") or 2)
    design_effect = float(req.get("design_effect") or 1.0)
    tails = int(req.get("tails") or 2)
    alternative = "two-sided" if tails == 2 else "larger"

    if not (0.0 < alpha < 1.0):
        fail("alpha 必须在 (0,1) 内")
    if not (0.0 < power < 1.0):
        fail("power 必须在 (0,1) 内")
    if design_effect < 1.0:
        fail("design_effect 不能小于 1（聚类只会让样本量变大）")

    result = {
        "ok": True,
        "kind": kind,
        "alpha": alpha,
        "power": power,
        "ratio": ratio,
        "k_groups": k_groups,
        "tails": tails,
        "design_effect": design_effect,
        "method": "lib",
        "note": "",
    }

    def finish(n_per_group, achieved, effect_value, effect_kind, note=""):
        n_adj = int(math.ceil(n_per_group * design_effect))
        result.update({
            "n_per_group": n_adj,
            "n_per_group_unadjusted": int(math.ceil(n_per_group)),
            "n_total": int(math.ceil(n_adj * (k_groups if kind == "anova" else (1 + ratio)))),
            "effect": effect_value,
            "effect_kind": effect_kind,
            "achieved_power": round(float(achieved), 4) if achieved is not None else None,
            "note": note,
        })
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(0)

    if kind in ("ttest", "t-test", "between"):
        effect = req.get("effect")
        if effect is None:
            fail("kind=ttest 需要 effect（Cohen's d）")
        effect = float(effect)
        if effect <= 0:
            fail("效应量必须为正数；方向不影响样本量")
        solver = TTestIndPower()
        n = solver.solve_power(effect_size=effect, alpha=alpha, power=power, ratio=ratio, alternative=alternative)
        achieved = solver.power(effect_size=effect, nobs1=n, alpha=alpha, ratio=ratio, alternative=alternative)
        finish(n, achieved, effect, "cohen_d",
               "两组独立，Welch 校正下样本量需略增（约 2%）" if ratio == 1 else "")

    elif kind in ("paired", "within"):
        effect = req.get("effect")
        if effect is None:
            fail("kind=paired 需要 effect（配对 Cohen's d）")
        effect = float(effect)
        if effect <= 0:
            fail("效应量必须为正数")
        solver = TTestPower()
        n = solver.solve_power(effect_size=effect, alpha=alpha, power=power, alternative=alternative)
        achieved = solver.power(effect_size=effect, nobs=n, alpha=alpha, alternative=alternative)
        finish(n, achieved, effect, "cohen_d_paired", "配对设计：n 是配对数，不是观测总数")

    elif kind in ("anova",):
        effect = req.get("effect")
        if effect is None:
            fail("kind=anova 需要 effect（Cohen's f）")
        effect = float(effect)
        if effect <= 0:
            fail("效应量必须为正数")
        if k_groups < 2:
            fail("k_groups 至少为 2")
        solver = FTestAnovaPower()
        n = solver.solve_power(effect_size=effect, alpha=alpha, power=power, k_groups=k_groups)
        achieved = solver.power(effect_size=effect, nobs=n, alpha=alpha, k_groups=k_groups)
        finish(n, achieved, effect, "cohen_f", f"n 为每组样本量，共 {k_groups} 组")

    elif kind in ("proportions", "prop"):
        spec = req.get("effect")
        if not isinstance(spec, dict):
            fail("kind=proportions 需要 effect: {p1, p2}")
        p1 = spec.get("p1")
        p2 = spec.get("p2")
        if p1 is None or p2 is None:
            fail("proportions 需要 p1 与 p2")
        p1, p2 = float(p1), float(p2)
        if not (0.0 < p1 < 1.0 and 0.0 < p2 < 1.0):
            fail("p1/p2 必须在 (0,1) 内")
        if p1 == p2:
            fail("p1 与 p2 相同，效应量为零")
        es = proportion_effectsize(p1, p2)
        solver = NormalIndPower()
        n = solver.solve_power(effect_size=es, alpha=alpha, power=power, ratio=ratio, alternative=alternative)
        achieved = solver.power(effect_size=es, nobs1=n, alpha=alpha, ratio=ratio, alternative=alternative)
        finish(n, achieved, round(float(es), 4), "cohen_h",
               f"由 {p1} 与 {p2} 折算的 Cohen's h；率接近 0 或 1 时正态近似偏乐观")

    elif kind in ("correlation", "corr"):
        effect = req.get("effect")
        if effect is None:
            fail("kind=correlation 需要 effect（Pearson r）")
        r = float(effect)
        if not (-1.0 < r < 1.0) or r == 0:
            fail("r 必须在 (-1,1) 内且不为 0")
        if abs(r) < 0.02:
            fail("|r| < 0.02 时所需样本量超过十万，超出可计算范围")
        es = 0.5 * math.log((1 + abs(r)) / (1 - abs(r)))  # Fisher z
        solver = NormalIndPower()
        n = solver.solve_power(effect_size=es, alpha=alpha, power=power, alternative=alternative) + 3
        achieved = solver.power(effect_size=es, nobs1=n - 3, alpha=alpha, alternative=alternative)
        finish(n, achieved, r, "pearson_r", "Fisher z 变换后正态近似，n 已加 3 修正")

    elif kind in ("mde", "minimum-detectable"):
        n = req.get("n")
        if n is None:
            fail("kind=mde 需要 n（每组已有样本量）")
        n = float(n)
        if n < 3:
            fail("n 太小，无法计算 MDE")
        probe = str(req.get("probe") or "ttest").lower()
        if probe in ("anova",):
            solver = FTestAnovaPower()
            effect = solver.solve_power(effect_size=None, nobs=n, alpha=alpha, power=power, k_groups=k_groups)
            effect_kind = "cohen_f"
        elif probe in ("paired", "within"):
            solver = TTestPower()
            effect = solver.solve_power(effect_size=None, nobs=n, alpha=alpha, power=power, alternative=alternative)
            effect_kind = "cohen_d_paired"
        else:
            solver = TTestIndPower()
            effect = solver.solve_power(effect_size=None, nobs1=n, alpha=alpha, power=power, ratio=ratio, alternative=alternative)
            effect_kind = "cohen_d"
        result.update({
            "n_per_group": int(n),
            "n_total": int(n * (k_groups if probe == "anova" else (1 + ratio))),
            "effect": round(float(effect), 4),
            "effect_kind": effect_kind,
            "achieved_power": power,
            "method": "lib",
            "note": "这是给定 n 能检测到的最小效应；比它更小的真实效应会被判为不显著。事前算这个比事后算功效有意义。",
        })
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(0)

    else:
        fail(f"未知 kind：{kind}（可用 ttest / paired / anova / proportions / correlation / mde）")


if __name__ == "__main__":
    main()
