#!/usr/bin/env python3
"""统计执行器。

stdin 收 JSON，stdout 出 JSON。永远只输出 JSON——出错也走 {"ok": false, ...}。

请求
  testId    statistics.json 里的检验 id
  data      {列名: [值...]}；列长度必须一致
  options   alpha / tails / mu / correction / seed / predictors / groups 等

输出（成功）
  ok, testId, label, n, statistic, df, p, effectSize{kind,value,ci},
  assumptions[{id,label,ok,detail}], warnings[], reportAs, method, seed

三个设计原则
  1. 假设检查是**结果的一部分**，不是前置步骤。假设不满足时照样出结果，
     但把结论标成需要降级，由上层提示换成 fallback 检验。
  2. 效应量与其 CI 一起给。只给 p 的结果在这个应用里算残缺。
  3. 不支持的检验返回 method="unsupported" 并附上 statistics.json 里的 py 片段，
     而不是硬塞一个近似方法。假装支持比不支持更危险。
"""

import json
import math
import sys
import warnings

import numpy as np

warnings.filterwarnings("ignore", category=RuntimeWarning)
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False, default=_json_safe))
    sys.exit(0)


def _json_safe(value):
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        v = float(value)
        return None if math.isnan(v) or math.isinf(v) else v
    if isinstance(value, np.ndarray):
        return [_json_safe(v) for v in value.tolist()]
    if isinstance(value, (np.bool_,)):
        return bool(value)
    return str(value)


def fail(message, **extra):
    out = {"ok": False, "error": message}
    out.update(extra)
    emit(out)


def num(v):
    """把 numpy 标量/NaN 变成 JSON 能接受的值。"""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def pfmt(p):
    if p is None:
        return "p = n/a"
    if p < 0.001:
        return "p < .001"
    return f"p = {p:.3f}"


def ci_of(lo, hi):
    if lo is None or hi is None:
        return None
    return [num(lo), num(hi)]


# ── 效应量 ────────────────────────────────────────────────────────────────
def cohens_d(a, b):
    na, nb = len(a), len(b)
    va, vb = np.var(a, ddof=1), np.var(b, ddof=1)
    pooled = math.sqrt(((na - 1) * va + (nb - 1) * vb) / max(na + nb - 2, 1))
    if pooled == 0:
        return None, None
    d = (np.mean(a) - np.mean(b)) / pooled
    se = math.sqrt((na + nb) / (na * nb) + d * d / (2 * (na + nb)))
    return num(d), ci_of(d - 1.96 * se, d + 1.96 * se)


def eta_sq_from_f(f, df1, df2):
    if f is None or df1 is None or df2 is None:
        return None
    return num((f * f * df1) / (f * f * df1 + df2))


def rank_biserial_from_u(u, n1, n2):
    if u is None or n1 == 0 or n2 == 0:
        return None
    return num(2 * u / (n1 * n2) - 1)


def r_from_stat(t, df):
    if t is None or df is None or df <= 0:
        return None
    return num(t / math.sqrt(t * t + df))


# ── 假设检查 ──────────────────────────────────────────────────────────────
def check_normality(name, values):
    from scipy import stats as st
    arr = np.asarray(values, dtype=float)
    if len(arr) < 3:
        return {"id": f"normality-{name}", "label": f"{name} 正态性", "ok": None, "detail": "样本太小，无法检验"}
    if len(arr) <= 50:
        w, p = st.shapiro(arr)
        return {
            "id": f"normality-{name}", "label": f"{name} 正态性（Shapiro-Wilk）",
            "ok": bool(p > 0.05), "detail": f"W = {w:.3f}, {pfmt(p)}",
        }
    skew = float(st.skew(arr))
    kurt = float(st.kurtosis(arr))
    return {
        "id": f"normality-{name}", "label": f"{name} 正态性（偏度/峰度，n>50）",
        "ok": bool(abs(skew) < 2 and abs(kurt) < 7),
        "detail": f"偏度 {skew:.2f}, 峰度 {kurt:.2f}（|偏度|<2 且 |峰度|<7 视为可接受）",
    }


def check_variance(a, b):
    from scipy import stats as st
    if len(a) < 3 or len(b) < 3:
        return {"id": "variance", "label": "方差齐性", "ok": None, "detail": "样本太小"}
    w, p = st.levene(a, b)
    return {"id": "variance", "label": "方差齐性（Levene）", "ok": bool(p > 0.05), "detail": f"W = {w:.3f}, {pfmt(p)}"}


# ── 各检验 ────────────────────────────────────────────────────────────────
def columns(data, *names):
    missing = [n for n in names if n not in data]
    if missing:
        fail(f"数据里缺列：{', '.join(missing)}；现有列：{', '.join(data.keys())}")
    out = []
    for n in names:
        try:
            arr = [float(x) for x in data[n] if x is not None and x != ""]
        except (TypeError, ValueError):
            fail(f"列 {n} 里有非数值")
        out.append(np.asarray(arr, dtype=float))
    return out


