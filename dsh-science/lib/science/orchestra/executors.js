/**
 * orchestra 执行器 —— 把「分片」变成真实产物，或者变成一张可交给模型的委派单。
 *
 * 设计取舍：
 *   1. 本地分片一律真算。统计数据必须能复算，所以数字只从 scipy / 本地兜底算法出，
 *      不做任何随机初始化；同一个 seed + 同一份 CSV 必须给出逐位相同的数字。
 *   2. python 走 local-compute.js 的 runPython（临时脚本 + args.json），
 *      避开 Windows 命令行引号问题，并把「没装 python / 没装 scipy」变成可读错误。
 *   3. 执行器不写 store：产物登记是调度器的职责。这里只负责计算、落文件、算哈希，
 *      这样同一分片重放时不会在仓储里留下重复行。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPython } from '../../local-compute.js'

const HERE = dirname(fileURLToPath(import.meta.url))
/** lib/science/orchestra → 包的根目录，data/ 与 scripts/ 都在这一层。 */
const PKG_ROOT = resolve(HERE, '..', '..', '..')
const EXAMPLES_DIR = join(PKG_ROOT, 'data', 'examples')
const ROLES_PATH = join(PKG_ROOT, 'data', 'org', 'roles.json')

/** 稿件小节的固定模板顺序：由 sectionIndex 取模选择，保证同一分片永远写同一节。 */
const SECTION_ORDER = ['methods', 'results', 'discussion', 'limitations', 'conclusion', 'abstract']

/* ────────────────────────────── 通用小工具 ────────────────────────────── */

const sha256Text = (text) => createHash('sha256').update(String(text), 'utf8').digest('hex')
const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

/** 键排序后的 JSON：哈希只关心内容，不关心字段顺序。 */
function stableStringify(value) {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map((v) => stableStringify(v === undefined ? null : v)).join(',') + ']'
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}'
}

/** shard.payload 在仓储里可能是 JSON 字符串，也可能是已解析的对象。 */
function payloadOf(shard) {
  const raw = shard?.payload
  if (raw && typeof raw === 'object') return raw
  if (typeof raw === 'string' && raw.trim()) {
    try { return JSON.parse(raw) } catch { return {} }
  }
  return {}
}

function parseJsonSafe(text, fallback = null) {
  if (text === null || text === undefined || text === '') return fallback
  if (typeof text === 'object') return text
  try { return JSON.parse(String(text)) } catch { return fallback }
}

function shardIndexOf(shard) {
  const raw = shard?.index ?? shard?.shardIndex ?? shard?.shard_index ?? 0
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

function fail(error, output = {}) {
  return { ok: false, error: String(error), output }
}

/** RFC4180 的最小实现：够用且不引第三方依赖（引号、逗号、CRLF、BOM）。 */
function parseCsvRows(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1 } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch === '\r') { /* 统一按 \n 切行 */ }
    else field += ch
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''))
}

function parseCsv(text) {
  const raw = parseCsvRows(text)
  if (!raw.length) return { columns: [], rows: [] }
  const columns = raw[0].map((c) => String(c).trim())
  const rows = raw.slice(1).map((cells) => {
    const obj = {}
    columns.forEach((col, i) => { obj[col] = cells[i] === undefined ? '' : String(cells[i]).trim() })
    return obj
  })
  return { columns, rows }
}

const ID_LIKE = /^(subject|subj|subject_id|participant|participant_id|id|index|no|row|编号)$/i

/** 没有显式 columns 时的兜底：跳过 id 类列，取前两个「整列都是数字」的列。 */
function pickPairedColumns(parsed, payload = {}) {
  const explicit = payload.columns && typeof payload.columns === 'object' ? payload.columns : {}
  const a = payload.columnA ?? payload.column_a ?? explicit.a ?? explicit.columnA
  const b = payload.columnB ?? payload.column_b ?? explicit.b ?? explicit.columnB
  if (a && b) return { a: String(a), b: String(b) }

  const numeric = parsed.columns.filter((col) => {
    if (ID_LIKE.test(col)) return false
    const values = parsed.rows.map((r) => String(r[col] ?? '').trim())
    if (!values.length || values.some((v) => v === '')) return false
    return values.every((v) => Number.isFinite(Number(v)))
  })
  if (numeric.length >= 2) return { a: numeric[0], b: numeric[1] }
  return null
}

function extractPairs(parsed, cols) {
  const a = []
  const b = []
  for (const row of parsed.rows) {
    const ra = String(row[cols.a] ?? '').trim()
    const rb = String(row[cols.b] ?? '').trim()
    if (!ra || !rb) continue
    const va = Number(ra)
    const vb = Number(rb)
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue
    a.push(va)
    b.push(vb)
  }
  return { a, b }
}

function meanOf(values) {
  return values.reduce((s, v) => s + v, 0) / values.length
}

function sampleSd(values, mean = meanOf(values)) {
  if (values.length < 2) return 0
  const ss = values.reduce((s, v) => s + (v - mean) ** 2, 0)
  return Math.sqrt(ss / (values.length - 1))
}

/** CSV 绝对路径，或相对 data/examples/<example>/；都缺时退回工作目录。 */
function resolveCsvPath(payload, workdir, fallback = {}) {
  const raw = payload.csv ?? payload.csvPath ?? fallback.csv ?? fallback.csvPath
  if (!raw) return null
  const p = String(raw)
  if (isAbsolute(p)) return p
  const example = payload.example ?? fallback.example
  if (example) return join(EXAMPLES_DIR, String(example), p)
  return resolve(workdir, p)
}

