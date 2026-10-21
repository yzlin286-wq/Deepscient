/**
 * 稿件源文件（`.md` + YAML front matter）↔ 文档模型。
 *
 * 一个源文件是唯一的真源：四个渲染器（LaTeX / DOCX / JATS / HTML）都从
 * `parseSource` 得到的同一个对象出发。要改格式只需换 `meta.journal`，
 * 正文一个字都不用动——这正是「同一篇稿子投不同刊」的实际工作方式。
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseYaml, stringifyYaml } from './yaml.js'
import { parseMarkdown, collectRefs, inlineText } from './markdown.js'

export const SOURCE_FILE = 'paper.md'
export const REFERENCES_FILE = 'references.yml'

/** 章节标题 → 规范化标签，用于结构检查与期刊固定小节匹配。 */
const CANONICAL = [
  [/^(abstract|摘要)$/i, 'abstract'],
  [/^(introduction|引言|前言|背景)$/i, 'introduction'],
  [/^(related work|background|相关工作|研究现状)$/i, 'related'],
  [/^(methods?|materials and methods|methodology|方法|材料与方法)$/i, 'methods'],
  [/^(results?|findings|结果)$/i, 'results'],
  [/^(discussion|讨论)$/i, 'discussion'],
  [/^(conclusions?|结论|总结)$/i, 'conclusion'],
  [/^(acknowledge?ments?|致谢)$/i, 'acknowledgements'],
  [/^(references?|bibliography|参考文献)$/i, 'references'],
  [/^(supplementary|supporting information|补充材料)$/i, 'supplementary'],
]

export function canonicalSection(title) {
  // 去掉编号前缀（"3."、"3.1"、"III."、"（三）"）再匹配
  const text = String(title ?? '')
    .trim()
    .replace(/^[（(]?[\dIVXivx一二三四五六七八九十]+[)）.、]?\s+/, '')
    .replace(/^\d+(\.\d+)*\.?\s*/, '')
    .trim()

  for (const [pattern, id] of CANONICAL) {
    if (pattern.test(text)) return id
  }

  // 复合标题：「Results and Discussion」「方法与结果」这类在期刊里很常见，
  // 整串匹配不上时按关键词扫描，顺序按“最靠前出现的那个”定，切题的节才不会被误判。
  const probes = [
    ['methods', /(methods?|methodology|方法|材料与方法)/i],
    ['results', /(results?|findings|结果)/i],
    ['discussion', /(discussion|讨论)/i],
    ['conclusion', /(conclusions?|结论|总结)/i],
    ['introduction', /(introduction|引言|前言)/i],
    ['related', /(related work|相关工作|研究现状)/i],
    ['references', /(references?|bibliography|参考文献)/i],
    ['supplementary', /(supplementary|supporting information|补充材料)/i],
    ['acknowledgements', /(acknowledge?ments?|致谢)/i],
  ]
  let best = null
  for (const [id, pattern] of probes) {
    const found = text.search(pattern)
    if (found < 0) continue
    if (best === null || found < best.at) best = { id, at: found }
  }
  return best ? best.id : null
}

function splitFrontMatter(text) {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n')
  if (!normalized.startsWith('---')) return { front: '', body: normalized }
  const end = normalized.indexOf('\n---', 3)
  if (end < 0) return { front: '', body: normalized }
  const front = normalized.slice(3, end).replace(/^\n/, '')
  const body = normalized.slice(end + 4).replace(/^\n/, '')
  return { front, body }
}

/** 作者字段容错：`"Zhang Wei"` / `{family, given}` / `"Wei Zhang"` 都收。 */
export function normalizeAuthor(raw, index) {
  if (typeof raw === 'string') {
    const parts = raw.trim().split(/\s+/)
    const family = parts.length > 1 ? parts[parts.length - 1] : parts[0]
    const given = parts.length > 1 ? parts.slice(0, -1).join(' ') : ''
    return { family, given, name: raw.trim(), affiliation: 1, corresponding: index === 0 }
  }
  const family = raw.family ?? raw.surname ?? ''
  const given = raw.given ?? raw.first ?? ''
  return {
    family: family || (raw.name ? String(raw.name).split(/\s+/).pop() : ''),
    given: given || '',
    name: raw.name || [given, family].filter(Boolean).join(' '),
    affiliation: raw.affiliation ?? 1,
    email: raw.email,
    orcid: raw.orcid,
    corresponding: Boolean(raw.corresponding),
  }
}

