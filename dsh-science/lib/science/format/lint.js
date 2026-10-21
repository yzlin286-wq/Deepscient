/**
 * 稿件合规检查：把源文件对着目标期刊的硬限制量一遍。
 *
 * 与 M2 的 `science_paper_audit` 分工不同：那套查的是**论证质量**（claim 有没有证据、
 * gap 是否成立），这里查的是**投稿要件**（字数、图表数、引文完整性、结构缺节）。
 * 两者都会在投稿前跑，但改的东西不一样——这里的问题改起来是机械的。
 *
 * 硬限制来自 data/journals.json 的 `limits`，版式要求来自 journal-formats.json。
 * 期刊没收录时不猜数字：只报告能算的量，限制项标成 `unknown`。
 */

import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { inlineText } from './markdown.js'
import { canonicalSection } from './source.js'
import { collectRefs } from './markdown.js'

const CJK = /[\u3400-\u9fff\u3040-\u30ff]/g

/** 字数：CJK 每字计 1，拉丁按空格分词计 1。与多数期刊的"word count"约定一致。 */
export function countWords(text) {
  const source = String(text ?? '')
  const cjk = (source.match(CJK) || []).length
  const latin = source
    .replace(CJK, ' ')
    .replace(/[0-9]+[.,][0-9]+/g, 'NUM')
    .split(/\s+/)
    .filter((token) => /[A-Za-z0-9]/.test(token))
    .length
  return cjk + latin
}

const blocksToText = (blocks) => blocks
  .map((block) => {
    if (block.type === 'para' || block.type === 'quote') return inlineText(block.inline)
    if (block.type === 'list') return block.items.map((item) => inlineText(item.inline)).join(' ')
    if (block.type === 'heading') return block.text
    if (block.type === 'figure') return inlineText(block.captionInline ?? [])
    if (block.type === 'table') {
      const header = block.header.map((cell) => inlineText(cell))
      const rows = block.rows.map((row) => row.map((cell) => inlineText(cell)).join(' '))
      return [...header, ...rows].join(' ')
    }
    return ''
  })
  .join('\n')

const DEFAULT_ABSTRACT_WORDS = { min: 120, max: 300 }

function severity(level, code, message, detail) {
  return { code, severity: level, message, ...(detail ? { detail } : {}) }
}

/**
 * @param {object} doc parseSource 的结果
 * @param {object} format resolveFormat 的结果
 * @param {{baseDir?: string, targetWords?: number}} options
 */