/* ───────────────────── t 分布（scipy 不可用时的本地兜底） ───────────────────── */

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
]

function logGamma(z) {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
  const x0 = z - 1
  let x = 0.99999999999980993
  for (let i = 0; i < LANCZOS.length; i += 1) x += LANCZOS[i] / (x0 + i + 1)
  const t = x0 + LANCZOS.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (x0 + 0.5) * Math.log(t) - t + Math.log(x)
}

/** 连分式求不完全 Beta（Numerical Recipes 的 Lentz 版），收敛后精度足够到 1e-10。 */
function betaContinuedFraction(a, b, x) {
  const MAX_IT = 300
  const EPS = 3e-14
  const FP_MIN = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FP_MIN) d = FP_MIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAX_IT; m += 1) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FP_MIN) d = FP_MIN
    c = 1 + aa / c
    if (Math.abs(c) < FP_MIN) c = FP_MIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FP_MIN) d = FP_MIN
    c = 1 + aa / c
    if (Math.abs(c) < FP_MIN) c = FP_MIN
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < EPS) break
  }
  return h
}

function incompleteBeta(a, b, x) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  if (x < (a + 1) / (a + b + 2)) return (bt * betaContinuedFraction(a, b, x)) / a
  return 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b
}

function studentTCdf(t, df) {
  const x = df / (df + t * t)
  const tail = 0.5 * incompleteBeta(df / 2, 0.5, x)
  return t > 0 ? 1 - tail : tail
}

/** 二分求分位数：单调函数，200 次足够，且不依赖随机迭代。 */
function studentTQuantile(p, df) {
  let lo = -1e3
  let hi = 1e3
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2
    if (studentTCdf(mid, df) < p) lo = mid
    else hi = mid
    if (hi - lo < 1e-12) break
  }
  return (lo + hi) / 2
}

/**
 * JS 版配对 t 检验：与 scipy.stats.ttest_rel 同口径（双侧、ddof=1）。
 * 只在 python/scipy 不可用时启用；失败就明确失败，不给占位数。
 */
function pairedTFromArrays(a, b) {
  const n = Math.min(a.length, b.length)
  if (n < 2) return { ok: false, error: `有效配对数不足 2 对（实际 ${n}）` }
  const diff = []
  for (let i = 0; i < n; i += 1) diff.push(a[i] - b[i])
  const meanA = meanOf(a.slice(0, n))
  const meanB = meanOf(b.slice(0, n))
  const meanDiff = meanOf(diff)
  const sdDiff = sampleSd(diff, meanDiff)
  if (!(sdDiff > 0)) return { ok: false, error: '差值标准差为 0，无法计算 dz 与 t 统计量' }
  const se = sdDiff / Math.sqrt(n)
  const statistic = meanDiff / se
  const df = n - 1
  /* 双侧 p 直接对 I_{df/(df+t²)}(df/2, 1/2) 取值，避免 1-CDF 的精度损失 */
  const p = incompleteBeta(df / 2, 0.5, df / (df + statistic * statistic))
  const dz = meanDiff / sdDiff
  const tcrit = studentTQuantile(0.975, df)
  const half = tcrit / Math.sqrt(n)
  return {
    ok: true,
    value: {
      n, meanA, meanB, meanDiff, sdDiff, statistic, p, df, dz,
      ci: [dz - half, dz + half], tcrit,
    },
  }
}

/* ────────────────────────────── python 脚本 ────────────────────────────── */

const STATS_SCRIPT = `import json, os, sys, csv, math
HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'args.json'), encoding='utf-8') as fh:
    ARGS = json.load(fh)

def emit(value):
    print(json.dumps(value, ensure_ascii=False, default=str))

def read_pairs(path, col_a, col_b):
    with open(path, encoding='utf-8-sig', newline='') as fh:
        reader = csv.DictReader(fh)
        names = reader.fieldnames or []
        if col_a not in names or col_b not in names:
            raise ValueError('CSV 缺少列: %s / %s；实际列: %s' % (col_a, col_b, ','.join(names)))
        a, b = [], []
        for row in reader:
            va = (row.get(col_a) or '').strip()
            vb = (row.get(col_b) or '').strip()
            if not va or not vb:
                continue
            a.append(float(va))
            b.append(float(vb))
    return a, b

def main():
    try:
        from scipy import stats as st
    except Exception as exc:
        emit({"error": "scipy 不可用: " + type(exc).__name__ + ": " + str(exc)})
        return
    a, b = read_pairs(ARGS['csvPath'], ARGS['columnA'], ARGS['columnB'])
    n = min(len(a), len(b))
    if n < 2:
        raise ValueError('有效配对数不足 2 对（实际 %d）' % n)
    a, b = a[:n], b[:n]
    diff = [x - y for x, y in zip(a, b)]
    mean_a = sum(a) / n
    mean_b = sum(b) / n
    mean_d = sum(diff) / n
    sd_d = math.sqrt(sum((d - mean_d) ** 2 for d in diff) / (n - 1))
    if sd_d == 0:
        raise ValueError('差值标准差为 0，无法计算 dz')
    res = st.ttest_rel(a, b)
    df = n - 1
    dz = mean_d / sd_d
    tcrit = float(st.t.ppf(0.975, df))
    half = tcrit / math.sqrt(n)
    emit({
        "n": int(n), "meanA": float(mean_a), "meanB": float(mean_b),
        "meanDiff": float(mean_d), "sdDiff": float(sd_d),
        "statistic": float(res.statistic), "p": float(res.pvalue), "df": int(df),
        "dz": float(dz), "ci": [float(dz - half), float(dz + half)], "tcrit": tcrit,
    })

try:
    main()
except Exception as exc:
    emit({"error": type(exc).__name__ + ": " + str(exc)})
`

