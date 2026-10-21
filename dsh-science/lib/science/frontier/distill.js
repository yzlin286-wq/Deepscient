/**
 * 从 README / 摘要里把散文拆成「可证伪的 claim」。
 *
 * ## 这一层只做结构化，不做评价
 *
 * 一句 README 里写着 "Muon converges at rate O(1/T)"，工具能认出这是一个定理式陈述、
 * 抽出原文、配上一条反推的可证伪条件。至于它**是不是真的**，工具不判——
 * 每条 claim 的 `needsHumanReview` 恒为 true，`excerpt` 原样保留，人自己去看。
 *
 * ## 为什么 mechanism 直接用原文句子
 *
 * 一旦改写就会引入工具自己的措辞，读者再也分不清「作者说的」和「工具编的」。
 * 所以 mechanism 永远是原文句子（截断到 240 字），prediction / falsifier 才是模板生成的，
 * 并用 `derived: true` 标出来。
 */

/** 句子类型。每种只用于分类，不代表可信度。 */
export const SENTENCE_KINDS = ['theorem', 'mechanism', 'result', 'limitation', 'marketing', 'other']

export const PATTERNS = {
  theorem: [
    /\btheorem\b/i, /\blemma\b/i, /\bproposition\b/i, /\bcorollary\b/i,
    /\bwe prove\b/i, /\bproof\b/i, /\bconverges?\b/i, /\bconvergence (rate|guarantee)\b/i,
    /\bregret bound\b/i, /\blower bound\b/i, /\bupper bound\b/i,
    /\bO\s*\(\s*[^)]{1,20}\)/,
    /收敛/, /定理/, /证明/, /界\s*O\(/,
  ],
  mechanism: [
    /\bwe propose\b/i, /\bwe introduce\b/i, /\bwe present\b/i, /\bour (method|approach|algorithm|optimizer)\b/i,
    /\bworks by\b/i, /\brelies on\b/i, /\bbased on\b/i, /\binstead of\b/i,
    /\bby (normalizing|orthogonalizing|clipping|scaling|preconditioning|averaging)\b/i,
    /\busing\b.{0,40}\b(instead|rather)\b/i,
    /我们提出/, /本文提出/, /通过对/, /利用/, /相比/,
  ],
  result: [
    /\boutperforms?\b/i, /\bachieves?\b/i, /\bfaster than\b/i, /\bbetter than\b/i,
    /\bspeed-?up\b/i, /\bspeedup\b/i, /\bimprov(e|es|ed|ement)\b/i,
    /\bstate[- ]of[- ]the[- ]art\b/i, /\bSOTA\b/, /\b\d+(\.\d+)?\s*[x×]\b/i,
    /\b(reduces?|decreases?|lowers?)\b.{0,30}\b\d/i,
    /* README 的成果常写成 "training speed record" / "throughput" 这种名词短语，不含动词 */
    /\bspeed\b/i, /\bthroughput\b/i, /\brecord\b/i,
    /优于/, /提升/, /加速/, /降低/,
  ],
  limitation: [
    /\blimitation\b/i, /\bdoes not\b/i, /\bfails? (to|on|when)\b/i, /\bonly works\b/i,
    /\brequires?\b/i, /\bassum(e|es|ption)\b/i, /\bcaveat\b/i,
    /局限/, /不足/, /仅在/, /假设/,
  ],
  marketing: [
    /\brevolutionary\b/i, /\bblazing\b/i, /\bgame[- ]chang/i, /\bnext[- ]generation\b/i,
    /\bultimate\b/i, /\bbest[- ]in[- ]class\b/i, /\bcutting[- ]edge\b/i,
    /\bstate of the art\b/i, /\bguaranteed\b/i,
    /颠覆/, /最强/, /业界第一/,
  ],
}

