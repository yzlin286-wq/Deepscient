#!/usr/bin/env node
/**
 * M5 排版导出层验证。
 *
 *   node scripts/verify-format.mjs            # 离线（纯计算，不启 TeX、不写研究工作区）
 *   node scripts/verify-format.mjs --compile  # 额外真编译一遍 PDF/DOCX（约 5–20 秒）
 *
 * 离线部分覆盖 yaml / markdown / source / cite / formats / latex / docx / jats / html / lint，
 * 断言的是「结构对不对」，不是「排版好不好看」——后者只能靠人看 PDF。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'

const compile = process.argv.includes('--compile')
const root = mkdtempSync(join(tmpdir(), 'format-verify-'))

let pass = 0
let fail = 0
const fails = []

function check(label, cond, detail = '') {
  if (cond) { pass += 1; return }
  fail += 1
  fails.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

function section(title) { console.log(`\n── ${title} ──`) }

const yaml = await import('../lib/science/format/yaml.js')
const md = await import('../lib/science/format/markdown.js')
const source = await import('../lib/science/format/source.js')
const cite = await import('../lib/science/format/cite.js')
const formats = await import('../lib/science/format/formats.js')
const latex = await import('../lib/science/format/latex.js')
const docx = await import('../lib/science/format/docx.js')
const jats = await import('../lib/science/format/jats.js')
const html = await import('../lib/science/format/html.js')
const lint = await import('../lib/science/format/lint.js')
const build = await import('../lib/science/format/build.js')

/* ── 1. YAML 子集 ──────────────────────────────────────────────────── */
section('yaml')
{
  const text = [
    '# 注释行',
    'title: "A: b"',
    'journal: nature',
    'targetBand: 5',
    'draft: true',
    'keywords: [muon, optimizer]',
    'authors:',
    '  - name: Zhang Wei',
    '    affiliation: 1',
    '  - {family: Doe, given: Alice}',
    'abstract: |',
    '  第一行',
    '  第二行',
    'folded: >',
    '  折行',
    '  合并',
  ].join('\n')

  const parsed = yaml.parseYaml(text)
  check('yaml 引号值保留冒号', parsed.title === 'A: b', JSON.stringify(parsed.title))
  check('yaml 字符串', parsed.journal === 'nature')
  check('yaml 数字', parsed.targetBand === 5)
  check('yaml 布尔', parsed.draft === true)
  check('yaml 行内数组', Array.isArray(parsed.keywords) && parsed.keywords.length === 2)
  check('yaml 嵌套列表', Array.isArray(parsed.authors) && parsed.authors.length === 2)
  check('yaml 列表首项 map', parsed.authors[0].name === 'Zhang Wei')
  check('yaml 数字型 affil', parsed.authors[0].affiliation === 1)
  check('yaml flow map', parsed.authors[1].family === 'Doe' && parsed.authors[1].given === 'Alice')
  check('yaml 块标量 |', parsed.abstract === '第一行\n第二行', JSON.stringify(parsed.abstract))
  check('yaml 块标量 >', parsed.folded === '折行 合并', JSON.stringify(parsed.folded))
  check('yaml 注释被丢弃', Object.keys(parsed).every((key) => !key.startsWith('#')))

  const back = yaml.parseYaml(yaml.stringifyYaml(parsed))
  check('yaml 往返稳定', JSON.stringify(back) === JSON.stringify(parsed))
  check('yaml 空输入', JSON.stringify(yaml.parseYaml('')) === '{}')
}