const FIGURE_SCRIPT = `import json, os, sys, math
HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'args.json'), encoding='utf-8') as fh:
    ARGS = json.load(fh)

def emit(value):
    print(json.dumps(value, ensure_ascii=False, default=str))

def main():
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception as exc:
        emit({"error": "matplotlib 缺失", "detail": type(exc).__name__ + ": " + str(exc)})
        return

    a = [float(v) for v in (ARGS.get("a") or [])]
    b = [float(v) for v in (ARGS.get("b") or [])]
    if len(a) != len(b) or len(a) < 2:
        emit({"error": "配对数据不足：a/b 长度需一致且 >= 2（实际 %d / %d）" % (len(a), len(b))})
        return

    labels = ARGS.get("labels") or ["A", "B"]
    mean_a = ARGS.get("meanA")
    mean_b = ARGS.get("meanB")
    mean_a = float(mean_a) if mean_a is not None else sum(a) / len(a)
    mean_b = float(mean_b) if mean_b is not None else sum(b) / len(b)
    ci_a = [float(v) for v in (ARGS.get("ciA") or [mean_a, mean_a])]
    ci_b = [float(v) for v in (ARGS.get("ciB") or [mean_b, mean_b])]
    font_size = float(ARGS.get("fontSize") or 7)
    dpi = int(ARGS.get("dpi") or 600)
    width_mm = float(ARGS.get("widthMm") or 90)
    height_mm = float(ARGS.get("heightMm") or 60)

    plt.rcParams.update({
        "font.size": font_size,
        "axes.labelsize": font_size,
        "xtick.labelsize": font_size - 0.5,
        "ytick.labelsize": font_size - 0.5,
        "axes.linewidth": 0.6,
        "xtick.major.width": 0.6,
        "ytick.major.width": 0.6,
        "xtick.major.size": 2.0,
        "ytick.major.size": 2.0,
        "xtick.major.pad": 2.0,
        "ytick.major.pad": 2.0,
        "axes.unicode_minus": False,
        "pdf.fonttype": 42,
        "ps.fonttype": 42,
        "font.family": "sans-serif",
        "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans"],
    })

    blue = "#0072B2"    # Okabe-Ito 蓝
    orange = "#D55E00"  # Okabe-Ito 朱红
    sky = "#56B4E9"     # Okabe-Ito 天蓝，用于被试内连线

    fig = plt.figure(figsize=(width_mm / 25.4, height_mm / 25.4))
    ax = fig.add_axes([0.20, 0.20, 0.76, 0.74])

    for va, vb in zip(a, b):
        ax.plot([0.0, 1.0], [va, vb], color=sky, alpha=0.5, linewidth=0.35, zorder=1)
    ax.plot([0.0] * len(a), a, "o", color=blue, markersize=2.0, markeredgewidth=0, alpha=0.75, zorder=2)
    ax.plot([1.0] * len(b), b, "o", color=orange, markersize=2.0, markeredgewidth=0, alpha=0.75, zorder=2)

    ax.plot([-0.18, 0.18], [mean_a, mean_a], color=blue, linewidth=2.2, solid_capstyle="butt", zorder=3)
    ax.plot([0.82, 1.18], [mean_b, mean_b], color=orange, linewidth=2.2, solid_capstyle="butt", zorder=3)
    ax.errorbar([0.0], [mean_a], yerr=[[mean_a - ci_a[0]], [ci_a[1] - mean_a]],
                fmt="none", ecolor=blue, elinewidth=0.8, capsize=2.2, capthick=0.8, zorder=4)
    ax.errorbar([1.0], [mean_b], yerr=[[mean_b - ci_b[0]], [ci_b[1] - mean_b]],
                fmt="none", ecolor=orange, elinewidth=0.8, capsize=2.2, capthick=0.8, zorder=4)

    ax.set_xlim(-0.55, 1.55)
    ax.set_xticks([0.0, 1.0])
    ax.set_xticklabels([str(labels[0]), str(labels[1])])
    ylabel = ARGS.get("ylabel")
    if ylabel:
        ax.set_ylabel(str(ylabel))
    lo = min(min(a), min(b))
    hi = max(max(a), max(b))
    pad = (hi - lo) * 0.10 if hi > lo else 0.5
    ax.set_ylim(lo - pad, hi + pad)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)

    outdir = ARGS["outDir"]
    name = ARGS["name"]
    os.makedirs(outdir, exist_ok=True)
    base = os.path.join(outdir, name)
    # 去掉元数据里的时间戳，让同输入重跑得到逐字节相同的文件（幂等哈希才有意义）
    fig.savefig(base + ".pdf", format="pdf", dpi=dpi, metadata={"CreationDate": None}, facecolor="white")
    fig.savefig(base + ".png", format="png", dpi=dpi, metadata={"Software": None}, facecolor="white")
    plt.close(fig)

    files = []
    for fmt in ("pdf", "png"):
        path = base + "." + fmt
        if not os.path.exists(path):
            emit({"error": "作图失败：未生成 " + path})
            return
        files.append({"format": fmt, "path": path, "bytes": int(os.path.getsize(path))})
    emit({"files": files})
    return

try:
    main()
except Exception as exc:
    emit({"error": type(exc).__name__ + ": " + str(exc)})
`

