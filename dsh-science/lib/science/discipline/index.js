/**
 * 学科包加载、匹配与校验。
 *
 * 设计约束（与其他 M 层一致）：学科知识全在 data/disciplines/*.json，本文件不写任何学科内容。
 * 匹配是纯字符串与别名运算，不做语义猜测；匹配不上就返回 generic 并说明原因，
 * 而不是硬塞一个最近的学科——错误的学科包会让后面每一步的建议都错。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const DIR = fileURLToPath(new URL('../../../data/disciplines/', import.meta.url))

/** 每个学科包的最低条目数。verify-discipline 与本文件的 validateDiscipline 共用同一套阈值。 */
export const MIN_COUNTS = {
  questionTypes: 3,
  designs: 4,
  measurements: 3,
  methods: 5,
  tools: 4,
  reviewerAttacks: 5,
  benchmarks: 3,
}

/** designs 内部还要检查每条必填字段非空。 */
export const DESIGN_FIELDS = ['id', 'label', 'when', 'nRule', 'why', 'source']
export const METHOD_FIELDS = ['id', 'label', 'when', 'tool', 'pitfall', 'why']
export const TOOL_FIELDS = ['id', 'label', 'kind', 'install', 'minimalScript', 'license']
export const BENCHMARK_FIELDS = ['metric', 'topJournal', 'field', 'source']

const cache = new Map()

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** 学科索引（data/disciplines/_index.json）。 */
export function loadIndex() {
  if (!cache.has('__index__')) {
    const file = join(DIR, '_index.json')
    if (!existsSync(file)) throw new Error(`学科索引缺失：${file}`)
    cache.set('__index__', readJson(file))
  }
  return cache.get('__index__')
}

/** 磁盘上实际存在的学科包 id（不含 _index）。 */
export function listDisciplineIds() {
  if (!existsSync(DIR)) return []
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.json') && !name.startsWith('_'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort()
}

/** 索引里声明的学科（含 generic）。 */
export function listDisciplines() {
  return loadIndex().disciplines ?? []
}

/**
 * 加载一个学科包。未知 id 返回 null（不抛错——上层要能优雅降级到 generic）。
 *
 * 注册表字段（label / headline / journalFamilies / defaultReporting / coreTools / aliases）
 * 以 _index.json 为准，包内同名键不覆盖注册表——否则索引与包会各说一套，
 * 而 science_discipline_list 与 profile 就会给出不同的名字。
 */
export function loadDiscipline(id) {
  const key = String(id ?? '').trim()
  if (!key) return null
  if (cache.has(key)) return cache.get(key)
  const file = join(DIR, `${key}.json`)
  if (!existsSync(file)) {
    cache.set(key, null)
    return null
  }
  const raw = readJson(file)
  const meta = (loadIndex().disciplines ?? []).find((d) => d.id === key) ?? {}
  const pack = { ...raw }
  for (const field of ['label', 'headline', 'journalFamilies', 'defaultReporting', 'coreTools', 'aliases']) {
    if (meta[field] !== undefined) pack[field] = meta[field]
  }
  if (!Array.isArray(pack.reportingExternal)) pack.reportingExternal = []
  cache.set(key, pack)
  return pack
}

/** 清缓存（测试用）。 */
export function clearCache() {
  cache.clear()
}

function normalise(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s_\-/]+/g, '')
}

/**
 * 从自由文本里找学科别名。
 * 只做包含匹配，且要求命中别名长度 ≥2 个字符，避免「ai」这类短别名误伤中文句子。
 */
function scoreAliases(text, entry) {
  const hay = normalise(text)
  if (!hay) return { score: 0, hit: null }
  let best = { score: 0, hit: null }
  for (const alias of entry.aliases ?? []) {
    const needle = normalise(alias)
    if (!needle) continue
    // 拉丁别名短于 4 个字符时只接受"整词"命中，否则 did/iv 会命中普通英文词
    const isLatin = /^[a-z0-9]+$/i.test(alias)
    if (isLatin && needle.length < 4) {
      const re = new RegExp(`(^|[^a-z0-9])${needle}([^a-z0-9]|$)`)
      if (!re.test(String(text ?? '').toLowerCase())) continue
    }
    if (hay.includes(needle) && needle.length > best.score) {
      best = { score: needle.length, hit: alias }
    }
  }
  return best
}

/**
 * 把「学科」定下来。
 *
 * 输入里 domain 可能是 id、中文名、英文名、或随便一段描述。
 * 返回 {id, matchedBy, confidence, candidates[]}；匹配不上时 id='generic'。
 */
