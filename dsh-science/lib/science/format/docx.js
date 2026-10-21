/**
 * 文档模型 → .docx 排版规格 →（交给 scripts/py/docx_build.py 落地）。
 *
 * 这里只做「转换为与语言无关的 JSON」，不做 OOXML。理由：Word 的样式继承、
 * 东亚字体槽位、行号、三线表边框这些东西在 python-docx 里已经是几十行可靠的代码，
 * 在 JS 里重写一遍只会多一处不一致。
 *
 * 公式：Word 里的真数学要 OMML，生成它需要一整套 TeX→OMML 转换。
 * 本模块用 Unicode 近似（希腊字母、上下标、常见运算符），转换不了的命令原样留下
 * 并计入 `unconverted`，由 lint 提示「这些公式要在 Word 里手工改」。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { formatInText, buildReferenceList, styleById } from './cite.js'
import { collectRefs } from './markdown.js'
import { canonicalSection } from './source.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUILDER = join(HERE, '..', '..', '..', 'scripts', 'py', 'docx_build.py')

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν',
  xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ',
  Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
}

const SYMBOLS = {
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
  sim: '∼', simeq: '≃', propto: '∝', infty: '∞', partial: '∂', nabla: '∇',
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', to: '→', rightarrow: '→',
  leftarrow: '←', Rightarrow: '⇒', Leftrightarrow: '⇔', mapsto: '↦',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩',
  forall: '∀', exists: '∃', sum: '∑', prod: '∏', int: '∫', sqrt: '√',
  ldots: '…', cdots: '⋯', dots: '…', prime: '′', ell: 'ℓ',
  lVert: '‖', rVert: '‖', Vert: '‖', vert: '|', lvert: '|', rvert: '|',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
  top: '⊤', bot: '⊥', perp: '⊥', oplus: '⊕', otimes: '⊗', circ: '∘',
  ast: '∗', star: '⋆', equiv: '≡', ll: '≪', gg: '≫', mid: '|',
  leftarrow: '←', Longrightarrow: '⟹', implies: '⟹', therefore: '∴',
}

const SUPERSCRIPT = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', n: 'ⁿ', i: 'ⁱ' }
const SUBSCRIPT = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', a: 'ₐ', e: 'ₑ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', n: 'ₙ', t: 'ₜ', x: 'ₓ' }

function mapChars(text, table) {
  let out = ''
  for (const ch of text) out += table[ch] ?? ch
  return out
}

/**
 * TeX 子集 → Unicode 近似。返回 { text, unconverted }。
 * 转换不了的命令保留原样（`unconverted` 里逐条列出），不做"悄悄丢掉"。
 */
export function texToUnicode(tex) {
  const unconverted = []
  let text = String(tex ?? '')

  // 细空格命令：\; \, \: \! \quad \qquad —— 排的是间距，不是内容
  text = text.replace(/\\[,;:!]/g, '').replace(/\\(?:quad|qquad)\b/g, ' ')

  // 剥掉字体/文本命令的外壳，否则 \frac{\mathbf{m}}{x} 这种嵌套会让后面的花括号匹配失败
  for (let guard = 0; guard < 5; guard += 1) {
    const next = text.replace(
      /\\(?:mathbf|mathrm|mathcal|mathit|mathsf|mathtt|mathfrak|mathbb|text|textrm|textit|operatorname|boldsymbol)\s*\{([^{}]*)\}/g,
      '$1',
    )
    if (next === text) break
    text = next
  }

  // 上下标放在 \sqrt / \frac 之前：`\sqrt{d_{in}}` 里的 `_{in}` 是花括号，
  // 先把它换成 ᵢₙ 才能让 `[^{}]` 的参数匹配成功。
  const mapAll = (inner, table) => {
    const chars = [...inner]
    if (chars.length === 0) return null
    if (!chars.every((ch) => table[ch] !== undefined)) return null
    return chars.map((ch) => table[ch]).join('')
  }

  text = text.replace(/_\{([^{}]*)\}/g, (_, inner) => {
    const mapped = mapAll(inner, SUBSCRIPT)
    return mapped !== null ? mapped : `_(${inner})`
  })
  // 单字符下标：`M_t` 直接出 `Mₜ`，比留成 `M_t` 好看得多
  text = text.replace(/_([A-Za-z0-9])(?![A-Za-z0-9{])/g, (match, ch) => SUBSCRIPT[ch] ?? match)

  text = text.replace(/\^\{([^{}]*)\}/g, (_, inner) => {
    const mapped = mapAll(inner, SUPERSCRIPT)
    return mapped !== null ? mapped : `^(${inner})`
  })
  text = text.replace(/\^([A-Za-z0-9])(?![A-Za-z0-9{])/g, (match, ch) => SUPERSCRIPT[ch] ?? match)

  // \sqrt{x} → √(x)；务必在 \frac 之前，否则分母里的花括号会挡住 frac 匹配
  for (let guard = 0; guard < 5 && text.includes('\\sqrt'); guard += 1) {
    const next = text.replace(/\\sqrt\s*\{([^{}]*)\}/g, (_, inner) => `√(${inner})`)
    if (next === text) break
    text = next
  }

  // \frac{a}{b} → a/b
  for (let guard = 0; guard < 5 && text.includes('\\frac'); guard += 1) {
    const next = text.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, a, b) => `${a}/${b}`)
    if (next === text) break
    text = next
  }

  text = text.replace(/\\\|/g, '‖').replace(/\\\{/g, '{').replace(/\\\}/g, '}')

  text = text.replace(/\\([A-Za-z]+)/g, (match, name) => {
    if (GREEK[name]) return GREEK[name]
    if (SYMBOLS[name]) return SYMBOLS[name]
    unconverted.push(match)
    return match
  })

  text = text.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
  return { text, unconverted }
}