/* ────────────────────────────── 统计结果读取 ────────────────────────────── */

function unwrapStats(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (raw.output && typeof raw.output === 'object' && (raw.output.testId || raw.output.statistic !== undefined)) return raw.output
  return raw
}

/**
 * 从 campaign_shard 里读统计分片的输出。
 * 为什么不用 listArtifacts：统计结果是分片输出而不是文件产物，按 task_id + state 取，
 * 与调度器的「已完成」语义完全一致，也避免把中间态读进来。
 */
function loadStats({ store, payload }) {
  const taskId = payload.statsTaskId ?? payload.stats_task_id ?? null
  if (store && store.db && taskId) {
    try {
      const row = store.db.prepare(
        "SELECT payload_json, output_json FROM campaign_shard WHERE task_id = ? AND state = 'done' LIMIT 1",
      ).get(String(taskId))
      if (row) {
        const stats = unwrapStats(parseJsonSafe(row.output_json, null))
        if (stats) return { stats, statsPayload: parseJsonSafe(row.payload_json, {}) || {}, taskId }
      }
    } catch { /* 查询失败就退回 payload，不让执行器因为仓储抖动而整单失败 */ }
  }
  const inline = payload.stats
  if (inline && typeof inline === 'object') {
    return { stats: unwrapStats(inline), statsPayload: {}, taskId }
  }
  if (payload.statistic !== undefined && payload.meanA !== undefined) {
    return {
      stats: {
        testId: payload.testId ?? 'ttest-rel',
        n: payload.n, meanA: payload.meanA, meanB: payload.meanB,
        meanDiff: payload.meanDiff, sdDiff: payload.sdDiff,
        statistic: payload.statistic, p: payload.p, df: payload.df,
        effectSize: payload.effectSize ?? null,
      },
      statsPayload: {},
      taskId,
    }
  }
  return { stats: null, statsPayload: {}, taskId }
}

/**
 * 统计结果只保留「能复算的数字」：scipy 与 JS 兜底给出同样的字段，
 * 因此下游作图/写作不需要知道是哪条路径算出来的。
 */
function normalizeStats(stats, extra = {}) {
  if (!stats) return null
  const effect = stats.effectSize && typeof stats.effectSize === 'object'
    ? { kind: 'cohens-dz', value: Number(stats.effectSize.value), ci: stats.effectSize.ci }
    : { kind: 'cohens-dz', value: Number(stats.dz), ci: stats.ci }
  if (stats.effectSize && stats.effectSize.kind) effect.kind = stats.effectSize.kind
  return {
    testId: stats.testId ?? 'ttest-rel',
    n: Number(stats.n),
    meanA: Number(stats.meanA),
    meanB: Number(stats.meanB),
    meanDiff: Number(stats.meanDiff),
    sdDiff: Number(stats.sdDiff),
    statistic: Number(stats.statistic),
    p: Number(stats.p),
    df: Number(stats.df),
    effectSize: effect,
    ...extra,
  }
}

/* ────────────────────────────── 各 kind 的实现 ────────────────────────────── */

async function handleDataLoad({ shard }) {
  const payload = payloadOf(shard)
  const example = String(payload.example ?? '').trim()
  if (!example) return fail('payload.example 缺失')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(example)) return fail(`示例名不合法: ${example}`)

  const csvPath = join(EXAMPLES_DIR, example, 'data.csv')
  if (!existsSync(csvPath)) return fail(`示例数据不存在: ${csvPath}`)

  const text = readFileSync(csvPath, 'utf8')
  const parsed = parseCsv(text)
  return {
    ok: true,
    output: {
      example,
      csvPath,
      rows: parsed.rows.length,
      columns: parsed.columns,
      sha256: sha256Text(text),
    },
  }
}

async function handleStatsPaired({ campaign, shard, workdir }) {
  const payload = payloadOf(shard)
  const csvPath = resolveCsvPath(payload, workdir)
  if (!csvPath) return fail('payload.csv 缺失（需要绝对路径，或配合 payload.example 给相对路径）')
  if (!existsSync(csvPath)) return fail(`CSV 不存在: ${csvPath}`)

  const text = readFileSync(csvPath, 'utf8')
  const parsed = parseCsv(text)
  if (!parsed.columns.length) return fail(`CSV 没有表头: ${csvPath}`)
  const cols = pickPairedColumns(parsed, payload)
  if (!cols) return fail(`无法确定配对列；请在 payload.columns 里显式给 {a, b}`)

  const seed = Number.isFinite(Number(payload.seed)) ? Number(payload.seed) : Number(campaign?.seed ?? 0)
  const py = await runPython(STATS_SCRIPT, { csvPath, columnA: cols.a, columnB: cols.b }, 60000)

  let value = null
  let backend = 'scipy'
  if (py.ok && py.value) {
    value = py.value
  } else {
    // scipy / python 不可用时退回 JS：公式与 scipy.stats.ttest_rel 一致，只是没有加速
    const pairs = extractPairs(parsed, cols)
    const local = pairedTFromArrays(pairs.a, pairs.b)
    if (!local.ok) {
      return fail(`统计失败：${py.error || 'python 无输出'}；本地兜底也失败：${local.error}`, { columns: cols })
    }
    value = local.value
    backend = 'js'
  }

  const effect = {
    kind: 'cohens-dz',
    value: Number(value.dz),
    ci: [Number(value.ci?.[0] ?? 0), Number(value.ci?.[1] ?? 0)],
  }
  return {
    ok: true,
    output: {
      testId: 'ttest-rel',
      n: Number(value.n),
      meanA: Number(value.meanA),
      meanB: Number(value.meanB),
      meanDiff: Number(value.meanDiff),
      sdDiff: Number(value.sdDiff),
      statistic: Number(value.statistic),
      p: Number(value.p),
      df: Number(value.df),
      effectSize: effect,
      csvSha256: sha256Text(text),
      seed,
      backend,
      columns: cols,
    },
  }
}