def t_ttest_welch(req, options, tails):
    from scipy import stats as st
    a, b = columns(req["data"], "a", "b")
    alt = "two-sided" if tails == 2 else "greater"
    res = st.ttest_ind(a, b, equal_var=False, alternative=alt)
    t, p = float(res.statistic), float(res.pvalue)
    # Welch 的 df 是 Satterthwaite 近似，不是 n1+n2-2；报告里必须写这个 df
    dfw = num(getattr(res, "df", None) if getattr(res, "df", None) is not None else len(a) + len(b) - 2)
    d, dci = cohens_d(a, b)
    return {
        "label": "Welch 双样本 t 检验",
        "n": {"a": len(a), "b": len(b)},
        "statistic": num(t),
        "df": dfw,
        "p": num(p),
        "effectSize": {"kind": "cohens-d", "value": d, "ci": dci},
        "assumptions": [check_normality("a", a), check_normality("b", b)],
        "reportAs": f"Welch t({dfw:.2f}) = {num(t):.2f}，{pfmt(num(p))}，Cohen's d = {d if d is None else round(d, 2)}",
    }


def t_ttest_rel(req, options, tails):
    from scipy import stats as st
    a, b = columns(req["data"], "a", "b")
    if len(a) != len(b):
        fail("配对 t 检验要求两列长度相同")
    alt = "two-sided" if tails == 2 else "greater"
    t, p = st.ttest_rel(a, b, alternative=alt)
    diff = a - b
    sd = np.std(diff, ddof=1)
    dz = num(np.mean(diff) / sd) if sd > 0 else None
    se = sd / math.sqrt(len(diff)) if len(diff) > 0 else None
    # dz 的区间要按 dz 自身的标准误算；均值差的区间是另一个量，不能挂在 effectSize 下
    dz_se = math.sqrt(1 / len(diff) + (dz * dz) / (2 * len(diff))) if dz is not None and len(diff) > 0 else None
    return {
        "label": "配对 t 检验",
        "n": {"pairs": len(a)},
        "statistic": num(t), "df": len(a) - 1, "p": num(p),
        "effectSize": {"kind": "cohens-dz", "value": dz,
                       "ci": ci_of(dz - 1.96 * dz_se, dz + 1.96 * dz_se) if dz_se else None},
        "meanDiff": {"value": num(np.mean(diff)),
                     "ci": ci_of(np.mean(diff) - 1.96 * se, np.mean(diff) + 1.96 * se) if se else None},
        "assumptions": [check_normality("差值", diff)],
        "reportAs": f"配对 t({len(a) - 1}) = {num(t):.2f}，{pfmt(num(p))}，Cohen's dz = {dz if dz is None else round(dz, 2)}",
    }


def t_mannwhitney(req, options, tails):
    from scipy import stats as st
    a, b = columns(req["data"], "a", "b")
    alt = "two-sided" if tails == 2 else "greater"
    u, p = st.mannwhitneyu(a, b, alternative=alt)
    rrb = rank_biserial_from_u(u, len(a), len(b))
    return {
        "label": "Mann-Whitney U 检验",
        "n": {"a": len(a), "b": len(b)},
        "statistic": num(u), "df": None, "p": num(p),
        "effectSize": {"kind": "rank-biserial", "value": rrb, "ci": None},
        "assumptions": [{"id": "independence", "label": "两组独立", "ok": None, "detail": "需由设计保证"}],
        "reportAs": f"U = {num(u):.0f}，{pfmt(num(p))}，秩二列相关 r = {rrb if rrb is None else round(rrb, 2)}",
    }


def t_wilcoxon(req, options, tails):
    from scipy import stats as st
    a, b = columns(req["data"], "a", "b")
    alt = "two-sided" if tails == 2 else "greater"
    try:
        w, p = st.wilcoxon(a, b, alternative=alt)
    except ValueError as exc:
        fail(f"Wilcoxon 失败：{exc}（差值全为 0 时无法检验）")
    # 效应量：匹配对秩和检验的 r = Z / sqrt(N)，Z 由正态近似给出
    diff = a - b
    nz = int(np.count_nonzero(diff))
    if nz > 0:
        try:
            z = float(st.norm.isf(float(p) / 2)) if 0 < float(p) < 1 else 0.0
        except Exception:
            z = 0.0
        r_eff = num(z / math.sqrt(nz))
    else:
        r_eff = None
    return {
        "label": "Wilcoxon 符号秩检验",
        "n": {"pairs": len(a)},
        "statistic": num(w), "df": None, "p": num(p),
        "effectSize": {"kind": "rank-biserial", "value": r_eff, "ci": None},
        "assumptions": [{"id": "symmetry", "label": "差值分布大致对称", "ok": None, "detail": "对称性不成立时改用符号检验"}],
        "reportAs": f"Wilcoxon W = {num(w):.0f}，{pfmt(num(p))}" + (f"，r = {round(r_eff, 2)}" if r_eff is not None else ""),
    }


