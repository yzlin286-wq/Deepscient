/**
 * 文本草案：cover letter 与审稿回应。
 *
 * 这两个工具**不生成成品套话**。它们产出的是"论据槽位 + 必须填的事实 + 要避免的写法"，
 * 因为套话正是编辑一眼看穿的东西。真正的句子必须由作者用具体事实填。
 */
import { getJournal } from './journals.js'

/* ══════════════ cover letter ══════════════ */

const LETTER_SLOTS = [
  {
    id: 'why-readers',
    heading: '第 1 段：本刊读者为什么会关心',
    mustFill: ['这篇稿子回答的问题属于哪个本刊读者群', '该读者群现在卡在哪一步'],
    avoid: ['This work is of great importance', 'We believe our study will be of broad interest（没有具体读者群就是空话）'],
  },
  {
    id: 'why-now',
    heading: '第 2 段：为什么是现在',
    mustFill: ['最近哪项进展/哪批数据让这个问题变得可答', '若没有时间敏感性，改成「为什么此前做不了」'],
    avoid: ['has attracted increasing attention（无引用支撑）'],
  },
  {
    id: 'what-we-show',
    heading: '第 3 段：我们做了什么（一句结论 + 三个支撑）',
    mustFill: ['一句可证伪的结论', '支撑它的 2–3 个关键结果，每个带数值', '样本量或数据规模'],
    avoid: ['We comprehensively investigated…（没有结论）', '首次（unless 你附了检索式与日期）'],
  },
  {
    id: 'why-this-journal',
    heading: '第 4 段：为什么投这本刊（scope 对应）',
    mustFill: [`本刊近期发表的相关工作（举 1–2 篇具体文章）`, '你的稿子如何接上那条线'],
    avoid: ['贵刊影响因子高（编辑最反感）', 'Your journal is prestigious'],
  },
  {
    id: 'declarations',
    heading: '第 5 段：声明（缺一项会被退回补）',
    mustFill: ['原创且未一稿多投', '全部作者同意投稿', '预印本 DOI（若已发）', '利益冲突声明', '推荐/回避审稿人（若期刊要求）'],
    avoid: ['用一段长声明淹没关键信息'],
  },
]

export function buildCoverLetter({ title, abstract, journalId, keyFinding, whyNow, relatedInJournal, preprintDoi } = {}) {
  const journal = journalId ? getJournal(journalId) : null
  const missing = []
  if (!journalId) missing.push('未指定目标刊：第 4 段无法写')
  if (!keyFinding) missing.push('未给 keyFinding（一句可证伪的结论）：第 3 段无法写')
  if (!whyNow) missing.push('未给 whyNow：第 2 段会退化成套话')
  if (!preprintDoi) missing.push('未给预印本 DOI（若已发预印本）')

  const slots = LETTER_SLOTS.map((s) => ({ ...s }))
  if (relatedInJournal && relatedInJournal.length > 0) {
    slots[3].mustFill = slots[3].mustFill.map((x) => x)
    slots[3].filled = relatedInJournal
  }

  return {
    journal: journal ? { id: journal.id, name: journal.name, deskDays: journal.firstDecisionDays?.desk ?? null } : null,
    opening: keyFinding
      ? `We report that ${String(keyFinding).replace(/^we\s+(report|show|find)\s+that\s+/i, '')}`
      : null,
    slots,
    missing,
    checks: [
      '第 1 段读完，编辑能否说出「这篇给谁看」？说不出就重写。',
      '不要复述摘要：编辑刚读完摘要。',
      '长度控制在一页（≤400 词）；附件清单另列。',
      journal ? `本刊 desk 决定中位约 ${journal.firstDecisionDays?.desk ?? '?'} 天（估计值）：前两段决定是否送审。` : '未指定目标刊时无法给周期预期。',
    ],
    note: '本工具产出论据槽位，不产出成品句子。套话会被编辑直接识别为模板投稿。',
  }
}

/* ══════════════ 审稿回应 ══════════════ */

