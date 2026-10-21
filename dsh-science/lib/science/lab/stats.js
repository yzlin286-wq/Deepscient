/**
 * 统计执行：把 data/ 里的数据 + 一个检验 id，变成一条带假设检查的结果记录。
 *
 * 分工：
 *   stats_run.py  真算（numpy/scipy/statsmodels）
 *   本文件        读表、组装请求、落记录、附上 statistics.json 里的用法与误用
 *
 * 「方法」字段只有三个值：lib（本执行器算的）、fallback（假设不满足时的备选）、
 * unsupported（没实现，已提示改为自己写脚本）。不写「近似」——那样读者会以为数是真的。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { resolvePython, runPy } from './power.js'
import { projectDir } from './project.js'
import { append } from './provenance.js'

const STATS_SCRIPT = fileURLToPath(new URL('../../../scripts/py/stats_run.py', import.meta.url))

let statsCache = null

/** 读 data/statistics.json（带缓存）。 */
export function loadStatistics() {
  if (statsCache) return statsCache
  const path = new URL('../../../data/statistics.json', import.meta.url)
  statsCache = JSON.parse(readFileSync(path, 'utf8'))
  return statsCache
}

export function getTest(testId) {
  return loadStatistics().tests?.[String(testId)] ?? null
}

export function listTestIds() {
  return Object.keys(loadStatistics().tests ?? {})
}

/**
 * 解析 CSV。只支持这一种格式：首行表头，逗号分隔，带引号的字段。
 * 数值列转成 number，非数值列保留 string —— 生存分析的 group 列就是字符串。
 */
export function parseCsv(text) {
  const rows = []
  let field = ''
  let row = []
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1 } else { quoted = false }
      } else field += ch
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === ',' || ch === '\t') { row.push(field); field = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += ch
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  if (rows.length === 0) return { columns: {}, order: [], n: 0 }

  const header = rows[0].map((h) => h.trim())
  const columns = {}
  for (const h of header) columns[h] = []
  for (const r of rows.slice(1)) {
    if (r.length === 1 && r[0].trim() === '') continue
    header.forEach((h, idx) => {
      const raw = (r[idx] ?? '').trim()
      if (raw === '') { columns[h].push(null); return }
      const n = Number(raw)
      columns[h].push(Number.isFinite(n) && raw !== '' ? n : raw)
    })
  }
  return { columns, order: header, n: rows.length - 1 }
}

/** 读项目内的 CSV，路径必须落在项目里。 */
export function readProjectCsv(store, projectId, relPath) {
  const dir = projectDir(projectId)
  if (!dir) throw new Error(`课题不存在：${projectId}`)
  const full = resolve(dir, relPath)
  if (!full.startsWith(resolve(dir))) throw new Error(`路径越界：${relPath}`)
  if (!existsSync(full)) throw new Error(`文件不存在：${relPath}（先放到课题目录里）`)
  return { ...parseCsv(readFileSync(full, 'utf8')), path: relPath }
}

/**
 * 跑一个检验。
 *
 * @param {object} store
 * @param {object} input
 *   projectId  必填
 *   testId     statistics.json 的检验 id
 *   data       {列名: [值...]}；与 csvPath 二选一
 *   csvPath    项目内 CSV 相对路径
 *   columns    可选，从 CSV 里挑列并重命名：{ a: 'rt_placebo', b: 'rt_caffeine' }
 *   options    alpha / tails / predictors / bound / resamples
 *   seed       重抽样种子
 *   runId      关联到某次执行
 *   save       是否落库（默认 true）
 */