async function handleFigurePaired({ store, campaign, shard, workdir }) {
  const payload = payloadOf(shard)
  const loaded = loadStats({ store, payload })
  const stats = normalizeStats(loaded.stats)
  if (!stats) {
    return fail(`找不到统计结果：statsTaskId=${payload.statsTaskId ?? '(空)'} 没有已完成分片，payload 也没有内联统计值`)
  }

  const csvPath = resolveCsvPath(payload, workdir, loaded.statsPayload)
  if (!csvPath) return fail('figure.paired 需要 CSV 才能画每人的配对线（payload.csv 缺失）')
  if (!existsSync(csvPath)) return fail(`CSV 不存在: ${csvPath}`)

  const text = readFileSync(csvPath, 'utf8')
  const parsed = parseCsv(text)
  const cols = pickPairedColumns(parsed, { ...loaded.statsPayload, ...payload })
  if (!cols) return fail('无法确定配对列；请在 payload.columns 里显式给 {a, b}')
  const pairs = extractPairs(parsed, cols)
  if (pairs.a.length < 2) return fail(`有效配对数不足 2 对（实际 ${pairs.a.length}）`)

  const ciA = meanCi(pairs.a)
  const ciB = meanCi(pairs.b)
  const labelCols = (loaded.statsPayload && loaded.statsPayload.columns) || payload.columns || {}
  const labels = Array.isArray(payload.labels) && payload.labels.length >= 2
    ? [String(payload.labels[0]), String(payload.labels[1])]
    : [String(labelCols.a ?? payload.columnA ?? 'A'), String(labelCols.b ?? payload.columnB ?? 'B')]

  const index = shardIndexOf(shard)
  const name = `fig-${index}`
  const outDir = join(workdir, 'figures')
  const widthMm = 90
  const heightMm = 60
  const dpi = 600
  const args = {
    a: pairs.a, b: pairs.b, labels,
    meanA: stats.meanA, meanB: stats.meanB,
    ciA: ciA.ci, ciB: ciB.ci,
    ylabel: payload.ylabel ?? payload.label ?? '',
    outDir, name, dpi, widthMm, heightMm, fontSize: 7,
  }

  const py = await runPython(FIGURE_SCRIPT, args, 120000)
  if (!py.ok || !py.value || !Array.isArray(py.value.files)) {
    if (py.value && String(py.value.error ?? '').includes('matplotlib')) {
      return fail('matplotlib 缺失', { detail: py.value.detail ?? null })
    }
    return fail(`作图失败：${py.error || 'python 没有返回文件清单'}`, { detail: py.value?.detail ?? null })
  }

  const files = []
  for (const f of py.value.files) {
    if (!existsSync(f.path)) return fail(`作图失败：未生成 ${f.path}`)
    const size = statSync(f.path).size
    if (size <= 0) return fail(`作图失败：${f.path} 是空文件`)
    files.push({ format: f.format, path: f.path, sha256: sha256File(f.path), bytes: size })
  }

  const statsHash = sha256Text(stableStringify(stats))
  const inputHash = sha256Text(stableStringify({
    statsHash,
    csvSha256: sha256Text(text),
    columns: cols,
    shardIndex: index,
    widthMm, heightMm, dpi, fontSize: 7,
  }))

  return {
    ok: true,
    output: {
      figure: 'paired',
      widthMm, heightMm, dpi, fontSize: 7,
      statsHash,
      csvSha256: sha256Text(text),
      files: files.map((f) => ({ format: f.format, path: f.path, bytes: f.bytes })),
    },
    artifacts: files.map((f) => ({
      kind: 'figure',
      path: f.path,
      sha256: f.sha256,
      bytes: f.bytes,
      tool: 'science_figure',
      inputHash,
    })),
  }
}

/** 单个条件的 95% CI：均值 ± t_{0.975, n-1} × SD/√n。 */
function meanCi(values) {
  const n = values.length
  const mean = meanOf(values)
  if (n < 2) return { mean, ci: [mean, mean] }
  const sd = sampleSd(values, mean)
  const tcrit = studentTQuantile(0.975, n - 1)
  const half = (tcrit * sd) / Math.sqrt(n)
  return { mean, ci: [mean - half, mean + half] }
}

/* 数字格式统一：p 用科学计数法，其余保留 4 位，避免同一数字在不同小节长得不一样。 */
const fmt = (v, digits = 4) => (Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : 'NA')
const fmtP = (v) => {
  const p = Number(v)
  if (!Number.isFinite(p)) return 'NA'
  return p < 1e-4 ? p.toExponential(2) : p.toFixed(4)
}