export function matchDiscipline({ domain, journal, publisher, question, keywords } = {}) {
  const index = loadIndex()
  const entries = index.disciplines ?? []
  const real = entries.filter((d) => d.id !== 'generic')

  // 1) 显式 domain 命中 id 或 label
  if (domain) {
    const raw = String(domain).trim()
    const needle = normalise(raw)
    for (const entry of entries) {
      if (entry.id === raw || normalise(entry.label) === needle) {
        return { id: entry.id, matchedBy: 'explicit', confidence: 'high', candidates: [entry.id] }
      }
    }
    // 2) 显式 domain 是别名
    let best = null
    for (const entry of real) {
      const hit = scoreAliases(raw, entry)
      if (hit.score > 0 && (!best || hit.score > best.score)) best = { ...hit, id: entry.id }
    }
    if (best) {
      return { id: best.id, matchedBy: 'explicit-alias', confidence: 'high', candidates: [best.id] }
    }
  }

  // 3) 期刊族。多数出版社族横跨多个学科，只能收窄候选，不能单独定案。
  if (journal || publisher) {
    let family = null
    try {
      // 延迟 import 会引入循环依赖风险，改用相对路径直接读表
      const formats = readJson(fileURLToPath(new URL('../../../data/journal-formats.json', import.meta.url)))
      const jid = String(journal ?? '').trim()
      const pub = String(publisher ?? '').trim()
      if (jid && formats.journalToFamily?.[jid]) family = formats.journalToFamily[jid]
      else if (pub) {
        const key = Object.keys(formats.publisherToFamily ?? {}).find((k) => normalise(k) === normalise(pub))
        if (key) family = formats.publisherToFamily[key]
      }
    } catch {
      family = null
    }
    if (family) {
      const candidates = real.filter((d) => (d.journalFamilies ?? []).includes(family)).map((d) => d.id)
      if (candidates.length === 1) {
        return { id: candidates[0], matchedBy: 'journalFamily', confidence: 'medium', candidates }
      }
      // 多个候选时用正文再收窄一次
      if (candidates.length > 1 && question) {
        const scored = candidates
          .map((id) => ({ id, ...scoreAliases(question, loadDiscipline(id) ?? {}) }))
          .filter((c) => c.score > 0)
          .sort((a, b) => b.score - a.score)
        if (scored.length > 0) {
          return { id: scored[0].id, matchedBy: 'journalFamily+question', confidence: 'medium', candidates }
        }
      }
      if (candidates.length > 0) {
        return { id: 'generic', matchedBy: 'journalFamily-ambiguous', confidence: 'low', candidates }
      }
    }
  }

  // 4) 问题文本里的别名
  const haystack = [question, ...(Array.isArray(keywords) ? keywords : [])].filter(Boolean).join(' ')
  if (haystack) {
    const scored = real
      .map((entry) => ({ id: entry.id, ...scoreAliases(haystack, entry) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
    if (scored.length > 0) {
      const top = scored[0]
      return {
        id: top.id,
        matchedBy: 'question-keyword',
        confidence: scored.length > 1 && scored[1].score === top.score ? 'low' : 'medium',
        candidates: scored.slice(0, 4).map((c) => c.id),
      }
    }
  }

  return { id: 'generic', matchedBy: 'fallback', confidence: 'none', candidates: [] }
}

/** reporting-standards.json 里已注册、可机器校验的规范 id。 */
export function registeredReportingIds() {
  if (!cache.has('__reporting__')) {
    try {
      const file = fileURLToPath(new URL('../../../data/reporting-standards.json', import.meta.url))
      const data = readJson(file)
      cache.set('__reporting__', new Set(Object.keys(data.profiles ?? {})))
    } catch {
      cache.set('__reporting__', new Set())
    }
  }
  return cache.get('__reporting__')
}

/**
 * 学科包的结构校验。返回 {ok, errors[]}。
 * 这是 verify-discipline 与运行时「包是否可用」的同一套判定。
 *
 * reporting 分两级：`reporting` 只放能机器校验的注册规范 id；
 * COBIDAS / ICH / IEC 这类外部标准放 `reportingExternal`，不做机器校验但必须显式登记，
 * 否则「报告规范」这一栏会变成不可核查的自由文本。
 */
export function validateDiscipline(pack) {
  const errors = []
  if (!pack || typeof pack !== 'object') return { ok: false, errors: ['包为空或不是对象'] }
  for (const key of ['id', 'label']) {
    if (!pack[key]) errors.push(`缺少 ${key}`)
  }
  for (const [key, min] of Object.entries(MIN_COUNTS)) {
    const list = pack[key]
    if (!Array.isArray(list)) {
      errors.push(`${key} 不是数组`)
      continue
    }
    if (list.length < min) errors.push(`${key} 只有 ${list.length} 条，至少需要 ${min} 条`)
  }
  for (const field of DESIGN_FIELDS) {
    (pack.designs ?? []).forEach((d, i) => {
      if (!d?.[field]) errors.push(`designs[${i}](${d?.id ?? '?'}) 缺 ${field}`)
    })
  }
  for (const field of METHOD_FIELDS) {
    (pack.methods ?? []).forEach((m, i) => {
      if (!m?.[field]) errors.push(`methods[${i}](${m?.id ?? '?'}) 缺 ${field}`)
    })
  }
  for (const field of TOOL_FIELDS) {
    (pack.tools ?? []).forEach((t, i) => {
      if (!t?.[field]) errors.push(`tools[${i}](${t?.id ?? '?'}) 缺 ${field}`)
    })
  }
  for (const field of BENCHMARK_FIELDS) {
    (pack.benchmarks ?? []).forEach((b, i) => {
      if (!b?.[field]) errors.push(`benchmarks[${i}] 缺 ${field}`)
    })
  }
  if (!pack.statsDefaults || typeof pack.statsDefaults.alpha !== 'number') {
    errors.push('statsDefaults.alpha 缺失或不是数字')
  }
  if (!pack.exemplarStructure || !Array.isArray(pack.exemplarStructure.resultsOrder)) {
    errors.push('exemplarStructure.resultsOrder 缺失')
  }

  // 报告规范：注册 id 与外部标准分开登记，设计级引用必须落在两者之一里
  const registered = registeredReportingIds()
  if (!Array.isArray(pack.reporting)) {
    errors.push('reporting 不是数组')
  } else {
    for (const id of pack.reporting) {
      if (!registered.has(id)) errors.push(`reporting 里的 "${id}" 不是已注册的规范 id`)
    }
  }
  const external = Array.isArray(pack.reportingExternal) ? pack.reportingExternal : []
  if (pack.reportingExternal !== undefined && !Array.isArray(pack.reportingExternal)) {
    errors.push('reportingExternal 不是数组')
  }
  for (const slug of external) {
    if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      errors.push(`reportingExternal 里的 "${slug}" 不是合法 slug`)
    }
  }
  const allowed = new Set([...registered, ...external])
  for (const d of pack.designs ?? []) {
    for (const id of d.reporting ?? []) {
      if (!allowed.has(id)) errors.push(`designs.${d.id} 引用了未登记的报告规范 "${id}"`)
    }
  }

  return { ok: errors.length === 0, errors }
}

/** 校验磁盘上全部学科包。 */
export function validateAll() {
  const byId = {}
  for (const id of listDisciplineIds()) {
    byId[id] = validateDiscipline(loadDiscipline(id))
  }
  return byId
}

/**
 * 跨学科检索：问题类型 / 设计 / 方法 / 工具。
 * 用于「我有个重复测量的设计，哪些学科有对应范式」这类反向查询。
 *
 * 匹配面刻意放宽到 when / requires / tool / assumptions：
 * 研究者记得的是「重复测量」这种说法，而它出现在方法的适用条件里，不一定在设计名里。
 */
export function searchDisciplines({ question, design, method, tool } = {}) {
  const hits = []
  const probe = (needle, fields) => {
    const n = normalise(needle)
    if (!n) return false
    return fields.some((f) => normalise(f).includes(n))
  }
  for (const entry of listDisciplines()) {
    if (entry.id === 'generic') continue
    const pack = loadDiscipline(entry.id)
    if (!pack) continue
    const reasons = []
    if (question) {
      if ((pack.questionTypes ?? []).some((t) => probe(question, [t.id, t.label, t.when, ...(t.needs ?? [])]))) reasons.push('questionTypes')
    }
    if (design) {
      const inDesigns = (pack.designs ?? []).some((x) => probe(design, [x.id, x.label, x.when, ...(x.requires ?? []), ...(x.threats ?? []).map((t) => t.risk)]))
      const inMethods = (pack.methods ?? []).some((x) => probe(design, [x.label, x.when]))
      if (inDesigns || inMethods) reasons.push(inDesigns ? 'designs' : 'methods')
    }
    if (method) {
      const inMethods = (pack.methods ?? []).some((x) => probe(method, [x.id, x.label, x.when, x.tool, ...(x.assumptions ?? [])]))
      if (inMethods) reasons.push('methods')
    }
    if (tool) {
      if ((pack.tools ?? []).some((x) => probe(tool, [x.id, x.label, ...(x.alt ?? []), x.kind]))) reasons.push('tools')
    }
    if (reasons.length > 0) hits.push({ id: entry.id, label: entry.label, reasons })
  }
  return hits
}

/** 按工具 id 在全部学科里查：谁用它、怎么装、最小脚本。 */
export function findTool(toolId) {
  const needle = normalise(toolId)
  const out = []
  for (const entry of listDisciplines()) {
    const pack = loadDiscipline(entry.id)
    if (!pack) continue
    for (const t of pack.tools ?? []) {
      if (normalise(`${t.id}${t.label}`).includes(needle)) {
        out.push({ discipline: entry.id, ...t })
      }
    }
  }
  return out
}
