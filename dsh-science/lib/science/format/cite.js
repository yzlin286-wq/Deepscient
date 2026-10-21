/**
 * 引文格式化：一个微缩的 CSL 执行器。
 *
 * 为什么不引 citeproc-js：它是完整的 CSL 处理器（几百 KB + XML 样式），
 * 而本包只需要覆盖 `data/journals.json` 里那 23 家出版社的引文习惯。
 * 把风格写成 `data/citation-styles.json` 里的模板串，执行器只做三件事：
 * 填槽、清标点、排序编号。加一种新风格 = 加一段 JSON，不改代码。
 *
 * 边界：不做消歧（同作者同年 a/b）、不做 locale 复数、不做标题大小写转换。
 * 这三项在 lint 里以警告形式出现，交给人决定。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, '..', '..', '..', 'data', 'citation-styles.json')

let CACHE = null

export function loadCitationStyles() {
  if (CACHE) return CACHE
  const raw = JSON.parse(readFileSync(DATA, 'utf8'))
  CACHE = { styles: raw.styles, publisherDefault: raw.publisherDefault, meta: raw.$meta }
  return CACHE
}

export function styleById(id) {
  const { styles } = loadCitationStyles()
  const style = styles[id]
  if (!style) {
    throw new Error(`未知引文风格 ${id}；可用：${Object.keys(styles).join(', ')}`)
  }
  return style
}

export function styleForPublisher(publisher) {
  const { styles, publisherDefault } = loadCitationStyles()
  const id = publisherDefault[publisher]
  return id && styles[id] ? id : 'apa-7'
}

const CJK = /[\u3400-\u9fff]/

const isCjk = (text) => CJK.test(String(text ?? ''))

function initialsOf(given, mode) {
  const parts = String(given ?? '')
    .split(/[\s.\-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .filter(Boolean)

  if (parts.length === 0) return ''
  if (mode === 'compact') return parts.join('')
  return parts.map((ch) => `${ch}.`).join(' ')
}

function formatOneAuthor(author, spec) {
  const family = author.family ?? ''
  const given = author.given ?? ''
  const name = author.name ?? [given, family].filter(Boolean).join(' ')

  // 中文姓名不做缩写、不加空格分隔
  if (isCjk(family) || isCjk(name)) {
    const combined = `${family}${given}`
    return combined.trim() || name
  }

  const mode = spec.initials ?? 'none'

  if (mode === 'none') {
    // GB/T 7714 对外文作者：姓全大写 + 名缩写
    const initials = initialsOf(given, 'compact')
    return initials ? `${String(family).toUpperCase()} ${initials}` : String(family).toUpperCase()
  }

  if (mode === 'with-period-before') {
    const initials = initialsOf(given, 'with-period')
    return initials ? `${initials} ${family}` : family
  }

  if (mode === 'compact') {
    const initials = initialsOf(given, 'compact')
    return initials ? `${family} ${initials}` : family
  }

  const initials = initialsOf(given, 'with-period')
  return initials ? `${family}, ${initials}` : family
}

export function formatAuthors(authors, spec) {
  const list = Array.isArray(authors) ? authors.filter(Boolean) : []
  if (list.length === 0) return ''

  const max = Number.isFinite(spec.max) ? spec.max : list.length
  const keep = Number.isFinite(spec.etAlKeep) ? spec.etAlKeep : max
  const separator = spec.separator ?? ', '
  const lastSeparator = spec.lastSeparator ?? separator

  const join = (items) => {
    const rendered = items.map((a) => formatOneAuthor(a, spec))
    if (rendered.length === 1) return rendered[0]
    const tail = rendered.length === 2 ? (spec.lastSeparatorTwo ?? lastSeparator) : lastSeparator
    return rendered.slice(0, -1).join(separator) + tail + rendered[rendered.length - 1]
  }

  if (list.length > max) {
    const head = join(list.slice(0, keep))
    const anyCjk = list.some((a) => isCjk(a.family) || isCjk(a.name))
    const etAl = anyCjk ? (spec.etAl ?? 'et al.') : (spec.etAlForeign ?? spec.etAl ?? 'et al.')
    return `${head}${separator}${etAl}`
  }

  const rendered = join(list)
  return spec.suffix ? `${rendered}${spec.suffix}` : rendered
}

/** 作者-年份风格的行内短名：只出姓，不出缩写。 */
export function shortAuthorName(ref, style) {
  const authors = ref.authors ?? []
  const familyOf = (author) => {
    const family = author.family || ''
    const given = author.given || ''
    if (isCjk(family) || isCjk(given)) return `${family}${given}`.trim() || author.name || 'Anon.'
    return family || author.name || 'Anon.'
  }

  if (authors.length === 0) {
    return ref.title ? String(ref.title).split(/\s+/).slice(0, 3).join(' ') : 'Anon.'
  }
  if (authors.length === 1) return familyOf(authors[0])
  if (authors.length === 2) {
    const [a, b] = authors.map(familyOf)
    return (style.inText.two ?? '{a} & {b}').replace('{a}', a).replace('{b}', b)
  }
  return `${familyOf(authors[0])} ${style.inText.etAl ?? 'et al.'}`
}