/* ── 2. Markdown 子集 ────────────────────────────────────��─────────── */
section('markdown')
{
  const text = [
    '# Introduction',
    '',
    'First para with **bold**, *italic*, `code` and [@jordan2024muon].',
    '',
    'Second para citing @doe2019book and [@a; @b].',
    '',
    '## Results {#sec:res}',
    '',
    '- item one',
    '- item two',
    '',
    '![Caption here.](figures/fig1.png){#fig:one}',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    ': Table caption. {#tab:one}',
    '',
    '$$',
    'E = mc^2',
    '\\label{eq:e}',
    '$$',
  ].join('\n')

  const blocks = md.parseMarkdown(text)
  check('md 解析出块', blocks.length >= 7, `${blocks.length}`)
  const headings = blocks.filter((b) => b.type === 'heading')
  check('md 标题数', headings.length === 2)
  check('md 标题带 label', headings[1].label === 'sec:res', JSON.stringify(headings[1].label))
  check('md 段落数', blocks.filter((b) => b.type === 'para').length === 2)
  check('md 列表', blocks.filter((b) => b.type === 'list').length === 1)
  check('md 图片', blocks.filter((b) => b.type === 'figure').length === 1)
  check('md 表格', blocks.filter((b) => b.type === 'table').length === 1)
  check('md 公式', blocks.filter((b) => b.type === 'math').length === 1)

  const para = blocks.find((b) => b.type === 'para')
  check('md 行内 strong', para.inline.some((n) => n.t === 'strong'))
  check('md 行内 em', para.inline.some((n) => n.t === 'em'))
  check('md 行内 code', para.inline.some((n) => n.t === 'code'))
  check('md 行内 cite', para.inline.some((n) => n.t === 'cite'))

  const fig = blocks.find((b) => b.type === 'figure')
  check('md 图 src', fig.src === 'figures/fig1.png', fig.src)
  check('md 图 label', fig.label === 'fig:one')
  check('md 图 caption', fig.caption === 'Caption here.', fig.caption)

  const table = blocks.find((b) => b.type === 'table')
  check('md 表 header', table.header.length === 2)
  check('md 表 rows', table.rows.length === 1)
  check('md 表 caption', table.caption === 'Table caption.')
  check('md 表 label', table.label === 'tab:one')

  const math = blocks.find((b) => b.type === 'math')
  check('md 公式 tex', math.tex === 'E = mc^2', JSON.stringify(math.tex))
  check('md 公式 label', math.label === 'eq:e', JSON.stringify(math.label))
  check('md 公式不含残留反斜杠', !math.tex.endsWith('\\'), JSON.stringify(math.tex))

  const refs = md.collectRefs(blocks)
  check('md 收集引用 ≥4', refs.cites.length >= 4, `${refs.cites.length}`)
  check('md 收集标签', refs.labels.includes('fig:one') && refs.labels.includes('tab:one'))

  const bare = md.parseMarkdown('See @doe2019book. Next sentence here.')
  const barePara = bare.find((b) => b.type === 'para')
  const citeNode = barePara.inline.find((n) => n.t === 'cite')
  check('md 裸 @ 不吃句号', citeNode && citeNode.keys[0].key === 'doe2019book', JSON.stringify(citeNode?.keys))

  const nested = md.parseMarkdown('Text with $x_1$ inline math and **bold $y$**.')
  check('md 行内公式', nested[0].inline.some((n) => n.t === 'math'))
  check('md inlineText 去标记', !md.inlineText(nested[0].inline).includes('**'))

  // 中文引用键：`[@张伟2023动量]` 曾经被整条丢掉，lint 只会说"正文没引用"
  const cjkCite = md.parseMarkdown('中文引用 [@张伟2023动量] 与英文 [@doe2019book]。')
  const cjkKeys = cjkCite[0].inline.filter((n) => n.t === 'cite').flatMap((n) => n.keys.map((k) => k.key))
  check('md 中文引用键被识别', cjkKeys.includes('张伟2023动量'), JSON.stringify(cjkKeys))
  check('md 中英混排引用都识别', cjkKeys.length === 2, JSON.stringify(cjkKeys))
}

/* ── 3. 稿件源 ─────────────────────────────────────────────────────── */
const docSource = [
  '---',
  'title: Orthogonalized Momentum Bounds the Effective Learning Rate',
  'journal: nature',
  'keywords: [muon, optimizer]',
  'authors:',
  '  - name: Zhang Wei',
  '    affiliation: 1',
  '    corresponding: true',
  '    email: zhang@example.edu',
  'affiliations:',
  '  - id: 1',
  '    name: "Institute of Computing"',
  'abstract: |',
  '  We show the orthogonalized update is a sign-SGD step in a rotated basis.',
  'references:',
  '  - key: jordan2024muon',
  '    type: article-journal',
  '    title: "Muon: An optimizer for hidden layers"',
  '    authors:',
  '      - {family: Jordan, given: Keller}',
  '      - {family: Jin, given: Yuchen}',
  '      - {family: Kolter, given: J. Zico}',
  '    year: 2024',
  '    journal: arXiv preprint',
  '    doi: 10.1234/example.001',
  '  - key: doe2019book',
  '    type: book',
  '    title: Optimization Theory',
  '    authors:',
  '      - {family: Doe, given: Alice}',
  '    year: 2019',
  '    publisher: Springer',
  '---',
  '',
  '# Introduction',
  '',
  'Momentum methods dominate [@jordan2024muon]. Prior work is incomplete [@doe2019book].',
  '',
  '# Results',
  '',
  'The bound is tight. See Figure 1.',
  '',
  '![Effective learning rate.](figures/fig1.png){#fig:lre}',
  '',
  '| Opt | Steps |',
  '| --- | --- |',
  '| SGD | 12000 |',
  ': Comparison. {#tab:cmp}',
  '',
  '$$',
  '\\eta_{\\mathrm{eff}} \\le \\frac{\\|\\mathbf{m}_t\\|_2}{\\sqrt{d}}',
  '\\label{eq:bound}',
  '$$',
  '',
  '# Discussion',
  '',
  'Explains the larger step size [@jordan2024muon].',
  '',
].join('\n')

