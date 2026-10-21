/**
 * 论文骨架：把「贡献设计」变成「可以动笔的结构」。
 *
 * ## 这一层刻意不做的事
 *
 * **不生成成品标题和摘要句子。** 从英文 claim 自动拼出来的标题必然是生硬的，
 * 交出去只会让作者在此基础上改语法，而不是改主张——这恰好是顶刊被拒的第一原因。
 *
 * 所以这里给的是**槽位 + 自检问题**：标题给三个断言式结构模板，每个模板用 claim 的关键短语
 * 填一份草稿并明确标 `draft: true`，附带「主语有没有、方向有没有、能不能被证伪」三问。
 * 摘要给五槽，每槽说明该写什么、必须填什么事实、claim 能自动填入什么。
 *
 * ## 唯一被硬编码的判断
 *
 * Figure 1 必须是核心发现、不能是示意图。这条写在 `figureOrder` 的规则里并逐条标注。
 */
import { planRoute } from './../method/route.js'

/** 断言式标题模板。每条都是「主语 + 方向 + 可证伪」，不是话题。 */
export const TITLE_PATTERNS = [
  {
    id: 'sets',
    pattern: '{X} sets {Y}',
    why: '「设定」类断言：X 决定 Y 的取值。最容易被编辑读成机制主张。',
    example: 'Chaperone concentration sets the folding rate of globular proteins',
  },
  {
    id: 'bounds',
    pattern: '{X} bounds {Y}',
    why: '「界住」类断言：适合有定理支撑的工作，天然可证伪（找到反例即倒）。',
    example: 'Orthogonalized momentum bounds the update spectrum of deep networks',
  },
  {
    id: 'governs',
    pattern: '{X} governs {Y} across {Z}',
    why: '跨规模断言：明确宣称普适性，band 4-5 常用；代价是要真的跨了规模。',
    example: 'A single exponent governs optimizer performance across four orders of magnitude',
  },
  {
    id: 'fails',
    pattern: '{X} does not {Y} when {Z}',
    why: '反例式断言：negative result 专用，冲击力最强，但必须先排除自身失误。',
    example: 'Second-order optimizers do not improve wall-clock time below one billion parameters',
  },
  {
    id: 'equivalent',
    pattern: '{X} is equivalent to {Y} under {Z}',
    why: '统一式断言：unification 专用，把两个领域钉在一起。',
    example: 'Adaptive gradient methods are sign-SGD under a diagonal preconditioner',
  },
]

/** 摘要五槽。第 2 槽是最容易漏、也是编辑判断「为什么现在」的唯一依据。 */
export const ABSTRACT_SLOTS = [
  { slot: 1, name: '背景', purpose: '这个领域已经知道什么，一句话，不写文献综述', mustFill: ['领域共识的一句话'], autoFill: 'mechanism 里提到的既有做法（AdamW 之类）' },
  { slot: 2, name: '空白', purpose: '还不知道什么、为什么重要——这是编辑判断「为什么现在」的依据', mustFill: ['缺口的完整句'], autoFill: 'gap.statement（若有）' },
  { slot: 3, name: '做法', purpose: '我们做了什么，一句，给关键方法名', mustFill: ['方法名'], autoFill: 'mechanism 的动词部分' },
  { slot: 4, name: '关键结果', purpose: '带数字：效应量、n、CI', mustFill: ['一个数', '样本量或规模'], autoFill: 'prediction 里的数字（通常不够，需补）' },
  { slot: 5, name: '意义', purpose: '改变了什么判断，不是「很重要」', mustFill: ['被推翻或建立的判断'], autoFill: null },
]

/**
 * 主函数。
 *
 * @param design - `designContribution()` 的输出
 * @param options - `{claim, gap, journalId, title, keywords, field}`
 */