const SLOT = /\{(\w+)\}/g

/** 清掉空槽留下的多余标点。 */
function cleanup(text) {
  let out = String(text)
  out = out.replace(/\s+/g, ' ')
  out = out.replace(/\(\s*\)/g, '')
  out = out.replace(/\[\s*\]/g, '')
  out = out.replace(/\s+([,.;:)\]])/g, '$1')
  out = out.replace(/([,;:])\s*([,.;:])/g, '$2')
  out = out.replace(/\.\s*\./g, '.')
  out = out.replace(/,\s*\./g, '.')
  out = out.replace(/^\s*[,.;:]\s*/, '')
  out = out.replace(/^\(\s*/, '(')
  out = out.replace(/\s{2,}/g, ' ')
  return out.trim()
}

export function renderTemplate(template, slots) {
  const filled = String(template).replace(SLOT, (_, name) => {
    const value = slots[name]
    return value === undefined || value === null ? '' : String(value)
  })
  return cleanup(filled)
}

const pagesOf = (ref) => {
  const pages = String(ref.pages ?? '').trim()
  if (!pages) return ''
  return pages.replace(/--/g, '–').replace(/(\d)-(\d)/, '$1–$2')
}

const doiOf = (ref) => {
  const doi = String(ref.doi ?? '').trim()
  if (!doi) return ''
  return doi.startsWith('http') ? doi : `https://doi.org/${doi.replace(/^doi:\s*/i, '')}`
}

export function referenceSlots(ref) {
  const year = ref.year === null || ref.year === undefined || ref.year === '' ? '' : String(ref.year)
  return {
    authors: ref.__authors ?? '',
    editors: ref.__editors ?? '',
    title: String(ref.title ?? '').replace(/\.$/, ''),
    titleQuoted: ref.title ? `"${String(ref.title).replace(/\.$/, '')}"` : '',
    journal: ref.journal ?? '',
    container: ref.container ?? ref.journal ?? ref.publisher ?? '',
    year,
    volume: ref.volume ?? '',
    issue: ref.issue ?? '',
    pages: pagesOf(ref),
    doi: doiOf(ref),
    url: ref.doi ? '' : (ref.url ?? ''),
    publisher: ref.publisher ?? '',
    label: ref.__label ?? '',
    note: ref.note ?? '',
  }
}

export function formatReference(ref, styleId) {
  const style = typeof styleId === 'string' ? styleById(styleId) : styleId
  const type = style.templates[ref.type] ? ref.type : 'misc'
  const template = style.templates[type]
  const authors = formatAuthors(ref.authors, style.authors)
  const slots = referenceSlots({
    ...ref,
    __authors: authors,
    __label: (style.typeLabels && style.typeLabels[type]) || '',
  })
  return renderTemplate(template, slots)
}