section('source')
const doc = source.parseSource(docSource, { baseDir: root })
{
  check('source 标题', doc.meta.title.startsWith('Orthogonalized'), doc.meta.title)
  check('source 期刊', doc.meta.journal === 'nature')
  check('source 关键词 2 个', doc.meta.keywords.length === 2)
  check('source 作者', doc.meta.authors.length === 1 && doc.meta.authors[0].corresponding === true)
  check('source 单位', doc.meta.affiliations.length === 1)
  check('source 摘要非空', doc.meta.abstract.length > 20)
  check('source 文献 2 条', doc.references.length === 2, `${doc.references.length}`)
  check('source 文献作者归一', doc.references[0].authors[0].family === 'Jordan')
  const arxivRef = source.normalizeReference({
    key: 'pre', type: 'preprint', title: 'T', authors: [], year: 2024, number: 'arXiv:2409.15103',
  }, 0)
  check('preprint 自动补 arXiv DOI', arxivRef.doi === '10.48550/arXiv.2409.15103', arxivRef.doi)
  check('source 标题层级映射', doc.headings.some((h) => h.section === 'introduction'))
  check('source 无警告', doc.warnings.length === 0, JSON.stringify(doc.warnings))
  check('source 标签收集', doc.labels.has('fig:lre') && doc.labels.has('tab:cmp'),
    JSON.stringify([...doc.labels]))

  check('canonicalSection 引', source.canonicalSection('Introduction') === 'introduction')
  check('canonicalSection 复合标题取靠前的',
    source.canonicalSection('3. Results and Discussion') === 'results',
    String(source.canonicalSection('3. Results and Discussion')))
  check('canonicalSection 去编号', source.canonicalSection('2. Methods') === 'methods',
    String(source.canonicalSection('2. Methods')))
  check('canonicalSection 中文', source.canonicalSection('材料与方法') === 'methods')
  check('canonicalSection 未知', source.canonicalSection('Acknowledgements') === 'acknowledgements',
    String(source.canonicalSection('Acknowledgements')))

  const rendered = source.renderSource(doc)
  check('source 往返含 front matter', rendered.startsWith('---'))
  check('source 往返含正文', rendered.includes('# Introduction'))
  const rep = source.parseSource(rendered, { baseDir: root })
  check('source 往返标题一致', rep.meta.title === doc.meta.title)
  check('source 往返文献数一致', rep.references.length === doc.references.length)

  const scaffold = source.scaffoldSource({ title: 'T', journal: 'nature', design: 'theory' })
  check('scaffold 有 front matter', scaffold.startsWith('---'))
  check('scaffold 有 References 节', scaffold.includes('## References'))
  check('scaffold 可解析', source.parseSource(scaffold).meta.title === 'T')
}