def t_anova_oneway(req, options, tails):
    from scipy import stats as st
    groups = _groups(req["data"])
    if len(groups) < 2:
        fail("ANOVA 至少需要 2 组；分组列命名为 g1/g2/g3 或 group")
    f, p = st.f_oneway(*groups)
    k = len(groups)
    n = sum(len(g) for g in groups)
    eta = eta_sq_from_f(f, k - 1, n - k)
    return {
        "label": "单因素方差分析",
        "n": {f"g{i + 1}": len(g) for i, g in enumerate(groups)},
        "statistic": num(f), "df": num(k - 1), "p": num(p),
        "effectSize": {"kind": "eta-squared", "value": eta, "ci": None},
        "assumptions": [check_normality(f"g{i + 1}", g) for i, g in enumerate(groups)],
        "reportAs": f"F({k - 1}, {n - k}) = {num(f):.2f}，{pfmt(num(p))}，η² = {eta}",
    }


def t_welch_anova(req, options, tails):
    from scipy import stats as st
    groups = _groups(req["data"])
    if len(groups) < 2:
        fail("Welch ANOVA 至少需要 2 组")
    res = st.alexandergovern(*groups)
    return {
        "label": "Welch ANOVA（Alexander-Govern）",
        "n": {f"g{i + 1}": len(g) for i, g in enumerate(groups)},
        "statistic": num(res.statistic), "df": num(len(groups) - 1), "p": num(res.pvalue),
        "effectSize": {"kind": "eta-squared", "value": None, "ci": None},
        "assumptions": [{"id": "variance", "label": "不要求方差齐性", "ok": True, "detail": "这正是选 Welch 的理由"}],
        "reportAs": f"Welch 方差分析 F({len(groups) - 1}) = {num(res.statistic):.2f}，{pfmt(num(res.pvalue))}（Alexander-Govern 近似）",
    }


def t_kruskal(req, options, tails):
    from scipy import stats as st
    groups = _groups(req["data"])
    if len(groups) < 2:
        fail("Kruskal-Wallis 至少需要 2 组")
    h, p = st.kruskal(*groups)
    n = sum(len(g) for g in groups)
    k = len(groups)
    eps = num((h - k + 1) / (n - k)) if n > k else None
    return {
        "label": "Kruskal-Wallis 检验",
        "n": {f"g{i + 1}": len(g) for i, g in enumerate(groups)},
        "statistic": num(h), "df": k - 1, "p": num(p),
        "effectSize": {"kind": "epsilon-squared", "value": eps, "ci": None},
        "assumptions": [{"id": "independence", "label": "各组独立", "ok": None, "detail": "由设计保证"}],
        "reportAs": f"H({k - 1}) = {num(h):.2f}，{pfmt(num(p))}，ε² = {eps}",
    }


def t_friedman(req, options, tails):
    from scipy import stats as st
    groups = _groups(req["data"])
    if len(groups) < 3:
        fail("Friedman 至少需要 3 个重复测量条件")
    lengths = {len(g) for g in groups}
    if len(lengths) != 1:
        fail("Friedman 要求每个条件下的观测数相同")
    stat, p = st.friedmanchisquare(*groups)
    return {
        "label": "Friedman 检验",
        "n": {"blocks": lengths.pop(), "conditions": len(groups)},
        "statistic": num(stat), "df": len(groups) - 1, "p": num(p),
        "effectSize": {"kind": "kendalls-w", "value": num(stat / (len(groups[0]) * (len(groups) - 1))) if len(groups[0]) > 1 else None, "ci": None},
        "assumptions": [{"id": "blocks", "label": "同一区块内条件可比", "ok": True, "detail": "被试内设计"}],
        "reportAs": f"Friedman χ²({len(groups) - 1}) = {num(stat):.2f}，{pfmt(num(p))}"
                    + (f"，Kendall's W = {round(num(stat / (len(groups[0]) * (len(groups) - 1))), 2)}" if len(groups[0]) > 1 else ""),
    }


def t_pearson(req, options, tails):
    from scipy import stats as st
    x, y = columns(req["data"], "x", "y")
    r, p = st.pearsonr(x, y)
    n = len(x)
    z = math.atanh(max(min(r, 0.999999), -0.999999))
    se = 1 / math.sqrt(max(n - 3, 1))
    return {
        "label": "Pearson 相关",
        "n": {"n": n},
        "statistic": num(r), "df": n - 2, "p": num(p),
        "effectSize": {"kind": "r-squared", "value": num(r * r), "ci": None},
        "assumptions": [check_normality("x", x), check_normality("y", y),
                        {"id": "linear", "label": "关系近似线性", "ok": None, "detail": "先看散点图；非线性时 r 会低估关系"}],
        "reportAs": f"r({n - 2}) = {num(r):.3f}，{pfmt(num(p))}，R² = {num(r * r):.3f}（r 的 95% CI [{math.tanh(z - 1.96 * se):.2f}, {math.tanh(z + 1.96 * se):.2f}]）",
    }