export function buildPaperPlan(design, { claim = null, gap = null, journalId = null, title = null, keywords = [], field = null } = {}) {
  const typeId = design.typeId
  const band = design.targetBand

  /* claim 只报结果、不给机制时，不硬塞一个主语进标题槽——那会产出语法通的胡说。
     宁可留空槽并说清楚「你现在还没有机制」。 */
  const hasMechanism = Boolean(claim?.mechanism && MECHANISM_MARKER.test(claim.mechanism))
  /* 没有机制时不给「原句即标题」——那会把「缺机制」这个真问题藏起来 */
  const verbatim = hasMechanism ? claimAsTitle(claim) : null
  /* 原句已经能用时，模板草稿只取短主语，免得三份草稿长得一模一样 */
  const X = hasMechanism
    ? (shortPhrase(claim.mechanism, { maxWords: verbatim ? 4 : 6 }) || '（待填：你的机制主语）')
    : '（待填机制主语——当前 claim 只报了结果）'
  const Y = (claim?.prediction ? shortPhrase(claim.prediction, { maxWords: 6, preferNumber: true }) : null) || '（待填：你的结果对象）'
  const Z = band >= 4 ? 'scales' : 'the tested range'

  const titleCandidates = [
    ...(verbatim ? [verbatim] : []),
    ...pickTitlePatterns(typeId).map((p) => ({
      id: p.id,
      pattern: p.pattern,
      slots: { X, Y, Z },
      draft: p.pattern.replace('{X}', X).replace('{Y}', Y).replace('{Z}', Z),
      draftIsRough: true,
      why: p.why,
      example: p.example,
      checks: [
        { q: '标题里有明确主语吗（谁在起作用）？', hint: '只写话题没有主语，就是没主张' },
        { q: '有方向吗（升高/降低/决定/界住）？', hint: '「A 与 B 的关系」不算方向' },
        { q: '能被一个实验或反例推翻吗？', hint: '推翻不了就不是科学断言' },
      ],
    })),
  ].slice(0, 3)

  const figure1Sentence = {
    template: `{机制} 导致 {结果}，在 {范围} 上成立`,
    draft: hasMechanism ? `${X} → ${Y}` : '（还没有 Figure 1：当前 claim 只报结果，没有机制可画）',
    draftIsRough: hasMechanism,
    rule: 'Figure 1 必须是全文的核心发现，不是示意图、不是流程图。把 Figure 1 和标题一起给别人看，他能否说出你在主张什么；不能就重画。',
    check: '图注能否独立看懂，且不含「示意图」字样',
  }

  const abstractSlots = ABSTRACT_SLOTS.map((s) => ({
    slot: s.slot,
    name: s.name,
    purpose: s.purpose,
    mustFill: s.mustFill,
    autoFilled: autoFillForSlot(s.slot, { claim, gap, design }),
    status: autoFillForSlot(s.slot, { claim, gap, design }) ? 'partial' : 'empty',
  }))

  const experimentList = (design.requiredEvidence || [])
    .filter((e) => ['experiment', 'ablation', 'fit', 'prediction', 'analysis'].includes(e.kind))
    .map((e, i) => ({
      order: i + 1,
      band: e.band,
      kind: e.kind,
      item: e.item,
      how: e.how,
      weeks: e.weeks,
      have: e.have,
    }))

  const theoryList = (design.requiredEvidence || [])
    .filter((e) => ['theorem', 'theory'].includes(e.kind))
    .map((e, i) => ({ order: i + 1, band: e.band, item: e.item, how: e.how, weeks: e.weeks, have: e.have }))

  const figureOrder = buildFigureOrder({ experimentList, theoryList, band })

  const route = safeRoute({ journalId, design, band, title, keywords, field })

  const risks = buildRisks({ claim, gap, design, band })

  return {
    mechanismPresent: hasMechanism,
    titleCandidates,
    figure1Sentence,
    abstractSlots,
    experimentList,
    theoryList,
    figureOrder,
    timeline: route?.timeline || null,
    totalDays: route?.totalDays ?? null,
    routeNote: route?.note || (journalId ? null : '未指定目标刊，时间线只有研究阶段；给 journalId 可接 science_submission_route 的完整链路。'),
    risks,
    nextActions: buildNextActions({ design, abstractSlots, experimentList, theoryList }),
    caveat: '标题与 Figure 1 的 draft 是用 claim 关键短语机械填充的，必然需要重写；它们的作用是让你从「结构对不对」开始改，而不是从「措辞好不好」开始改。',
  }
}

/**
 * claim 原句本身就是断言式标题时，直接用它。
 *
 * 判据：不以「我们提出」开头（那是正文语气），词数 ≤ 14（标题不该是句子）。
 * 这种情况很常见——好的 claim 和好的标题本来就是一个东西。
 */
function claimAsTitle(claim) {
  const text = String(claim?.mechanism || '').trim()
  if (!text) return null
  if (LEAD_PATTERN.test(text)) return null
  const words = text.split(/\s+/)
  if (words.length > 14) return null
  /* 中文按字数判：超过 40 字就不像标题了 */
  if (/[\u4e00-\u9fa5]/.test(text) && text.length > 40) return null
  const titled = text.charAt(0).toUpperCase() + text.slice(1)
  return {
    id: 'verbatim',
    pattern: '（claim 原句）',
    slots: { X: null, Y: null, Z: null },
    draft: titled,
    fromClaim: true,
    why: '这条 claim 本身已经满足断言标题的三个条件（有主语、有方向、可证伪），直接用它，或只改措辞不改结构。',
    example: null,
    checks: [
      { q: '主语是否在标题前 5 个词内出现？', hint: '主语太靠后会读成话题' },
      { q: '动词是不是「决定/界住/设定/导致」这类方向词？', hint: '是「研究/探讨」就要改' },
    ],
  }
}

