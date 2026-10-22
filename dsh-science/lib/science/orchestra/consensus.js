/**
 * 共识、去重、门禁与冲突升级：调度器把「一票成功」变成「可交付结论」的最后一道闸。
 *
 * 为什么这些判断要纯函数化：同一个 task 可能被多进程、多轮 run 反复投票，
 * 只要输入（票行 + task）相同，结论就必须相同，否则重跑一次就换一个答案，
 * 证据链也就失去意义。因此这里不读库、不随机、不依赖 Map 插入顺序。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 与 chart.js 读同一份组织图，但不 import 它：chart.js 已依赖 roles.json，
// 这里再引会让 orchestra 内部形成环，升级路径只需要 reporting 这一小块。
const ORG_FILE = new URL('../../../data/org/org-chart.json', import.meta.url)

const FALLBACK_THRESHOLD = 0.66
const VALID_VERDICTS = new Set(['done', 'failed', 'veto'])
const DEDUPE_KEYS = ['doi', 'title', 'sha256']
const MIN_TITLE_LENGTH = 8
const SHA256_RE = /^[0-9a-f]{64}$/

let orgCache = null

/** 读组织图失败时退化为空对象：缺文件不该让整个共识模块在 import 阶段炸掉。 */
function orgChart() {
  if (orgCache) return orgCache
  try {
    orgCache = JSON.parse(readFileSync(fileURLToPath(ORG_FILE), 'utf8'))
  } catch {
    orgCache = {}
  }
  return orgCache
}

/** 阈值来自组织图而不是写死：换编制（例如要求 0.8）只改 JSON。 */
function readThreshold() {
  const raw = Number(orgChart()?.batchPolicy?.voteThreshold)
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : FALLBACK_THRESHOLD
}

export const DEFAULT_THRESHOLD = readThreshold()

function voteWeight(vote) {
  const raw = Number(vote?.evidence_weight)
  // 0 或负数会让一票彻底失去分量，按缺省 1 处理更符合「一票至少算一票」。
  return Number.isFinite(raw) && raw > 0 ? raw : 1
}

function voteTime(vote) {
  const t = Number(vote?.created_at)
  return Number.isFinite(t) ? t : 0
}

function voteId(vote) {
  return String(vote?.id ?? '')
}

/** 平票与代表票都用同一套排序：时间优先，id 兜底，保证跨进程结果一致。 */
function compareVotes(a, b) {
  const dt = voteTime(a) - voteTime(b)
  if (dt !== 0) return dt
  return voteId(a).localeCompare(voteId(b))
}

/**
 * 汇总投票。
 *
 * winner 取「加权票数最高」的 verdict 组，而不是票数最多的组：证据权重高的票
 * 本来就代表更可靠的分片，若按人头平权，一张高权重的 done 会被三张低权重废票淹没。
 */
export function aggregate({ task, votes } = {}) {
  const rows = Array.isArray(votes) ? votes : []
  const valid = rows.filter((vote) => VALID_VERDICTS.has(String(vote?.verdict ?? '')))

  const tally = {}
  const groups = new Map()
  let totalWeight = 0

  for (const vote of valid) {
    const key = String(vote.verdict)
    tally[key] = (tally[key] || 0) + 1
    const weight = voteWeight(vote)
    totalWeight += weight
    if (!groups.has(key)) groups.set(key, { verdict: key, weight: 0, votes: [] })
    const group = groups.get(key)
    group.weight += weight
    group.votes.push(vote)
  }

  const ordered = [...groups.values()].map((group) => ({
    ...group,
    votes: group.votes.slice().sort(compareVotes),
  }))
  ordered.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight
    // 加权平票时先看 done：能交付就别硬拖进复核；其余再按最早票定序。
    const aDone = a.verdict === 'done' ? 0 : 1
    const bDone = b.verdict === 'done' ? 0 : 1
    if (aDone !== bDone) return aDone - bDone
    const dt = voteTime(a.votes[0]) - voteTime(b.votes[0])
    if (dt !== 0) return dt
    return a.verdict.localeCompare(b.verdict)
  })

  const best = ordered[0] ?? null
  const winner = best?.votes[0] ?? null
  const confidence = totalWeight > 0 && best ? best.weight / totalWeight : 0
  const dissents = winner ? valid.filter((vote) => String(vote.verdict) !== best.verdict).length : 0
  const needed = Math.max(1, Math.floor(Number(task?.votes) || 1))

  // veto 先于一切：否决票一旦存在，票数够不够、置信度多高都不能放行。
  // 这里不按 voter 过滤，是因为漏判一张否决票的代价远大于误判一张。
  const vetoVoters = [...new Set(valid
    .filter((vote) => String(vote.verdict) === 'veto')
    .map((vote) => String(vote?.voter ?? 'unknown')))]
  if (vetoVoters.length > 0) {
    return {
      verdict: 'needs-review',
      winner,
      confidence,
      dissents,
      tally,
      reason: `veto:${vetoVoters.join(',')}`,
    }
  }

  if (valid.length < needed) {
    return {
      verdict: 'needs-review',
      winner,
      confidence,
      dissents,
      tally,
      reason: 'not-enough-votes',
    }
  }

  if (!best || best.verdict !== 'done') {
    return {
      verdict: 'needs-review',
      winner,
      confidence,
      dissents,
      tally,
      reason: 'winner-failed',
    }
  }

  if (confidence < DEFAULT_THRESHOLD) {
    // 平票本身不是否决理由，但要在 reason 里留痕，方便人工一眼看出是分歧还是少数派。
    const tie = ordered.length > 1 && ordered[1].weight === best.weight
    return {
      verdict: 'needs-review',
      winner,
      confidence,
      dissents,
      tally,
      reason: `below-threshold:${confidence}<${DEFAULT_THRESHOLD}${tie ? ';tie' : ''}`,
    }
  }

  return {
    verdict: 'done',
    winner,
    confidence,
    dissents,
    tally,
    reason: `consensus:done:${confidence}`,
  }
}