def t_spearman(req, options, tails):
    from scipy import stats as st
    x, y = columns(req["data"], "x", "y")
    rho, p = st.spearmanr(x, y)
    return {
        "label": "Spearman 秩相关",
        "n": {"n": len(x)},
        "statistic": num(rho), "df": None, "p": num(p),
        "effectSize": {"kind": "rho-squared", "value": num(rho * rho), "ci": None},
        "assumptions": [{"id": "monotonic", "label": "关系单调", "ok": None, "detail": "非单调时秩相关也会低估"}],
        "reportAs": f"ρ = {num(rho):.3f}，{pfmt(num(p))}",
    }


def t_kendall(req, options, tails):
    from scipy import stats as st
    x, y = columns(req["data"], "x", "y")
    tau, p = st.kendalltau(x, y)
    return {
        "label": "Kendall τ",
        "n": {"n": len(x)},
        "statistic": num(tau), "df": None, "p": num(p),
        "effectSize": {"kind": "tau", "value": num(tau), "ci": None},
        "assumptions": [{"id": "monotonic", "label": "关系单调", "ok": None, "detail": "小样本或有大量并列值时用 τ-b"}],
        "reportAs": f"τ = {num(tau):.3f}，{pfmt(num(p))}",
    }


def t_chi2(req, options, tails):
    from scipy import stats as st
    table = req["data"].get("table")
    if not table:
        fail('卡方检验需要 data.table（二维计数表）')
    arr = np.asarray(table, dtype=float)
    # 2×2 表上 Yates 连续性校正会显著改小统计量（例：9.09 → 7.92）。
    # 这不是「哪个更对」的问题，而是必须先声明的事：两种口径同时给，由用户按领域惯例选。
    correction = str(options.get("correction") or "yates").lower()
    use_yates = correction not in ("none", "off", "false", "0")
    chi2, p, dof, expected = st.chi2_contingency(arr, correction=use_yates and min(arr.shape) == 2)
    chi2_raw, p_raw, _, _ = st.chi2_contingency(arr, correction=False)
    n = arr.sum()
    v = num(math.sqrt(chi2 / (n * (min(arr.shape) - 1)))) if n > 0 and min(arr.shape) > 1 else None
    small = bool((expected < 5).any())
    detail = f"最小期望频数 {expected.min():.1f}；不满足时用 Fisher 精确检验"
    if use_yates and min(arr.shape) == 2:
        detail += f"；未校正 χ² = {chi2_raw:.3f}（p = {p_raw:.4f}）"
    return {
        "label": "Pearson 卡方检验" + ("（Yates 校正）" if use_yates and min(arr.shape) == 2 else ""),
        "n": {"total": int(n)},
        "statistic": num(chi2), "df": int(dof), "p": num(p),
        "correction": "yates" if use_yates and min(arr.shape) == 2 else "none",
        "uncorrected": {"statistic": num(chi2_raw), "p": num(p_raw)},
        "effectSize": {"kind": "cramers-v", "value": v, "ci": None},
        "assumptions": [{"id": "expected", "label": "每格期望频数 ≥5", "ok": not small, "detail": detail}],
        "reportAs": f"χ²({int(dof)}) = {num(chi2):.2f}，{pfmt(num(p))}，Cramér's V = {v}"
        + ("（Yates 校正）" if use_yates and min(arr.shape) == 2 else ""),
    }


def t_fisher(req, options, tails):
    from scipy import stats as st
    table = req["data"].get("table")
    if not table:
        fail('Fisher 精确检验需要 data.table（2×2）')
    arr = np.asarray(table, dtype=float)
    if arr.shape != (2, 2):
        fail("Fisher 精确检验只接受 2×2 表")
    odds, p = st.fisher_exact(arr)
    return {
        "label": "Fisher 精确检验",
        "n": {"total": int(arr.sum())},
        "statistic": num(odds), "df": None, "p": num(p),
        "effectSize": {"kind": "odds-ratio", "value": num(odds), "ci": None},
        "assumptions": [{"id": "fixed-margins", "label": "边际固定", "ok": True, "detail": "精确检验不依赖大样本近似"}],
        "reportAs": f"Fisher OR = {num(odds):.2f}，{pfmt(num(p))}",
    }


def t_mcnemar(req, options, tails):
    from scipy import stats as st
    table = req["data"].get("table")
    if not table:
        fail('McNemar 检验需要 data.table（2×2 配对表）')
    arr = np.asarray(table, dtype=float)
    if arr.shape != (2, 2):
        fail("McNemar 只接受 2×2 配对表")
    # scipy 并不带 mcnemar（较新版本才有），这里直接做精确二项检验：
    # 只看不一致的格子，在 H0（两者等价）下它们应各占一半。
    b, c = float(arr[0, 1]), float(arr[1, 0])
    discordant = int(b + c)
    if discordant == 0:
        fail("没有不一致的配对（b+c=0），McNemar 无法检验")
    res = st.binomtest(int(min(b, c)), discordant, 0.5)
    return {
        "label": "McNemar 检验",
        "n": {"total": int(arr.sum()), "discordant": discordant},
        "statistic": num(min(b, c)), "df": None, "p": num(res.pvalue),
        "effectSize": {"kind": "odds-ratio", "value": num(b / c) if c else None, "ci": None},
        "assumptions": [{"id": "paired", "label": "配对二分类", "ok": True, "detail": "同一对象两次测量"}],
        "reportAs": f"McNemar 精确检验 p = {num(res.pvalue):.4f}（不一致对 {discordant}，b={int(b)}, c={int(c)}）",
    }


