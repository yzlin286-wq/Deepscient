/**
 * 极简 YAML 子集解析/序列化。
 *
 * 为什么自己写：稿件源文件的 front matter 需要人可读、手可改，JSON 不行；
 * 而 `yaml` / `js-yaml` 不是本包的依赖（dsh profile 里也没有稳定路径）。
 * 这个实现只覆盖 front matter 真正用得到的语法，超出的部分一律抛错，
 * 不做"猜你想要什么"——稿件元数据静默解读错误比报错危险得多。
 *
 * 支持：注释、嵌套 map（缩进）、`- ` 列表、引号字符串、行内数组 `[a, b]`、
 *      块标量 `|` 与 `>`、true/false/null/数字。
 * 不支持（会抛错或按字面串处理）：锚点引用、多文档、flow map `{a: b}`、跨行续行纯量。
 */

const COMMENT = /^#/
const LIST_ITEM = /^-(\s|$)/
const KEY_VALUE = /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s#][^:]*?):(?:\s+(.*))?$/

const blankOrComment = (line) => {
  const t = line.trim()
  return t === '' || COMMENT.test(t)
}

const indentOf = (line) => {
  const m = line.match(/^ +/)
  return m ? m[0].length : 0
}

function fail(message, lineNo) {
  throw new Error(`YAML 第 ${lineNo} 行：${message}`)
}

function unquote(token) {
  if (token.length >= 2) {
    const head = token[0]
    const tail = token[token.length - 1]
    if (head === '"' && tail === '"') {
      return token.slice(1, -1).replace(/\\(["\\nt])/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))
    }
    if (head === "'" && tail === "'") {
      return token.slice(1, -1).replace(/''/g, "'")
    }
  }
  return null
}

function splitTopLevel(text, separator) {
  const parts = []
  let depth = 0
  let quote = null
  let current = ''

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue }
    if (ch === '{' || ch === '[') depth += 1
    if (ch === '}' || ch === ']') depth -= 1
    if (ch === separator && depth === 0) { parts.push(current); current = ''; continue }
    current += ch
  }
  if (current.trim() !== '') parts.push(current)
  return parts
}

function findTopLevelColon(text) {
  let depth = 0
  let quote = null
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) { if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '{' || ch === '[') depth += 1
    if (ch === '}' || ch === ']') depth -= 1
    if (ch === ':' && depth === 0) return i
  }
  return -1
}

function parseFlowMap(text, lineNo) {
  const inner = text.slice(1, -1).trim()
  const map = {}
  if (inner === '') return map
  for (const part of splitTopLevel(inner, ',')) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const colon = findTopLevelColon(trimmed)
    if (colon < 0) fail(`flow map 里缺少冒号：${trimmed}`, lineNo)
    const rawKey = trimmed.slice(0, colon).trim()
    const key = unquote(rawKey) ?? rawKey
    map[key] = parseScalar(trimmed.slice(colon + 1).trim(), lineNo)
  }
  return map
}

function parseScalar(token, lineNo) {
  const text = token.trim()
  if (text === '') return null

  const quoted = unquote(text)
  if (quoted !== null) return quoted

  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null' || text === '~') return null
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10)
  if (/^-?\d+\.\d+$/.test(text)) return Number.parseFloat(text)

  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim()
    if (inner === '') return []
    return inner.split(',').map((part) => parseScalar(part, lineNo))
  }

  if (text.startsWith('{') && text.endsWith('}')) {
    return parseFlowMap(text, lineNo)
  }

  return text
}

/** 块标量 `|` / `>`；返回 [text, nextIndex]。 */
function parseBlockScalar(lines, start, parentIndent, style) {
  const collected = []
  let i = start
  let blockIndent = null

  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      collected.push('')
      i += 1
      continue
    }
    const indent = indentOf(line)
    if (indent <= parentIndent) break
    if (blockIndent === null) blockIndent = indent
    if (indent < blockIndent) break
    collected.push(line.slice(blockIndent))
    i += 1
  }

  // 去掉尾部空行
  while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop()

  if (style === '|') return [collected.join('\n'), i]
  // folded：单个换行变空格，空行保留为换行
  const folded = collected.reduce((acc, line) => {
    if (line === '') return `${acc}\n`
    if (acc === '' || acc.endsWith('\n')) return acc + line
    return `${acc} ${line}`
  }, '')
  return [folded.replace(/\n$/, ''), i]
}

function nextContent(lines, i) {
  let j = i
  while (j < lines.length && blankOrComment(lines[j])) j += 1
  return j
}