/** 只保留 doi 本体：带 URL、带 doi: 前缀、大小写混写的都指向同一篇文献。 */
export function normalizeDoi(value) {
  if (value === null || value === undefined) return ''
  let out = String(value).trim()
  if (!out) return ''
  // 前缀可能叠加（doi:https://doi.org/...），循环剥离到稳定为止。
  for (let i = 0; i < 3; i += 1) {
    const before = out
    out = out.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    out = out.replace(/^(?:dx\.)?doi\.org\//i, '')
    out = out.replace(/^doi\s*:\s*/i, '')
    if (out === before) break
  }
  return out.trim().toLowerCase()
}

/** 标题去标点与空白：期刊名、破折号、全半角差异都不该让同一篇文章被算两次。 */
export function normalizeTitle(value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** 合法 sha256 才算身份：长度不对的多半是截断值或被当成哈希的随机串。 */
export function normalizeSha256(value) {
  if (value === null || value === undefined) return ''
  const out = String(value).trim().toLowerCase()
  return SHA256_RE.test(out) ? out : ''
}

export function dedupeKeys() {
  return DEDUPE_KEYS.slice()
}

function normalizeByKey(key, value) {
  if (key === 'doi') return normalizeDoi(value)
  if (key === 'title') return normalizeTitle(value)
  if (key === 'sha256') return normalizeSha256(value)
  return ''
}

/** 顶层优先、payload 兜底：票/分片结果两种形状并存，取值规则必须只有一处。 */
function pickField(item, field) {
  if (!item || typeof item !== 'object') return null
  const top = item[field]
  if (top !== undefined && top !== null && top !== '') return top
  const payload = item.payload
  if (payload && typeof payload === 'object') {
    const nested = payload[field]
    if (nested !== undefined && nested !== null && nested !== '') return nested
  }
  return null
}

function itemWeight(item) {
  const raw = pickField(item, 'evidence_weight') ?? pickField(item, 'evidenceWeight')
  const n = Number(raw)
  return Number.isFinite(n) ? n : 1
}

/**
 * 多键去重。任一键命中即视为同一条证据，因此用并查集做连通：
 * A 与 B 同 DOI、B 与 C 同标题时，三者是一组，而不是两组各自保留一份。
 */
export function dedupe(items, { key = 'doi', keys = null } = {}) {
  const list = Array.isArray(items) ? items : []
  const keyList = (Array.isArray(keys) && keys.length > 0 ? keys : [key])
    .map((entry) => String(entry ?? '').trim())
    .filter((entry) => DEDUPE_KEYS.includes(entry))
  if (list.length === 0) return { unique: [], duplicates: [] }
  if (keyList.length === 0) return { unique: list.slice(), duplicates: [] }

  // 每个键的归一化值单独建索引，避免 doi 与 title 恰好同串时互相污染。
  const lookup = new Map()
  const normalized = list.map((item) => {
    const values = {}
    for (const name of keyList) {
      let value = normalizeByKey(name, pickField(item, name))
      // 过短标题不具备身份特征（"Editorial" 之类），不参与去重。
      if (name === 'title' && value.length < MIN_TITLE_LENGTH) value = ''
      values[name] = value
    }
    return values
  })

  const parent = list.map((_, index) => index)
  const find = (index) => {
    let root = index
    while (parent[root] !== root) root = parent[root]
    let cur = index
    while (parent[cur] !== cur) {
      const next = parent[cur]
      parent[cur] = root
      cur = next
    }
    return root
  }
  const union = (a, b) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA === rootB) return
    // 根取较小下标，保证分组结果与输入顺序一致、可复现。
    if (rootA < rootB) parent[rootB] = rootA
    else parent[rootA] = rootB
  }

  list.forEach((_, index) => {
    for (const name of keyList) {
      const value = normalized[index][name]
      if (!value) continue
      const mapKey = `${name}\u0000${value}`
      if (lookup.has(mapKey)) union(lookup.get(mapKey), index)
      else lookup.set(mapKey, index)
    }
  })

  const groups = new Map()
  list.forEach((_, index) => {
    const root = find(index)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(index)
  })

  const unique = []
  const duplicates = []
  for (const indexes of groups.values()) {
    // 组内保留证据权重最高者；权重相同保留先出现的（下标最小），与原顺序一致。
    let keptIndex = indexes[0]
    for (const index of indexes) {
      if (itemWeight(list[index]) > itemWeight(list[keptIndex])) keptIndex = index
    }
    unique.push(list[keptIndex])

    for (const index of indexes) {
      if (index === keptIndex) continue
      let reasonKey = ''
      let reasonValue = ''
      for (const name of keyList) {
        const value = normalized[index][name]
        if (!value) continue
        if (normalized[keptIndex][name] === value) {
          reasonKey = name
          reasonValue = value
          break
        }
      }
      // 与保留者不直接共享键（链式连通）时，退回组内任意同键者说明原因。
      if (!reasonKey) {
        for (const name of keyList) {
          const value = normalized[index][name]
          if (!value) continue
          const hit = indexes.some((other) => other !== index && normalized[other][name] === value)
          if (hit) {
            reasonKey = name
            reasonValue = value
            break
          }
        }
      }
      if (!reasonKey) {
        for (const name of keyList) {
          if (normalized[index][name]) {
            reasonKey = name
            reasonValue = normalized[index][name]
            break
          }
        }
      }
      duplicates.push({
        item: list[index],
        reason: `duplicate:${reasonKey}:${reasonValue}`,
        kept: list[keptIndex],
      })
    }
  }

  return { unique, duplicates }
}