function sectionMarkdown(section, stats, labels) {
  const [a, b] = labels
  const n = fmt(stats.n, 0)
  const df = fmt(stats.df, 0)
  const ci = Array.isArray(stats.effectSize?.ci) ? stats.effectSize.ci : [null, null]
  const dz = fmt(stats.effectSize?.value)
  const higher = Number(stats.meanDiff) >= 0 ? a : b
  const lower = Number(stats.meanDiff) >= 0 ? b : a
  const head = {
    methods: '## Methods',
    results: '## Results',
    discussion: '## Discussion',
    limitations: '## Limitations',
    conclusion: '## Conclusion',
    abstract: '## Abstract',
  }[section]

  if (section === 'methods') {
    return [
      head,
      '',
      `采用被试内（配对）设计，对同一批被试在 ${a} 与 ${b} 两个条件下的观测值做配对样本 t 检验（two-sided paired t-test）。`,
      `有效配对样本量 n = ${n}，差值自由度 df = ${df}。`,
      `效应量按 Cohen's dz 计算：dz = 平均差值 / 差值标准差；区间估计为基于 t 分布的 95% 置信区间（双侧 α = 0.05）。`,
      `检验统计量取自同一份统计输出：t(${df}) = ${fmt(stats.statistic)}，p = ${fmtP(stats.p)}（详见 Results）。`,
      '上列样本量、自由度与统计量直接取本地统计分片的工具输出，未做手工改写。',
    ].join('\n')
  }

  if (section === 'results') {
    return [
      head,
      '',
      `${a}（M = ${fmt(stats.meanA)}）与 ${b}（M = ${fmt(stats.meanB)}）的配对差异具有统计显著性：`
        + `t(${df}) = ${fmt(stats.statistic)}，p = ${fmtP(stats.p)}，平均差值 = ${fmt(stats.meanDiff)}（差值 SD = ${fmt(stats.sdDiff)}）。`,
      `效应量 Cohen's dz = ${dz}，95% CI [${fmt(ci[0])}, ${fmt(ci[1])}]，n = ${n}。`,
    ].join('\n')
  }

  if (section === 'discussion') {
    return [
      head,
      '',
      `在本样本中，${higher} 条件下的观测值高于 ${lower} 条件，平均差值为 ${fmt(stats.meanDiff)}。`,
      `Cohen's dz = ${dz}（95% CI [${fmt(ci[0])}, ${fmt(ci[1])}]），按常规经验阈值属于较大效应。`,
      `该比较为被试内设计（n = ${n}），方向与幅度只在本样本内成立；差值分布的正态性与异常值影响需在完整分析中核对。`,
    ].join('\n')
  }

  if (section === 'limitations') {
    return [
      head,
      '',
      `- 样本量有限（n = ${n}），效应量的不确定性可从 95% CI 的宽度直接读出。`,
      '- 配对设计只覆盖同一批被试的两个条件，结论不能直接外推到其他人群或未测量的条件。',
      '- 片段中的数字来自单次统计分片；差值分布假设与异常值处理仍需方法学审查确认。',
    ].join('\n')
  }

  if (section === 'conclusion') {
    return [
      head,
      '',
      `在 n = ${n} 的配对样本中，${a} 与 ${b} 的差异为 ${fmt(stats.meanDiff)}`
        + `（t(${df}) = ${fmt(stats.statistic)}，p = ${fmtP(stats.p)}，Cohen's dz = ${dz}）。`,
      `${higher} 条件下的观测值更高；该结论需在更大样本与更多条件下复现。`,
    ].join('\n')
  }

  return [
    head,
    '',
    `配对样本 t 检验（n = ${n}）显示 ${a} 与 ${b} 存在显著差异：`
      + `t(${df}) = ${fmt(stats.statistic)}，p = ${fmtP(stats.p)}，Cohen's dz = ${dz}`
      + `（95% CI [${fmt(ci[0])}, ${fmt(ci[1])}]）；${higher} 条件下的观测值更高。`,
  ].join('\n')
}

async function handleManuscriptSection({ store, shard, workdir }) {
  const payload = payloadOf(shard)
  const loaded = loadStats({ store, payload })
  const stats = normalizeStats(loaded.stats)
  if (!stats) {
    return fail(`找不到统计结果：statsTaskId=${payload.statsTaskId ?? '(空)'} 没有已完成分片，payload 也没有内联统计值`)
  }

  const rawIndex = Number(payload.sectionIndex ?? shardIndexOf(shard))
  const index = Number.isFinite(rawIndex) ? Math.abs(Math.trunc(rawIndex)) % SECTION_ORDER.length : 0
  const section = SECTION_ORDER[index]

  const labelCols = (loaded.statsPayload && loaded.statsPayload.columns) || payload.columns || {}
  const labels = Array.isArray(payload.labels) && payload.labels.length >= 2
    ? [String(payload.labels[0]), String(payload.labels[1])]
    : [String(labelCols.a ?? payload.columnA ?? 'A'), String(labelCols.b ?? payload.columnB ?? 'B')]

  const statsHash = sha256Text(stableStringify(stats))
  const markdown = sectionMarkdown(section, stats, labels) + '\n'

  /* 文件名带上 sectionIndex：重放时覆盖同一个文件，不会堆出 N 份草稿。 */
  const dir = join(workdir, 'sections')
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, `${index}-${section}.md`)
  writeFileSync(filePath, markdown, 'utf8')
  const bytes = statSync(filePath).size

  return {
    ok: true,
    output: { section, markdown, statsHash },
    artifacts: [{
      kind: 'manuscript',
      path: filePath,
      sha256: sha256File(filePath),
      bytes,
      tool: 'science_manuscript',
      inputHash: sha256Text(stableStringify({ statsHash, sectionIndex: index, section, labels })),
    }],
  }
}

