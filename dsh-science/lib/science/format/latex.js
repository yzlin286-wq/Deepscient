/**
 * 文档模型 → LaTeX → PDF。
 *
 * 两个刻意的决定：
 *
 * 1. **不用 BibTeX**。参考文献由 cite.js 算好、按顺序写成 `thebibliography` 条目，
 *    所以不需要 `.bst`、不需要第二次 bibtex 处理，一次 xelatex 就能出正确编号。
 *    代价是没有从正文跳转到条目的超链接，换来的是"任何机器上都不会因为缺 bst 而失败"。
 *
 * 2. **引文按纯文本落进正文**，而不是 `\cite{}`。四个渲染器（LaTeX/DOCX/JATS/HTML）
 *    因此显示完全一致的引文——审稿人看到 PDF 里是 `[3]`，Word 里也是 `[3]`。
 */

import { formatInText, buildReferenceList, styleById } from './cite.js'
import { collectRefs } from './markdown.js'
import { canonicalSection } from './source.js'

const ESCAPES = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  '$': '\\$',
  '#': '\\#',
  '_': '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
}

export function escapeLatex(text) {
  return String(text ?? '').replace(/[\\&%$#_{}~^]/g, (ch) => ESCAPES[ch])
}

function classKind(className) {
  if (/^elsarticle/.test(className)) return 'elsarticle'
  if (/^IEEEtran/.test(className)) return 'ieee'
  if (/^revtex/.test(className)) return 'revtex'
  if (/^achemso/.test(className)) return 'achemso'
  if (/^nature/.test(className)) return 'nature'
  return 'plain'
}

function renderInline(nodes, ctx) {
  return (nodes || [])
    .map((node) => {
      switch (node.t) {
        case 'text': return escapeLatex(node.v)
        case 'em': return `\\emph{${renderInline(node.c, ctx)}}`
        case 'strong': return `\\textbf{${renderInline(node.c, ctx)}}`
        case 'code': return `\\texttt{${escapeLatex(node.v)}}`
        case 'math': return `$${node.v}$`
        case 'cite': {
          const result = formatInText(node, ctx.style, ctx.citeContext)
          if (!result.text) return ''
          if (result.mode === 'superscript') return `\\textsuperscript{${escapeLatex(result.text)}}`
          return escapeLatex(result.text)
        }
        case 'ref': return `\\ref{${node.target}}`
        case 'link': return `\\href{${escapeLatex(node.v)}}{${renderInline(node.c, ctx)}}`
        case 'break': return '\\\\\n'
        default: return ''
      }
    })
    .join('')
}

function affiliationOf(meta, author) {
  const list = Array.isArray(meta.affiliations) ? meta.affiliations : []
  const id = author.affiliation ?? 1
  const found = list.find((entry) => String(entry.id) === String(id))
  if (found) return found.name ?? found.label ?? ''
  if (typeof author.affiliation === 'string') return author.affiliation
  return ''
}

function buildFrontMatter(doc, format, kind) {
  const meta = doc.meta
  const title = escapeLatex(meta.title)
  const authors = meta.authors || []
  const out = []

  const affiliationsListed = []
  const affIndex = (author) => {
    const name = affiliationOf(meta, author)
    if (!name) return null
    const existing = affiliationsListed.findIndex((entry) => entry.name === name)
    if (existing >= 0) return existing
    affiliationsListed.push({ name })
    return affiliationsListed.length - 1
  }

  if (kind === 'elsarticle') {
    const authorLines = []
    authors.forEach((author) => {
      const idx = affIndex(author)
      const tag = idx === null ? '' : `[a${idx}]`
      const corref = author.corresponding ? '\\corref{cor1}' : ''
      authorLines.push(`\\author${tag}{${escapeLatex(author.name ?? author.family ?? '')}${corref}}`)
      if (author.email) authorLines.push(`\\ead{${escapeLatex(author.email)}}`)
    })
    out.push('\\begin{frontmatter}', `\\title{${title}}`, ...authorLines)
    affiliationsListed.forEach((entry, index) => {
      out.push(`\\affiliation[a${index}]{organization={${escapeLatex(entry.name)}}}`)
    })
    out.push(`\\cortext[cor1]{Corresponding author}`)
    out.push('\\begin{abstract}')
    out.push(escapeLatex(meta.abstract || ''))
    out.push('\\end{abstract}')
    if (meta.keywords && meta.keywords.length > 0) {
      out.push(`\\begin{keyword}${meta.keywords.map(escapeLatex).join(' \\sep ')}\\end{keyword}`)
    }
    out.push('\\end{frontmatter}')
    return out.join('\n')
  }

  if (kind === 'ieee') {
    const blocks = authors.map((author) => {
      const affil = affiliationOf(meta, author)
      const email = author.email ? `\\textit{${escapeLatex(author.email)}}` : ''
      return [
        `\\IEEEauthorblockN{${escapeLatex(author.name ?? author.family ?? '')}}`,
        `\\IEEEauthorblockA{${escapeLatex(affil)}${email ? `\\\\ ${email}` : ''}}`,
      ].join('\n')
    })
    return [
      `\\title{${title}}`,
      `\\author{${blocks.join('\\and\n')}}`,
      '\\maketitle',
      '\\begin{abstract}',
      escapeLatex(meta.abstract || ''),
      '\\end{abstract}',
      meta.keywords && meta.keywords.length > 0
        ? `\\begin{IEEEkeywords}\n${meta.keywords.map(escapeLatex).join(', ')}\n\\end{IEEEkeywords}`
        : '',
    ].filter(Boolean).join('\n')
  }

  if (kind === 'revtex' || kind === 'achemso') {
    const lines = [`\\title{${title}}`]
    authors.forEach((author) => {
      lines.push(`\\author{${escapeLatex(author.name ?? author.family ?? '')}}`)
      const affil = affiliationOf(meta, author)
      if (affil) lines.push(`\\affiliation{${escapeLatex(affil)}}`)
    })
    lines.push('\\begin{abstract}', escapeLatex(meta.abstract || ''), '\\end{abstract}')
    lines.push('\\maketitle')
    if (meta.keywords && meta.keywords.length > 0) {
      lines.push(`\\noindent\\textbf{Keywords:} ${meta.keywords.map(escapeLatex).join(', ')}`)
    }
    return lines.join('\n')
  }

  if (kind === 'nature') {
    // nature.cls 只有 \author{}，没有 \affiliation{}；单位写进 author 块
    const block = authors
      .map((author) => {
        const affil = affiliationOf(meta, author)
        const name = escapeLatex(author.name ?? author.family ?? '')
        return affil ? `${name}\\\\ \\small ${escapeLatex(affil)}` : name
      })
      .join('\\\\[0.6em]\n')
    return [
      `\\title{${title}}`,
      `\\author{${block}}`,
      '\\maketitle',
      '\\begin{abstract}',
      escapeLatex(meta.abstract || ''),
      '\\end{abstract}',
      meta.keywords && meta.keywords.length > 0
        ? `\\vspace{0.6em}\\noindent\\textbf{Keywords:} ${meta.keywords.map(escapeLatex).join(', ')}`
        : '',
    ].filter(Boolean).join('\n')
  }

  // plain / article 兜底
  const grouped = new Map()
  authors.forEach((author) => {
    const affil = affiliationOf(meta, author)
    const key = affil || ''
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(escapeLatex(author.name ?? author.family ?? ''))
  })
  const authorBlock = [...grouped.entries()]
    .map(([affil, names]) => (affil ? `${names.join(', ')}\\\\ \\small ${escapeLatex(affil)}` : names.join(', ')))
    .join('\\\\[0.6em]\n')

  return [
    `\\title{${title}}`,
    `\\author{${authorBlock}}`,
    '\\date{}',
    '\\maketitle',
    '\\begin{abstract}',
    escapeLatex(meta.abstract || ''),
    '\\end{abstract}',
    meta.keywords && meta.keywords.length > 0
      ? `\\vspace{0.6em}\\noindent\\textbf{Keywords:} ${meta.keywords.map(escapeLatex).join(', ')}`
      : '',
  ].filter(Boolean).join('\n')
}

function buildPreamble(doc, format, className) {
  const kind = classKind(className)
  const options = format.latex.classOptions || []
  const opt = options.length > 0 ? `[${options.join(',')}]` : ''

  const packages = [
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{graphicx}',
    '\\usepackage{booktabs}',
    '\\usepackage{longtable}',
    '\\usepackage{array}',
    '\\usepackage{xcolor}',
    '\\usepackage[unicode]{hyperref}',
    '\\usepackage{url}',
  ]

  const lines = [`\\documentclass${opt}{${className}}`]

  // 双倍行距：不依赖 setspace（MiKTeX 精简安装里可能缺）
  const spacing = format.docx.lineSpacing ?? 1
  if (spacing >= 2 && kind === 'plain') {
    lines.push('\\renewcommand{\\baselinestretch}{2}')
  }

  lines.push(...packages)

  // 中文支持：正文含 CJK 时必须用 xeCJK，否则 xelatex 会静默丢字
  const hasCjk = JSON.stringify(doc.meta).match(/[\u3400-\u9fff]/) !== null ||
    doc.blocks.some((b) => JSON.stringify(b).match(/[\u3400-\u9fff]/) !== null)
  if (hasCjk) {
    lines.push('\\usepackage{xeCJK}')
    lines.push('\\setCJKmainfont{SimSun}[BoldFont=SimHei,ItalicFont=KaiTi]')
  }

  if (kind === 'plain' && format.docx.lineNumbers) {
    lines.push('\\usepackage{lineno}')
    lines.push('\\linenumbers')
  }

  if (hasCjk && kind === 'plain') {
    lines.push('\\renewcommand{\\baselinestretch}{2}')
  }

  lines.push('\\hypersetup{colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue}')

  return lines.join('\n')
}

function figureWidth(block) {
  const raw = block.width ?? 0.85
  const value = Number(raw)
  if (!Number.isFinite(value)) return '0.85'
  return String(Math.min(Math.max(value, 0.1), 1)).replace(/^0/, '')
}

function buildBlocks(doc, ctx) {
  const out = []
  let abstractSeen = false

  for (const block of doc.blocks) {
    switch (block.type) {
      case 'heading': {
        const section = canonicalSection(block.text)
        if (section === 'abstract') { abstractSeen = true; continue }
        if (section === 'references') continue
        const level = Math.min(Math.max(block.level - 1, 0), 3)
        const command = ['section', 'subsection', 'subsubsection', 'paragraph'][level]
        const star = section === 'acknowledgements' ? '*' : ''
        const label = block.label ? `\\label{${block.label}}` : ''
        out.push(`\\${command}${star}{${escapeLatex(block.text)}}${label}`)
        break
      }
      case 'para':
        out.push(renderInline(block.inline, ctx))
        break
      case 'quote':
        out.push(`\\begin{quote}\n${renderInline(block.inline, ctx)}\n\\end{quote}`)
        break
      case 'list': {
        const env = block.ordered ? 'enumerate' : 'itemize'
        const items = block.items.map((item) => `\\item ${renderInline(item.inline, ctx)}`)
        out.push(`\\begin{${env}}\n${items.join('\n')}\n\\end{${env}}`)
        break
      }
      case 'code':
        out.push(`\\begin{verbatim}\n${block.text}\n\\end{verbatim}`)
        break
      case 'math': {
        const label = block.label ? `\\label{${block.label}}` : ''
        out.push(`\\begin{equation}${label}\n${block.tex}\n\\end{equation}`)
        break
      }
      case 'figure': {
        const caption = renderInline(block.captionInline ?? [{ t: 'text', v: block.caption }], ctx)
        const label = block.label ? `\\label{${block.label}}` : ''
        out.push([
          '\\begin{figure}[htbp]',
          '\\centering',
          `\\includegraphics[width=${figureWidth(block)}\\linewidth]{${block.src}}`,
          `\\caption{${caption}}${label}`,
          '\\end{figure}',
        ].join('\n'))
        break
      }
      case 'table': {
        const columns = 'l'.repeat(Math.max(block.header.length, 1))
        const header = block.header.map((cell) => renderInline(cell, ctx)).join(' & ')
        const rows = block.rows.map((row) => row.map((cell) => renderInline(cell, ctx)).join(' & '))
        const caption = block.caption
          ? renderInline(block.captionInline ?? [{ t: 'text', v: block.caption }], ctx)
          : ''
        const label = block.label ? `\\label{${block.label}}` : ''
        out.push([
          '\\begin{table}[htbp]',
          '\\centering',
          caption ? `\\caption{${caption}}${label}` : label,
          `\\begin{tabular}{${columns}}`,
          '\\hline',
          `${header} \\\\`,
          '\\hline',
          ...rows.map((row) => `${row} \\\\`),
          '\\hline',
          '\\end{tabular}',
          '\\end{table}',
        ].filter(Boolean).join('\n'))
        break
      }
      case 'raw':
        if (block.format === 'latex' || block.format === 'tex') out.push(block.text)
        break
      case 'hr':
        out.push('\\vspace{0.5em}\\hrule\\vspace{0.5em}')
        break
      default:
        break
    }
  }

  return { body: out.join('\n\n'), abstractSeen }
}

function buildBibliography(referenceList, style) {
  if (referenceList.entries.length === 0) return ''
  const lines = ['\\section*{References}']

  if (style.kind === 'numeric') {
    lines.push('\\begin{enumerate}')
    for (const entry of referenceList.entries) {
      lines.push(`\\item \\label{ref:${entry.key}} ${escapeLatex(entry.text)}`)
    }
    lines.push('\\end{enumerate}')
  } else {
    lines.push('\\begin{list}{}{\\setlength{\\leftmargin}{2em}\\setlength{\\itemindent}{-2em}\\setlength{\\itemsep}{0.35em}}')
    for (const entry of referenceList.entries) {
      lines.push(`\\item \\label{ref:${entry.key}} ${escapeLatex(entry.text)}`)
    }
    lines.push('\\end{list}')
  }

  return lines.join('\n')
}

/**
 * @param {object} doc parseSource 的结果
 * @param {object} format resolveFormat 的结果
 * @param {{className?: string}} options className 可覆盖（用于类缺失时回退）
 */
export function renderLatex(doc, format, { className } = {}) {
  const effectiveClass = className || format.family.latex.class || 'article'
  const kind = classKind(effectiveClass)
  const style = styleById(format.citation)
  const { cites } = collectRefs(doc.blocks)
  const referenceList = buildReferenceList(doc.references, cites, format.citation)
  const refsByKey = new Map(doc.references.map((ref) => [ref.key, ref]))

  const ctx = {
    style,
    citeContext: { numbers: referenceList.numbers, refsByKey },
    citeStyleId: format.citation,
  }

  const preamble = buildPreamble(doc, format, effectiveClass)
  const frontMatter = buildFrontMatter(doc, format, kind)
  const { body } = buildBlocks(doc, ctx)
  const bibliography = buildBibliography(referenceList, style)

  const tex = [
    preamble,
    '\\begin{document}',
    frontMatter,
    body,
    bibliography,
    '\\end{document}',
    '',
  ].join('\n\n')

  return {
    tex,
    className: effectiveClass,
    classKind: kind,
    citationStyle: format.citation,
    referenceCount: referenceList.entries.length,
    uncitedReferences: referenceList.entries.filter((entry) => !entry.cited).map((entry) => entry.key),
    fallbackUsed: effectiveClass !== format.family.latex.class,
  }
}
