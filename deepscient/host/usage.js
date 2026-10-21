/**
 * token 用量与计费：把会话日志里**已经存在**的真实计数汇总出来。
 *
 * 为什么不调接口问模型、也不自己估字数：
 *   - 每一次 assistant 回复在日志里都带 `usage`（provider 返回的原始计数），
 *     输入/命中缓存/写缓存/输出四项齐全，`totalTokens` 由它们相加得到，这是唯一的真数；
 *   - 中转了谁的 key、按什么价目扣钱，是 New API 中转站那边的事，本机只做「同一口径的本地汇总」，
 *     界面上必须写成预估，并把中转站链接摆在旁边。
 *
 * 索引文件的存在理由是体积：一份 16MB 的日志解压后两万多行，每次开面板都重算不可接受。
 * 索引按 (size, mtimeMs) 增量复用 —— 只有写过的会话才重算，其余直接拿缓存。
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import zlib from 'node:zlib'

import { dshHome, scienceRoot } from './science.js'

const INDEX_VERSION = 1
/** 单份日志上限：超过就跳过并记账，不为了统计把进程拖死。 */
const MAX_FILE_BYTES = 64 * 1024 * 1024
const TTL_MS = 60_000

export const RANGES = Object.freeze(['today', '7d', '30d', 'all'])

const COUNTERS = ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'totalTokens', 'messages']

export function usageIndexPath() {
  return join(scienceRoot(), 'usage-index.json')
}

export function emptyTotals() {
  return { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 0, messages: 0 }
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function addTotals(into, usage) {
  into.inputTokens += num(usage.inputTokens)
  into.cacheReadTokens += num(usage.cacheReadTokens)
  into.cacheWriteTokens += num(usage.cacheWriteTokens)
  into.outputTokens += num(usage.outputTokens)
  // provider 有时只给 total，有时三项之和才是 total；以 total 为准，缺了再用四项和兜底。
  const sum = num(usage.inputTokens) + num(usage.cacheReadTokens) + num(usage.cacheWriteTokens) + num(usage.outputTokens)
  into.totalTokens += num(usage.totalTokens) || sum
  into.messages += 1
}

function mergeInto(target, source) {
  for (const key of COUNTERS) target[key] += num(source[key])
}

/** 本地时区的日键：账单按人看的日历切，不按 UTC。 */
export function dayKey(ms) {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function bucketOf(map, key) {
  if (!map[key]) map[key] = emptyTotals()
  return map[key]
}

function splitModelKey(key) {
  const at = key.indexOf('/')
  return at < 0 ? ['unknown', key] : [key.slice(0, at), key.slice(at + 1)]
}

/**
 * 解析一份会话日志。
 * @returns 该文件的聚合（totals / byModel / byDay / byDayModel / 会话元数据）
 */
export function parseSessionLog(text, { file = '' } = {}) {
  const totals = emptyTotals()
  const byModel = {}
  const byDay = {}
  const byDayModel = {}
  const meta = { sessionId: null, title: null, cwd: null, agentPreset: null, createdAt: null }
  let badLines = 0
  let withoutUsage = 0
  let lastHeader = null
  const headers = new Map()

  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      badLines += 1
      continue
    }
    const data = event?.data ?? {}
    switch (event.type) {
      case 'session':
        meta.sessionId = event.id ?? data.id ?? meta.sessionId
        meta.cwd = data.cwd ?? meta.cwd
        meta.agentPreset = data.agentPreset ?? meta.agentPreset
        meta.createdAt = event.createdAt ?? meta.createdAt
        break
      case 'session/title':
        meta.title = data.title ?? data.text ?? meta.title
        break
      case 'request/header': {
        const config = data.header?.config ?? null
        lastHeader = config ? { provider: config.provider ?? null, model: config.model ?? null } : null
        if (lastHeader) headers.set(`${data.turn}:${data.step}`, lastHeader)
        break
      }
      case 'assistant/message': {
        const usage = data.usage
        if (!usage) {
          withoutUsage += 1
          break
        }
        const owner = headers.get(`${data.turn}:${data.step}`) ?? lastHeader ?? {}
        const key = `${owner.provider ?? 'unknown'}/${owner.model ?? 'unknown'}`
        addTotals(bucketOf(byModel, key), usage)
        addTotals(totals, usage)

        const day = dayKey(event.time)
        if (day) {
          addTotals(bucketOf(byDay, day), usage)
          const dayModels = byDayModel[day] ?? (byDayModel[day] = {})
          addTotals(bucketOf(dayModels, key), usage)
        }

        const stamp = Number(event.time) || null
        if (stamp !== null) {
          totals.firstTime = totals.firstTime === null || totals.firstTime === undefined ? stamp : Math.min(totals.firstTime, stamp)
          totals.lastTime = totals.lastTime === null || totals.lastTime === undefined ? stamp : Math.max(totals.lastTime, stamp)
        }
        break
      }
      default:
        break
    }
  }

  return {
    file,
    totals,
    byModel,
    byDay,
    byDayModel,
    meta,
    quality: { badLines, withoutUsage },
  }
}