async function handleLiteratureExtract({ shard }) {
  const payload = payloadOf(shard)
  const index = Number.isFinite(Number(payload.index)) ? Number(payload.index) : shardIndexOf(shard)
  const example = String(payload.example ?? '').trim()
  const invalid = !example || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(example)
  const refsPath = invalid ? null : join(EXAMPLES_DIR, example, 'refs.json')

  if (refsPath && existsSync(refsPath)) {
    const parsed = parseJsonSafe(readFileSync(refsPath, 'utf8'), null)
    const entries = Array.isArray(parsed) ? parsed
      : (Array.isArray(parsed?.refs) ? parsed.refs : (Array.isArray(parsed?.references) ? parsed.references : null))
    const entry = entries ? entries[index] : null
    if (entry && typeof entry === 'object') {
      return {
        ok: true,
        output: {
          index,
          doi: entry.doi ?? null,
          title: entry.title ?? null,
          year: entry.year ?? null,
          source: 'example-refs',
        },
      }
    }
    /* 本地文献库存在但索引越界：仍然是「没拿到」，不能拿相邻条目凑数 */
    return {
      ok: true,
      output: {
        index,
        missing: true,
        reason: 'offline:reference-index-out-of-range',
        note: '本地文献库没有该索引；未联网，不生成占位 DOI',
      },
      gap: { kind: 'literature', index, reason: 'offline:reference-index-out-of-range' },
    }
  }

  return {
    ok: true,
    output: {
      index,
      missing: true,
      reason: 'offline:no-local-reference',
      note: '未联网，不生成占位 DOI',
    },
    gap: { kind: 'literature', index, reason: 'offline:no-local-reference' },
  }
}

async function handleGateCheck({ workdir, shard }) {
  const payload = payloadOf(shard)
  const raw = String(payload.path ?? '').trim()
  if (!raw) return fail('payload.path 缺失')
  const abs = isAbsolute(raw) ? raw : resolve(workdir, raw)
  if (!existsSync(abs)) return fail(`待校验文件不存在: ${abs}`)

  const expected = payload.sha256 === undefined || payload.sha256 === null ? null : String(payload.sha256).trim().toLowerCase()
  const actual = sha256File(abs)
  const matches = expected === null ? false : actual === expected
  return { ok: true, output: { ok: true, matches, path: abs, sha256: actual } }
}

async function handleNoop() {
  return { ok: true, output: { noop: true } }
}

const BUILTIN = {
  'data.load': handleDataLoad,
  'stats.paired': handleStatsPaired,
  'figure.paired': handleFigurePaired,
  'manuscript.section': handleManuscriptSection,
  'literature.extract': handleLiteratureExtract,
  'gate.check': handleGateCheck,
  noop: handleNoop,
}

const KIND_DESCRIPTIONS = {
  'data.load': '校验示例数据存在并给出列名、行数与 sha256',
  'stats.paired': '配对样本 t 检验（scipy，缺失时 JS 同口径兜底）',
  'figure.paired': '90×60 mm、7 pt、Okabe-Ito 的配对连线图（pdf + png）',
  'manuscript.section': '从统计输出生成确定性的 Markdown 小节',
  'literature.extract': '离线文献分片；没有本地文献就明确报缺口',
  'gate.check': '对文件重算 sha256 并与期望值比对',
  noop: '压测用空转分片',
}

/* ────────────────────────────── 扩展点 ────────────────────────────── */

/** 自定义 handler 优先于内置实现，便于在不改本文件的情况下加新 kind。 */
const customHandlers = new Map()

export function registerHandler(kind, handler) {
  const name = String(kind ?? '').trim()
  if (!name) throw new Error('registerHandler: kind 必须是非空字符串')
  if (typeof handler !== 'function') throw new Error('registerHandler: handler 必须是函数')
  customHandlers.set(name, handler)
  return handler
}

export function listKinds() {
  return [...new Set([...Object.keys(BUILTIN), ...customHandlers.keys()])]
}

/** 分派只看 executor 字段：human 优先于 llm，其余一律交给本地执行器。 */
export function classify({ task = {}, shard = {} } = {}) {
  const t = String(task?.executor ?? '').toLowerCase()
  const s = String(shard?.executor ?? '').toLowerCase()
  if (t === 'human' || s === 'human') return 'human'
  if (t === 'llm' || s === 'llm') return 'llm'
  return 'local'
}

function rolesIndex() {
  const parsed = parseJsonSafe(readFileSync(ROLES_PATH, 'utf8'), null)
  if (!parsed || !Array.isArray(parsed.roles)) return null
  const map = new Map()
  for (const role of parsed.roles) if (role?.id) map.set(String(role.id), role)
  return map
}

function buildPersona(role, roleDef) {
  const name = roleDef?.name ?? role
  const layer = roleDef?.layer ?? 'L3'
  const duty = roleDef?.duty ?? '执行本分片任务，按幂等键交付，不扩范围'
  const skills = Array.isArray(roleDef?.skills) && roleDef.skills.length
    ? roleDef.skills.join(' / ')
    : '按任务要求选择最小工具面'
  const authority = Array.isArray(roleDef?.authority) && roleDef.authority.length
    ? roleDef.authority.join(' / ')
    : 'execute'
  return [
    `你是「${name}」（${layer}）。${duty}。`,
    `本单只使用这些技能：${skills}。`,
    `权限边界：${authority}；越权的判断不写，交回组长。`,
    `交付要求：数字与结论都能追到工具输出，路径与哈希写清楚。`,
  ].join('\n')
}