export function normalizeReference(raw, index) {
  if (typeof raw === 'string') return { key: raw, type: 'misc', title: raw, authors: [] }
  const key = raw.key ?? raw.id ?? raw.citekey ?? `ref${index + 1}`
  const type = raw.type ?? 'article-journal'

  // arXiv 会给每篇预印本发 DataCite DOI，形式固定。作者只写 `number: arXiv:2409.15103` 时
  // 自动补出 DOI——否则预印本条目在多数风格里会渲染成没有标识的空壳（"Preprint at (2024)"）。
  let doi = String(raw.doi ?? '')
  const arxivId = String(raw.number ?? raw.arxivid ?? '').match(/(\d{4}\.\d{4,5})(v\d+)?/)
  if (!doi && arxivId && (type === 'preprint' || /arxiv/i.test(String(raw.journal ?? '')))) {
    doi = `10.48550/arXiv.${arxivId[1]}`
  }

  return {
    key,
    type,
    title: raw.title ?? '',
    authors: Array.isArray(raw.authors)
      ? raw.authors.map((a, i) => normalizeAuthor(a, i))
      : [],
    year: raw.year ?? raw.date ?? null,
    journal: raw.journal ?? raw.venue ?? raw.container ?? '',
    volume: raw.volume ?? '',
    issue: raw.issue ?? raw.number ?? '',
    pages: raw.pages ?? raw.page ?? '',
    publisher: raw.publisher ?? '',
    doi,
    url: raw.url ?? '',
    isbn: raw.isbn ?? '',
    note: raw.note ?? '',
  }
}

/**
 * 解析稿件源。`references` 可在 front matter 内，也可由 `referencesFile` 指向外部文件。
 */
export function parseSource(text, { baseDir = process.cwd() } = {}) {
  const { front, body } = splitFrontMatter(text)
  const warnings = []
  let meta = {}

  if (front.trim() !== '') {
    try {
      meta = parseYaml(front)
    } catch (error) {
      throw new Error(`front matter 解析失败：${error.message}`)
    }
  }

  const blocks = parseMarkdown(body)
  const headings = blocks
    .filter((b) => b.type === 'heading')
    .map((b) => ({ level: b.level, text: b.text, label: b.label, section: canonicalSection(b.text) }))

  let references = Array.isArray(meta.references) ? meta.references.map(normalizeReference) : []

  const refFile = meta.referencesFile ? resolve(baseDir, meta.referencesFile) : null
  if (refFile) {
    if (existsSync(refFile)) {
      const parsed = parseYaml(readFileSync(refFile, 'utf8'))
      const list = Array.isArray(parsed) ? parsed : parsed.references
      if (Array.isArray(list)) references = list.map(normalizeReference)
      else warnings.push(`${refFile} 里没有找到参考文献列表`)
    } else {
      warnings.push(`referencesFile 指向的 ${refFile} 不存在`)
    }
  }

  const authors = Array.isArray(meta.authors) ? meta.authors.map(normalizeAuthor) : []
  if (authors.length === 0) warnings.push('没有作者：front matter 的 authors 为空')

  const seen = new Set()
  for (const ref of references) {
    if (seen.has(ref.key)) warnings.push(`参考文献 key 重复：${ref.key}`)
    seen.add(ref.key)
  }

  const { cites, labels } = collectRefs(blocks)
  const missing = [...new Set(cites)].filter((key) => !seen.has(key))
  if (missing.length > 0) warnings.push(`正文引用了未定义的文献：${missing.join(', ')}`)

  const labelSet = new Set(labels)
  const dangling = [...new Set(labels)].filter((target) => {
    if (!target.includes(':')) return false
    return !blocks.some((b) => b.label === target)
  })
  if (dangling.length > 0) warnings.push(`交叉引用指向不存在的标签：${dangling.join(', ')}`)

  return {
    meta: {
      ...meta,
      title: meta.title ?? '（未命名稿件）',
      authors,
      journal: meta.journal ?? null,
      keywords: Array.isArray(meta.keywords) ? meta.keywords.map(String) : [],
    },
    blocks,
    headings,
    references,
    labels: labelSet,
    warnings,
  }
}