function pathToFile(src, baseDir) {
  if (!src) return null
  const cleaned = String(src).replace(/^\.\//, '')
  const candidate = isAbsolute(cleaned) ? cleaned : resolve(baseDir, cleaned)
  return existsSync(candidate) ? candidate : null
}

/** 行内节点 → docx runs。 */
function toRuns(nodes, ctx) {
  const runs = []

  const push = (text, flags = {}) => {
    if (text === '' || text === undefined || text === null) return
    runs.push({ text, ...flags })
  }

  const walk = (list, flags = {}) => {
    for (const node of list || []) {
      switch (node.t) {
        case 'text': push(node.v, flags); break
        case 'em': walk(node.c, { ...flags, italic: true }); break
        case 'strong': walk(node.c, { ...flags, bold: true }); break
        case 'code': push(node.v, { ...flags, code: true }); break
        case 'math': {
          const { text, unconverted } = texToUnicode(node.v)
          for (const item of unconverted) ctx.unconverted.add(item)
          push(text, { ...flags, italic: true })
          break
        }
        case 'cite': {
          const result = formatInText(node, ctx.style, ctx.citeContext)
          if (result.mode === 'superscript') push(result.text, { ...flags, sup: true })
          else push(result.text, flags)
          break
        }
        case 'ref': push(`@${node.target}`, flags); break
        case 'link': {
          walk(node.c, { ...flags, url: node.v })
          break
        }
        case 'break': push('\n', flags); break
        default: break
      }
    }
  }

  walk(nodes)
  return runs
}

/** 编号：图、表、公式各自连续编号（与 LaTeX 的计数器语义一致）。 */
function numberBlocks(blocks) {
  let fig = 0
  let tab = 0
  let eq = 0
  return blocks.map((block) => {
    if (block.type === 'figure') { fig += 1; return { ...block, number: fig } }
    if (block.type === 'table') { tab += 1; return { ...block, number: tab } }
    if (block.type === 'math') { eq += 1; return { ...block, number: eq } }
    return block
  })
}

function buildDocxSpec(doc, format, { baseDir, outPath, abstractLabel }) {
  const style = styleById(format.citation)
  const { cites } = collectRefs(doc.blocks)
  const referenceList = buildReferenceList(doc.references, cites, format.citation)
  const refsByKey = new Map(doc.references.map((ref) => [ref.key, ref]))
  const unconverted = new Set()

  const ctx = {
    style,
    citeContext: { numbers: referenceList.numbers, refsByKey },
    unconverted,
  }

  const numbered = numberBlocks(doc.blocks)
  const blocks = []

  blocks.push({ k: 'title', text: doc.meta.title })

  const affiliations = Array.isArray(doc.meta.affiliations) ? doc.meta.affiliations : []
  const affilName = (author) => {
    const id = author.affiliation ?? 1
    const found = affiliations.find((entry) => String(entry.id) === String(id))
    if (found) return found.name ?? ''
    return typeof author.affiliation === 'string' ? author.affiliation : ''
  }

  blocks.push({
    k: 'authors',
    entries: (doc.meta.authors || []).map((author) => ({
      name: author.name || [author.given, author.family].filter(Boolean).join(' '),
      affiliation: affilName(author),
      email: author.email || '',
    })),
  })
  blocks.push({ k: 'spacer' })

  const abstractText = doc.meta.abstract || ''
  if (abstractText.trim() !== '') {
    blocks.push({
      k: 'abstract',
      label: abstractLabel || format.family.abstractHeading || 'Abstract',
      runs: [{ text: abstractText }],
    })
  }

  if (doc.meta.keywords && doc.meta.keywords.length > 0) {
    blocks.push({ k: 'keywords', runs: [{ text: doc.meta.keywords.join(', ') }] })
  }

  for (const block of numbered) {
    switch (block.type) {
      case 'heading': {
        const section = canonicalSection(block.text)
        if (section === 'abstract' || section === 'references') break
        blocks.push({ k: 'heading', level: block.level, text: block.text })
        break
      }
      case 'para':
        blocks.push({ k: 'para', runs: toRuns(block.inline, ctx) })
        break
      case 'quote':
        blocks.push({ k: 'para', runs: toRuns(block.inline, ctx) })
        break
      case 'list':
        blocks.push({
          k: 'list',
          ordered: block.ordered,
          items: block.items.map((item, index) => ({
            depth: item.depth,
            index: index + 1,
            runs: toRuns(item.inline, ctx),
          })),
        })
        break
      case 'figure': {
        const file = pathToFile(block.src, baseDir)
        blocks.push({
          k: 'figure',
          src: block.src,
          path: file,
          number: block.number,
          caption: toRuns(block.captionInline ?? [{ t: 'text', v: block.caption }], ctx),
        })
        break
      }
      case 'table':
        blocks.push({
          k: 'table',
          number: block.number,
          header: block.header.map((cell) => toRuns(cell, ctx)),
          rows: block.rows.map((row) => row.map((cell) => toRuns(cell, ctx))),
          caption: block.caption ? toRuns(block.captionInline ?? [{ t: 'text', v: block.caption }], ctx) : [],
        })
        break
      case 'math': {
        const { text } = texToUnicode(block.tex)
        const { unconverted: inner } = texToUnicode(block.tex)
        for (const item of inner) unconverted.add(item)
        blocks.push({
          k: 'equation',
          number: block.number,
          runs: [{ text: `(${block.number})  ${text}`, italic: false }],
        })
        break
      }
      case 'code':
        blocks.push({ k: 'para', runs: [{ text: block.text, code: true }] })
        break
      case 'raw':
        if (block.format === 'text') blocks.push({ k: 'para', runs: [{ text: block.text }] })
        break
      default:
        break
    }
  }

  if (referenceList.entries.length > 0) {
    blocks.push({ k: 'heading', level: 1, text: 'References' })
    blocks.push({
      k: 'refs',
      entries: referenceList.entries.map((entry) => ({ n: entry.n, text: entry.text })),
    })
  }

  return {
    out: outPath,
    spec: {
      ...format.family.docx,
      lineSpacing: format.family.docx.lineSpacing ?? 1,
    },
    blocks,
    unconverted: [...unconverted],
    referenceCount: referenceList.entries.length,
  }
}

/**
 * @param {object} doc parseSource 的结果
 * @param {object} format resolveFormat 的结果
 * @param {{outPath: string, baseDir: string, python?: string}} options
 */
export function renderDocx(doc, format, { outPath, baseDir, python = 'python' }) {
  const spec = buildDocxSpec(doc, format, {
    baseDir,
    outPath: resolve(outPath),
    abstractLabel: format.family.abstractHeading,
  })

  if (!existsSync(BUILDER)) {
    throw new Error(`缺少 DOCX 渲染器：${BUILDER}`)
  }

  const workDir = mkdtempSync(join(tmpdir(), 'dsh-docx-'))
  const specPath = join(workDir, 'spec.json')
  writeFileSync(specPath, JSON.stringify(spec), 'utf8')

  try {
    const result = spawnSync(python, [BUILDER, specPath], {
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    })

    if (result.error) throw new Error(`无法启动 ${python}：${result.error.message}`)

    const stdout = String(result.stdout || '').trim()
    let payload = null
    if (stdout) {
      try {
        payload = JSON.parse(stdout.split('\n').pop())
      } catch {
        payload = null
      }
    }

    if (!payload) {
      const detail = [stdout, String(result.stderr || '')].filter(Boolean).join('\n').slice(-1200)
      throw new Error(`DOCX 渲染器没有返回可解析结果：${detail || '(空输出)'}`)
    }
    if (!payload.ok) {
      throw new Error(`DOCX 渲染失败：${payload.error}${payload.trace ? `\n${payload.trace}` : ''}`)
    }

    return {
      path: payload.path,
      bytes: payload.bytes ?? statSync(payload.path).size,
      blocks: spec.blocks.length,
      referenceCount: spec.referenceCount,
      unconverted: spec.unconverted,
      citationStyle: format.citation,
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

export { buildDocxSpec }