export function lintManuscript(doc, format, { baseDir = process.cwd() } = {}) {
  const findings = []
  const metrics = {}

  const blocks = doc.blocks
  const bodyBlocks = blocks.filter((block) => {
    if (block.type !== 'heading') return true
    const section = canonicalSection(block.text)
    return section !== 'references'
  })

  const bodyText = blocksToText(bodyBlocks)
  const words = countWords(bodyText)
  const abstractWords = countWords(doc.meta.abstract || '')
  const figures = blocks.filter((block) => block.type === 'figure')
  const tables = blocks.filter((block) => block.type === 'table')
  const equations = blocks.filter((block) => block.type === 'math')

  metrics.words = words
  metrics.abstractWords = abstractWords
  metrics.figures = figures.length
  metrics.tables = tables.length
  metrics.equations = equations.length
  metrics.references = doc.references.length
  metrics.keywords = (doc.meta.keywords || []).length
  metrics.titleWords = countWords(doc.meta.title || '')
  metrics.titleChars = String(doc.meta.title || '').length

  const limits = format.limits || null
  metrics.limits = limits
  metrics.journalKnown = Boolean(format.journal)

  // ── 篇幅 ──────────────────────────────────────────────
  /* limits.words === 0 表示"该刊不设字数上限"（PLOS ONE 这类）。
     以前这个分支会把 0 当上限，于是 355 词的稿子被判"超过上限 0 词的 25%"——
     一条永远无法修复的 block，等于把这条规则变成噪声。 */
  if (limits && Number.isFinite(limits.words) && limits.words > 0) {
    const cap = limits.words
    if (words > cap * 1.25) {
      findings.push(severity('block', 'words-over-hard',
        `正文 ${words} 词，超过 ${format.journal?.name ?? format.journalId} 上限 ${cap} 词的 25%`,
        '先砍重复的结果描述和方法细节，不要靠缩字号挤进去'))
    } else if (words > cap) {
      findings.push(severity('warn', 'words-over',
        `正文 ${words} 词，超过上限 ${cap} 词（${Math.round((words / cap - 1) * 100)}%）`))
    } else if (words < cap * 0.5 && cap >= 2000) {
      findings.push(severity('info', 'words-thin',
        `正文 ${words} 词，不到上限 ${cap} 词的一半——顶刊常见退稿理由是"内容量不足"`))
    }
  } else {
    findings.push(severity('info', 'words-unbounded',
      `正文 ${words} 词；目标期刊未收录，无法比对字数上限`,
      '在 front matter 写 `journal: <journals.json 里的 id>` 才能检查'))
  }

  // ── 摘要 ──────────────────────────────────────────────
  const abstractRange = limits?.abstractWords ?? DEFAULT_ABSTRACT_WORDS
  const abstractMin = abstractRange.min ?? DEFAULT_ABSTRACT_WORDS.min
  const abstractMax = abstractRange.max ?? DEFAULT_ABSTRACT_WORDS.max
  if (abstractWords === 0) {
    findings.push(severity('block', 'abstract-missing', '摘要为空'))
  } else if (abstractWords < abstractMin) {
    findings.push(severity('warn', 'abstract-short', `摘要 ${abstractWords} 词，短于 ${abstractMin} 词`))
  } else if (abstractWords > abstractMax) {
    findings.push(severity('block', 'abstract-long', `摘要 ${abstractWords} 词，超过 ${abstractMax} 词`))
  } else {
    findings.push(severity('pass', 'abstract-ok', `摘要 ${abstractWords} 词，在 ${abstractMin}–${abstractMax} 区间`))
  }

  // ── 图表 ──────────────────────────────────────────────
  /* limits.figures === 0 也是"不设上限"（PLOS ONE 这类以补充材料承接超额图表）。
     把 0 当上限会给出"图 1 张，超过上限 0 张"——同 words 一样，是一条修不掉的 block。 */
  if (limits && Number.isFinite(limits.figures) && limits.figures > 0) {
    const total = figures.length + tables.length
    if (figures.length > limits.figures) {
      findings.push(severity('block', 'figures-over',
        `图 ${figures.length} 张，超过上限 ${limits.figures} 张`,
        `多出来的放补充材料（Supporting Information），正文只留被直接论证的那几张`))
    } else if (total > limits.figures + 2) {
      findings.push(severity('warn', 'exhibits-heavy',
        `图 ${figures.length} + 表 ${tables.length}，正文非文字元素偏多（上限 ${limits.figures} 图）`))
    }
  }

  const missingFigures = figures.filter((block) => {
    const src = String(block.src || '')
    if (!src) return true
    if (/^https?:/.test(src)) return false
    const file = isAbsolute(src) ? src : resolve(baseDir, src)
    return !existsSync(file)
  })
  if (missingFigures.length > 0) {
    findings.push(severity('block', 'figure-file-missing',
      `${missingFigures.length} 张图的文件找不到：${missingFigures.map((b) => b.src).join(', ')}`))
  }
  const uncaptioned = figures.filter((block) => countWords(block.caption) < 5)
  if (uncaptioned.length > 0) {
    findings.push(severity('warn', 'figure-caption-thin',
      `${uncaptioned.length} 张图的图注少于 5 个词——图注要能独立读懂`))
  }
  const unlabeled = figures.filter((block) => !block.label)
  if (unlabeled.length > 0) {
    findings.push(severity('info', 'figure-unlabeled',
      `${unlabeled.length} 张图没有 \`{#fig:...}\` 标签，正文无法交叉引用`))
  }

  // ── 引文完整性 ────────────────────────────────────────
  const { cites, labels } = collectRefs(blocks)
  const refKeys = new Set(doc.references.map((ref) => ref.key))
  const cited = new Set(cites)
  const undefinedKeys = [...cited].filter((key) => !refKeys.has(key))
  const uncitedKeys = [...refKeys].filter((key) => !cited.has(key))

  if (undefinedKeys.length > 0) {
    findings.push(severity('block', 'cite-undefined',
      `${undefinedKeys.length} 条引用在参考文献表里不存在：${undefinedKeys.join(', ')}`))
  }
  if (uncitedKeys.length > 0) {
    findings.push(severity('warn', 'cite-uncited',
      `${uncitedKeys.length} 条参考文献正文没引：${uncitedKeys.join(', ')}`,
      '投稿系统会拒收"挂名引用"；要么在正文引用，要么删掉'))
  }
  if (limits && Number.isFinite(limits.refs) && limits.refs > 0 && doc.references.length > limits.refs) {
    findings.push(severity('block', 'refs-over',
      `参考文献 ${doc.references.length} 条，超过上限 ${limits.refs} 条`))
  }

  // ── 交叉引用 ──────────────────────────────────────────
  const labelSet = new Set(blocks.filter((b) => b.label).map((b) => b.label))
  const danglingLabels = [...new Set(labels)].filter((target) => target.includes(':') && !labelSet.has(target))
  const unusedLabels = [...labelSet].filter((label) => !labels.includes(label))
  if (danglingLabels.length > 0) {
    findings.push(severity('block', 'xref-dangling',
      `交叉引用指向不存在的标签：${danglingLabels.join(', ')}`))
  }
  if (unusedLabels.length > 0) {
    findings.push(severity('info', 'xref-unused',
      `${unusedLabels.length} 个标签正文从未引用：${unusedLabels.join(', ')}`))
  }

  // ── 结构 ──────────────────────────────────────────────
  const sections = new Set(
    blocks
      .filter((block) => block.type === 'heading')
      .map((block) => canonicalSection(block.text))
      .filter(Boolean),
  )
  const hasMethods = sections.has('methods')
  const hasResults = sections.has('results')
  const hasIntro = sections.has('introduction')

  if (!hasIntro) findings.push(severity('block', 'section-intro-missing', '缺引言（`## Introduction`）'))
  if (!hasResults && !hasMethods) {
    findings.push(severity('warn', 'section-body-missing',
      '既没有 Results 也没有 Methods——期刊编辑会认为这不是研究论文'))
  }
  if (!doc.meta.keywords || doc.meta.keywords.length === 0) {
    findings.push(severity('warn', 'keywords-missing', '关键词为空（多数期刊要求 3–8 个）'))
  } else if (doc.meta.keywords.length > 10) {
    findings.push(severity('warn', 'keywords-many',
      `关键词 ${doc.meta.keywords.length} 个，通常上限 8 个`))
  }

  const corresponding = (doc.meta.authors || []).filter((author) => author.corresponding)
  if (corresponding.length === 0) {
    findings.push(severity('block', 'no-corresponding', '没有标注通讯作者（front matter 里加 `corresponding: true`）'))
  }
  const noEmail = (doc.meta.authors || []).filter((author) => author.corresponding && !author.email)
  if (noEmail.length > 0) {
    findings.push(severity('warn', 'corresponding-no-email', '通讯作者没有邮箱'))
  }

  // ── 标题 ──────────────────────────────────────────────
  if (metrics.titleWords > 25 || metrics.titleChars > 150) {
    findings.push(severity('warn', 'title-long',
      `标题 ${metrics.titleChars} 字符 / ${metrics.titleWords} 词，多数期刊建议 ≤ 20 词`))
  }
  if (/[.!?。！？]$/.test(String(doc.meta.title || '').trim())) {
    findings.push(severity('info', 'title-period', '标题结尾不应带句号'))
  }

  // ── 正文排版细节 ──────────────────────────────────────
  const doubleSpace = (bodyText.match(/[^\n] {2,}[^\n]/g) || []).length
  if (doubleSpace > 0) {
    findings.push(severity('info', 'double-space', `${doubleSpace} 处连续空格`))
  }
  const figureRefs = blocks
    .filter((block) => block.type === 'para')
    .map((block) => inlineText(block.inline))
    .join(' ')
  if (figures.length > 0 && !/\bFig(?:ure)?\.?\s*\d/.test(figureRefs)) {
    findings.push(severity('warn', 'figure-unreferenced',
      '正文从未提到 "Figure N"——图必须被正文引用'))
  }

  const blocking = findings.filter((item) => item.severity === 'block')
  const warnings = findings.filter((item) => item.severity === 'warn')
  const passes = findings.filter((item) => item.severity === 'pass')

  return {
    ok: blocking.length === 0,
    blocking: blocking.length,
    warning: warnings.length,
    info: findings.filter((item) => item.severity === 'info').length,
    pass: passes.length,
    metrics,
    findings,
    format: {
      journalId: format.journalId,
      familyId: format.familyId,
      citation: format.citation,
      pageSize: format.family.docx.pageSize,
      lineNumbers: format.family.docx.lineNumbers,
    },
  }
}
