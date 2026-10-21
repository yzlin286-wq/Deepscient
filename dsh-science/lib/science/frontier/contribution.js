/**
 * 贡献设计：把「一条 claim + 一个缺口」变成「一份带证据清单的研究方案」。
 *
 * ## 这一层在做什么
 *
 * 缺口的判定只说明「这里没人做」。但没人做有很多原因：可能是新方向，也可能是做不出来。
 * 这一层把缺口翻译成**具体要补的证据**，并按目标期刊档位给出不同强度的清单——
 * band 3 和 band 5 要的东西完全不是一回事，用同一张清单等于没设计。
 *
 * ## 这一层不在做什么
 *
 * 不估录用率，不排期刊名次，不判断证明能不能做出来。`estimatedWeeks` 是工期的粗估
 * （按证据项的 `weeks` 相加再乘一个重叠系数），不是承诺。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_FILE = join(HERE, '..', '..', '..', 'data', 'contribution-types.json')

let CACHE = null

/** 读贡献类型表。文件缺失时抛错——这是核心判断依据，不能静默降级。 */
export function loadContributionTypes(file = DATA_FILE) {
  if (CACHE && file === DATA_FILE) return CACHE
  if (!existsSync(file)) throw new Error(`缺少贡献类型表：${file}`)
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  const types = {}
  for (const [id, t] of Object.entries(raw.types || {})) types[id] = { id, ...t }
  CACHE = { meta: raw.$meta || null, types, bandLabels: raw.bandLabels || {} }
  return CACHE
}

/** 供测试注入，避免动到真文件。 */
export function resetContributionTypesCache() { CACHE = null }

export const CONTRIBUTION_TYPE_IDS = ['new-theory', 'new-algorithm', 'empirical-law', 'negative-result', 'benchmark', 'unification', 'systems']

/** unification 与 negative-result 的标志性说法是强信号：命中一个就足以定性，权重 2。 */
const STRONG_DETECT = {
  unification: ['equivalent to', 'is equivalent', 'special case of', 'can be reduced to', 'unif(y|ies)', '统一', '等价'],
  'negative-result': ['fail to reproduce', 'does not reproduce', 'no improvement over', '无法复现'],
}

/**
 * 判一条 claim 属于哪类贡献。
 *
 * 打分规则：命中 `detect` 里每个模式 +1；`STRONG_DETECT` 里的标志性说法每个 +2——
 * 「等价于」「无法复现」这种句式本身就是结论，不该被 theorem 的加分盖掉。
 * `theorem` 型证据对 `new-theory` 额外 +2，但这只是加分，不是决定性证据。
 */
export function classifyContribution(claim = {}) {
  const table = loadContributionTypes()
  const text = `${claim.mechanism || ''} ${claim.prediction || ''} ${claim.note || ''}`
  const scores = []
  for (const type of Object.values(table.types)) {
    let score = 0
    const hits = []
    for (const pattern of type.detect || []) {
      try {
        if (new RegExp(pattern).test(text)) { score += 1; hits.push(pattern) }
      } catch { /* 坏模式不该拖垮整条判定 */ }
    }
    for (const pattern of STRONG_DETECT[type.id] || []) {
      try {
        if (new RegExp(pattern, 'i').test(text) && !hits.includes(pattern)) { score += 2; hits.push(pattern) }
      } catch { /* 同上 */ }
    }
    if (type.id === 'new-theory' && claim.evidenceKind === 'theorem') score += 2
    if (type.id === 'new-algorithm' && claim.evidenceKind === 'experiment') score += 1
    scores.push({ id: type.id, label: type.label, score, hits: hits.slice(0, 4) })
  }
  scores.sort((a, b) => b.score - a.score)
  const best = scores[0]
  const runnerUp = scores[1]
  /* hits 为空时 score 只来自证据类型加分——那不是「命中」，不能当成判定依据 */
  if (!best || best.score === 0 || best.hits.length === 0) {
    return {
      typeId: 'new-algorithm',
      label: table.types['new-algorithm']?.label || '新算法',
      confidence: 'low',
      candidates: scores,
      why: '没有任何类型模式命中，按最常见的「新算法」处理。这条判定基本等于猜，请先人工确认 claim 的贡献形态。',
    }
  }
  const margin = best.score - (runnerUp?.score || 0)
  const confidence = margin >= 2 ? 'high' : margin === 1 ? 'medium' : 'low'
  return {
    typeId: best.id,
    label: best.label,
    confidence,
    candidates: scores,
    why: `命中 ${best.hits.join(' / ')}${runnerUp && runnerUp.score > 0 ? `；次优 ${runnerUp.id}(${runnerUp.score})` : ''}`,
  }
}

