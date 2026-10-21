/**
 * 报告规范检查器：规则全部来自 data/reporting-standards.json，代码里不写学科知识。
 *
 * 关键约束：
 *   - 每条规则必须能回答"为什么"（source）与"怎么改"（fix），否则只是噪声
 *   - 目标章节缺失时记 skip，不记 pass —— 虚假通过比漏检更危险
 *   - auto:false 的项只列成待人工确认，绝不替 agent 做语义判断
 */
import { readFileSync } from 'node:fs'

const DATA_URL = new URL('../../../data/reporting-standards.json', import.meta.url)

/** 章节名归一：把各种写法映射到 doc 的键。 */
const SECTION_ALIAS = {
  title: 'title', abstract: 'abstract', summary: 'abstract',
  intro: 'intro', introduction: 'intro', background: 'intro',
  method: 'methods', methods: 'methods', materials: 'methods',
  result: 'results', results: 'results', findings: 'results',
  discussion: 'discussion', conclusion: 'discussion', conclusions: 'discussion',
  fulltext: 'fulltext', any: 'fulltext', text: 'fulltext',
  store: 'store',
}

const FIELDS = ['title', 'abstract', 'intro', 'methods', 'results', 'discussion']

function concatAll(doc) {
  return FIELDS.map((f) => doc[f]).filter(Boolean).join('\n\n')
}

/** 取规则作用的文本；返回 {text, available}。 */
export function sectionText(doc, target) {
  const key = SECTION_ALIAS[String(target || 'any').toLowerCase()] || String(target).toLowerCase()
  if (key === 'store') return { text: '', available: false, key }
  if (key === 'fulltext') {
    const text = doc.fulltext || concatAll(doc)
    return { text, available: Boolean(text && text.trim()), key }
  }
  const text = doc[key]
  return { text: text || '', available: Boolean(text && text.trim()), key }
}