/** 贡献类型 → 该用哪几个标题模板。 */const TYPE_TO_PATTERNS = {
  'new-theory': ['bounds', 'sets', 'equivalent'],
  'new-algorithm': ['bounds', 'sets', 'governs'],
  'empirical-law': ['governs', 'sets'],
  'negative-result': ['fails', 'bounds'],
  benchmark: ['fails', 'governs'],
  unification: ['equivalent', 'sets'],
  systems: ['governs', 'bounds'],
}

function pickTitlePatterns(typeId) {
  const ids = TYPE_TO_PATTERNS[typeId] || ['sets', 'bounds', 'governs']
  const picked = ids.map((id) => TITLE_PATTERNS.find((p) => p.id === id)).filter(Boolean)
  /* 保证至少三个候选，不够就补通用的 */
  for (const p of TITLE_PATTERNS) {
    if (picked.length >= 3) break
    if (!picked.includes(p)) picked.push(p)
  }
  return picked.slice(0, 3)
}

function autoFillForSlot(slot, { claim, gap }) {
  if (slot === 1) return claim?.mechanism ? `已知：${shortPhrase(claim.mechanism, { maxWords: 10 })}…` : null
  if (slot === 2) return gap?.statement ? gap.statement : null
  if (slot === 3) return claim?.mechanism ? shortPhrase(claim.mechanism, { maxWords: 8 }) : null
  if (slot === 4) {
    const m = String(claim?.prediction || '').match(/\d+(\.\d+)?\s*[x×%]|\d+(\.\d+)?\s*(times|fold)/i)
    return m ? `数字已出现：${m[0]}（还需样本量或规模）` : null
  }
  return null
}

/**
 * 图的顺序：Figure 1 = 核心发现，之后每张图对应一个支撑性论证。
 *
 * 硬规则：不存在「示意图」这个位置。如果实验清单里只有 setup 类内容，就要提醒作者
 * 现在还没有核心发现可画。
 */
function buildFigureOrder({ experimentList, theoryList, band }) {
  const figures = []
  const core = experimentList.find((e) => e.band === 3 || e.band === band) || experimentList[0]
  if (core) {
    figures.push({ n: 1, role: '核心发现', from: core.item, rule: '必须是结论本身，不是流程示意' })
  } else {
    figures.push({ n: 1, role: '核心发现（缺）', from: null, rule: '实验清单里没有可当核心发现的内容——现在还没有 Figure 1，先做实验' })
  }
  experimentList.filter((e) => e !== core).slice(0, 4).forEach((e, i) => {
    figures.push({ n: i + 2, role: '支撑论证', from: e.item, rule: '图注能独立看懂' })
  })
  if (theoryList.length > 0) {
    figures.push({ n: figures.length + 1, role: '理论示意（可选）', from: theoryList[0].item, rule: `band ${band >= 4 ? '4-5' : '3'} 的理论工作通常需要一张假设与结论的关系图，但不要用它占掉 Figure 1` })
  }
  return figures
}

function safeRoute({ journalId, band, title, keywords, field }) {
  if (!journalId) return null
  try {
    return planRoute({ journalId, band, title, keywords, field })
  } catch {
    /* 期刊 id 不认识时不要让整个 plan 失败——时间线是附加信息 */
    return null
  }
}

function buildRisks({ claim, gap, design, band }) {
  const risks = []
  if (claim?.confidence === 'low') {
    risks.push({ level: 'high', risk: 'claim 的证据类型是 anecdote 或纯结果句，等于还没有机制', action: '先补一个直接测中间量的实验，再谈投稿' })
  }
  /* 只有结果、没有机制：这是代码仓转论文最常见的死因——审稿人会问「所以为什么」 */
  if (claim?.mechanism && !MECHANISM_MARKER.test(claim.mechanism)) {
    risks.push({
      level: 'high',
      risk: `这条 claim 只报告了结果，没有机制陈述（没有「通过什么导致什么」）`,
      action: '补一个机制假设并设计能直接检验它的实验；只报数字的稿子在 band 4 以上一律被判 descriptive',
    })
  }
  if (gap && gap.verdict === 'crowded') {
    risks.push({ level: 'high', risk: `缺口方向（${gap.gapType}）已被 ${gap.coveredCount} 篇覆盖`, action: '换方向，或在这些工作之上再往前一步' })
  }
  if (gap && gap.verdict === 'gap' && gap.searchedTotal === 0) {
    risks.push({ level: 'medium', risk: '检索零命中——这既可能是真空白，也可能是关键词太窄', action: '换 2-3 组关键词重查，再用 science_novelty 撞标题' })
  }
  if (design.gapFit && design.gapFit.ok === false) {
    risks.push({ level: 'high', risk: `贡献类型（${design.typeId}）与缺口类型（${design.gapFit.gapType}）不匹配`, action: design.gapFit.note })
  }
  if (band >= 5) {
    risks.push({ level: 'medium', risk: 'band 5 要求普适机制或紧界，只分析一个算法几乎不可能', action: '先按 band 4 准备，把紧界或跨域当加分项而不是前提' })
  }
  if (!design.requiredEvidence.some((e) => e.kind === 'theorem') && design.typeId === 'new-theory') {
    risks.push({ level: 'high', risk: '类型被判为理论工作，但清单里没有定理项', action: '重新确认 claim 的贡献形态' })
  }
  if (risks.length === 0) risks.push({ level: 'low', risk: '结构性风险未发现', action: '剩下的风险在阅读最近邻工作之后才会显现' })
  return risks
}

