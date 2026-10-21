/**
 * 文档模型 → 自包含 HTML（期刊版式的可视化预览）。
 *
 * 这是「格式编辑器」的看的那一半：改源文件 → 立刻看到按目标期刊版式排出来的样子。
 * 刻意不引 MathJax / KaTeX：预览要能在任何环境离线打开，公式用 Unicode 近似
 * 加等宽衬线排版，够看清结构；真排版结果以 PDF 为准。
 *
 * 页面尺寸、字号、行距、行号都从 data/journal-formats.json 的 docx 段取，
 * 所以预览和最终 Word 稿的观感一致，不会出现「预览好看到 Word 里跑版」。
 */

import { formatInText, buildReferenceList, styleById } from './cite.js'
import { collectRefs } from './markdown.js'
import { canonicalSection } from './source.js'
import { texToUnicode } from './docx.js'

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const esc = (text) => String(text ?? '').replace(/[&<>"]/g, (ch) => ESCAPES[ch])

const PAGE_MM = { A4: [210, 297], Letter: [215.9, 279.4] }

function renderInline(nodes, ctx) {
  return (nodes || [])
    .map((node) => {
      switch (node.t) {
        case 'text': return esc(node.v)
        case 'em': return `<em>${renderInline(node.c, ctx)}</em>`
        case 'strong': return `<strong>${renderInline(node.c, ctx)}</strong>`
        case 'code': return `<code>${esc(node.v)}</code>`
        case 'math': return `<span class="math">${esc(texToUnicode(node.v).text)}</span>`
        case 'cite': {
          const result = formatInText(node, ctx.style, ctx.citeContext)
          if (result.mode === 'superscript') return `<sup class="cite">${esc(result.text)}</sup>`
          return `<span class="cite">${esc(result.text)}</span>`
        }
        case 'ref': return `<span class="xref">${esc(node.target)}</span>`
        case 'link': return `<a href="${esc(node.v)}">${renderInline(node.c, ctx)}</a>`
        case 'break': return '<br>'
        default: return ''
      }
    })
    .join('')
}

function buildCss(format) {
  const spec = format.family.docx
  const [widthMm, heightMm] = PAGE_MM[spec.pageSize] ?? PAGE_MM.A4
  const m = spec.marginsMm ?? {}
  const spacing = spec.lineSpacing ?? 1
  const lineHeight = spacing >= 2 ? 2 : 1.45

  return `
:root {
  --page-w: ${widthMm}mm;
  --page-h: ${heightMm}mm;
  --pad-top: ${m.top ?? 25}mm;
  --pad-right: ${m.right ?? 25}mm;
  --pad-bottom: ${m.bottom ?? 25}mm;
  --pad-left: ${m.left ?? 25}mm;
  --body-pt: ${spec.bodyPt ?? 12}pt;
  --title-pt: ${spec.titlePt ?? 16}pt;
  --heading-pt: ${spec.headingPt ?? 13}pt;
  --latin: "${spec.bodyFont ?? 'Times New Roman'}", "Georgia", serif;
  --cjk: "${spec.cjkFont ?? '宋体'}", "Songti SC", serif;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 24px 0;
  background: #e9ecef;
  font-family: var(--latin), var(--cjk);
}
.page {
  width: var(--page-w); min-height: var(--page-h);
  margin: 0 auto 24px; padding: var(--pad-top) var(--pad-right) var(--pad-bottom) var(--pad-left);
  background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.18);
  font-size: var(--body-pt); line-height: ${lineHeight};
  color: #111;
  ${spec.lineNumbers ? 'counter-reset: line;' : ''}
}
${spec.lineNumbers ? `.page p { counter-increment: line; position: relative; }
.page p::before {
  content: counter(line);
  position: absolute; left: calc(-1 * var(--pad-left) + 4mm);
  color: #9aa0a6; font-size: 8pt; font-family: ui-monospace, monospace;
}` : ''}
h1.title { font-size: var(--title-pt); text-align: center; margin: 0 0 1em; line-height: 1.3; }
.authors { text-align: center; margin-bottom: 1.4em; }
.authors .name { display: block; }
.authors .affil, .authors .email { display: block; font-size: .88em; font-style: italic; color: #333; }
h2 { font-size: var(--heading-pt); margin: 1.3em 0 .5em; }
h3 { font-size: calc(var(--body-pt) + 1pt); margin: 1.1em 0 .4em; }
h4 { font-size: var(--body-pt); margin: 1em 0 .35em; }
p { margin: 0 0 .55em; text-align: justify; }
.abstract-label, .kw-label { font-weight: bold; }
.abstract p { margin-bottom: .8em; }
figure { margin: 1.2em 0; text-align: center; }
figure img { max-width: 100%; }
figcaption { font-size: .92em; text-align: left; margin-top: .4em; }
table { width: 100%; border-collapse: collapse; margin: .8em 0; font-size: .95em; }
thead th { border-top: 1.2pt solid #000; border-bottom: .7pt solid #000; text-align: left; padding: 4px 6px; }
tbody td { padding: 3px 6px; }
tbody tr:last-child td { border-bottom: 1.2pt solid #000; }
caption { caption-side: bottom; text-align: left; font-size: .92em; padding-top: .4em; }
.equation { text-align: center; margin: .9em 0; font-family: var(--latin); }
.math { font-style: italic; font-family: var(--latin), var(--cjk); }
.cite, .xref { font-variant-numeric: tabular-nums; }
sup.cite { font-size: .75em; }
ol, ul { margin: .4em 0 .8em 1.4em; padding: 0; }
li { margin-bottom: .25em; }
.refs { list-style: none; margin: 0; padding: 0; }
.refs li { padding-left: 2em; text-indent: -2em; margin-bottom: .4em; font-size: .95em; }
.banner { max-width: var(--page-w); margin: 0 auto 12px; font: 12px/1.6 ui-sans-serif, system-ui; color: #495057; }
.banner b { color: #212529; }
code { font-family: ui-monospace, Consolas, monospace; font-size: .92em; background: #f4f5f7; padding: 0 .2em; }
@media print { body { background: #fff; padding: 0; } .page { box-shadow: none; margin: 0; } .banner { display: none; } }
`
}

function buildBlocks(doc, ctx) {
  const out = []
  let figNo = 0
  let tabNo = 0
  let eqNo = 0

  for (const block of doc.blocks) {
    switch (block.type) {
      case 'heading': {
        const section = canonicalSection(block.text)
        if (section === 'abstract' || section === 'references') break
        const level = Math.min(Math.max(block.level, 2), 4)
        out.push(`<h${level}${block.label ? ` id="${esc(block.label)}"` : ''}>${esc(block.text)}</h${level}>`)
        break
      }
      case 'para': out.push(`<p>${renderInline(block.inline, ctx)}</p>`); break
      case 'quote': out.push(`<blockquote><p>${renderInline(block.inline, ctx)}</p></blockquote>`); break
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul'
        const items = block.items
          .map((item) => `<li${item.depth ? ` style="margin-left:${item.depth * 1.2}em"` : ''}>${renderInline(item.inline, ctx)}</li>`)
          .join('')
        out.push(`<${tag}>${items}</${tag}>`)
        break
      }
      case 'figure': {
        figNo += 1
        out.push([
          `<figure${block.label ? ` id="${esc(block.label)}"` : ''}>`,
          `<img src="${esc(block.src)}" alt="${esc(block.caption)}">`,
          `<figcaption><b>Figure ${figNo}.</b> ${renderInline(block.captionInline ?? [{ t: 'text', v: block.caption }], ctx)}</figcaption>`,
          '</figure>',
        ].join(''))
        break
      }
      case 'table': {
        tabNo += 1
        const head = block.header.map((cell) => `<th>${renderInline(cell, ctx)}</th>`).join('')
        const body = block.rows
          .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell, ctx)}</td>`).join('')}</tr>`)
          .join('')
        out.push([
          `<table${block.label ? ` id="${esc(block.label)}"` : ''}>`,
          block.caption ? `<caption><b>Table ${tabNo}.</b> ${renderInline(block.captionInline ?? [{ t: 'text', v: block.caption }], ctx)}</caption>` : '',
          `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`,
          '</table>',
        ].join(''))
        break
      }
      case 'math': {
        eqNo += 1
        out.push(`<div class="equation">${esc(texToUnicode(block.tex).text)} &nbsp;&nbsp;(${eqNo})</div>`)
        break
      }
      case 'code': out.push(`<pre><code>${esc(block.text)}</code></pre>`); break
      case 'hr': out.push('<hr>'); break
      default: break
    }
  }

  return out.join('\n')
}