function readIndex() {
  try {
    const parsed = JSON.parse(readFileSync(usageIndexPath(), 'utf8'))
    if (parsed?.version === INDEX_VERSION && parsed.files && typeof parsed.files === 'object') return parsed
  } catch {
    /* 坏了就当没有，下面重建 */
  }
  return { version: INDEX_VERSION, files: {} }
}

function writeIndex(index) {
  const path = usageIndexPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(index)}\n`, 'utf8')
  renameSync(tmp, path)
}

function walkLogs(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkLogs(full, out)
    else if (entry.isFile() && entry.name.endsWith('.jsonl.zstd')) out.push(full)
  }
  return out
}

export function sessionsRoot() {
  return join(dshHome(), 'sessions')
}

let memo = { at: 0, payload: null }

/**
 * 扫描全部会话日志（增量）。
 * @returns {{files: object, warnings: object[], parsed: number, reused: number, unavailable?: boolean}}
 */
export function scanUsage({ refresh = false } = {}) {
  if (!refresh && memo.payload && Date.now() - memo.at < TTL_MS) return memo.payload

  if (typeof zlib.zstdDecompressSync !== 'function') {
    return {
      files: {},
      warnings: [{ file: '', reason: '当前 Node 没有 zstd 解压能力，无法统计会话日志' }],
      parsed: 0,
      reused: 0,
      unavailable: true,
    }
  }

  const index = readIndex()
  const next = { version: INDEX_VERSION, files: {} }
  const warnings = []
  let parsed = 0
  let reused = 0

  for (const file of walkLogs(sessionsRoot())) {
    const rel = relative(dshHome(), file)
    let info
    try {
      info = statSync(file)
    } catch {
      continue
    }
    const cached = index.files[rel]
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
      next.files[rel] = cached
      reused += 1
      continue
    }
    if (info.size > MAX_FILE_BYTES) {
      warnings.push({ file: rel, reason: `超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB，跳过统计` })
      continue
    }
    try {
      const text = zlib.zstdDecompressSync(readFileSync(file)).toString('utf8')
      const result = parseSessionLog(text, { file: rel })
      next.files[rel] = {
        size: info.size,
        mtimeMs: info.mtimeMs,
        meta: result.meta,
        totals: result.totals,
        byModel: result.byModel,
        byDay: result.byDay,
        byDayModel: result.byDayModel,
        quality: result.quality,
      }
      parsed += 1
      if (result.quality.badLines > 0) {
        warnings.push({ file: rel, reason: `有 ${result.quality.badLines} 行无法解析，已跳过` })
      }
    } catch (error) {
      warnings.push({ file: rel, reason: `解压或解析失败：${error.message}` })
    }
  }

  if (parsed > 0 || Object.keys(next.files).length !== Object.keys(index.files).length) {
    try {
      writeIndex(next)
    } catch (error) {
      warnings.push({ file: 'usage-index.json', reason: `索引写入失败：${error.message}` })
    }
  }

  const payload = { files: next.files, warnings, parsed, reused }
  memo = { at: Date.now(), payload }
  return payload
}

/** 供测试清缓存。 */
export function resetUsageCache() {
  memo = { at: 0, payload: null }
}

/** 价目查找：先精确 provider+model，再退化到 model 通配、provider 通配，最后全通配。 */
export function priceOf(priceTable, provider, model) {
  if (!Array.isArray(priceTable) || priceTable.length === 0) return null
  const unset = (v) => !v || v === '*'
  const rules = [
    (row) => row.provider === provider && row.model === model,
    (row) => row.model === model && unset(row.provider),
    (row) => row.provider === provider && unset(row.model),
    (row) => unset(row.provider) && unset(row.model),
  ]
  for (const match of rules) {
    const row = priceTable.find((item) => item && match(item))
    if (row) return row
  }
  return null
}

function round4(value) {
  return Number(value.toFixed(4))
}

function costOf(totals, row) {
  if (!row) return null
  // 命中缓存的输入通常比未命中便宜一个数量级，必须分开算，否则预估会虚高。
  const per = (value, rate) => (num(value) / 1e6) * (Number(rate) || 0)
  const amount =
    per(totals.inputTokens, row.inputPerM) +
    per(totals.cacheReadTokens, row.cacheReadPerM ?? row.inputPerM) +
    per(totals.cacheWriteTokens, row.cacheWritePerM ?? row.inputPerM) +
    per(totals.outputTokens, row.outputPerM)
  return round4(amount)
}

/** 范围起点（epoch ms）：today/7d/30d 按自然日回推，all 从 0 起。 */
export function rangeStart(range, now = Date.now()) {
  if (range === 'all') return 0
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 1
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  return start.getTime()
}

/**
 * 汇总一个时间范围。
 * @returns {{range, source, totals, cost, byModel, bySession, byDay, warnings, index}}
 */
export function usageRange({ range = 'today', refresh = false, priceTable = [], currency = 'CNY' } = {}) {
  const normalized = RANGES.includes(range) ? range : 'today'
  const startDay = dayKey(rangeStart(normalized))
  const scan = scanUsage({ refresh })

  const totals = emptyTotals()
  const modelTotals = new Map()
  const dayTotals = new Map()
  const bySession = []
  const warnings = [...scan.warnings]

  const inRange = (day) => !startDay || day >= startDay

  for (const [rel, entry] of Object.entries(scan.files)) {
    const sessionTotals = emptyTotals()

    for (const [day, bucket] of Object.entries(entry.byDay ?? {})) {
      if (!inRange(day)) continue
      mergeInto(sessionTotals, bucket)
      mergeInto(dayTotals.get(day) ?? (dayTotals.set(day, emptyTotals()), dayTotals.get(day)), bucket)
    }
    if (sessionTotals.messages === 0) continue
    mergeInto(totals, sessionTotals)

    let sessionCost = null
    for (const [day, models] of Object.entries(entry.byDayModel ?? {})) {
      if (!inRange(day)) continue
      for (const [key, bucket] of Object.entries(models)) {
        const [provider, model] = splitModelKey(key)
        const slot = modelTotals.get(key) ?? { provider, model, ...emptyTotals(), cost: null }
        mergeInto(slot, bucket)
        modelTotals.set(key, slot)
        const price = priceOf(priceTable, provider, model)
        if (price) sessionCost = (sessionCost ?? 0) + (costOf(bucket, price) ?? 0)
      }
    }

    bySession.push({
      sessionId: entry.meta?.sessionId ?? rel,
      title: entry.meta?.title ?? null,
      cwd: entry.meta?.cwd ?? null,
      agentPreset: entry.meta?.agentPreset ?? null,
      file: rel,
      updatedAt: new Date(entry.mtimeMs).toISOString(),
      ...sessionTotals,
      cost: sessionCost === null ? null : round4(sessionCost),
    })
  }

  const byModel = [...modelTotals.values()]
    .map((slot) => {
      const price = priceOf(priceTable, slot.provider, slot.model)
      return { ...slot, cost: price ? costOf(slot, price) : null }
    })
    .sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model))

  const costKnown = byModel.some((row) => row.cost !== null)
  const amount = costKnown ? round4(byModel.reduce((n, row) => n + (row.cost ?? 0), 0)) : null

  return {
    range: normalized,
    source: scan.unavailable ? 'unavailable' : 'local-session-log',
    generatedAt: new Date().toISOString(),
    currency,
    totals,
    cost: amount === null ? null : { currency, amount, estimated: true },
    byModel,
    bySession: bySession.sort((a, b) => b.totalTokens - a.totalTokens),
    byDay: [...dayTotals.entries()].map(([day, bucket]) => ({ day, ...bucket })).sort((a, b) => a.day.localeCompare(b.day)),
    warnings,
    index: { files: Object.keys(scan.files).length, parsed: scan.parsed, reused: scan.reused },
  }
}
