/**
 * 文档模型 → JATS XML（NISO Z39.96 / Journal Article Tag Suite）。
 *
 * 为什么还要 JATS：越来越多出版社（PLOS、BMC、Frontiers、eLife、SciELO）
 * 的投稿系统直接吃 XML，而且它是唯一能把「结构」无损交给排版厂的格式。
 * DOCX 和 PDF 都是给人看的，JATS 是给机器看的。
 *
 * 只出 `sub-article` 级的最小合法集：front（期刊/文章元数据 + 作者 + 摘要）、
 * body（分节正文）、back（参考文献 + 致谢）。不做的：<processing-meta>、
 * 权限声明、基金标注的完整 CRediT 映射——这些投稿系统会自己补。
 */

import { formatReference, buildReferenceList, styleById } from './cite.js'
import { collectRefs } from './markdown.js'
import { canonicalSection } from './source.js'

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

export function escapeXml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch])
}

function renderInline(nodes, ctx) {
  return (nodes || [])
    .map((node) => {
      switch (node.t) {
        case 'text': return escapeXml(node.v)
        case 'em': return `<italic>${renderInline(node.c, ctx)}</italic>`
        case 'strong': return `<bold>${renderInline(node.c, ctx)}</bold>`
        case 'code': return `<monospace>${escapeXml(node.v)}</monospace>`
        case 'math': return `<inline-formula><tex-math>${escapeXml(node.v)}</tex-math></inline-formula>`
        case 'cite': {
          const keys = node.keys.map((k) => k.key)
          return `<xref ref-type="bibr" rid="${escapeXml(keys.join(' '))}">${escapeXml(
            keys.map((key) => ctx.numbers.get(key) ?? '?').join(','),
          )}</xref>`
        }
        case 'ref': return `<xref rid="${escapeXml(node.target)}">${escapeXml(node.target)}</xref>`
        case 'link': return `<ext-link ext-link-type="uri" xlink:href="${escapeXml(node.v)}">${renderInline(node.c, ctx)}</ext-link>`
        case 'break': return ''
        default: return ''
      }
    })
    .join('')
}

function secTitle(block) {
  return escapeXml(block.text)
}

function buildBody(doc, ctx) {
  const out = []
  let openSections = 0
  let figureCount = 0
  let tableCount = 0

  const closeSections = (toLevel) => {
    while (openSections > toLevel) { out.push('</sec>'); openSections -= 1 }
  }

  for (const block of doc.blocks) {
    switch (block.type) {
      case 'heading': {
        const section = canonicalSection(block.text)
        if (section === 'abstract' || section === 'references') break
        const level = Math.min(Math.max(block.level - 1, 0), 3)
        closeSections(level)
        out.push(`<sec id="${escapeXml(block.label ?? `sec-${openSections + 1}-${out.length}`)}">`)
        out.push(`<title>${secTitle(block)}</title>`)
        openSections += 1
        break
      }
      case 'para':
        out.push(`<p>${renderInline(block.inline, ctx)}</p>`)
        break
      case 'quote':
        out.push(`<disp-quote><p>${renderInline(block.inline, ctx)}</p></disp-quote>`)
        break
      case 'list': {
        const tag = block.ordered ? 'list' : 'list'
        const attrs = block.ordered ? ' list-type="order"' : ' list-type="bullet"'
        const items = block.items.map((item) => `<list-item><p>${renderInline(item.inline, ctx)}</p></list-item>`)
        out.push(`<${tag}${attrs}>${items.join('')}</${tag}>`)
        break
      }
      case 'figure': {
        figureCount += 1
        const id = block.label ?? `fig${figureCount}`
        out.push([
          `<fig id="${escapeXml(id)}">`,
          `<label>Figure ${figureCount}</label>`,
          `<caption><p>${renderInline(block.captionInline ?? [{ t: 'text', v: block.caption }], ctx)}</p></caption>`,
          `<graphic xlink:href="${escapeXml(block.src)}"/>`,
          '</fig>',
        ].join(''))
        break
      }
      case 'table': {
        tableCount += 1
        const id = block.label ?? `tab${tableCount}`
        const cols = Math.max(block.header.length, 1)
        const head = block.header.map((cell) => `<th>${renderInline(cell, ctx)}</th>`).join('')
        const rows = block.rows
          .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell, ctx)}</td>`).join('')}</tr>`)
          .join('')
        out.push([
          `<table-wrap id="${escapeXml(id)}">`,
          `<label>Table ${tableCount}</label>`,
          block.caption ? `<caption><p>${renderInline(block.captionInline ?? [{ t: 'text', v: block.caption }], ctx)}</p></caption>` : '',
          `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`,
          '</table-wrap>',
        ].join(''))
        break
      }
      case 'math':
        out.push(
          `<disp-formula${block.label ? ` id="${escapeXml(block.label)}"` : ''}><tex-math>${escapeXml(block.tex)}</tex-math></disp-formula>`,
        )
        break
      case 'code':
        out.push(`<code>${escapeXml(block.text)}</code>`)
        break
      case 'raw':
        if (block.format === 'jats') out.push(block.text)
        break
      default:
        break
    }
  }

  closeSections(0)
  return out.join('\n')
}