function words(text) {
  const latin = (String(text).match(/[A-Za-z][A-Za-z'-]*/g) || []).length
  const cjk = (String(text).match(/[\u4e00-\u9fff]/g) || []).length
  /* 中文按字计、英文按词计，粗略折算成"词"以便与期刊 limit 对齐 */
  return latin + Math.round(cjk / 1.6)
}

const CHECKS = {
  'forbid-pattern'(text, args) {
    /* matchAll 要求 g 标志；规则里常写 flags:"i"，这里补齐而不是让规则报错 */
    const raw = args.flags || 'i'
    const flags = raw.includes('g') ? raw : `${raw}g`
    const hits = [...String(text).matchAll(new RegExp(args.pattern, flags))].map((m) => m[0])
    return { problem: hits.length > 0, evidence: hits.slice(0, 3).join(' / '), count: hits.length }
  },
  'require-pattern'(text, args) {
    const re = new RegExp(args.pattern, args.flags || 'i')
    return { problem: !re.test(String(text)) }
  },
  'require-any'(text, args) {
    const found = (args.patterns || []).find((p) => new RegExp(p, args.flags || 'i').test(String(text)))
    return { problem: !found, evidence: found || '' }
  },
  'min-words'(text, args) {
    const n = words(text)
    return { problem: n < args.min || (Number.isFinite(args.max) && n > args.max), evidence: `${n} 词` }
  },
  'max-words'(text, args) {
    const n = words(text)
    return { problem: n > args.max, evidence: `${n} > ${args.max}` }
  },
  'numbers-in-abstract'(text, args) {
    const nums = (String(text).match(/\b\d+(\.\d+)?\b/g) || []).filter((x) => Number(x) > 0)
    return { problem: nums.length < args.min, evidence: `${nums.length} 个数字` }
  },
  'figure-reference-coverage'(text, args, ctx) {
    const declared = Number(args.declared) || Number(ctx.meta?.figures) || null
    if (!declared) return { problem: false, skip: true, reason: '未声明图数' }
    const refs = new Set([...String(text).matchAll(/\b(?:Fig(?:ure)?\.?)\s*(\d+)/gi)].map((m) => m[1]))
    return { problem: refs.size < declared, evidence: `正文引用 ${refs.size} 张 / 声明 ${declared} 张` }
  },
  'limitations-present'(text, args) {
    const re = new RegExp(args.pattern, args.flags || 'i')
    return { problem: !re.test(String(text)) }
  },
  'chunk-coverage'(text, args, ctx) {
    const missing = (args.required || []).filter((name) => {
      const alias = SECTION_ALIAS[name] || name
      const candidate = alias === 'fulltext' ? (ctx.doc.fulltext || concatAll(ctx.doc)) : ctx.doc[alias]
      return !(candidate && String(candidate).trim())
    })
    return { problem: missing.length > 0, evidence: missing.length ? `缺 ${missing.join('/')}` : '' }
  },
  'orphan-claims'(_text, _args, ctx) {
    if (!ctx.store || !ctx.manuscriptId) return { problem: false, skip: true, reason: '未绑定稿件' }
    const rows = ctx.store.orphanClaims(ctx.manuscriptId)
    return {
      problem: rows.length > 0,
      evidence: rows.length ? `${rows.length} 条：${rows.slice(0, 2).map((r) => r.text.slice(0, 40)).join(' / ')}` : '',
      count: rows.length,
    }
  },
  'contradicted-claims'(_text, _args, ctx) {
    if (!ctx.store || !ctx.manuscriptId) return { problem: false, skip: true, reason: '未绑定稿件' }
    const rows = ctx.store.claimsForManuscript(ctx.manuscriptId).filter((c) => c.status === 'contradicted')
    return {
      problem: rows.length > 0,
      evidence: rows.length ? `${rows.length} 条：${rows.slice(0, 2).map((r) => r.text.slice(0, 40)).join(' / ')}` : '',
      count: rows.length,
    }
  },
  manual() {
    return { problem: false, manual: true }
  },
}

export function loadStandards() {
  const raw = JSON.parse(readFileSync(DATA_URL, 'utf8'))
  return { meta: raw.$meta || {}, profiles: raw.profiles || {} }
}

export function listProfiles() {
  const { profiles } = loadStandards()
  return Object.entries(profiles).map(([id, p]) => ({
    id,
    label: p.label,
    rules: (p.rules || []).length,
    autoRules: (p.rules || []).filter((r) => r.auto !== false).length,
  }))
}

/**
 * 跑一次审计。
 *
 * @param doc     {title, abstract, intro, methods, results, discussion, fulltext?}
 * @param options {profiles: string[], meta: {figures, words, refs}, store, manuscriptId}
 * @returns {results, counts, profiles}
 */
export function runAudit(doc = {}, options = {}) {
  const { meta = {}, store = null, manuscriptId = null } = options
  const standards = loadStandards()
  const wanted = Array.isArray(options.profiles) && options.profiles.length > 0
    ? options.profiles
    : ['general']
  const ctx = { doc, meta, store, manuscriptId }

  const results = []
  for (const profileId of wanted) {
    const profile = standards.profiles[profileId]
    if (!profile) {
      results.push({
        profile: profileId, id: `${profileId}-MISSING`, severity: 'warning', status: 'skip',
        message: `未知规范 profile：${profileId}`, fix: `可用：${Object.keys(standards.profiles).join(', ')}`,
        source: '内置规则集', auto: true,
      })
      continue
    }
    for (const rule of profile.rules || []) {
      const base = {
        profile: profileId, id: rule.id, severity: rule.severity || 'warning',
        message: rule.message, fix: rule.fix, source: rule.source, auto: rule.auto !== false,
      }
      const fn = CHECKS[rule.check]
      if (!fn) {
        results.push({ ...base, status: 'skip', evidence: `未实现的检查类型 ${rule.check}` })
        continue
      }
      const sec = sectionText(doc, rule.target)
      if (!sec.available && rule.check !== 'orphan-claims' && rule.check !== 'contradicted-claims') {
        results.push({ ...base, status: 'skip', evidence: `缺少 ${rule.target} 章节，无法检查` })
        continue
      }
      let out
      try {
        out = fn(sec.text, rule.args || {}, ctx)
      } catch (error) {
        results.push({ ...base, status: 'skip', evidence: `规则执行失败：${error.message}` })
        continue
      }
      if (out.skip) { results.push({ ...base, status: 'skip', evidence: out.reason || '' }); continue }
      if (out.manual) { results.push({ ...base, status: 'manual', evidence: rule.args?.prompt || '' }); continue }
      results.push({
        ...base,
        status: out.problem ? 'fail' : 'pass',
        ...(out.evidence ? { evidence: out.evidence } : {}),
      })
    }
  }

  const counts = {
    blocking: results.filter((r) => r.status === 'fail' && r.severity === 'blocking').length,
    warning: results.filter((r) => r.status === 'fail' && r.severity !== 'blocking').length,
    pass: results.filter((r) => r.status === 'pass').length,
    skipped: results.filter((r) => r.status === 'skip').length,
    manual: results.filter((r) => r.status === 'manual').length,
    total: results.length,
  }
  return { results, counts, profiles: wanted }
}

export default { loadStandards, listProfiles, runAudit, sectionText }