export function runStats(store, input = {}) {
  const projectId = String(input.projectId ?? '').trim()
  if (!projectId) throw new Error('必须给 projectId')
  const dir = projectDir(projectId)
  if (!dir) throw new Error(`课题不存在：${projectId}`)

  const testId = String(input.testId ?? '').trim()
  if (!testId) throw new Error('必须给 testId（statistics.json 里的检验 id）')

  const meta = getTest(testId)
  if (!meta) throw new Error(`统计库里没有这个检验：${testId}`)

  let data = input.data ?? null
  let source = 'inline'
  if (!data) {
    if (!input.csvPath) throw new Error('必须给 data 或 csvPath')
    const parsed = readProjectCsv(store, projectId, input.csvPath)
    source = parsed.path
    data = remapColumns(parsed.columns, input.columns)
  } else if (input.columns) {
    data = remapColumns(data, input.columns)
  }

  const options = { ...(input.options ?? {}) }
  if (input.alpha !== undefined) options.alpha = input.alpha
  if (input.tails !== undefined) options.tails = input.tails
  if (input.seed !== undefined) options.seed = input.seed

  const seed = Number.isInteger(input.seed) ? input.seed : 20261021
  const request = { testId, data, options: { ...options, seed } }

  const raw = runPy(STATS_SCRIPT, request)
  const spec = {
    testId,
    label: meta.label,
    source,
    columns: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v])),
    options,
    seed,
    why: meta.why ?? '',
    reportAs: meta.reportAs ?? '',
  }

  if (!raw || raw.ok !== true) {
    const failure = {
      id: `ana_${randomUUID().slice(0, 8)}`,
      ok: false,
      testId,
      label: meta.label,
      error: raw?.error ?? '统计执行器没有返回结果',
      method: raw?.method ?? 'error',
      hint: raw?.hint,
      supported: raw?.supported,
      spec,
    }
    if (input.save !== false) {
      persist(store, { projectId, runId: input.runId, kind: 'stats', testId, spec, result: failure, method: failure.method, seed, assumptions: [] })
    }
    return failure
  }

  const result = {
    id: `ana_${randomUUID().slice(0, 8)}`,
    ok: true,
    testId,
    label: raw.label ?? meta.label,
    statistic: raw.statistic ?? null,
    df: raw.df ?? null,
    p: raw.p ?? null,
    effectSize: raw.effectSize ?? null,
    coefficients: raw.coefficients ?? null,
    components: raw.components ?? null,
    curve: raw.curve ?? null,
    correction: raw.correction ?? null,
    uncorrected: raw.uncorrected ?? null,
    n: raw.n ?? {},
    assumptions: raw.assumptions ?? [],
    reportAs: raw.reportAs ?? meta.reportAs ?? '',
    method: raw.method ?? 'lib',
    seed,
    warnings: buildWarnings(raw.assumptions ?? [], meta),
  }

  if (input.save !== false) {
    persist(store, { projectId, runId: input.runId, kind: 'stats', testId, spec, result, method: result.method, seed, assumptions: result.assumptions })
  }
  return result
}

/**
 * 假设不满足时给出可执行的下一步：用 statistics.json 里的 fallback，而不是同一套方法换个说法。
 */
function buildWarnings(assumptions, meta) {
  const out = []
  for (const a of assumptions) {
    if (a.ok === false) {
      out.push({
        id: a.id,
        message: `${a.label} 不满足（${a.detail}）`,
        fallback: (meta.fallback ?? []).filter(Boolean),
      })
    }
  }
  return out
}

function remapColumns(columns, map) {
  if (!map) return columns
  const out = {}
  for (const [alias, spec] of Object.entries(map)) {
    out[alias] = pickSeries(columns, spec)
  }
  return out
}

/**
 * 从 CSV 里取出一列，支持长表格式。
 *
 * 实验数据几乎都是长表（一列分组、一列测量值），而检验要的是两组各自一个数组。
 * 所以列的写法允许两种：
 *   'rt'                                    → 直接取整列
 *   { column: 'rt', where: { group: 'a' } }  → 先按条件筛行，再取 rt
 * 只允许字符串一种写法的话，用户就得自己在 Excel 里把表拆开，那一步没人会做对。
 */