const CLASSIFY = [
  {
    category: 'new-experiment',
    label: '要求补实验',
    pattern: /additional experiment|further experiment|should (test|measure|examine|include)|knock\s?down|knock\s?out|in vivo|cohort|replicat|more samples|补充实验|加大样本/i,
    action: '能补就补；不能补则降级为 limitation，并说明为何不影响主结论（要有数据支撑，不能只说做不到）',
    severity: 'blocking',
  },
  {
    category: 'statistics',
    label: '统计质疑',
    pattern: /statistic|sample size|power|multiple comparison|p.?value|confidence interval|\bCI\b|effect size|normality|统计/i,
    action: '重跑分析并给效应量 + CI + 校正方法；如数据处理有误，明确写出修正后的数值',
    severity: 'blocking',
  },
  {
    category: 'prior-work',
    label: '文献/优先权',
    pattern: /cite|reference|prior work|previous study|literature|already (shown|reported)|优先权|引用/i,
    action: '补引用并说明差异；若确属已知，改为"我们确认并扩展了 X 的发现"',
    severity: 'warning',
  },
  {
    category: 'claim-strength',
    label: '过度声称',
    pattern: /overclaim|not (fully )?support|does not (support|justify)|too strong|conclusion.*(weak|overreach)|过度|不足以支持/i,
    action: '降低表述强度（从"证明"改为"与…一致/支持"），并在讨论里给替代解释',
    severity: 'blocking',
  },
  {
    category: 'clarity',
    label: '表述不清',
    pattern: /unclear|confusing|should (clarify|rewrite|rephrase)|hard to follow|grammar|typo|表述|不清楚/i,
    action: '重写该段并在回应中引用改后的原句 + page/line',
    severity: 'warning',
  },
  {
    category: 'method-detail',
    label: '方法细节缺失',
    pattern: /provide (more )?detail|not enough (detail|information)|protocol|reagent|catalog|version|antibod|参数|细节/i,
    action: '补到可复现粒度，必要时移到补充材料并在正文加指引',
    severity: 'warning',
  },
  {
    category: 'disagreement',
    label: '与审稿人判断分歧',
    pattern: /we disagree|not convincing|fundamentally|flawed|fundamental (flaw|problem)|不认同|根本性/i,
    action: '先复述对方关切证明理解，再给证据；必要时请编辑裁决。不要顺从式"我们已全部修改"',
    severity: 'blocking',
  },
]

/** 把评审文本切成条目：优先按 Reviewer 分段，再按编号/空行。 */
export function splitComments(text) {
  const src = String(text || '').trim()
  if (!src) return []
  const byReviewer = src.split(/\n(?=\s*(Reviewer|Referee|审稿人)\s*[#\d1-3])/i).filter((s) => s.trim())
  const chunks = byReviewer.length > 1 ? byReviewer : [src]
  const items = []
  for (const chunk of chunks) {
    const reviewerMatch = chunk.match(/(Reviewer|Referee|审稿人)\s*[#\s]*([\d1-3])/i)
    const reviewer = reviewerMatch ? `R${reviewerMatch[2]}` : 'R?'
    const parts = chunk.split(/\n(?=\s*(?:\(?\d+[\).]|[ivx]+[\).]|[-•*])\s)/i).filter((s) => s.trim().length > 12)
    for (const p of (parts.length > 1 ? parts : [chunk])) {
      const body = p.replace(/(Reviewer|Referee|审稿人)\s*[#\s]*[\d1-3]\s*[:.]?/i, '').trim()
      if (body.length < 12) continue
      items.push({ reviewer, text: body })
    }
  }
  return items
}

/** 逐条分类，给回应骨架。 */
export function parseRebuttal(text) {
  const items = splitComments(text)
  const findings = items.map((item, index) => {
    const hit = CLASSIFY.find((c) => c.pattern.test(item.text))
    const cls = hit || {
      category: 'other',
      label: '未归类',
      action: '人工判断：先确认这是要求、质疑还是建议，再决定改或辩',
      severity: 'warning',
    }
    return {
      index: index + 1,
      reviewer: item.reviewer,
      category: cls.category,
      label: cls.label,
      severity: cls.severity,
      excerpt: item.text.slice(0, 220),
      action: cls.action,
      skeleton: [
        `复述关切：审稿人指出……（用自己的话复述，证明理解，不复述就等于没读）`,
        `我们的回应：${cls.category === 'new-experiment' ? '已补做 X（图 S3），结果支持/削弱……' : cls.category === 'statistics' ? '已重跑，修正后效应量 X（95% CI a–b）……' : '我们同意/不同意，因为……'}`,
        `改动位置：p.X, l.YY；图 Z`,
      ],
    }
  })

  const counts = {
    total: findings.length,
    blocking: findings.filter((f) => f.severity === 'blocking').length,
    byCategory: findings.reduce((acc, f) => { acc[f.category] = (acc[f.category] || 0) + 1; return acc }, {}),
  }

  return {
    counts,
    findings,
    strategy: [
      '逐条编号回应；每条先复述关切，再给结论，再给改动定位（page/line）。',
      '分两类：能改的直接改并给定位；不能改的用数据辩，不要顺从式接受（顺从会引出新一轮要求）。',
      '"要求补实验"要分流：能补的补；不能补的降级为 limitation 并解释为何不影响主结论。',
      '统计质疑一律重跑并给效应量 + CI，不要只回"我们已增加说明"。',
      '与审稿人根本分歧时，明确写出分歧点并请编辑裁决，同时说明两种解释各自的证据。',
    ],
    note: '分类基于关键词，可能误判；每条都要人工确认后再写正文。',
  }
}

export default { buildCoverLetter, parseRebuttal, splitComments }
