/**
 * 科研设置：一个 JSON 文件，落在本实例自己的数据根里。
 *
 * 为什么不做成插件 Config：Config 是「装的时候就定了」的东西，改它要重启；而这里的
 * 每一项都是研究者随时会调的偏好（默认学科、默认目标刊、α、严格度、计费价目、引导进度）。用文件，
 * 改完下一次请求就生效，也不必把 patch 层变成用户表单。
 *
 * 键的合法性按「每个键自己的规则」判，不按 JS 类型猜：
 * α 要求 (0,1) 开区间，引导步骤要求 0..6 的整数，价目表要求一串非负数字 —— 类型一样，规则不一样。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { dshHome } from './science.js'

export const DEFAULTS = Object.freeze({
  /** 默认学科包 id；空串表示每次问用户。 */
  defaultDiscipline: '',
  /** 默认目标刊；science_manuscript_new 与门判定会参考它。 */
  defaultJournal: '',
  /** 证据链严格度：strict 时没有证据的结论句直接算阻塞。 */
  evidenceStrictness: 'strict',
  /** 是否允许检索类工具访问外网。 */
  networkForSearch: true,
  /** 统计约定。 */
  alpha: 0.05,
  effectSize: 'cohen-d',
  correction: 'holm',
  /** 图与单位。 */
  figureUnits: 'mm',
  locale: 'zh',

  /** ── 计费（真值在 New API 中转站，这里只放口径与链接） ─────────────── */
  /** 计费口径来源。newapi = New API 中转站；none = 只看本地 token，不显示钱。 */
  billingProvider: 'newapi',
  /** 中转站根地址，预留给用户后填；空串表示还没配。 */
  billingBaseUrl: '',
  /** 中转站的余额/账单页，预留给用户后填。 */
  billingConsoleUrl: '',
  billingCurrency: 'CNY',
  /** 价目：每百万 token 单价。命中缓存的输入与未命中的输入分开算。 */
  billingPriceTable: [],

  /** ── 使用引导 ───────────────────────────────────────────────────── */
  onboardingDone: false,
  onboardingStep: 0,
})

const ENUMS = {
  evidenceStrictness: ['strict', 'normal'],
  effectSize: ['cohen-d', 'hedges-g', 'eta-squared', 'odds-ratio'],
  correction: ['holm', 'bonferroni', 'fdr-bh', 'none'],
  figureUnits: ['mm', 'inch'],
  locale: ['zh', 'en'],
  billingProvider: ['newapi', 'none'],
  billingCurrency: ['CNY', 'USD'],
}

/** 开区间数字：α 这类概率量。 */
const OPEN_UNIT = new Set(['alpha'])
/** 闭区间整数。 */
const STEP_RANGE = { onboardingStep: [0, 6] }
/** URL 字段：空串或用 http(s)。 */
const URL_KEYS = new Set(['billingBaseUrl', 'billingConsoleUrl'])
const MAX_PRICE_ROWS = 50
const MAX_URL = 300

function cleanString(value, limit = 120) {
  return typeof value === 'string' ? value.slice(0, limit).trim() : null
}

function cleanUrl(value) {
  const text = cleanString(value, MAX_URL)
  if (text === null) return null
  if (text === '') return ''
  return /^https?:\/\/[^\s]+$/i.test(text) ? text : null
}

function cleanNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false, exclusiveMin = false } = {}) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  if (exclusiveMin ? n <= min : n < min) return null
  if (n > max) return null
  if (integer && !Number.isInteger(n)) return null
  return n
}

/** 价目行：provider/model 至少一个，单价非负；非法行丢掉，不因此废掉整张表。 */
function cleanPriceRow(row) {
  if (!row || typeof row !== 'object') return null
  const provider = row.provider === undefined || row.provider === null ? '' : cleanString(row.provider, 64)
  const model = row.model === undefined || row.model === null ? '' : cleanString(row.model, 64)
  if (provider === null || model === null) return null
  if (!provider && !model) return null
  const out = { provider, model }
  let any = false
  for (const key of ['inputPerM', 'cacheReadPerM', 'cacheWritePerM', 'outputPerM']) {
    if (row[key] === undefined || row[key] === null || row[key] === '') continue
    const n = cleanNumber(row[key], { min: 0, max: 100_000 })
    if (n === null) return null
    out[key] = n
    any = true
  }
  return any ? out : null
}

function cleanPriceTable(value) {
  if (!Array.isArray(value)) return null
  const rows = []
  for (const row of value.slice(0, MAX_PRICE_ROWS)) {
    const cleaned = cleanPriceRow(row)
    if (cleaned) rows.push(cleaned)
  }
  return rows
}

/**
 * 逐键校验。
 * @returns {{values: object, rejected: string[]}}
 */
export function normalize(input) {
  const values = {}
  const rejected = []
  if (!input || typeof input !== 'object') return { values, rejected }
  for (const [key, raw] of Object.entries(input)) {
    const accepted = normalizeOne(key, raw)
    if (accepted === undefined) rejected.push(key)
    else values[key] = accepted
  }
  return { values, rejected }
}

/** 返回 undefined 表示拒绝；返回任何值（含空串/空数组）表示接受。 */
function normalizeOne(key, raw) {
  if (!(key in DEFAULTS)) return undefined
  if (key === 'billingPriceTable') {
    const table = cleanPriceTable(raw)
    return table === null ? undefined : table
  }
  if (URL_KEYS.has(key)) {
    const url = cleanUrl(raw)
    return url === null ? undefined : url
  }
  if (key in STEP_RANGE) {
    const [min, max] = STEP_RANGE[key]
    const n = cleanNumber(raw, { min, max, integer: true })
    return n === null ? undefined : n
  }
  if (OPEN_UNIT.has(key)) {
    const n = cleanNumber(raw, { min: 0, max: 1, exclusiveMin: true })
    return n === null || n >= 1 ? undefined : n
  }
  if (ENUMS[key]) return ENUMS[key].includes(raw) ? raw : undefined

  const fallback = DEFAULTS[key]
  if (typeof fallback === 'number') {
    const n = cleanNumber(raw, { min: 0 })
    return n === null ? undefined : n
  }
  if (typeof fallback === 'boolean') return typeof raw === 'boolean' ? raw : undefined
  const text = cleanString(raw)
  return text === null ? undefined : text
}

/** 只保留认识的键与合法的值：手改坏了的文件不该让面板崩掉。 */
export function sanitize(input) {
  return normalize(input).values
}

export function settingsPath() {
  return join(dshHome(), 'science', 'ui-settings.json')
}

export function readSettings() {
  let stored = {}
  try {
    stored = JSON.parse(readFileSync(settingsPath(), 'utf8'))
  } catch {
    stored = {}
  }
  return { values: { ...DEFAULTS, ...sanitize(stored) }, path: settingsPath() }
}

/**
 * 合并写入。先写临时文件再 rename：半截写入的设置比没有设置更难查。
 * @returns {{values: object, changed: string[], rejected: string[]}}
 */
export function writeSettings(patch) {
  const current = readSettings().values
  const { values: accepted, rejected } = normalize(patch && typeof patch === 'object' ? patch : {})
  const next = { ...current, ...accepted }
  const path = settingsPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return {
    values: next,
    changed: Object.keys(accepted).filter((k) => JSON.stringify(current[k]) !== JSON.stringify(accepted[k])),
    rejected,
  }
}