/** 带数字/单位的句子，比纯形容词有力得多。 */
const HAS_NUMBER = /\d/
const HAS_UNIT = /(\d+(\.\d+)?\s*(%|x|×|ms|s|GB|MB|B tokens|steps|epochs))|O\s*\(/i

/**
 * 切句。刻意保守：只按句末标点 + 空白切，并跳过常见缩写。
 */
export function splitSentences(text = '') {
  const normalised = String(text)
    .replace(/\r\n/g, '\n')
    /* 代码块与表格不是散文，先摘掉 */
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\n{2,}/g, '\n')
  const out = []
  for (const para of normalised.split(/\n/)) {
    /* 去掉 markdown 列表与标题前缀：README 的成果常写成 bullet，前缀会污染 claim 首词 */
    const line = para.replace(/^\s{0,3}([*\-+]|\d+\.)\s+/, '').replace(/^\s{0,3}#{1,6}\s+/, '').trim()
    if (!line || line.length < 20) continue
    /* 保护 e.g. / i.e. / et al. / Fig. 不被切断 */
    const guarded = line.replace(/\b(e\.g|i\.e|et al|Fig|Eq|vs|cf|approx)\./gi, '$1\u0001')
    /* 中文句号后通常不带空格，只在空白处切会把整段中文并成一句 */
    for (const piece of guarded.split(/(?<=[.!?。！？])\s+|(?<=[。！？])(?=[\u4e00-\u9fa5])/)) {
      const s = piece.replace(/\u0001/g, '.').trim()
      if (visibleLength(s) >= MIN_SENTENCE) out.push(s)
    }
  }
  return out
}

/** 中文一个字的信息量约等于英文两个字符，按这个折算再比阈值，否则中文短句全被滤掉。 */
function visibleLength(text) {
  const cjk = (String(text).match(/[\u4e00-\u9fa5]/g) || []).length
  return String(text).length + cjk
}

/** 一句话至少要有这么多「可见长度」才算句子，否则是标题碎片或表格残留。 */
const MIN_SENTENCE = 20

/** 给单句定性。一句可命中多类，按「证据强度」排序取第一个。 */
export function classifySentence(sentence = '') {
  const hits = []
  for (const kind of SENTENCE_KINDS) {
    if (kind === 'other') continue
    const re = PATTERNS[kind]
    if (re && re.some((r) => r.test(sentence))) hits.push(kind)
  }
  if (hits.length === 0) return { kind: 'other', hits }
  const order = ['theorem', 'mechanism', 'result', 'limitation', 'marketing']
  hits.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return { kind: hits[0], hits }
}

/** 营销句里带数字的，其实是有内容的——降级为 result，不要当营销丢掉。 */
function isMarketingOnly(sentence) {
  return classifySentence(sentence).kind === 'marketing' && !(HAS_NUMBER.test(sentence) && HAS_UNIT.test(sentence))
}

/**
 * 反推可证伪条件。模板化，**不是**原文，所以调用方必须把它标成 derived。
 */
export function makeFalsifier(mechanism, kind = 'mechanism') {
  const m = String(mechanism || '')
  if (kind === 'theorem') {
    return '按文中假设构造反例，或实测收敛阶低于所声明的阶，该陈述即不成立；另需检查假设是否被论文偷偷加强（如额外光滑性、有界方差）。'
  }
  if (kind === 'result') {
    return '在独立环境按同样设置复现，若效应量消失、方向反转或只在单一随机种子下成立，该陈述即不成立。'
  }
  if (kind === 'limitation') {
    return `文中自述的限制若能被绕过（${m.slice(0, 50)}），这条限制就不再是限制，需重新检查作者为何没能绕过。`
  }
  return `若阻断该机制的关键中间量后，声称的效果仍然出现，则该机制解释不成立；反之若效果随该中间量单调变化，机制得到支持。`
}

/**
 * 主函数：文本 → claim 列表。
 *
 * @returns `{claims, sentences, stats, warnings}`；`claims` 里每条都带 `needsHumanReview: true`。
 */
export function distillClaims(text = '', { maxClaims = 5, sourceUrl = null, now = Date.now() } = {}) {
  const sentences = splitSentences(text)
  const warnings = []
  if (sentences.length === 0) {
    return {
      claims: [], sentences: [], warnings: ['no-textual-content'], stats: { sentences: 0, byKind: {} },
      caveat: '这段文本没有可解析的散文（可能是图片、纯代码块或空 README），无法提炼。',
    }
  }

  const classified = sentences.map((s) => ({ text: s, ...classifySentence(s) }))
  const byKind = {}
  for (const c of classified) byKind[c.kind] = (byKind[c.kind] || 0) + 1

  const theorems = classified.filter((c) => c.kind === 'theorem')
  const mechanisms = classified.filter((c) => c.kind === 'mechanism')
  const results = classified.filter((c) => c.kind === 'result' && !isMarketingOnly(c.text))
  const limitations = classified.filter((c) => c.kind === 'limitation')

  if (mechanisms.length === 0 && theorems.length === 0 && results.length === 0) {
    warnings.push('no-claim-bearing-sentence')
  }

  /* 组合策略：优先「机制 + 与之最近的定理或结果」配对，配对不上就单独成 claim */
  const claims = []
  const used = new Set()
  const pool = [...mechanisms, ...theorems]

  for (const anchor of pool) {
    if (claims.length >= maxClaims) break
    if (used.has(anchor.text)) continue
    used.add(anchor.text)

    /* 找最近的支撑句：定理优先，其次带数字的结果 */
    const support = [...theorems, ...results]
      .filter((s) => s.text !== anchor.text && !used.has(s.text))
      .sort((a, b) => Math.abs(sentences.indexOf(a.text) - sentences.indexOf(anchor.text))
        - Math.abs(sentences.indexOf(b.text) - sentences.indexOf(anchor.text)))[0]

    const evidenceKind = anchor.kind === 'theorem' ? 'theorem'
      : support?.kind === 'theorem' ? 'theorem'
        : support ? 'experiment' : 'anecdote'

    const confidence = evidenceKind === 'theorem'
      ? (theorems.length > 0 && mechanisms.length > 0 ? 'high' : 'medium')
      : (support && HAS_NUMBER.test(support.text) ? 'medium' : 'low')

    if (support) used.add(support.text)

    claims.push({
      mechanism: truncate(anchor.text, 240),
      prediction: support ? truncate(support.text, 240) : null,
      falsifier: makeFalsifier(anchor.text, evidenceKind === 'theorem' ? 'theorem' : 'mechanism'),
      evidenceKind,
      confidence,
      needsHumanReview: true,
      excerpt: truncate(anchor.text, 320),
      supportExcerpt: support ? truncate(support.text, 320) : null,
      derived: { prediction: Boolean(support), falsifier: true },
      sourceUrl,
      createdAt: now,
    })
  }

  /* 机制句配完之后还有名额，就把没被用到的结果句补成「待解释的观察」 */
  if (claims.length < maxClaims) {
    for (const r of results) {
      if (claims.length >= maxClaims) break
      if (used.has(r.text)) continue
      used.add(r.text)
      claims.push({
        mechanism: truncate(r.text, 240),
        prediction: null,
        falsifier: makeFalsifier(r.text, 'result'),
        evidenceKind: 'experiment',
        confidence: HAS_NUMBER.test(r.text) && HAS_UNIT.test(r.text) ? 'medium' : 'low',
        needsHumanReview: true,
        excerpt: truncate(r.text, 320),
        supportExcerpt: null,
        derived: { prediction: false, falsifier: true },
        sourceUrl,
        createdAt: now,
        note: '这是被报告的结果，不是机制；要成为 claim 还缺「为什么」。',
      })
    }
    if (claims.some((c) => c.note)) warnings.push('has-result-only-claims')
  }

  /* 没有机制句也没有可用机制：退化成「观察 + 待解释」，仍然是有用的起点 */
  if (claims.length === 0) {
    for (const r of results.slice(0, maxClaims)) {
      claims.push({
        mechanism: truncate(r.text, 240),
        prediction: null,
        falsifier: makeFalsifier(r.text, 'result'),
        evidenceKind: 'experiment',
        confidence: HAS_NUMBER.test(r.text) ? 'medium' : 'low',
        needsHumanReview: true,
        excerpt: truncate(r.text, 320),
        supportExcerpt: null,
        derived: { prediction: false, falsifier: true },
        sourceUrl,
        createdAt: now,
        note: '没有找到机制陈述，这条只是被报告的结果；要成为 claim 还缺「为什么」。',
      })
    }
    if (claims.length > 0) warnings.push('no-mechanism-sentence')
  }

  const marketing = classified.filter((c) => c.kind === 'marketing')
  if (marketing.length > 0) {
    warnings.push(`marketing-sentences:${marketing.length}`)
  }

  return {
    claims,
    sentences: classified.slice(0, 40).map((c) => ({ text: truncate(c.text, 160), kind: c.kind })),
    stats: {
      sentences: sentences.length,
      byKind,
      theorems: theorems.length,
      mechanisms: mechanisms.length,
      results: results.length,
      limitations: limitations.length,
      marketing: marketing.length,
    },
    warnings,
    caveat: '每条 claim 的 mechanism 是原文句子，prediction/falsifier 是模板生成（derived 标记）。工具不判断真伪，needsHumanReview 恒为 true。',
  }
}

/** 从 README 里抽「作者自己承认的限制」，这是写 Discussion 时最省事的一段。 */
export function extractLimitations(text = '', { max = 5 } = {}) {
  const sentences = splitSentences(text)
  return sentences
    .filter((s) => classifySentence(s).kind === 'limitation')
    .slice(0, max)
    .map((s) => truncate(s, 240))
}

function truncate(s, n) {
  const str = String(s || '').trim()
  return str.length <= n ? str : `${str.slice(0, n - 1)}…`
}

export default { distillClaims, splitSentences, classifySentence, makeFalsifier, extractLimitations, PATTERNS, SENTENCE_KINDS }