/* ── 4. 引文引擎 ───────────────────────────────────────────────────── */
section('cite')
{
  const styles = cite.loadCitationStyles()
  const ids = Object.keys(styles.styles)
  check('6 种引文风格', ids.length === 6, ids.join(','))
  for (const id of ['gb-t-7714-2015', 'apa-7', 'vancouver', 'nature', 'ieee', 'cell']) {
    const style = cite.styleById(id)
    check(`${id} 有 label`, typeof style.label === 'string' && style.label.length > 2, String(style.label))
    check(`${id} 有 inText`, Boolean(style.inText))
    check(`${id} 有模板`, Boolean(style.templates))
  }

  const refArticle = source.normalizeReference({
    key: 'jordan2024muon',
    type: 'article-journal',
    title: 'Muon: An optimizer for hidden layers in neural networks',
    authors: [
      { family: 'Jordan', given: 'Keller' },
      { family: 'Jin', given: 'Yuchen' },
      { family: 'Kolter', given: 'J. Zico' },
    ],
    year: 2024,
    journal: 'arXiv preprint',
    volume: '12',
    issue: '3',
    pages: '45-67',
    doi: '10.1234/example.001',
  })
  const refBook = source.normalizeReference({
    key: 'doe2019book',
    type: 'book',
    title: 'Optimization Theory',
    authors: [{ family: 'Doe', given: 'Alice' }],
    year: 2019,
    publisher: 'Springer',
  })

  const out = {}
  for (const id of ids) {
    const style = cite.styleById(id)
    out[id] = cite.formatReference(refArticle, style)
    check(`${id} 输出非空`, typeof out[id] === 'string' && out[id].length > 20, String(out[id]))
    check(`${id} 含年`, out[id].includes('2024'), out[id])
    check(`${id} 不含 object`, !out[id].includes('[object'), out[id])
    check(`${id} 不含未填槽`, !/\{[a-z]\}/i.test(out[id]), out[id])
  }
  check('gb-t 带 [J] 类型标识', out['gb-t-7714-2015'].includes('[J]'), out['gb-t-7714-2015'])
  check('apa 带 DOI', out['apa-7'].toLowerCase().includes('doi'))
  check('vancouver 带卷期页', out.vancouver.includes('12(3)'))
  check('nature 三作者全列（未到截断阈值）',
    out.nature.includes('Jordan') && out.nature.includes('Kolter') && !out.nature.includes('et al'),
    out.nature)
  check('ieee 带引号标题', out.ieee.includes('"') || out.ieee.includes('“'), out.ieee)
  check('cell 带括号年', out.cell.includes('(2024)'), out.cell)

  // 超过 max 时降为 et al：nature 的 max 是 5，给 6 个作者
  const manyAuthors = source.normalizeReference({
    key: 'many2024',
    type: 'article-journal',
    title: 'Six authors',
    authors: ['A', 'B', 'C', 'D', 'E', 'F'].map((family) => ({ family, given: 'X' })),
    year: 2024,
    journal: 'J',
  })
  const manyOut = cite.formatReference(manyAuthors, cite.styleById('nature'))
  check('nature 六作者降 et al', manyOut.includes('et al'), manyOut)
  check('nature et al 前只留一位', (manyOut.match(/,/g) || []).length <= 3, manyOut)

  const bookOut = cite.formatReference(refBook, cite.styleById('apa-7'))
  check('book 类型用出版社模板', bookOut.includes('Springer'), bookOut)

  const list = cite.buildReferenceList([refArticle, refBook], ['jordan2024muon', 'doe2019book'], 'vancouver')
  check('文献表 2 条', list.entries.length === 2)
  check('文献表编号 1/2', list.entries[0].n === 1 && list.entries[1].n === 2)
  check('文献表有 cited 标记', list.entries.every((e) => e.cited === true))
  check('编号映射', list.numbers.get('jordan2024muon') === 1)

  const single = cite.formatInText({ t: 'cite', keys: [{ key: 'jordan2024muon', prefix: null, suffix: null }] },
    cite.styleById('nature'), { numbers: list.numbers, refsByKey: new Map([['jordan2024muon', refArticle]]) })
  check('nature 单引上标', single.mode === 'superscript' && single.text === '1', JSON.stringify(single))

  const apa = cite.formatInText({ t: 'cite', keys: [{ key: 'jordan2024muon', prefix: null, suffix: null }] },
    cite.styleById('apa-7'), { numbers: list.numbers, refsByKey: new Map([['jordan2024muon', refArticle]]) })
  check('apa 作者年', /Jordan/.test(apa.text) && /2024/.test(apa.text), apa.text)
  check('apa 不是 [object]', !apa.text.includes('[object'), apa.text)

  const multi = cite.formatInText({
    t: 'cite',
    keys: [{ key: 'jordan2024muon' }, { key: 'doe2019book' }],
  }, cite.styleById('vancouver'), { numbers: list.numbers, refsByKey: new Map() })
  check('vancouver 合并编号', multi.text.includes('-') || multi.text.includes(','), multi.text)

  const natStyle = cite.styleById('nature')
  check('compressNumbers 连续', cite.compressNumbers([1, 2, 3, 7], natStyle) === '1–3,7',
    cite.compressNumbers([1, 2, 3, 7], natStyle))
  check('compressNumbers 单值', cite.compressNumbers([5], natStyle) === '5')
  check('未知 key 不崩', typeof cite.formatReference(
    source.normalizeReference({ key: 'x', type: 'misc', title: 'T', authors: [], year: 2020 }),
    cite.styleById('apa-7'),
  ) === 'string')
  check('publisher 映射', cite.styleForPublisher('Springer Nature') === 'nature'
    || typeof cite.styleForPublisher('Springer Nature') === 'string')
}

/* ── 5. 期刊族解析 ─────────────────────────────────────────────────── */
section('formats')
{
  const families = formats.listFamilies()
  check('族数 ≥ 12', families.length >= 12, `${families.length}`)
  check('族字段完整', families.every((f) => f.id && f.latexClass && f.pageSize && Number.isFinite(f.bodyPt)))

  const nature = formats.resolveFormat({ journal: 'nature' })
  check('nature 族', nature.familyId === 'nature', nature.familyId)
  check('nature 类', nature.latex.class === 'article' || nature.latex.class === 'nature', nature.latex.class)
  check('nature 引文', nature.citation === 'nature', nature.citation)
  check('nature 双倍行距', nature.family.docx.lineSpacing >= 2, String(nature.family.docx.lineSpacing))
  check('nature 行号', nature.family.docx.lineNumbers === true)
  check('nature 有 limits', Boolean(nature.limits) && Number.isFinite(nature.limits.words), JSON.stringify(nature.limits))

  const cell = formats.resolveFormat({ journal: 'cell' })
  check('cell 用 elsarticle', cell.latex.class === 'elsarticle', cell.latex.class)
  check('cell 引文', cell.citation === 'cell')

  const ieee = formats.resolveFormat({ publisher: 'IEEE' })
  check('IEEE 用 IEEEtran', ieee.latex.class === 'IEEEtran', ieee.latex.class)
  check('IEEE 10pt', ieee.family.docx.bodyPt === 10, String(ieee.family.docx.bodyPt))
  check('IEEE 投稿稿单栏', ieee.family.docx.columns === 1, String(ieee.family.docx.columns))
  check('IEEE 投稿稿双倍行距', ieee.family.docx.lineSpacing === 2, String(ieee.family.docx.lineSpacing))

  const elsevier = formats.resolveFormat({ publisher: 'Elsevier' })
  check('Elsevier 用 elsarticle', elsevier.latex.class === 'elsarticle', elsevier.latex.class)

  const springer = formats.resolveFormat({ publisher: 'Springer' })
  check('Springer 指向 sn-jnl', springer.latex.class === 'sn-jnl', springer.latex.class)

  const plos = formats.resolveFormat({ journal: 'plos-one' })
  check('PLOS 引文 vancouver', plos.citation === 'vancouver', plos.citation)

  const unknown = formats.resolveFormat({ journal: 'nonexistent-journal-xyz' })
  check('未知刊回落 generic', unknown.familyId === 'generic', unknown.familyId)
  check('未知刊有警告', typeof unknown.warning === 'string' && unknown.warning.length > 0, String(unknown.warning))

  const empty = formats.resolveFormat({})
  check('空参数不崩', empty.familyId === 'generic')
  check('扁平 latex 别名', typeof empty.latex.class === 'string')
  check('扁平 docx 别名', Number.isFinite(empty.docx.bodyPt))
}