def t_ols(req, options, tails, robust=False):
    import statsmodels.api as sm
    y, X = _design(req["data"], options)
    model = sm.OLS(y, X)
    fit = model.fit(cov_type="HC3") if robust else model.fit()
    coef = fit.params
    ci = fit.conf_int()
    return {
        "label": "OLS 回归（HC3 稳健标准误）" if robust else "OLS 回归",
        "n": {"n": int(fit.nobs), "k": int(X.shape[1])},
        "statistic": num(fit.fvalue) if hasattr(fit, "fvalue") else None,
        "df": int(fit.nobs - X.shape[1]),
        "p": num(fit.f_pvalue) if hasattr(fit, "f_pvalue") else None,
        "effectSize": {"kind": "adjusted-r2", "value": num(fit.rsquared_adj), "ci": None},
        "coefficients": [
            {"name": name, "estimate": num(coef[name]), "se": num(fit.bse[name]),
             "p": num(fit.pvalues[name]), "ci": ci_of(ci.iloc[i, 0], ci.iloc[i, 1])}
            for i, name in enumerate(coef.index)
        ],
        "assumptions": [
            {"id": "epv", "label": "样本量相对变量数充足", "ok": bool(fit.nobs >= 10 * X.shape[1]),
             "detail": f"n={int(fit.nobs)}，变量 {X.shape[1]} 个"},
        ],
        "reportAs": f"F({int(fit.df_model)}, {int(fit.df_resid)}) = {num(fit.fvalue):.2f}，{pfmt(num(fit.f_pvalue))}，调整 R² = {num(fit.rsquared_adj):.3f}",
    }


def t_logit(req, options, tails):
    import statsmodels.api as sm
    y, X = _design(req["data"], options)
    if len(set(y.tolist())) != 2:
        fail("Logistic 回归的 y 必须是二分类（0/1）")
    fit = sm.Logit(y, X).fit(disp=0, maxiter=200)
    events = int(min(y.sum(), len(y) - y.sum()))
    epv = events / max(X.shape[1] - 1, 1)
    return {
        "label": "Logistic 回归",
        "n": {"n": int(fit.nobs), "events": events},
        "statistic": num(getattr(fit, "llr", None)), "df": int(X.shape[1] - 1),
        "p": num(getattr(fit, "llr_pvalue", None)),
        "effectSize": {"kind": "mcfadden-r2", "value": num(getattr(fit, "prsquared", None)), "ci": None},
        "coefficients": [
            {"name": name, "estimate": num(fit.params[name]), "se": num(fit.bse[name]),
             "oddsRatio": num(math.exp(fit.params[name])), "p": num(fit.pvalues[name])}
            for name in fit.params.index
        ],
        "assumptions": [{"id": "epv", "label": "每变量事件数 ≥10", "ok": bool(epv >= 10),
                         "detail": f"EPV = {epv:.1f}；不足时改用 Firth 惩罚或减少变量"}],
        "reportAs": f"LR χ²({int(X.shape[1] - 1)}) = {num(getattr(fit, 'llr', None)):.2f}，{pfmt(num(getattr(fit, 'llr_pvalue', None)))}",
    }


def t_poisson(req, options, tails):
    import statsmodels.api as sm
    y, X = _design(req["data"], options)
    fit = sm.GLM(y, X, family=sm.families.Poisson()).fit()
    pearson = float(fit.pearson_chi2) / max(fit.df_resid, 1)
    return {
        "label": "Poisson 回归",
        "n": {"n": int(fit.nobs)},
        "statistic": num(fit.deviance), "df": int(fit.df_resid), "p": None,
        "effectSize": {"kind": "mcfadden-r2", "value": num(1 - fit.deviance / max(fit.null_deviance, 1e-12)), "ci": None},
        "coefficients": [
            {"name": name, "estimate": num(fit.params[name]), "se": num(fit.bse[name]),
             "rateRatio": num(math.exp(fit.params[name])), "p": num(fit.pvalues[name])}
            for name in fit.params.index
        ],
        "assumptions": [{"id": "dispersion", "label": "无过度离散（Pearson χ²/df ≈ 1）", "ok": bool(pearson < 1.5),
                         "detail": f"Pearson χ²/df = {pearson:.2f}；>1.5 时改用准泊松或负二项"}],
        "reportAs": f"Deviance = {num(fit.deviance):.2f}，df = {int(fit.df_resid)}",
    }