/**
 * @param {object} doc parseSource 的结果
 * @param {object} format resolveFormat 的结果
 * @param {{title?: string}} options
 */
export function renderHtml(doc, format, { title } = {}) {
  const style = styleById(format.citation)
  const { cites } = collectRefs(doc.blocks)
  const referenceList = buildReferenceList(doc.references, cites, format.citation)
  const refsByKey = new Map(doc.references.map((ref) => [ref.key, ref]))
  const ctx = { style, citeContext: { numbers: referenceList.numbers, refsByKey } }

  const authors = (doc.meta.authors || [])
    .map((author) => {
      const list = Array.isArray(doc.meta.affiliations) ? doc.meta.affiliations : []
      const found = list.find((entry) => String(entry.id) === String(author.affiliation ?? 1))
      const affil = found ? found.name : (typeof author.affiliation === 'string' ? author.affiliation : '')
      return [
        `<span class="name">${esc(author.name || [author.given, author.family].filter(Boolean).join(' '))}</span>`,
        affil ? `<span class="affil">${esc(affil)}</span>` : '',
        author.email ? `<span class="email">${esc(author.email)}</span>` : '',
      ].join('')
    })
    .join('')

  const abstractLabel = format.family.abstractHeading || 'Abstract'
  const abstractHtml = (doc.meta.abstract || '').trim()
    ? `<h2>${esc(abstractLabel)}</h2><div class="abstract"><p>${esc(doc.meta.abstract)}</p></div>`
    : ''

  const keywordsHtml = (doc.meta.keywords || []).length > 0
    ? `<p><span class="kw-label">Keywords:</span> ${esc(doc.meta.keywords.join(', '))}</p>`
    : ''

  const refsHtml = referenceList.entries.length > 0
    ? `<h2>References</h2><ol class="refs">${referenceList.entries
      .map((entry) => `<li>${esc(entry.text)}</li>`)
      .join('')}</ol>`
    : ''

  const banner = [
    '<div class="banner">',
    `<b>${esc(format.journal?.name || format.journalId || '通用族')}</b>`,
    ` · 族 <b>${esc(format.familyId)}</b>`,
    ` · LaTeX <b>${esc(format.latex.class)}</b>`,
    ` · 引文 <b>${esc(format.citation)}</b>`,
    ` · ${esc(format.family.docx.pageSize)} / ${esc(String(format.family.docx.bodyPt))}pt / 行距 ${esc(String(format.family.docx.lineSpacing))}`,
    format.family.docx.lineNumbers ? ' · 连续行号' : '',
    ` · 参考文献 ${referenceList.entries.length}`,
    '</div>',
  ].join('')

  const html = [
    '<!DOCTYPE html>',
    `<html lang="en"><head><meta charset="utf-8"><title>${esc(title || doc.meta.title)}</title>`,
    `<style>${buildCss(format)}</style>`,
    '</head><body>',
    banner,
    '<div class="page">',
    `<h1 class="title">${esc(doc.meta.title)}</h1>`,
    authors ? `<div class="authors">${authors}</div>` : '',
    abstractHtml,
    keywordsHtml,
    buildBlocks(doc, ctx),
    refsHtml,
    '</div>',
    '</body></html>',
    '',
  ].filter(Boolean).join('\n')

  return {
    html,
    bytes: Buffer.byteLength(html, 'utf8'),
    citationStyle: format.citation,
    referenceCount: referenceList.entries.length,
  }
}