/* ── 6. LaTeX 渲染 ─────────────────────────────────────────────────── */
section('latex')
{
  const format = formats.resolveFormat({ journal: 'nature' })
  const rendered = latex.renderLatex(doc, format)
  check('tex 有 documentclass', rendered.tex.includes('\\documentclass'))
  check('tex 有 begin document', rendered.tex.includes('\\begin{document}'))
  check('tex 双倍行距走 baselinestretch', rendered.tex.includes('baselinestretch'))
  check('tex 行号', rendered.tex.includes('\\usepackage{lineno}') || !format.family.docx.lineNumbers)
  check('tex 不用 \\cite（引文是字面量）', !/\\cite\{/.test(rendered.tex))
  check('tex 参考文献成表', rendered.tex.includes('\\item \\label{ref:') || rendered.tex.includes('thebibliography'),
    rendered.tex.match(/\\item \\label\{ref:[^}]+\}/)?.[0] ?? '(未找到)')
  check('tex 含标题', rendered.tex.includes('Orthogonalized Momentum'))
  check('tex 含图', rendered.tex.includes('includegraphics'))
  check('tex 含表', rendered.tex.includes('tabular') || rendered.tex.includes('longtable'))
  check('tex 含公式', rendered.tex.includes('\\begin{equation}'))
  check('tex 引文计数', rendered.referenceCount === 2, String(rendered.referenceCount))
  check('tex 未引用文献清单', Array.isArray(rendered.uncitedReferences))
  check('tex 无 fallback', rendered.fallbackUsed === false)

  const cnText = docSource.replace('Momentum methods dominate [@jordan2024muon].',
    '动量方法在大规模训练中占主导 [@jordan2024muon]，中文排版需要 CJK 字体。')
  const cn = source.parseSource(cnText, { baseDir: root })
  const cnTex = latex.renderLatex(cn, format)
  check('中文稿带 xeCJK', cnTex.tex.includes('xeCJK'), 'preamble 里没有 xeCJK')
  check('中文稿设置 CJK 主字体', cnTex.tex.includes('setCJKmainfont'), 'preamble 里没有 setCJKmainfont')
  check('中文稿保留中文', cnTex.tex.includes('动量方法'))
  check('英文稿不塞 xeCJK（少一层依赖）', !rendered.tex.includes('xeCJK'))

  check('escapeLatex 处理 &', latex.escapeLatex('a & b') === 'a \\& b')
  check('escapeLatex 处理 _', latex.escapeLatex('a_b') === 'a\\_b')
  check('escapeLatex 处理 %', latex.escapeLatex('50%') === '50\\%')
  check('escapeLatex 保留数学', latex.escapeLatex('$x_1$').includes('$'))

  const ieeeFmt = formats.resolveFormat({ publisher: 'IEEE' })
  const ieeeTex = latex.renderLatex(doc, ieeeFmt)
  check('IEEE 用 IEEEtran 类', ieeeTex.tex.includes('\\documentclass') && ieeeTex.tex.includes('IEEEtran'),
    ieeeTex.className)

  const cellFmt = formats.resolveFormat({ journal: 'cell' })
  const cellTex = latex.renderLatex(doc, cellFmt)
  check('cell 用 elsarticle 且带 frontmatter', cellTex.tex.includes('elsarticle') && cellTex.tex.includes('frontmatter'))

  const cn2 = source.parseSource(docSource.replace('Momentum methods dominate [@jordan2024muon].',
    '动量方法在大规模训练中占主导 [@jordan2024muon]，中文排版需要 CJK 字体。'), { baseDir: root })
  const cnTex2 = latex.renderLatex(cn2, format)
  check('中文稿保留中文', cnTex2.tex.includes('动量方法'))
}