def t_mixedlm(req, options, tails):
    import statsmodels.formula.api as smf
    data = req["data"]
    for col in ("y", "x", "group"):
        if col not in data:
            fail(f"混合模型需要列 y / x / group；现有：{', '.join(data.keys())}")
    import pandas as pd
    df = pd.DataFrame({"y": data["y"], "x": data["x"], "group": data["group"]})
    df = df.dropna()
    try:
        fit = smf.mixedlm("y ~ x", df, groups=df["group"]).fit(reml=True)
    except Exception as exc:  # noqa: BLE001
        fail(f"混合模型不收敛：{exc}（减少随机效应或用 ridge 惩罚）")
    var_re = float(fit.cov_re.iloc[0, 0])
    var_resid = float(fit.scale)
    marginal = None
    conditional = None
    if var_re + var_resid > 0:
        conditional = var_re / (var_re + var_resid)
    return {
        "label": "线性混合模型",
        "n": {"n": int(fit.nobs), "groups": int(df["group"].nunique())},
        "statistic": num(fit.tvalues.get("x")), "df": None,
        "p": num(fit.pvalues.get("x")),
        "effectSize": {"kind": "marginal-r2", "value": num(marginal), "ci": None},
        "coefficients": [
            {"name": name, "estimate": num(fit.params[name]), "se": num(fit.bse[name]), "p": num(fit.pvalues[name])}
            for name in fit.params.index
        ],
        "assumptions": [
            {"id": "groups", "label": "簇数足够（≥30）", "ok": bool(df["group"].nunique() >= 30),
             "detail": f"簇数 {int(df['group'].nunique())}；不足时随机效应方差估计不稳"},
        ],
        "reportAs": f"β = {num(fit.params['x']):.3f}（SE {num(fit.bse['x']):.3f}），{pfmt(num(fit.pvalues['x']))}，ICC ≈ {num(conditional)}",
    }


def t_permutation(req, options, tails):
    from scipy import stats as st
    groups = _groups(req["data"])
    if len(groups) < 2:
        fail("置换检验至少需要 2 组")
    rng = np.random.default_rng(int(options.get("seed") or 0))
    observed = st.f_oneway(*groups).statistic
    pooled = np.concatenate(groups)
    sizes = [len(g) for g in groups]
    count = 0
    rounds = int(options.get("resamples") or 10000)
    for _ in range(rounds):
        rng.shuffle(pooled)
        idx = 0
        fake = []
        for s in sizes:
            fake.append(pooled[idx:idx + s])
            idx += s
        if st.f_oneway(*fake).statistic >= observed:
            count += 1
    p = (count + 1) / (rounds + 1)
    return {
        "label": "置换方差分析",
        "n": {f"g{i + 1}": len(g) for i, g in enumerate(groups)},
        "statistic": num(observed), "df": len(groups) - 1, "p": num(p),
        "effectSize": {"kind": "eta-squared", "value": None, "ci": None},
        "assumptions": [{"id": "exchangeability", "label": "组内可交换", "ok": True, "detail": "这是置换检验唯一的假设"}],
        "reportAs": f"置换 F = {num(observed):.2f}，p = {p:.4f}（{rounds} 次重抽样）",
    }


def t_bootstrap_median(req, options, tails):
    a, b = columns(req["data"], "a", "b")
    rng = np.random.default_rng(int(options.get("seed") or 0))
    rounds = int(options.get("resamples") or 5000)
    diffs = np.empty(rounds)
    for i in range(rounds):
        diffs[i] = np.median(rng.choice(a, len(a), replace=True)) - np.median(rng.choice(b, len(b), replace=True))
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    point = float(np.median(a) - np.median(b))
    return {
        "label": "Bootstrap 中位数差",
        "n": {"a": len(a), "b": len(b)},
        "statistic": num(point), "df": None,
        "p": num(2 * min((diffs <= 0).mean(), (diffs >= 0).mean())),
        "effectSize": {"kind": "median-diff", "value": num(point), "ci": ci_of(lo, hi)},
        "assumptions": [{"id": "representative", "label": "样本有代表性", "ok": None, "detail": "bootstrap 修不了选择偏倚"}],
        "reportAs": f"中位数差 {point:.3f}（95% bootstrap CI [{lo:.3f}, {hi:.3f}]）",
    }