function parseMap(lines, start, indent) {
  const map = {}
  let i = start

  for (;;) {
    i = nextContent(lines, i)
    if (i >= lines.length) break

    const line = lines[i]
    const lineIndent = indentOf(line)
    if (lineIndent < indent) break
    if (lineIndent > indent) fail(`缩进不一致（期望 ${indent}，实际 ${lineIndent}）`, i + 1)
    if (LIST_ITEM.test(line.trim())) fail('map 里出现列表项，缩进层级可能不对', i + 1)

    const match = line.trim().match(KEY_VALUE)
    if (!match) fail(`无法解析为键值对：${line.trim()}`, i + 1)

    const key = unquote(match[1]) ?? match[1]
    const rest = (match[2] ?? '').trim()
    i += 1

    if (rest.startsWith('|') || rest.startsWith('>')) {
      const [text, next] = parseBlockScalar(lines, i, indent, rest[0])
      map[key] = text
      i = next
      continue
    }

    if (rest !== '') {
      map[key] = parseScalar(rest, i)
      continue
    }

    const probe = nextContent(lines, i)
    if (probe < lines.length && indentOf(lines[probe]) > indent) {
      const childIndent = indentOf(lines[probe])
      const [value, next] = LIST_ITEM.test(lines[probe].trim())
        ? parseList(lines, probe, childIndent)
        : parseMap(lines, probe, childIndent)
      map[key] = value
      i = next
      continue
    }

    map[key] = null
  }

  return [map, i]
}

function parseList(lines, start, indent) {
  const list = []
  let i = start

  for (;;) {
    i = nextContent(lines, i)
    if (i >= lines.length) break

    const line = lines[i]
    if (indentOf(line) < indent) break
    if (indentOf(line) > indent) fail(`列表项缩进不一致（期望 ${indent}）`, i + 1)
    if (!LIST_ITEM.test(line.trim())) break

    const rest = line.trim().replace(/^-\s?/, '')
    i += 1

    if (rest === '') {
      const probe = nextContent(lines, i)
      if (probe < lines.length && indentOf(lines[probe]) > indent) {
        const childIndent = indentOf(lines[probe])
        const [value, next] = LIST_ITEM.test(lines[probe].trim())
          ? parseList(lines, probe, childIndent)
          : parseMap(lines, probe, childIndent)
        list.push(value)
        i = next
      } else {
        list.push(null)
      }
      continue
    }

    const inlineMap = rest.startsWith('{') || rest.startsWith('[') ? null : rest.match(KEY_VALUE)
    if (inlineMap && !unquote(rest)) {
      // `- key: value` 形式的列表项，后续同级键在 indent+2
      const key = unquote(inlineMap[1]) ?? inlineMap[1]
      const valueText = (inlineMap[2] ?? '').trim()
      const item = {}
      if (valueText !== '') {
        item[key] = parseScalar(valueText, i)
      } else {
        item[key] = null
      }
      const probe = nextContent(lines, i)
      if (probe < lines.length && indentOf(lines[probe]) > indent) {
        const [extra, next] = parseMap(lines, probe, indentOf(lines[probe]))
        Object.assign(item, extra)
        i = next
      }
      list.push(item)
      continue
    }

    list.push(parseScalar(rest, i))
  }

  return [list, i]
}

export function parseYaml(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const start = nextContent(lines, 0)
  if (start >= lines.length) return {}

  const indent = indentOf(lines[start])
  const [value] = LIST_ITEM.test(lines[start].trim())
    ? parseList(lines, start, indent)
    : parseMap(lines, start, indent)
  return value
}

const NEEDS_QUOTE = /^[\s>|*&!%@`{[\]},#?:-]|[:#]\s|^(true|false|null|~|-?\d+(\.\d+)?)$/

function scalarToYaml(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  const text = String(value)
  if (text.includes('\n')) return null // 交给块标量
  if (text === '' || NEEDS_QUOTE.test(text) || /:\s/.test(text) || text !== text.trim()) {
    return JSON.stringify(text)
  }
  return text
}

export function stringifyYaml(value, indent = 0) {
  const pad = ' '.repeat(indent)
  const out = []

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const entries = Object.entries(item)
        if (entries.length === 0) {
          out.push(`${pad}- {}`)
          continue
        }
        entries.forEach(([k, v], index) => {
          const head = index === 0 ? `${pad}- ` : `${pad}  `
          out.push(renderEntry(head, k, v, indent + 2))
        })
        continue
      }
      const flat = item !== null && typeof item === 'object' ? null : scalarToYaml(item)
      out.push(flat === null ? `${pad}-` : `${pad}- ${flat}`)
    }
    return out.join('\n')
  }

  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(renderEntry(pad, k, v, indent))
    }
    return out.join('\n')
  }

  return `${pad}${scalarToYaml(value)}`
}

function renderEntry(head, key, value, indent) {
  const safeKey = /^[A-Za-z_][\w.-]*$/.test(key) ? key : JSON.stringify(key)
  const pad = ' '.repeat(indent)

  if (typeof value === 'string' && value.includes('\n')) {
    const body = value
      .split('\n')
      .map((line) => (line === '' ? '' : `${pad}  ${line}`))
      .join('\n')
    return `${head}${safeKey}: |\n${body}`
  }

  if (value !== null && typeof value === 'object') {
    const nested = stringifyYaml(value, indent + 2)
    if (nested.trim() === '' || (Array.isArray(value) && value.length === 0)) {
      return `${head}${safeKey}: ${Array.isArray(value) ? '[]' : '{}'}`
    }
    return `${head}${safeKey}:\n${nested}`
  }

  return `${head}${safeKey}: ${scalarToYaml(value)}`
}