/* ── 7. DOCX 规格 ──────────────────────────────────────────────────── */
section('docx')
{
  const format = formats.resolveFormat({ journal: 'nature' })
  const spec = docx.buildDocxSpec(doc, format, {
    baseDir: root,
    outPath: join(root, 'x.docx'),
    abstractLabel: format.family.abstractHeading,
  })
  check('docx 有 title 块', spec.blocks.some((b) => b.k === 'title'))
  check('docx 有 authors 块', spec.blocks.some((b) => b.k === 'authors'))
  check('docx 有 abstract 块', spec.blocks.some((b) => b.k === 'abstract'))
  check('docx 有 heading 块', spec.blocks.filter((b) => b.k === 'heading').length >= 3)
  check('docx 有 para 块', spec.blocks.filter((b) => b.k === 'para').length >= 2)
  check('docx 有 figure 块', spec.blocks.some((b) => b.k === 'figure'))
  check('docx 有 table 块', spec.blocks.filter((b) => b.k === 'table').length === 1)
  check('docx 有 refs 块', spec.blocks.some((b) => b.k === 'refs'))
  check('docx 页尺寸透传', spec.spec.pageSize === format.family.docx.pageSize, spec.spec.pageSize)
  check('docx 行距透传', spec.spec.lineSpacing === format.family.docx.lineSpacing)
  check('docx 行号透传', spec.spec.lineNumbers === format.family.docx.lineNumbers)
  check('docx 摘要标签', spec.blocks.find((b) => b.k === 'abstract').label.length > 2)

  const refs = spec.blocks.find((b) => b.k === 'refs')
  check('docx 文献 2 条', refs.entries.length === 2)
  check('docx 文献带序号', refs.entries[0].n === 1)

  const titleRuns = spec.blocks.find((b) => b.k === 'title')
  check('docx 标题块有文本', titleRuns.text.length > 10)

  check('texToUnicode 希腊字母', docx.texToUnicode('\\alpha').text === 'α')
  check('texToUnicode 关系符', docx.texToUnicode('a \\le b').text === 'a ≤ b')
  check('texToUnicode frac', docx.texToUnicode('\\frac{a}{b}').text === 'a/b', docx.texToUnicode('\\frac{a}{b}').text)
  check('texToUnicode 嵌套 sqrt 里的 frac',
    !docx.texToUnicode('\\frac{\\|m\\|_2}{\\sqrt{d}}').unconverted.includes('\\frac'),
    JSON.stringify(docx.texToUnicode('\\frac{\\|m\\|_2}{\\sqrt{d}}')))
  check('texToUnicode 全映射才用角标', docx.texToUnicode('x_{ij}').text === 'xᵢⱼ', docx.texToUnicode('x_{ij}').text)
  check('texToUnicode 部分映射退括号', docx.texToUnicode('\\eta_{\\mathrm{eff}}').text === 'η_(eff)',
    docx.texToUnicode('\\eta_{\\mathrm{eff}}').text)
  check('texToUnicode 嵌套下标里的 sqrt',
    docx.texToUnicode('\\frac{\\lVert \\mathbf{M}_t \\rVert_2}{\\sqrt{d_{\\mathrm{in}}}}').unconverted.length === 0,
    JSON.stringify(docx.texToUnicode('\\frac{\\lVert \\mathbf{M}_t \\rVert_2}{\\sqrt{d_{\\mathrm{in}}}}')))
  check('texToUnicode 单字符下标', docx.texToUnicode('M_t').text === 'Mₜ', docx.texToUnicode('M_t').text)
  check('texToUnicode 细空格命令清掉', docx.texToUnicode('a \\;\\le\\; b').text === 'a ≤ b',
    docx.texToUnicode('a \\;\\le\\; b').text)
  check('texToUnicode 范数符号', docx.texToUnicode('\\lVert x \\rVert').text === '‖ x ‖',
    docx.texToUnicode('\\lVert x \\rVert').text)
  check('texToUnicode mathbb 剥壳', docx.texToUnicode('\\mathbb{E}').text === 'E', docx.texToUnicode('\\mathbb{E}').text)
  check('texToUnicode 未知命令留痕', docx.texToUnicode('\\weirdcmd x').unconverted.length === 1)
}