/** 点路径取值：gate 的 require 可以是 `ok`，也可以是 `effectSize.value`。 */
function readPath(source, path) {
  if (source === null || source === undefined) return undefined
  let current = source
  for (const segment of String(path).split('.')) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = current[segment]
  }
  return current
}

/**
 * 门禁判定。
 * 空 gate 视为「这个任务本来就没有门禁」，放行而不是拦下；
 * 有 gate 但没结果则是硬失败，因为缺结果时任何真值判断都是猜测。
 */
export function applyGate({ gate, result } = {}) {
  const require = gate?.require
  const requirements = (Array.isArray(require) ? require : [require])
    .filter((entry) => entry !== null && entry !== undefined && String(entry).trim() !== '')
    .map((entry) => String(entry).trim())

  if (requirements.length === 0) return { ok: true, reason: 'no-gate' }
  if (result === null || result === undefined) return { ok: false, reason: 'no-result' }

  const missing = requirements.filter((path) => !readPath(result, path))
  if (missing.length === 0) return { ok: true, reason: 'gate-ok' }
  return {
    ok: false,
    reason: `gate-failed:${missing.join(',')}`,
    missing,
  }
}

function reportingChain(roleId) {
  const org = orgChart()
  const reporting = org?.reporting && typeof org.reporting === 'object' ? org.reporting : {}
  const path = []
  const seen = new Set()
  let current = String(roleId ?? '')
  // 报告关系是人工维护的 JSON，带 seen 防御被写成环。
  while (current && !seen.has(current)) {
    seen.add(current)
    path.push(current)
    const declared = reporting[current]
    const parent = Array.isArray(declared) ? declared[0] : null
    if (!parent) break
    current = String(parent)
  }
  return path
}

/**
 * 冲突升级。
 * 关键词判定优先于默认值：统计/方法学问题只有方法学审稿人能判，
 * 数据与许可问题只有数据管理员能判，其余才回落到课题组长。
 */
export function escalate({ task, reason } = {}) {
  void task
  const text = String(reason ?? '').trim()
  const lower = text.toLowerCase()

  let role = 'lead'
  if (/stat|method|assumption/.test(lower)) role = 'methodologist'
  else if (/data|license|ethic|consent/.test(lower)) role = 'data-steward'

  return {
    role,
    path: reportingChain(role),
    reason: text || 'unspecified',
  }
}