/**
 * 按风格排序并编号。numeric 按首次引用顺序，author-date 按作者字母序。
 * 未被正文引用的条目照样列出，但标记 `cited: false`——投稿前应当清掉。
 */
export function buildReferenceList(references, citeOrder, styleId) {
  const style = typeof styleId === 'string' ? styleById(styleId) : styleId
  const byKey = new Map(references.map((ref) => [ref.key, ref]))
  const ordered = []
  const seen = new Set()

  for (const key of citeOrder) {
    if (seen.has(key)) continue
    const ref = byKey.get(key)
    if (!ref) continue
    seen.add(key)
    ordered.push(ref)
  }

  const uncited = references.filter((ref) => !seen.has(ref.key))

  if (style.sort === 'alphabetical') {
    const keyOf = (ref) => {
      const family = ref.authors?.[0]?.family ?? ref.authors?.[0]?.name ?? ref.title ?? ''
      return `${family} ${ref.year ?? ''}`
    }
    ordered.sort((a, b) => keyOf(a).localeCompare(keyOf(b), 'en'))
    uncited.sort((a, b) => keyOf(a).localeCompare(keyOf(b), 'en'))
  }

  const all = [...ordered, ...uncited]
  const numbers = new Map()
  const entries = all.map((ref, index) => {
    const n = index + 1
    numbers.set(ref.key, n)
    return {
      key: ref.key,
      n,
      cited: seen.has(ref.key),
      text: formatReference(ref, style),
    }
  })

  return { entries, numbers, styleId: typeof styleId === 'string' ? styleId : null }
}

/** 把连续编号压成 `1–3`。 */
export function compressNumbers(numbers, style) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const collapseAt = style.inText.collapseAt ?? 3
  const groups = []
  for (const n of sorted) {
    const last = groups[groups.length - 1]
    if (last && n === last[last.length - 1] + 1) last.push(n)
    else groups.push([n])
  }
  return groups
    .map((group) => {
      if (group.length >= collapseAt) {
        return `${group[0]}${style.inText.range ?? '-'}${group[group.length - 1]}`
      }
      return group.join(style.inText.separator ?? ',')
    })
    .join(style.inText.separator ?? ',')
}

/**
 * 行内引文 → 字符串。
 * 返回纯文本部件数组，由各渲染器决定是否加数学上标。
 */
export function formatInText(citeNode, style, context) {
  const { numbers, refsByKey } = context
  const styleKind = style.kind

  if (styleKind === 'numeric') {
    const nums = citeNode.keys.map((k) => numbers.get(k.key)).filter((n) => Number.isFinite(n))
    if (nums.length === 0) return { mode: 'numeric', text: '', numbers: [] }
    const joined = compressNumbers(nums, style)
    const text = style.inText.single.replace('{n}', joined)
    return { mode: 'superscript', text, numbers: nums }
  }

  const parts = citeNode.keys.map((k) => {
    const ref = refsByKey.get(k.key)
    if (!ref) return null
    const year = ref.year ?? 'n.d.'
    if (k.suppressAuthor) return String(year)
    const authorPart = shortAuthorName(ref, style)
    return { authorPart, year }
  }).filter(Boolean)

  if (parts.length === 0) return { mode: 'author-date', text: '', numbers: [] }

  if (citeNode.mode === 'text') {
    const text = parts.map((part) => (typeof part === 'string' ? part : `${part.authorPart} (${part.year})`)).join(', ')
    return { mode: 'author-date', text, numbers: [] }
  }

  const inner = parts
    .map((part) => (typeof part === 'string' ? part : `${part.authorPart}, ${part.year}`))
    .join('; ')
  return { mode: 'author-date', text: `(${inner})`, numbers: [] }
}