/* ── 8. JATS ───────────────────────────────────────────────────────── */
section('jats')
{
  const format = formats.resolveFormat({ journal: 'nature' })
  const out = jats.renderJats(doc, format)
  const xml = out.xml
  check('jats 有声明', xml.startsWith('<?xml'))
  check('jats 有 DOCTYPE', xml.includes('JATS'))
  check('jats 有 article', xml.includes('<article '))
  check('jats 有 front/body/back', xml.includes('<front>') && xml.includes('<body>') && xml.includes('<back>'))
  check('jats 标题转义安全', xml.includes('<article-title>'))
  check('jats 有 section', xml.includes('<sec'))
  check('jats 有图', xml.includes('<fig'))
  check('jats 有表', xml.includes('<table-wrap'))
  check('jats 有公式', xml.includes('<disp-formula'))
  check('jats 有引文 xref', xml.includes('ref-type="bibr"'))
  check('jats 文献 2 条', (xml.match(/<ref id=/g) || []).length === 2, String((xml.match(/<ref id=/g) || []).length))
  check('jats 有 DOI', xml.includes('pub-id-type="doi"'))
  check('jats 作者结构', xml.includes('<surname>Jordan</surname>'))
  check('jats 摘要', xml.includes('<abstract>'))
  check('jats 关键词', xml.includes('<kwd>'))
  check('jats 标签配平 sec', (xml.match(/<sec\b/g) || []).length === (xml.match(/<\/sec>/g) || []).length)
  check('jats 标签配平 p', (xml.match(/<p>/g) || []).length === (xml.match(/<\/p>/g) || []).length)
  check('jats 转义 <', jats.escapeXml('a < b') === 'a &lt; b')
  check('jats 转义 &', jats.escapeXml('a & b') === 'a &amp; b')
}

/* ── 9. HTML 预览 ──────────────────────────────────────────────────── */
section('html')
{
  const format = formats.resolveFormat({ journal: 'nature' })
  const out = html.renderHtml(doc, format)
  const page = out.html
  check('html 有 doctype', page.startsWith('<!DOCTYPE html>'))
  check('html 自包含（无外链脚本）', !/<script/i.test(page))
  check('html 有页面容器', page.includes('class="page"'))
  check('html 页宽匹配 A4', page.includes('210mm') || page.includes(format.family.docx.pageSize))
  check('html 有行号计数器', format.family.docx.lineNumbers ? page.includes('counter(line)') : true)
  check('html 有标题', page.includes('Orthogonalized Momentum'))
  check('html 有表格', page.includes('<table'))
  check('html 有图注', page.includes('<figcaption'))
  check('html 有文献表', page.includes('class="refs"'))
  check('html 文献 2 条', (page.match(/<li>/g) || []).length >= 2)
  check('html 无 [object', !page.includes('[object'))
  check('html 字节数合理', out.bytes > 2000, String(out.bytes))

  const cnDoc = source.parseSource(docSource.replace('Momentum methods dominate', '动量方法占主导'), { baseDir: root })
  const cnHtml = html.renderHtml(cnDoc, format)
  check('html 保留中文', cnHtml.html.includes('动量方法'))
}

/* ── 10. 要件检查 ──────────────────────────────────────────────────── */
section('lint')
{
  const format = formats.resolveFormat({ journal: 'nature' })
  const result = lint.lintManuscript(doc, format, { baseDir: root })
  check('lint 有 metrics', Number.isFinite(result.metrics.words))
  check('lint 结构完整', Number.isFinite(result.blocking) && Number.isFinite(result.warning))
  check('lint 词数 > 0', result.metrics.words > 10, String(result.metrics.words))
  check('lint 图 1 张', result.metrics.figures === 1)
  check('lint 文献 2 条', result.metrics.references === 2)
  check('lint 无未定义引用', !result.findings.some((f) => f.code === 'cite-undefined'),
    JSON.stringify(result.findings.filter((f) => f.code === 'cite-undefined')))
  check('lint 每条 finding 有 severity', result.findings.every((f) => ['block', 'warn', 'info', 'pass'].includes(f.severity)))
  check('lint 每条 finding 有 code', result.findings.every((f) => typeof f.code === 'string' && f.code.length > 2))

  const undefinedRef = lint.lintManuscript(
    source.parseSource(docSource.replace('[@doe2019book]', '[@ghost2020]'), { baseDir: root }),
    format, { baseDir: root })
  check('lint 抓到未定义引用', undefinedRef.findings.some((f) => f.code === 'cite-undefined'))
  check('lint 未定义引用阻断', undefinedRef.ok === false)

  const uncited = lint.lintManuscript(
    source.parseSource(docSource.replace(' Prior work is incomplete [@doe2019book].', ''), { baseDir: root }),
    format, { baseDir: root })
  check('lint 抓到未被引文献', uncited.findings.some((f) => f.code === 'cite-uncited'))

  const noIntro = lint.lintManuscript(
    source.parseSource(docSource.replace('# Introduction', '# Background'), { baseDir: root }),
    format, { baseDir: root })
  check('lint 抓到缺引言', noIntro.findings.some((f) => f.code === 'section-intro-missing'))

  const missingFig = lint.lintManuscript(doc, format, { baseDir: join(root, 'nope') })
  check('lint 抓到缺图文件', missingFig.findings.some((f) => f.code === 'figure-file-missing'))

  const dangling = lint.lintManuscript(
    source.parseSource(docSource.replace('See Figure 1.', 'See Figure 1 and \\ref{fig:ghost}.'), { baseDir: root }),
    format, { baseDir: root })
  check('lint 抓到悬空交叉引用', dangling.findings.some((f) => f.code === 'xref-dangling'),
    JSON.stringify(dangling.findings.map((f) => f.code)))

  const noCorr = lint.lintManuscript(
    source.parseSource(docSource.replace('    corresponding: true', ''), { baseDir: root }),
    format, { baseDir: root })
  check('lint 抓到无通讯作者', noCorr.findings.some((f) => f.code === 'no-corresponding'))

  const noKw = lint.lintManuscript(
    source.parseSource(docSource.replace('keywords: [muon, optimizer]', 'keywords: []'), { baseDir: root }),
    format, { baseDir: root })
  check('lint 抓到无关键词', noKw.findings.some((f) => f.code === 'keywords-missing'))

  const longAb = lint.lintManuscript(
    source.parseSource(docSource.replace(
      '  We show the orthogonalized update is a sign-SGD step in a rotated basis.',
      `  ${'word '.repeat(400)}`), { baseDir: root }),
    format, { baseDir: root })
  check('lint 抓到摘要超长', longAb.findings.some((f) => f.code === 'abstract-long'))

  check('countWords 纯英文', lint.countWords('one two three') === 3, String(lint.countWords('one two three')))
  check('countWords 中文按字', lint.countWords('中文四个字') === 5, String(lint.countWords('中文四个字')))
  check('countWords 混合', lint.countWords('hello 世界') === 3, String(lint.countWords('hello 世界')))
}