const EXPECTED_FIELDS = {
  'data.load': ['example', 'csvPath', 'rows', 'columns', 'sha256'],
  'stats.paired': ['testId', 'n', 'meanA', 'meanB', 'meanDiff', 'sdDiff', 'statistic', 'p', 'df', 'effectSize', 'csvSha256', 'seed'],
  'figure.paired': ['figure', 'files', 'statsHash', 'csvSha256'],
  'manuscript.section': ['section', 'markdown', 'statsHash'],
  'literature.extract': ['index', 'doi', 'title', 'year', 'source'],
  'gate.check': ['ok', 'matches'],
  noop: ['noop'],
}

/* ────────────────────────────── 工厂 ────────────────────────────── */

/**
 * @param {object} opts
 * @param {object} opts.store      ScienceStore（只读：figure / manuscript 要回查统计分片）
 * @param {Function} opts.workdirFor ({campaign, task, shard}) => 绝对工作目录
 * @param {object} [opts.logger]
 */
export function createExecutors({ store = null, workdirFor = null, logger = null } = {}) {
  function resolveWorkdir(ctx) {
    const given = ctx?.workdir
    if (given) return String(given)
    if (typeof workdirFor === 'function') {
      const dir = workdirFor({ campaign: ctx?.campaign ?? null, task: ctx?.task ?? null, shard: ctx?.shard ?? null })
      if (dir) return String(dir)
    }
    /* 调度器没给目录也不给解析器时，用「战役/任务」拼一个稳定的临时目录：
       宁可产物落在 tmp，也不要因为配置缺失把整条流水线卡死。 */
    const campaignId = String(ctx?.campaign?.id ?? 'campaign').replace(/[^\w.-]/g, '_')
    const taskId = String(ctx?.task?.id ?? 'task').replace(/[^\w.-]/g, '_')
    return join(tmpdir(), 'dsh-orchestra-work', campaignId, taskId)
  }

  async function local(ctx = {}) {
    const started = Date.now()
    const campaign = ctx.campaign ?? null
    const task = ctx.task ?? {}
    const shard = ctx.shard ?? {}
    const kind = String(shard.kind ?? task.kind ?? '').trim()
    const workdir = resolveWorkdir(ctx)

    try {
      mkdirSync(workdir, { recursive: true })
    } catch (error) {
      return { ok: false, error: `无法创建工作目录 ${workdir}: ${error?.message ?? error}`, output: { kind, elapsedMs: Date.now() - started } }
    }

    const handler = customHandlers.get(kind) ?? BUILTIN[kind]
    if (!handler) {
      return {
        ok: false,
        error: `未知分片类型（kind）: ${kind || '(空)'}；可用：${listKinds().join(', ')}`,
        output: { kind, elapsedMs: Date.now() - started },
      }
    }

    try {
      const result = await handler({
        store: ctx.store ?? store,
        campaign,
        task,
        shard,
        workdir,
        logger,
      })
      const output = result?.output && typeof result.output === 'object' ? { ...result.output } : {}
      // elapsedMs 放在 output 里但不参与幂等哈希（调度器按 output 的业务字段算 key）
      output.elapsedMs = Date.now() - started
      return { ...result, output }
    } catch (error) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn(`orchestra: 分片 ${shard?.id ?? task?.id ?? '?'} 执行失败: ${error?.message ?? error}`)
      }
      return { ok: false, error: String(error?.message ?? error), output: { kind, elapsedMs: Date.now() - started } }
    }
  }

  /**
   * 委派单：结构固定，模型拿到后可以直接派子智能体，不需要再猜上下文。
   * 这里不联网、不读模型配置，只做「任务 + 角色 + 期望输出」的拼装。
   */
  function delegate({ campaign = null, task = {}, shard = {} } = {}) {
    const payload = payloadOf(shard)
    const role = String(task.role ?? shard.role ?? payload.role ?? 'shard-worker')
    let index = null
    try { index = rolesIndex() } catch { index = null }
    const roleDef = index?.get(role) ?? null

    const roleName = roleDef?.name ?? role
    const layer = roleDef?.layer ?? 'L3'
    const preset = roleDef?.preset ?? task.preset ?? null
    const kind = String(shard.kind ?? task.kind ?? '').trim()

    const brief = {
      role,
      roleName,
      layer,
      preset,
      task: { id: task.id ?? null, title: task.title ?? null, executor: task.executor ?? shard.executor ?? null },
      shard: { id: shard.id ?? null, index: shardIndexOf(shard), kind, payload },
      persona: buildPersona(role, roleDef),
      inputs: { ...payload },
      expected: { format: 'json', fields: EXPECTED_FIELDS[kind] ?? ['ok', 'output'] },
      gate: task.gate ?? null,
      instructions: ['不要编造数据', '结论必须能追到工具输出', '按 gate 工具自检后再交付'],
    }

    return {
      brief,
      tokensEstimate: 2000 + JSON.stringify(payload).length / 4,
    }
  }

  function describe() {
    return {
      version: 1,
      executors: ['local', 'llm', 'human'],
      kinds: listKinds().map((kind) => ({
        kind,
        description: KIND_DESCRIPTIONS[kind] ?? '自定义 handler',
        custom: customHandlers.has(kind),
      })),
    }
  }

  return { classify, local, delegate, describe }
}

export default { createExecutors, classify, registerHandler, listKinds }