const JATS_REF_TYPES = {
  'article-journal': 'journal',
  book: 'book',
  chapter: 'chapter',
  conference: 'confproc',
  thesis: 'thesis',
  preprint: 'preprint',
  dataset: 'data',
  software: 'software',
  misc: 'other',
}

function buildBack(doc, format) {
  const { cites } = collectRefs(doc.blocks)
  const referenceList = buildReferenceList(doc.references, cites, format.citation)
  const byKey = new Map(doc.references.map((ref) => [ref.key, ref]))
  const entries = []

  for (const entry of referenceList.entries) {
    const ref = byKey.get(entry.key)
    if (!ref) continue

    const parts = [`<ref id="${escapeXml(entry.key)}">`, `<label>${entry.n}</label>`]
    parts.push(`<element-citation publication-type="${JATS_REF_TYPES[ref.type] ?? 'other'}">`)

    if (ref.authors.length > 0) {
      const names = ref.authors
        .map((author) => [
          '<name>',
          author.family ? `<surname>${escapeXml(author.family)}</surname>` : '',
          author.given ? `<given-names>${escapeXml(author.given)}</given-names>` : '',
          '</name>',
        ].join(''))
        .join('')
      parts.push(`<person-group person-group-type="author">${names}</person-group>`)
    }

    if (ref.title) parts.push(`<article-title>${escapeXml(ref.title)}</article-title>`)
    if (ref.journal) parts.push(`<source>${escapeXml(ref.journal)}</source>`)
    if (ref.year) parts.push(`<year>${escapeXml(ref.year)}</year>`)
    if (ref.volume) parts.push(`<volume>${escapeXml(ref.volume)}</volume>`)
    if (ref.issue) parts.push(`<issue>${escapeXml(ref.issue)}</issue>`)
    if (ref.pages) {
      const [first, last] = String(ref.pages).split(/[-–]+/)
      parts.push(`<fpage>${escapeXml(first ?? '')}</fpage>`)
      if (last) parts.push(`<lpage>${escapeXml(last)}</lpage>`)
    }
    if (ref.publisher) parts.push(`<publisher-name>${escapeXml(ref.publisher)}</publisher-name>`)
    if (ref.doi) parts.push(`<pub-id pub-id-type="doi">${escapeXml(ref.doi)}</pub-id>`)

    parts.push('</element-citation>', '</ref>')
    entries.push(parts.join(''))
  }

  return { xml: entries.join('\n'), referenceList }
}

function affilOf(meta, author) {
  const list = Array.isArray(meta.affiliations) ? meta.affiliations : []
  const id = author.affiliation ?? 1
  const found = list.find((entry) => String(entry.id) === String(id))
  if (found) return found.name ?? ''
  return typeof author.affiliation === 'string' ? author.affiliation : ''
}