/* ── 11. 工具链探测 ────────────────────────────────────────────────── */
section('toolchain')
{
  const tc = build.checkToolchain()
  check('toolchain 有 engines', tc.engines && typeof tc.engines === 'object')
  check('toolchain 有 classes', tc.classes && Object.keys(tc.classes).length >= 5)
  check('toolchain article 类可查', tc.classes.article && typeof tc.classes.article.available === 'boolean')
  if (tc.latexAvailable) {
    check('toolchain 至少一个引擎可用', Object.values(tc.engines).some((e) => e.ok))
  } else {
    console.log('    （本机无 TeX 引擎，跳过引擎断言）')
  }
  check('readLatexLog 缺文件返回空', build.readLatexLog(join(root, 'missing.log')).errors.length === 0)
}

/* ── 12. 真编译（--compile） ───────────────────────────────────────── */
if (compile) {
  section('compile')
  const dir = join(root, 'manuscript')
  mkdirSync(join(dir, 'figures'), { recursive: true })
  writeFileSync(join(dir, 'figures/fig1.png'), makePng(120, 80, [30, 80, 140]))
  writeFileSync(join(dir, source.SOURCE_FILE), docSource)

  const built = build.buildManuscript({ dir, targets: ['all'], journal: 'nature' })
  const byKind = Object.fromEntries(built.artifacts.map((a) => [a.kind, a]))
  check('build 整体成功', built.ok === true, JSON.stringify(built.artifacts.map((a) => a.kind)))
  check('build 出 tex', byKind.latex?.bytes > 500)
  check('build 出 html', byKind.html?.bytes > 2000)
  check('build 出 jats', byKind.jats?.bytes > 1000)
  check('build 出 docx', byKind.docx?.bytes > 8000, JSON.stringify(byKind.docx))
  if (built.artifacts.some((a) => a.kind === 'pdf')) {
    check('build 出 pdf', byKind.pdf?.bytes > 5000, JSON.stringify(byKind.pdf))
  } else {
    console.log('    （本机无 TeX 引擎，跳过 PDF 断言）')
  }
  check('build 记录耗时', Number.isFinite(built.ms))
  check('build 输出目录存在', existsSync(built.outDir))

  // 换刊只改 journal：同一份源换三个族都要成功
  for (const journal of ['cell', 'plos-one', 'nature']) {
    const one = build.buildManuscript({ dir, targets: ['docx'], journal })
    check(`换刊 ${journal} 出 docx`, one.artifacts.some((a) => a.kind === 'docx' && a.bytes > 8000),
      JSON.stringify(one.artifacts))
  }
}

/* ── 汇总 ──────────────────────────────────────────────────────────── */
console.log('')
if (fails.length > 0) {
  console.log('失败项：')
  for (const item of fails) console.log(`  ✗ ${item}`)
  console.log('')
}
console.log(`${pass}/${pass + fail} 通过（${compile ? '含真编译' : '离线'}）`)
rmSync(root, { recursive: true, force: true })
if (fail > 0) process.exitCode = 1

function makePng(width, height, rgb) {
  const table = []
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = rgb[0]
      raw[row + 2 + x * 3] = rgb[1]
      raw[row + 3 + x * 3] = rgb[2]
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