/**
 * 生成证据清单：把目标档位**及以上**的要求都列出来，并标出哪些在 claim 里已经有。
 *
 * 为什么要含更高档：目标是 band 3 时，band 4 的清单告诉你「再往前一步能到哪」。
 * 只给当前档位等于把路封死。
 */
export function requiredEvidenceFor(typeId, targetBand = 4, { claim = null } = {}) {
  const table = loadContributionTypes()
  const type = table.types[typeId]
  if (!type) throw new Error(`未知贡献类型 ${typeId}；可选：${CONTRIBUTION_TYPE_IDS.join(', ')}`)
  const bands = ['3', '4', '5'].filter((b) => Number(b) >= targetBand)
  const out = []
  for (const band of bands) {
    const items = type.evidence?.[band] || []
    for (const item of items) {
      out.push({
        band: Number(band),
        kind: item.kind,
        item: item.item,
        how: item.how,
        weeks: item.weeks || 2,
        have: claim ? alreadyHave(claim, item) : false,
        isGapToBand: Number(band) > targetBand,
      })
    }
  }
  return out
}

/** 「已经有了吗」：只看 claim 自带的证据类型，不做语义判断。 */
function alreadyHave(claim, item) {
  if (claim.evidenceKind === 'theorem' && item.kind === 'theorem') return true
  if (claim.evidenceKind === 'experiment' && (item.kind === 'experiment' || item.kind === 'ablation')) return true
  return false
}

/**
 * 门槛差距：距目标 band 还缺什么。用 `type.gate` 原文，加上「缺的证据项数」。
 */
export function gateGapsFor(typeId, targetBand = 4, evidence = []) {
  const table = loadContributionTypes()
  const type = table.types[typeId]
  if (!type) throw new Error(`未知贡献类型 ${typeId}`)
  const gaps = []
  const gate = type.gate?.[String(targetBand)]
  if (gate) gaps.push({ kind: 'gate', band: targetBand, statement: gate })
  const missingAtBand = evidence.filter((e) => e.band === targetBand && !e.have)
  const missingAbove = evidence.filter((e) => e.isGapToBand && !e.have)
  if (missingAtBand.length > 0) {
    gaps.push({ kind: 'evidence', band: targetBand, statement: `目标档位还缺 ${missingAtBand.length} 项证据：${missingAtBand.map((e) => e.item).join('；')}` })
  }
  if (missingAbove.length > 0) {
    gaps.push({ kind: 'upside', band: targetBand + 1, statement: `再往上一档还能补 ${missingAbove.length} 项：${missingAbove.slice(0, 3).map((e) => e.item).join('；')}` })
  }
  return gaps
}

/**
 * 工期粗估。
 *
 * 只算**目标档位**的未拥有项：把 4/5 档的清单也算进来会让「目标是 band 3」看起来比
 * 「目标是 band 5」更久，反直觉也没意义——那些是路标，不是当期承诺。
 * 上行空间单独用 `upwardWeeks` 报。
 */
export function estimateWeeks(evidence = [], { band = null, overlap = 0.7 } = {}) {
  const scoped = band === null ? evidence : evidence.filter((e) => e.band === band)
  const todo = scoped.filter((e) => !e.have)
  if (todo.length === 0) {
    return {
      weeks: 0, rawWeeks: 0, items: 0,
      note: band === null
        ? '清单里的证据都已经有了（按 claim 自带的证据类型判断）。'
        : `目标档位（band ${band}）的证据按 claim 自带类型判断已齐，工期只剩写作与投稿。`,
    }
  }
  const total = todo.reduce((sum, e) => sum + (e.weeks || 2), 0)
  return {
    weeks: Math.max(1, Math.round(total * overlap)),
    rawWeeks: total,
    items: todo.length,
    note: `band ${band ?? '-'} 还有 ${todo.length} 项待补，相加 ${total} 周，乘重叠系数 ${overlap} 得 ${Math.max(1, Math.round(total * overlap))} 周。工期粗估，不是承诺。`,
  }
}