/** 文档模型 → 源文件文本（用于 scaffold 与写回）。 */
export function renderSource(doc) {
  const { blocks, references, ...meta } = doc.meta
  const head = { ...meta }
  if (references && references.length > 0) head.references = references
  const frontMatter = stringifyYaml(head)
  const body = renderBlocksToMarkdown(doc.blocks || [])
  return `---\n${frontMatter}\n---\n\n${body}\n`
}

function renderBlocksToMarkdown(blocks) {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'heading':
          return `${'#'.repeat(block.level)} ${block.text}${block.label ? ` {#${block.label}}` : ''}`
        case 'para':
          return block.text ?? inlineText(block.inline)
        case 'quote':
          return `> ${inlineText(block.inline)}`
        case 'code':
          return `\`\`\`${block.lang || ''}\n${block.text}\n\`\`\``
        case 'math':
          return `$$\n${block.tex}\n$$`
        case 'list':
          return block.items
            .map((item, index) => {
              const bullet = item.ordered ? `${index + 1}.` : '-'
              return `${'  '.repeat(item.depth)}${bullet} ${inlineText(item.inline)}`
            })
            .join('\n')
        case 'figure':
          return `![${block.caption}](${block.src})${block.label ? ` {#${block.label}}` : ''}`
        case 'table': {
          const header = `| ${block.header.map(inlineText).join(' | ')} |`
          const sep = `| ${block.header.map(() => '---').join(' | ')} |`
          const rows = block.rows.map((row) => `| ${row.map(inlineText).join(' | ')} |`)
          const caption = block.caption ? `\n: ${block.caption}${block.label ? ` {#${block.label}}` : ''}` : ''
          return [header, sep, ...rows].join('\n') + caption
        }
        case 'raw':
          return `:::${block.format}\n${block.text}\n:::`
        case 'hr':
          return '---'
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join('\n\n')
}

/** 读取一个稿件目录。 */
export function loadSource(dir) {
  const file = resolve(dir, SOURCE_FILE)
  if (!existsSync(file)) throw new Error(`没有找到稿件源文件：${file}`)
  const text = readFileSync(file, 'utf8')
  return { file, dir, text, doc: parseSource(text, { baseDir: dirname(file) }) }
}

/**
 * 生成初始源文件。刻意留占位符而不是空段落：
 * 空文件会让人从零开始写，占位符会让人知道这一节需要回答什么问题。
 */
export function scaffoldSource({ title, journal, band, design, keywords = [], authors = [], sections = null, abstract = '' }) {
  const lines = []
  lines.push(`# ${title || '（把 M4 的 science_paper_plan 标题草稿粘到这里）'}`)
  lines.push('')
  lines.push('> 正文用 Markdown 子集：`##` 分节、`[@key]` 引用、`![caption](path)` 插图、`$$ 公式 $$`。')
  lines.push('> 换刊只改 front matter 的 `journal`，正文不必动。')
  lines.push('')

  const plan = sections || [
    ['Introduction', '为什么这个问题重要、现有工作缺什么、本文做了什么（三段式，最后一段点名贡献）。'],
    ['Results', '先给图 1 的核心发现，再给支撑实验；每个小节第一句就是结论。'],
    ['Discussion', '边界条件、与已有解释的冲突、局限性（写在这里比被审稿人写出来好）。'],
    ['Methods', '别人能照着重做的程度；数据与代码可得性声明放最后。'],
  ]

  for (const [name, hint] of plan) {
    lines.push(`## ${name}`)
    lines.push('')
    lines.push(`<!-- ${hint} -->`)
    lines.push('')
  }

  lines.push('## References')
  lines.push('')
  lines.push('<!-- 参考文献写在 front matter 的 references 里，或在 references.yml 中维护 -->')
  lines.push('')

  const meta = {
    title: title || '（未命名稿件）',
    journal: journal || null,
    targetBand: band ?? null,
    design: design ?? null,
    keywords,
    authors: authors.length > 0 ? authors : [{ name: '（作者姓名）', affiliation: 1, corresponding: true }],
    affiliations: [{ id: 1, name: '（单位名称，城市，国家）' }],
    abstract: abstract || '（摘要：一句背景 → 一句缺口 → 一句做法 → 一句最硬的结果（带数字）→ 一句意义。150–250 词。）',
    // 建稿时同时落了 references.yml；不在这里指过去，正文引用就会被判成未定义
    referencesFile: REFERENCES_FILE,
    references: [],
  }

  return `---\n${stringifyYaml(meta)}\n---\n\n${lines.join('\n')}`
}
