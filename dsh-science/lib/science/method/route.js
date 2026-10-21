/**
 * 加速路径规划：把"更快发表"拆成有日历的步骤，而不是口号。
 *
 * 判定原则：
 *   - Registered Report 只在"假设检验型 + 目标刊支持"时才算可行，不无脑推荐
 *   - portable review 需要预印本，且 affiliate 群以生命科学为主，跨学科要提示
 *   - 所有天数都是量级估计，输出必须标注 estimate
 */
import { readFileSync } from 'node:fs'
import { getJournal } from './journals.js'

const DATA_URL = new URL('../../../data/acceleration.json', import.meta.url)

let CACHE = null
export function loadAcceleration() {
  if (!CACHE) CACHE = JSON.parse(readFileSync(DATA_URL, 'utf8'))
  return CACHE
}

const HYPOTHESIS_DESIGNS = new Set(['experimental', 'clinical-trial', 'observational', 'meta-analysis'])
const LIFE_SCIENCE_HINT = /cell|neurosci|immun|genet|genom|molecul|biolog|protein|clinical|patient|brain|development/i

/** 目标刊的典型周期；拿不到就用 defaults。 */
function cycleOf(journal, defaults) {
  return {
    desk: journal?.firstDecisionDays?.desk ?? defaults.deskDecisionDays,
    review: journal?.firstDecisionDays?.afterReview ?? defaults.reviewRoundDays,
    estimate: true,
  }
}

/**
 * @param input {journalId, band, design, rejectReason, hasPreprint, field}
 * @returns 路径方案 + 带日历的时间线
 */
export function planRoute(input = {}) {
  const acc = loadAcceleration()
  const defaults = acc.timelineDefaults || {}
  const journal = input.journalId ? getJournal(input.journalId) : null
  const cycle = cycleOf(journal, defaults)
  const design = input.design || null

  /* ── Registered Reports ── */
  const rrJournals = acc.registeredReports?.examples || []
  const journalSupportsRR = journal?.registeredReports === true
  const designFitsRR = design ? HYPOTHESIS_DESIGNS.has(design) : null
  const rrViable = journalSupportsRR && designFitsRR !== false
  const rrReasons = []
  if (!design) rrReasons.push('未提供研究设计，无法判定是否为假设检验型')
  else if (designFitsRR === false) rrReasons.push(`设计为 ${design}，通常是探索性/方法性，不适合 RR`)
  if (journal && !journalSupportsRR) rrReasons.push(`${journal.name} 不支持 Registered Reports；可考虑 ${rrJournals.slice(0, 3).join(' / ')} 等以 RR 为常规通道的刊`)
  if (rrViable) rrReasons.push('stage 1 通过即 in-principle acceptance：结果不影响录用，只影响质量判定')

  /* ── portable review ── */
  const rc = (acc.portableReview?.platforms || []).find((p) => p.id === 'review-commons')
  const journalPortable = (journal?.portableReview || []).length > 0
  const fieldText = `${input.field || ''} ${input.title || ''} ${(input.keywords || []).join(' ')}`
  const lifeSci = LIFE_SCIENCE_HINT.test(fieldText) || !fieldText.trim()
  const prViable = journalPortable && lifeSci
  const prReasons = []
  if (!input.hasPreprint && prViable) prReasons.push('需先把预印本发到 bioRxiv/medRxiv（Review Commons 的评审对象是预印本）')
  if (!journal) prReasons.push('未指定目标刊，无法确认是否接受 portable review')
  else if (!journalPortable) prReasons.push(`${journal.name} 不在 portable review 的 affiliate 名单里`)
  if (!lifeSci && !prViable) prReasons.push('Review Commons 的 affiliate 期刊以生命科学为主，本领域需另找平台（PCI 分学科子站）')
  if (prViable) prReasons.push(`affiliate 含 ${(rc?.affiliates || []).slice(0, 4).join('、')} 等；一次评审可省 2–3 轮重复外审`)

  /* ── 预印本 ── */
  const preprintPolicy = journal?.preprint || 'allowed'
  const preprintAction = input.hasPreprint
    ? '已发预印本：投稿信里写明 DOI 与版本日期'
    : (preprintPolicy === 'allowed' ? '先发预印本占 priority（3 天内），再投稿' : `该刊政策为 ${preprintPolicy}，投前核对当期说明`)

  /* ── transfer ── */
  const chain = journal?.transferChain || []
  const publisherChain = (acc.transferChains?.chains || []).find((c) => c.path.includes(journal?.id))
  const transferViable = chain.length > 0 || Boolean(publisherChain)

  /* ── 时间线 ── */
  const timeline = []
  let cum = 0
  const push = (step, action, days, note) => {
    cum += days
    timeline.push({ step, action, days, cumulativeDays: cum, ...(note ? { note } : {}) })
  }

  if (!input.hasPreprint) push('preprint', preprintAction, defaults.preprintPostDays || 3)
  if (rrViable) {
    push('rr-stage1', '写 Stage 1 方案（假设/样本量论证/分析计划）并提交', defaults.registeredReportStage1Days || 45, '审稿只看方案')
    push('rr-review', 'Stage 1 复审与修订', 30)
    push('rr-stage2', '按注册方案执行并写 Stage 2 全文', defaults.registeredReportStage2Days || 60)
    push('rr-accept', 'Stage 2 复审（结果不参与录用判定，只查是否按方案执行与质量）', 40)
  } else {
    push('submit', `投 ${journal?.name || '目标刊'}`, 0)
    push('desk', '编辑初筛（desk 决定）', cycle.desk, '多数稿在此阶段结束')
    push('review', '外审一轮', cycle.review)
    push('revision', '修回（实验补做/分析重跑/文本重写）', defaults.revisionDays || 30)
    push('round2', '第二轮外审', defaults.secondRoundDays || 25)
    if (transferViable) push('transfer-option', '若被拒：走 transfer 而非重投', defaults.transferDays || 10, '携带审稿意见，不重新排队')
  }

  /* ── 决策树：只给与当前情形相关的分支 ── */
  const tree = (acc.decisionTree || [])
  const decision = input.rejectReason
    ? tree.filter((d) => d.reason === input.rejectReason)
    : tree

  return {
    target: journal ? {
      id: journal.id, name: journal.name, band: journal.band,
      deskDays: cycle.desk, reviewDays: cycle.review,
      acceptRate: journal.acceptRate?.value ?? null,
    } : null,
    registeredReport: {
      viable: rrViable,
      reasons: rrReasons,
      journalsThatSupport: rrJournals.slice(0, 8),
      stage1Days: defaults.registeredReportStage1Days,
      stage2Days: defaults.registeredReportStage2Days,
    },
    portableReview: {
      viable: prViable,
      reasons: prReasons,
      platforms: (acc.portableReview?.platforms || []).map((p) => p.id),
      days: defaults.portableReviewDays,
    },
    preprint: { policy: preprintPolicy, action: preprintAction },
    transfer: {
      viable: transferViable,
      chain: chain.length > 0 ? chain : (publisherChain?.path || []),
      publisher: publisherChain?.publisher || journal?.publisher || null,
    },
    timeline,
    totalDays: cum,
    decision,
    estimate: true,
    note: '天数为量级估计（data/acceleration.json 的 timelineDefaults），用于排期，不是承诺。',
  }
}

export default { planRoute, loadAcceleration }