def t_tost(req, options, tails):
    from scipy import stats as st
    a, b = columns(req["data"], "a", "b")
    bound = options.get("bound")
    if bound is None:
        fail("等效性检验必须给 options.bound（等效界值，事前设定）")
    bound = abs(float(bound))
    diff = np.mean(a) - np.mean(b)
    na, nb = len(a), len(b)
    se = math.sqrt(np.var(a, ddof=1) / na + np.var(b, ddof=1) / nb)
    t1 = (diff + bound) / se
    t2 = (diff - bound) / se
    p1 = 1 - st.t.cdf(t1, na + nb - 2)
    p2 = st.t.cdf(t2, na + nb - 2)
    p = max(p1, p2)
    return {
        "label": "等效性检验（TOST）",
        "n": {"a": na, "b": nb},
        "statistic": num(min(t1, t2)), "df": na + nb - 2, "p": num(p),
        "effectSize": {"kind": "cohens-d", "value": cohens_d(a, b)[0], "ci": ci_of(diff - 1.96 * se, diff + 1.96 * se)},
        "assumptions": [{"id": "bound", "label": "等效界值事前设定", "ok": True, "detail": f"±{bound}"}],
        "reportAs": f"TOST p = {p:.4f}（界值 ±{bound}），{'可宣称等效' if p < 0.05 else '不能宣称等效'}",
    }


def t_pca(req, options, tails):
    data = req["data"]
    matrix = np.column_stack([np.asarray(v, dtype=float) for v in data.values()])
    matrix = matrix[~np.isnan(matrix).any(axis=1)]
    centered = matrix - matrix.mean(axis=0)
    _, s, vt = np.linalg.svd(centered, full_matrices=False)
    var = s ** 2
    ratio = var / var.sum()
    cum = np.cumsum(ratio)
    return {
        "label": "主成分分析",
        "n": {"n": int(matrix.shape[0]), "variables": int(matrix.shape[1])},
        "statistic": num(cum[min(1, len(cum) - 1)]), "df": None, "p": None,
        "effectSize": {"kind": "explained-variance", "value": num(ratio[0]), "ci": None},
        "components": [{"index": i + 1, "explained": num(ratio[i]), "cumulative": num(cum[i])} for i in range(min(5, len(ratio)))],
        "assumptions": [{"id": "linear", "label": "变量间线性关系", "ok": None, "detail": "PCA 对量纲敏感，先标准化"}],
        "reportAs": f"PC1 解释 {num(ratio[0]) * 100:.1f}%，前两主成分累计 {num(cum[min(1, len(cum) - 1)]) * 100:.1f}%",
    }


def t_kaplan_meier(req, options, tails):
    data = req["data"]
    for col in ("time", "event"):
        if col not in data:
            fail("生存分析需要列 time 与 event（event: 1=事件，0=删失）")
    times = np.asarray([float(x) for x in data["time"]], dtype=float)
    events = np.asarray([int(float(x)) for x in data["event"]], dtype=int)
    order = np.argsort(times)
    times, events = times[order], events[order]
    n = len(times)
    survival = []
    s = 1.0
    at_risk = n
    i = 0
    median = None
    while i < n:
        t = times[i]
        d = int(events[i:][times[i:] == t].sum())
        r = int((times >= t).sum())
        if r > 0 and d > 0:
            s *= 1 - d / r
        survival.append({"time": num(t), "survival": num(s), "atRisk": r, "events": d})
        if median is None and s <= 0.5:
            median = float(t)
        i += int((times == t).sum())
    return {
        "label": "Kaplan-Meier 生存曲线",
        "n": {"n": n, "events": int(events.sum()), "censored": int(n - events.sum())},
        "statistic": num(median), "df": None, "p": None,
        "effectSize": {"kind": "median-survival", "value": num(median), "ci": None},
        "curve": survival[:50],
        "assumptions": [{"id": "censoring", "label": "删失与事件独立（非信息删失）", "ok": None, "detail": "信息删失会让曲线偏高"}],
        "reportAs": f"中位生存时间 {median if median is None else round(median, 2)}（事件 {int(events.sum())}/{n}）",
    }


def t_logrank(req, options, tails):
    from scipy import stats as st
    data = req["data"]
    for col in ("time", "event", "group"):
        if col not in data:
            fail("log-rank 需要列 time / event / group")
    times = np.asarray([float(x) for x in data["time"]], dtype=float)
    events = np.asarray([int(float(x)) for x in data["event"]], dtype=int)
    groups = np.asarray([str(x) for x in data["group"]])
    labels = sorted(set(groups.tolist()))
    if len(labels) != 2:
        fail(f"log-rank 目前只支持两组；检测到 {len(labels)} 组")
    # 两样本 log-rank：逐事件时点求 O-E 与方差
    o1 = e1 = v = 0.0
    for t in sorted(set(times[events == 1].tolist())):
        at_risk = times >= t
        d = int(((times == t) & (events == 1)).sum())
        n_risk = int(at_risk.sum())
        n1 = int((at_risk & (groups == labels[0])).sum())
        d1 = int(((times == t) & (events == 1) & (groups == labels[0])).sum())
        if n_risk <= 1:
            continue
        o1 += d1
        e1 += d * n1 / n_risk
        v += d * (n1 / n_risk) * (1 - n1 / n_risk) * (n_risk - d) / (n_risk - 1)
    if v <= 0:
        fail("log-rank 方差为 0（没有可比事件），检查 group 与 event 编码")
    chi2 = (o1 - e1) ** 2 / v
    p = 1 - st.chi2.cdf(chi2, 1)
    return {
        "label": "Log-rank 检验",
        "n": {labels[0]: int((groups == labels[0]).sum()), labels[1]: int((groups == labels[1]).sum())},
        "statistic": num(chi2), "df": 1, "p": num(p),
        "effectSize": {"kind": "hazard-ratio", "value": num((o1 / max(e1, 1e-9))), "ci": None},
        "assumptions": [{"id": "ph", "label": "比例风险", "ok": None, "detail": "曲线交叉时改用 RMST"}],
        "reportAs": f"log-rank χ²(1) = {chi2:.2f}，{pfmt(p)}，HR ≈ {o1 / max(e1, 1e-9):.2f}",
    }


