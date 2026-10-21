/**
 * 稿件正文的 Markdown 子集解析器。
 *
 * 这不是通用 Markdown：它只认写论文需要的块与行内元素，并把它们变成
 * 一个与渲染目标无关的 AST。LaTeX / DOCX / JATS / HTML 四个渲染器都吃同一棵树，
 * 所以「一种源文件、多种期刊格式」不会出现四处漂移。
 *
 * 引用语法沿用 Pandoc：`[@key]`、`[@a; @b]`、`[-@key]`（只出年份）、`@key`（叙述式）。
 * 交叉引用用 `{#fig:xxx}` 打标签，`[@fig:xxx]` 之外用 `\ref{fig:xxx}` 或 `{#ref}` 均可。
 */

const HEADING = /^(#{1,6})\s+(.*)$/
const FENCE = /^```\s*([\w+-]*)\s*$/
const FIGURE = /^!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)\s*(?:\{#([\w:.-]+)\})?\s*$/
const TABLE_ROW = /^\s*\|(.+)\|\s*$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const MATH_FENCE = /^\$\$\s*$/
const RAW_FENCE = /^:::\s*(\w+)\s*$/
const HR = /^\s*(?:---|\*\*\*|___)\s*$/
const LABEL_SUFFIX = /\s*\{#([\w:.-]+)\}\s*$/

export const SECTION_LABELS = {
  abstract: '摘要',
  introduction: '引言',
  related: '相关工作',
  methods: '方法',
  results: '结果',
  discussion: '讨论',
  conclusion: '结论',
  acknowledgements: '致谢',
  references: '参考文献',
}

/** 段落级解析：文本 → 块数组。 */
export function parseMarkdown(text) {
  /* HTML 注释不是正文。建稿时的提示（`<!-- TODO: ... -->`）里写着 `[@key]`、`\ref{fig:name}`
     这类示例，若照原文解析，每一篇新稿都会凭空多出"引用不存在"与"交叉引用悬空"两条 block——
     一条永远修不掉的错误，等于把 lint 变成噪声。注释在解析前整段删除（含跨行注释）。 */
  const stripped = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
  const lines = stripped.split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') { i += 1; continue }

    const heading = line.match(HEADING)
    if (heading) {
      let title = heading[2].trim()
      let label = null
      const suffix = title.match(LABEL_SUFFIX)
      if (suffix) {
        label = suffix[1]
        title = title.slice(0, suffix.index).trim()
      }
      blocks.push({ type: 'heading', level: heading[1].length, text: title, label })
      i += 1
      continue
    }

    const fence = line.match(FENCE)
    if (fence) {
      const body = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { body.push(lines[i]); i += 1 }
      i += 1
      blocks.push({ type: 'code', lang: fence[1] || '', text: body.join('\n') })
      continue
    }

    if (MATH_FENCE.test(line)) {
      const body = []
      i += 1
      while (i < lines.length && !MATH_FENCE.test(lines[i])) { body.push(lines[i]); i += 1 }
      i += 1
      const tex = body.join('\n').trim()
      // `\label{...}` 前面可能已经有一个 `\\`（行尾换行），一并吃掉，别留一个孤零零的反斜杠
      const tagged = tex.match(/(?:\\\\\s*)?\\label\{([\w:.-]+)\}\s*$/)
      blocks.push({
        type: 'math',
        tex: tagged ? tex.slice(0, tagged.index).trim() : tex,
        label: tagged ? tagged[1] : null,
      })
      continue
    }

    const raw = line.match(RAW_FENCE)
    if (raw) {
      const body = []
      i += 1
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) { body.push(lines[i]); i += 1 }
      i += 1
      blocks.push({ type: 'raw', format: raw[1].toLowerCase(), text: body.join('\n') })
      continue
    }

    if (HR.test(line)) { blocks.push({ type: 'hr' }); i += 1; continue }

    const figure = line.match(FIGURE)
    if (figure) {
      blocks.push({
        type: 'figure',
        src: figure[2],
        caption: figure[1],
        captionInline: parseInline(figure[1]),
        title: figure[3] || null,
        label: figure[4] || null,
        width: null,
      })
      i += 1
      continue
    }

    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const header = splitRow(lines[i])
      i += 2
      const rows = []
      while (i < lines.length && TABLE_ROW.test(lines[i])) { rows.push(splitRow(lines[i])); i += 1 }
      let caption = null
      let label = null
      if (i < lines.length && /^:\s+/.test(lines[i])) {
        caption = lines[i].replace(/^:\s+/, '').trim()
        const suffix = caption.match(LABEL_SUFFIX)
        if (suffix) { label = suffix[1]; caption = caption.slice(0, suffix.index).trim() }
        i += 1
      }
      blocks.push({ type: 'table', header, rows, caption, captionInline: caption ? parseInline(caption) : null, label })
      continue
    }

    if (LIST_ITEM.test(line)) {
      const result = parseList(lines, i)
      blocks.push(result.block)
      i = result.next
      continue
    }

    if (QUOTE.test(line)) {
      const body = []
      while (i < lines.length && QUOTE.test(lines[i])) { body.push(lines[i].match(QUOTE)[1]); i += 1 }
      blocks.push({ type: 'quote', inline: parseInline(body.join(' ').trim()) })
      continue
    }

    // 段落：收集到空行或下一个块起始
    const body = []
    while (i < lines.length) {
      const current = lines[i]
      if (current.trim() === '') break
      if (HEADING.test(current) || FENCE.test(current) || MATH_FENCE.test(current)) break
      if (LIST_ITEM.test(current) || QUOTE.test(current) || HR.test(current)) break
      if (FIGURE.test(current) || RAW_FENCE.test(current)) break
      body.push(current)
      i += 1
    }
    if (body.length > 0) {
      blocks.push({ type: 'para', inline: parseInline(joinLines(body)) })
    }
  }

  return blocks
}

function joinLines(body) {
  let out = ''
  body.forEach((line, index) => {
    if (index > 0) out += /\s{2,}$/.test(body[index - 1]) ? '\u0000' : ' '
    out += line.trim()
  })
  return out.replace(/\u0000/g, '\u0001')
}

function splitRow(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split('|').map((cell) => parseInline(cell.trim()))
}

function parseList(lines, start) {
  const items = []
  let i = start
  let cursor = 0

  for (;;) {
    if (i >= lines.length) break
    const match = lines[i].match(LIST_ITEM)
    if (!match) {
      if (lines[i].trim() === '') {
        // 空行后仍是列表项则继续
        const probe = i + 1 < lines.length ? lines[i + 1].match(LIST_ITEM) : null
        if (probe && probe[1].length >= cursor) { i += 1; continue }
      }
      break
    }
    if (items.length === 0) {
      items.push({
        depth: 0,
        ordered: /\d/.test(match[2]),
        inline: parseInline(match[3].trim()),
      })
    } else {
      const depth = match[1].length >= 2 ? 1 : 0
      items.push({ depth, ordered: /\d/.test(match[2]), inline: parseInline(match[3].trim()) })
    }
    cursor = match[1].length
    i += 1
  }

  return {
    block: { type: 'list', items, ordered: items.length > 0 ? items[0].ordered : false },
    next: i,
  }
}

// 引用键允许中日韩字符：中文作者习惯写 `[@张伟2023动量]`，硬按 ASCII 卡会把整条引用丢掉，
// 而且丢得很安静——lint 只会说「正文没引用」，查不出真正原因。
const CJK_CHAR = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\u3040-\\u30ff\\uac00-\\ud7af'
const CITATION_KEY = new RegExp(`^[A-Za-z0-9${CJK_CHAR}][\\w:.\\-${CJK_CHAR}]*$`)
const BARE_KEY = new RegExp(`^[A-Za-z0-9${CJK_CHAR}](?:[\\w:\\-${CJK_CHAR}]|\\.(?=[\\w:\\-${CJK_CHAR}]))*`)

/**
 * 行内解析。手写扫描器而不是正则链，因为 `$` 与 `*` 在数学和强调之间会互相吃。
 */
export function parseInline(text) {
  const src = String(text ?? '')
  const nodes = []
  let buffer = ''
  let i = 0

  const flush = () => {
    if (buffer) { nodes.push({ t: 'text', v: buffer }); buffer = '' }
  }

  while (i < src.length) {
    const ch = src[i]

    if (ch === '\u0001') { flush(); nodes.push({ t: 'break' }); i += 1; continue }

    if (ch === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i) {
        flush()
        nodes.push({ t: 'code', v: src.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    if (ch === '$') {
      const end = src.indexOf('$', i + 1)
      if (end > i) {
        flush()
        nodes.push({ t: 'math', v: src.slice(i + 1, end).trim() })
        i = end + 1
        continue
      }
    }

    if (ch === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2)
      if (end > i) {
        flush()
        nodes.push({ t: 'strong', c: parseInline(src.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }

    if (ch === '*' || (ch === '_' && /[\s(]/.test(src[i - 1] ?? ' '))) {
      const end = src.indexOf(ch, i + 1)
      if (end > i + 1) {
        flush()
        nodes.push({ t: 'em', c: parseInline(src.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }

    if (ch === '[') {
      const bracket = matchBracket(src, i)
      if (bracket > i) {
        const inner = src.slice(i + 1, bracket)
        const after = src.slice(bracket + 1, bracket + 2)
        if (after === '(') {
          const close = src.indexOf(')', bracket + 2)
          if (close > 0) {
            flush()
            nodes.push({ t: 'link', v: src.slice(bracket + 2, close).trim(), c: parseInline(inner) })
            i = close + 1
            continue
          }
        }
        if (inner.startsWith('@') || inner.startsWith('-@')) {
          const keys = parseCitationKeys(inner)
          if (keys.length > 0) {
            flush()
            nodes.push({ t: 'cite', keys, mode: inner.trim().startsWith('-@') ? 'year' : 'paren' })
            i = bracket + 1
            continue
          }
        }
      }
    }

    if (ch === '\\') {
      const cmd = src.slice(i).match(/^\\(cite|citep|citet|ref|eqref)\{([^}]*)\}/)
      if (cmd) {
        flush()
        if (cmd[1] === 'ref' || cmd[1] === 'eqref') {
          nodes.push({ t: 'ref', target: cmd[2].trim() })
        } else {
          nodes.push({
            t: 'cite',
            keys: cmd[2].split(',').map((k) => k.trim()).filter(Boolean).map((k) => ({ key: k, suppressAuthor: false })),
            mode: cmd[1] === 'citet' ? 'text' : 'paren',
          })
        }
        i += cmd[0].length
        continue
      }
    }

    if (ch === '@' && (i === 0 || /[\s(\[{]/.test(src[i - 1]))) {
      // `@key` 叙述式引用；点号只允许出现在 key 内部，不允许吃掉句末句点
      const match = src.slice(i + 1).match(BARE_KEY)
      if (match && CITATION_KEY.test(match[0])) {
        flush()
        nodes.push({ t: 'cite', keys: [{ key: match[0], suppressAuthor: false }], mode: 'text' })
        i += match[0].length + 1
        continue
      }
    }

    buffer += ch
    i += 1
  }

  flush()
  return mergeText(nodes)
}

function matchBracket(src, start) {
  let depth = 0
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === '[') depth += 1
    else if (src[i] === ']') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function parseCitationKeys(inner) {
  return inner
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const suppressAuthor = part.startsWith('-@')
      const key = part.replace(/^-?@/, '').replace(/\s+.*$/, '').trim()
      return { key, suppressAuthor }
    })
    .filter((entry) => entry.key && CITATION_KEY.test(entry.key))
}

function mergeText(nodes) {
  const out = []
  for (const node of nodes) {
    if (node.t === 'text' && out.length > 0 && out[out.length - 1].t === 'text') {
      out[out.length - 1].v += node.v
    } else {
      out.push(node)
    }
  }
  return out
}

/** 行内节点 → 纯文本（用于字数统计与 lint）。 */
export function inlineText(nodes) {
  return (nodes || [])
    .map((node) => {
      switch (node.t) {
        case 'text': return node.v
        case 'code': return node.v
        case 'math': return `$${node.v}$`
        case 'cite': return `[${node.keys.map((k) => k.key).join('; ')}]`
        case 'ref': return `@${node.target}`
        case 'link': return inlineText(node.c)
        case 'em':
        case 'strong': return inlineText(node.c)
        case 'break': return '\n'
        default: return ''
      }
    })
    .join('')
}

/** 从块数组里收集所有引用键与交叉引用目标。 */
export function collectRefs(blocks) {
  const cites = []
  const labels = []

  const walkInline = (nodes) => {
    for (const node of nodes || []) {
      if (node.t === 'cite') for (const key of node.keys) cites.push(key.key)
      else if (node.t === 'ref') labels.push(node.target)
      else if (node.c) walkInline(node.c)
    }
  }

  for (const block of blocks) {
    if (block.label) labels.push(block.label)
    if (block.inline) walkInline(block.inline)
    if (block.items) for (const item of block.items) walkInline(item.inline)
    if (block.type === 'table') {
      for (const cell of block.header) walkInline(cell)
      for (const row of block.rows) for (const cell of row) walkInline(cell)
    }
  }

  return { cites, labels }
}