export function pickSeries(columns, spec) {
  if (typeof spec === 'string') {
    if (!(spec in columns)) throw new Error(`CSV 里没有列 ${spec}；现有列：${Object.keys(columns).join(', ')}`)
    return columns[spec]
  }
  if (!spec || typeof spec !== 'object') throw new Error(`列的写法不对：${JSON.stringify(spec)}`)
  const name = spec.column ?? spec.col
  if (!name) throw new Error(`列定义缺 column：${JSON.stringify(spec)}`)
  if (!(name in columns)) throw new Error(`CSV 里没有列 ${name}；现有列：${Object.keys(columns).join(', ')}`)
  const where = spec.where
  if (!where || typeof where !== 'object') return columns[name]
  for (const key of Object.keys(where)) {
    if (!(key in columns)) throw new Error(`筛选条件用了不存在的列 ${key}；现有列：${Object.keys(columns).join(', ')}`)
  }
  const keys = Object.keys(where)
  const values = columns[name]
  return values.filter((_, i) => keys.every((k) => String(columns[k][i]) === String(where[k])))
}

function persist(store, { projectId, runId, kind, testId, spec, result, method, seed, assumptions }) {
  const id = result.id
  const now = Date.now()
  store.db.prepare(`
    INSERT INTO analysis(id, project_id, run_id, kind, test_id, spec_json, result_json, method, seed, assumptions_json, created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, projectId, runId ?? null, kind, testId,
    JSON.stringify(spec), JSON.stringify(result), method ?? 'lib', seed ?? null,
    JSON.stringify(assumptions ?? []), now,
  )
  append(store, {
    projectId,
    subject: 'analysis',
    subjectId: id,
    action: kind === 'figure' ? 'figure' : 'analyze',
    detail: { testId, method: method ?? 'lib', ok: result.ok !== false },
  })
  return id
}

export { persist as persistAnalysis }

/**
 * 把结果写成 markdown 片段（结果段草稿）。
 * 只写确实跑出来的数字；假设有问题的条目不写进正文，写进「待处理」。
 */
export function renderResultMarkdown(result) {
  const lines = []
  lines.push(`### ${result.label}（${result.testId}）`)
  if (!result.ok) {
    lines.push('', `未完成：${result.error}`)
    if (result.hint) lines.push(`提示：${result.hint}`)
    return lines.join('\n')
  }
  lines.push('')
  const bits = []
  if (result.statistic !== null && result.statistic !== undefined) bits.push(`统计量 = ${fmt(result.statistic)}`)
  if (result.df !== null && result.df !== undefined) bits.push(`df = ${result.df}`)
  if (result.p !== null && result.p !== undefined) bits.push(fmtP(result.p))
  if (result.effectSize?.value !== null && result.effectSize?.value !== undefined) {
    const ci = result.effectSize.ci
    bits.push(`${result.effectSize.kind} = ${fmt(result.effectSize.value)}${ci ? `（95% CI ${fmt(ci[0])}–${fmt(ci[1])}）` : ''}`)
  }
  if (bits.length) lines.push(bits.join('，'))
  const ns = Object.entries(result.n ?? {})
  if (ns.length) lines.push('', `样本：${ns.map(([k, v]) => `${k}=${v}`).join('，')}`)

  const bad = (result.assumptions ?? []).filter((a) => a.ok === false)
  if (bad.length) {
    lines.push('', '待处理（写进正文前必须先解决）：')
    for (const a of bad) lines.push(`- ${a.label}：${a.detail}`)
    const fb = result.warnings?.flatMap((w) => w.fallback ?? []) ?? []
    if (fb.length) lines.push(`  备选检验：${[...new Set(fb)].join(' / ')}`)
  }
  if (result.reportAs) lines.push('', `可直接抄进正文：${result.reportAs}`)
  return lines.join('\n')
}

function fmt(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  if (Math.abs(n) >= 100) return n.toFixed(1)
  if (Math.abs(n) >= 1) return n.toFixed(2)
  return n.toFixed(3)
}

function fmtP(p) {
  const n = Number(p)
  if (!Number.isFinite(n)) return 'p = n/a'
  return n < 0.001 ? 'p < .001' : `p = ${n.toFixed(3).replace(/^0/, '')}`
}

export { resolvePython, runPy, mkdirSync, dirname, join, writeFileSync }