/**
 * @param {object} doc parseSource 的结果
 * @param {object} format resolveFormat 的结果
 * @param {{journalMeta?: object}} options
 */
export function renderJats(doc, format, { journalMeta = {} } = {}) {
  const style = styleById(format.citation)
  const { cites } = collectRefs(doc.blocks)
  const referenceList = buildReferenceList(doc.references, cites, format.citation)
  const ctx = { numbers: referenceList.numbers }

  const journals = {
    'journal-id': journalMeta.id ?? format.journalId ?? 'unassigned',
    'journal-title': journalMeta.title ?? format.journal?.name ?? '',
    issn: journalMeta.issn ?? format.journal?.issn ?? '',
  }

  const affilBlocks = (Array.isArray(doc.meta.affiliations) ? doc.meta.affiliations : [])
    .map((entry) => `<aff id="aff${escapeXml(entry.id ?? 1)}"><label>${escapeXml(entry.id ?? 1)}</label><institution>${escapeXml(entry.name ?? '')}</institution></aff>`)
    .join('\n')

  const contribs = (doc.meta.authors || [])
    .map((author, index) => [
      `<contrib contrib-type="author"${author.corresponding ? ' corresp="yes"' : ''}>`,
      '<name>',
      author.family ? `<surname>${escapeXml(author.family)}</surname>` : '',
      author.given ? `<given-names>${escapeXml(author.given)}</given-names>` : '',
      '</name>',
      author.email ? `<email>${escapeXml(author.email)}</email>` : '',
      affilOf(doc.meta, author)
        ? `<xref ref-type="aff" rid="aff${escapeXml(author.affiliation ?? 1)}">${escapeXml(author.affiliation ?? 1)}</xref>`
        : '',
      '</contrib>',
    ].join('')).join('\n')

  const abstractText = doc.meta.abstract || ''
  const keywords = (doc.meta.keywords || [])
    .map((word) => `<kwd>${escapeXml(word)}</kwd>`)
    .join('')

  const body = buildBody(doc, ctx)
  const back = buildBack(doc, format)

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Publishing DTD v1.2 20190208//EN" "JATS-journalpublishing1-2.dtd">',
    '<article article-type="research-article" xml:lang="en" xmlns:xlink="http://www.w3.org/1999/xlink">',
    '<front>',
    '<journal-meta>',
    `<journal-id journal-id-type="publisher-id">${escapeXml(journals['journal-id'])}</journal-id>`,
    `<journal-title-group><journal-title>${escapeXml(journals['journal-title'])}</journal-title></journal-title-group>`,
    journals.issn ? `<issn>${escapeXml(journals.issn)}</issn>` : '',
    '</journal-meta>',
    '<article-meta>',
    `<title-group><article-title>${escapeXml(doc.meta.title)}</article-title></title-group>`,
    contribs ? `<contrib-group>\n${contribs}\n</contrib-group>` : '',
    affilBlocks,
    doc.meta.meta?.received ? `<history><date date-type="received"><day>${escapeXml(doc.meta.meta.received)}</day></date></history>` : '',
    keywords ? `<kwd-group>${keywords}</kwd-group>` : '',
    abstractText ? `<abstract><title>${escapeXml(format.family.abstractHeading || 'Abstract')}</title><p>${escapeXml(abstractText)}</p></abstract>` : '',
    '</article-meta>',
    '</front>',
    `<body>\n${body}\n</body>`,
    `<back>\n${back.xml ? `<ref-list>\n${back.xml}\n</ref-list>` : ''}\n</back>`,
    '</article>',
    '',
  ].filter((line) => line !== '').join('\n')

  return {
    xml,
    citationStyle: format.citation,
    citationStyleLabel: style.label,
    referenceCount: referenceList.entries.length,
  }
}