function buildNextActions({ design, abstractSlots, experimentList, theoryList }) {
  const actions = []
  const empty = abstractSlots.filter((s) => s.status === 'empty')
  if (empty.length > 0) actions.push(`补摘要空白槽：${empty.map((s) => s.name).join('、')}（其中「空白」一槽必须写完整句）`)
  const firstExperiment = experimentList.find((e) => !e.have)
  if (firstExperiment) actions.push(`先做实验：${firstExperiment.item}（${firstExperiment.how}）`)
  const firstTheory = theoryList.find((e) => !e.have)
  if (firstTheory) actions.push(`先做证明：${firstTheory.item}（${firstTheory.how}）`)
  if (design.evidenceCount.have === 0) actions.push('当前没有任何证据被判定为「已有」，先确认 claim 的原作者到底做了什么')
  actions.push('设计定稿前跑一次 science_novelty，确认没被抢发')
  return actions
}

/** 句首的「我们提出」类动词，填进标题槽只会让草稿变成不成句的英文。 */
const LEAD_PATTERN = /^\s*(we|our|this work|in this (paper|work))?\s*(propose|propose a|introduce|present|describe|show|report|demonstrate|develop)\s+/i
/** 在这些词处断开：它们后面是修饰语或对比，属于正文不属于标题主语。 */
const CUT_WORDS = new Set(['instead', 'rather', 'compared', 'whereas', 'but', 'while', 'although', 'which', 'that', 'because', 'since', 'so'])

/**
 * 出现这些词才算「有机制」：要么给了因果链条（by / because / through），
 * 要么给了方向性动词（bounds / determines / sets）。只是报了个数的不算。
 */
const MECHANISM_MARKER = new RegExp(
  '\\b(by|works? by|relies? on|based on|because|due to|through|via|leads? to|causes?|results? in|instead of|enables?'
  + '|bounds?|limits?|determines?|sets?|governs?|drives?|controls?|regulates?|modulates?|stabiliz(es?|ed))\\b'
  + '|通过|由于|从而|使得|基于|决定|降低|提高',
  'i',
)

/**
 * 取一段可读的短语，用于填标题槽。
 *
 * 做法：去掉句首的「我们提出」、在对比连词处断开、按词数截断。
 * `preferNumber` 为 true 时（填 {Y} 用），优先取带数字的片段——
 * 标题里的结果项几乎总是「1.35x speedup」这种，而不是整句。
 */
function shortPhrase(text, { maxWords = 6, preferNumber = false } = {}) {
  let cleaned = String(text || '')
    .replace(LEAD_PATTERN, '')
    .replace(/[.;:!?，。；：]$/g, '')
    .trim()
  if (!cleaned) return null

  /* 中文按标点断 + 字数截断：没有空格可切，按词切会切出无意义片段 */
  if (/[\u4e00-\u9fa5]/.test(cleaned)) {
    const first = cleaned.split(/[，。；、,;]/)[0].trim()
    return first.length <= 14 ? first : `${first.slice(0, 13)}…`
  }

  if (preferNumber) {
    const m = cleaned.match(/(\d+(\.\d+)?\s*[x×%]?\s*(speedup|faster|reduction|improvement|accuracy|gain)|O\([^)]{1,15}\))/i)
    if (m) return m[0].replace(/\s+/g, ' ').trim()
  }

  const words = cleaned.split(/\s+/)
  const cut = words.findIndex((w) => CUT_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')))
  const scoped = cut > 1 ? words.slice(0, cut) : words
  if (scoped.length <= maxWords) return scoped.join(' ')
  /* 截断时尽量停在介词前，读起来像一个短语而不是半句话 */
  const preps = ['of', 'for', 'in', 'on', 'to', 'by', 'with']
  for (let i = maxWords - 1; i >= 3; i -= 1) {
    if (preps.includes(scoped[i].toLowerCase())) return scoped.slice(0, i).join(' ')
  }
  return scoped.slice(0, maxWords).join(' ')
}

export default { buildPaperPlan, TITLE_PATTERNS, ABSTRACT_SLOTS }