/**
 * 候选期刊：按 band 从 journals 里筛，再用 M3 的实证足迹排序（如果库里有）。
 *
 * 没有 intel 时只按 band 给，并在 note 里说明「还没做实证匹配」。
 */
export function candidateJournalsFor(targetBand, journals = [], { store = null, limit = 5 } = {}) {
  if (!Array.isArray(journals) || journals.length === 0) return { journals: [], note: '期刊表未加载，无法给候选。' }
  const exact = journals.filter((j) => j.band === targetBand)
  const oneBelow = journals.filter((j) => j.band === targetBand - 1)
  const pool = exact.length >= 3 ? exact : [...exact, ...oneBelow]
  const picked = pool.slice(0, Math.max(limit, 5)).map((j) => ({
    id: j.id,
    name: j.name,
    band: j.band,
    type: j.type || null,
    limitation: j.intelPolicy === 'conference-no-issn' ? '会议，无 ISSN，M3 情报层不覆盖' : null,
  }))
  const note = store
    ? '已按 band 筛选；具体方向匹配请接着跑 science_journal_fit（可带 intel:true 用实证足迹重排）。'
    : '只按 band 筛选，没有用实证足迹。'
  return { journals: picked, note }
}

/**
 * 主函数：claim + gap → 完整方案。
 */
export function designContribution({ claim, gap = null, targetBand = 4, journals = [], store = null } = {}) {
  const table = loadContributionTypes()
  const cls = classifyContribution(claim || {})
  const band = Math.max(3, Math.min(5, Number(targetBand) || 4))
  const evidence = requiredEvidenceFor(cls.typeId, band, { claim })
  const gateGaps = gateGapsFor(cls.typeId, band, evidence)
  const weeks = estimateWeeks(evidence, { band })
  const upward = estimateWeeks(evidence.filter((e) => e.isGapToBand), { band: null })
  const candidates = candidateJournalsFor(band, journals, { store })

  /* 缺口类型与贡献类型的搭配提示：某些缺口天然属于某类贡献 */
  const fit = gap ? judgeGapFit(cls.typeId, gap.gapType) : null

  return {
    typeId: cls.typeId,
    typeLabel: cls.label,
    typeConfidence: cls.confidence,
    typeWhy: cls.why,
    typeCandidates: cls.candidates.filter((c) => c.score > 0).slice(0, 3),
    targetBand: band,
    bandLabel: table.bandLabels?.[String(band)] || null,
    requiredEvidence: evidence,
    evidenceCount: { atBand: evidence.filter((e) => e.band === band).length, above: evidence.filter((e) => e.isGapToBand).length, have: evidence.filter((e) => e.have).length },
    gateGaps,
    estimatedWeeks: weeks.weeks,
    weeksNote: weeks.note,
    upwardWeeks: upward.weeks,
    upwardNote: upward.weeks > 0 ? `再往上一档（band ${band + 1} 级）还要 ≈${upward.weeks} 周：${upward.note}` : null,
    candidateJournals: candidates.journals,
    journalsNote: candidates.note,
    ...(fit ? { gapFit: fit } : {}),
    caveat: table.meta?.warning || '门槛是审稿习惯的总结，不是期刊官方标准。',
  }
}

/** 缺口类型 → 贡献类型的匹配度。不匹配时要提醒，否则会设计出「用实证补理论缺口」这种方案。 */
const GAP_TO_TYPE = {
  theory: ['new-theory'],
  scale: ['empirical-law', 'new-algorithm'],
  transfer: ['unification'],
  reproduction: ['negative-result'],
  benchmark: ['benchmark'],
}

function judgeGapFit(typeId, gapType) {
  const expected = GAP_TO_TYPE[gapType] || []
  const ok = expected.includes(typeId)
  return {
    gapType,
    expectedTypes: expected,
    ok,
    note: ok
      ? `缺口（${gapType}）与贡献类型（${typeId}）匹配。`
      : `缺口是 ${gapType}，但方案落在 ${typeId} 上。要么换贡献类型，要么先补 ${expected.join('/') || '对应类型'} 的证据——`
        + '用实验去填理论缺口是最常见的失败设计。',
  }
}

export default {
  loadContributionTypes, classifyContribution, requiredEvidenceFor, gateGapsFor,
  estimateWeeks, candidateJournalsFor, designContribution, CONTRIBUTION_TYPE_IDS,
}