HANDLERS = {
    "ttest-welch": t_ttest_welch,
    "ttest-rel": t_ttest_rel,
    "mannwhitney": t_mannwhitney,
    "wilcoxon": t_wilcoxon,
    "anova-oneway": t_anova_oneway,
    "welch-anova": t_welch_anova,
    "kruskal": t_kruskal,
    "friedman": t_friedman,
    "pearson": t_pearson,
    "spearman": t_spearman,
    "kendall": t_kendall,
    "chi2": t_chi2,
    "fisher": t_fisher,
    "mcnemar": t_mcnemar,
    "ols": lambda r, o, t: t_ols(r, o, t, robust=False),
    "ols-robust": lambda r, o, t: t_ols(r, o, t, robust=True),
    "logit": t_logit,
    "poisson": t_poisson,
    "mixedlm": t_mixedlm,
    "permutation": t_permutation,
    "permutation-anova": t_permutation,
    "bootstrap-median": t_bootstrap_median,
    "bootstrap": t_bootstrap_median,
    "tost": t_tost,
    "pca": t_pca,
    "kaplan-meier": t_kaplan_meier,
    "logrank": t_logrank,
}


def _groups(data):
    """分组：优先 g1/g2/g3…，其次 group 长表（配 y）。"""
    keys = sorted([k for k in data if k.lower().startswith("g") and k[1:].isdigit()])
    if len(keys) >= 2:
        return [np.asarray([float(x) for x in data[k] if x not in (None, "")], dtype=float) for k in keys]
    if "group" in data and "y" in data:
        pairs = {}
        for g, y in zip(data["group"], data["y"]):
            if y in (None, ""):
                continue
            pairs.setdefault(str(g), []).append(float(y))
        return [np.asarray(v, dtype=float) for _, v in sorted(pairs.items())]
    fail("找不到分组：请给 g1/g2/… 或 group+y 长表格式")


def _design(data, options):
    """构造 y 与自变量矩阵。predictors 不写时取除 y 之外的全部数值列。

    返回 (y, X) 都用 pandas，因为系数表要按名字取——用裸 ndarray 会丢掉列名，
    下游就召不回「哪一行的系数」。
    """
    import pandas as pd
    import statsmodels.api as sm
    if "y" not in data:
        fail("回归需要列 y")
    names = options.get("predictors") or [k for k in data if k != "y"]
    if not names:
        fail("回归至少需要一个自变量")
    lens = {len(data[k]) for k in ["y", *names]}
    if len(lens) != 1:
        fail(f"回归各列长度不一致：{sorted(lens)}")
    frame = pd.DataFrame({k: pd.to_numeric(pd.Series(data[k]), errors="coerce") for k in ["y", *names]})
    frame = frame.dropna()
    if frame.empty:
        fail("去掉缺失行后没有数据了")
    y = frame["y"]
    X = sm.add_constant(frame[names], has_constant="add")
    return y, X


def main():
    # Windows 上 Python 的 stdout 默认是 cp936，直接印中文会让调用方的 utf-8 解码炸掉
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    raw = sys.stdin.read()
    try:
        req = json.loads(raw) if raw.strip() else {}
    except Exception as exc:  # noqa: BLE001
        fail(f"请求不是合法 JSON：{exc}")

    test_id = str(req.get("testId") or "").strip()
    if not test_id:
        fail("必须给 testId")
    if not isinstance(req.get("data"), dict) or not req["data"]:
        fail("必须给 data（{列名: [值...]}）")

    options = req.get("options") or {}
    tails = int(options.get("tails") or 2)
    handler = HANDLERS.get(test_id)
    if handler is None:
        fail(
            f"这个检验还没在本执行器里实现：{test_id}",
            method="unsupported",
            hint="把它写成 code/stats.py 交给 science_exp_run 跑；statistics.json 里该条目有可直接复制的 py 片段。",
            supported=sorted(HANDLERS.keys()),
        )

    seed = options.get("seed")
    rng_seed = int(seed) if seed is not None else 20261021
    np.random.seed(rng_seed)

    result = handler(req, options, tails)
    result.update({
        "ok": True,
        "testId": test_id,
        "method": "lib",
        "seed": rng_seed,
        "warnings": [],
    })
    if "df" not in result:
        result["df"] = None
    emit(result)


if __name__ == "__main__":
    main()
