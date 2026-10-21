#!/usr/bin/env node
/**
 * 论文产出端到端：一个课题的真实分析 → 装配 → 要件检查 → 四件出稿。
 *
 * 这条链和 science_manuscript_build 用的是同一套代码，所以它绿了不等于"论文写得好"，
 * 只等于"从数据到投稿级 PDF 的机械环节没有断"。判断类的东西（论证、贡献、新颖性）
 * 在 M2 的审计里，不在这里。
 *
 * 用法：
 *   node scripts/e2e-paper-run.mjs            # 跑整套，用最近一个有分析的课题
 *   node scripts/e2e-paper-run.mjs --keep     # 保留临时稿件目录
 *   node scripts/e2e-paper-run.mjs --project <id> --manuscript <id>
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const SCIENCE_LIB = resolve(REPO, 'dsh-science', 'lib')

const args = process.argv.slice(2)
const keep = args.includes('--keep')
const projectArg = args.includes('--project') ? args[args.indexOf('--project') + 1] : null
const manuscriptArg = args.includes('--manuscript') ? args[args.indexOf('--manuscript') + 1] : null

const home = process.env.DSH_HOME || join(homedir(), '.deepscient')

let failed = 0
const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  if (!ok) failed += 1
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`)
}

const { ScienceStore } = await import(`file://${join(SCIENCE_LIB, 'science', 'store.js').replace(/\\/g, '/')}`)
const { apply } = await import(`file://${join(SCIENCE_LIB, 'manuscript-tools.js').replace(/\\/g, '/')}`)

const store = new ScienceStore({ dbPath: join(home, 'science', 'science.db') })
const registry = new Map()
apply({
  tools: { register: (tool) => registry.set(tool.name, tool) },
  get: (key) => (key === 'scienceRuntime' ? { store } : key === 'logger' ? console : null),
})

/* 选课题：默认取最近一个既有分析又有图的课题——没有就没得测。 */
const projects = store.db.prepare('SELECT id, title FROM project ORDER BY updated_at DESC').all()
const candidate = projectArg
  ? projects.find((row) => row.id === projectArg)
  : projects.find((row) => {
    const a = store.db.prepare('SELECT COUNT(*) c FROM analysis WHERE project_id = ?').get(row.id).c
    const f = store.db.prepare('SELECT COUNT(*) c FROM figure_spec WHERE project_id = ?').get(row.id).c
    return a > 0 && f > 0
  })

console.log('\n一、选题与数据')
if (!candidate) {
  console.log('  ✗ 找不到既有分析又有图的课题；先跑 science_stats 与 science_figure')
  process.exit(1)
}
console.log(`  课题：${candidate.id}`)
check('课题里有成功的统计', true)

const tmpRoot = mkdtempSync(join(tmpdir(), 'e2e-paper-'))
const manuscriptId = manuscriptArg || 'e2e-paper'
const msDir = join(tmpRoot, manuscriptId)

console.log('\n二、建稿并装配')
const manuscriptNew = registry.get('science_manuscript_new')
await manuscriptNew.execute({
  // 绝对路径当 id 传：建稿工具对含分隔符的输入直接 resolve，不会往 manuscripts 根里塞
  id: msDir,
  title: 'A generated manuscript used to verify the end-to-end paper pipeline',
  journal: 'plos-one',
  keywords: ['pipeline', 'reproducibility'],
  authorName: 'E2E Bot',
  projectId: candidate.id,
})
check('稿件骨架已建', existsSync(join(msDir, 'paper.md')))

/* 往骨架里填一段真正能排版的最小正文：不填的话出件只有两三页，
   测不出「完整论文」的规模，也测不到引文闭环。 */
const SENTENCES = [
  'Sleep loss is one of the most reversible stressors in modern life, and its cognitive cost has been documented for decades.',
  'The dominant summary of that literature is that deprivation makes people slower and less accurate across the board.',
  'That summary is useful for public communication and less useful for planning a study, because it does not say which constructs are hit hardest.',
  'Basic attention and working memory are usually distinguished: the first detects a clearly defined stimulus, the second holds and manipulates information.',
  'Meta-analytic work suggests the two are not equally affected, with heavier demands on prefrontal systems showing larger decrements.',
  'Dose-response designs further show that impairment accumulates with time awake rather than appearing as a single step.',
]
const filler = (heading, paragraphs, citeKey) => {
  const body = []
  for (let i = 0; i < paragraphs; i += 1) {
    const block = SENTENCES.map((sentence, index) => (index === 0 && i === 0 ? `${sentence} [@${citeKey}]` : sentence)).join(' ')
    body.push(block)
  }
  return `## ${heading}\n\n${body.join('\n\n')}\n\n`
}

const referenceAdd = registry.get('science_reference_add')
const added = await referenceAdd.execute({
  dir: msDir,
  items: [
    {
      title: 'A demo reference used by the end-to-end pipeline check',
      authors: [{ family: 'Demo', given: 'A' }],
      year: 2024,
      journal: 'Journal of Pipeline Verification',
      doi: '10.0000/demo.2024',
    },
    {
      title: 'A second demo reference used by the end-to-end pipeline check',
      authors: [{ family: 'Sample', given: 'B' }],
      year: 2023,
      journal: 'Journal of Pipeline Verification',
      doi: '10.0000/demo.2023',
    },
  ],
})
check('参考文献入库', added.added.length === 2, added.added.join(', '))
const reAdd = await referenceAdd.execute({
  dir: msDir,
  items: [{ title: 'A demo reference used by the end-to-end pipeline check', authors: [{ family: 'Demo' }], year: 2024, doi: '10.0000/DEMO.2024' }],
})
check('引文去重（DOI 大小写不敏感）', reAdd.added.length === 0 && reAdd.skipped.length === 1)

/* 正文只引第一个 key：第二个故意留成"未被引用"，看 lint 会不会报 cite-uncited。 */
const citeKey = added.added[0]
const scaffold = readFileSync(join(msDir, 'paper.md'), 'utf8')
const filled = scaffold
  .replace(/## Introduction[\s\S]*?(?=## )/, filler('Introduction', 3, citeKey))
  .replace(/## Methods[\s\S]*?(?=## )/, filler('Methods', 3, citeKey))
  .replace(/## Discussion[\s\S]*?(?=## )/, filler('Discussion', 3, citeKey))
writeFileSync(join(msDir, 'paper.md'), filled, 'utf8')

const assemble = registry.get('science_manuscript_assemble')
const first = await assemble.execute({ dir: msDir, projectId: candidate.id })
check('装配写入分析', first.analyses > 0, `${first.analyses} 条`)
check('装配写入图', first.figures > 0, `${first.figures} 张`)
check('标签可用', first.labels.includes('tab:results') && first.labels.some((l) => l.startsWith('fig:')))

const afterFirst = readFileSync(join(msDir, 'paper.md'), 'utf8')
const second = await assemble.execute({ dir: msDir, projectId: candidate.id })
const afterSecond = readFileSync(join(msDir, 'paper.md'), 'utf8')
check('装配幂等（连跑两次字节相同）', afterFirst === afterSecond)

/* 图必须落到稿件自己的 figures/ 里，否则换台机器就出不了稿。 */
const figuresDir = join(msDir, 'figures')
const figureFiles = existsSync(figuresDir) ? readdirSync(figuresDir) : []
check('图已复制进稿件目录', figureFiles.length > 0, figureFiles.join(', '))

console.log('\n三、要件检查与出件')
const lint = registry.get('science_manuscript_lint')
const lintResult = await lint.execute({ dir: msDir })
check('lint 无阻断项', lintResult.blocking === 0, `blocking=${lintResult.blocking}`)
if (lintResult.blocking > 0) {
  for (const finding of (lintResult.findings ?? []).filter((f) => f.severity === 'block')) {
    console.log(`      ${finding.code}: ${String(finding.message).slice(0, 110)}`)
  }
}

const build = registry.get('science_manuscript_build')
const built = await build.execute({ dir: msDir, targets: ['all'] })
const byKind = new Map((built.artifacts ?? []).map((a) => [a.kind, a]))
for (const kind of ['latex', 'pdf', 'docx', 'jats', 'html']) {
  const artifact = byKind.get(kind)
  check(`产物 ${kind}`, Boolean(artifact?.path) && existsSync(artifact.path), artifact?.path ? `${artifact.bytes} B` : artifact?.hint ?? '')
}

const pdfPath = byKind.get('pdf')?.path
if (pdfPath && existsSync(pdfPath)) {
  check('PDF 体积像真稿', statSync(pdfPath).size > 60_000, `${statSync(pdfPath).size} B`)
  try {
    const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' })
    const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0)
    check('PDF 页数 ≥ 5', pages >= 5, `${pages} 页`)
  } catch {
    check('PDF 页数 ≥ 5', false, 'pdfinfo 不可用（MiKTeX 里缺则跳过）')
  }
  try {
    const textPath = join(tmpRoot, 'extract.txt')
    execFileSync('pdftotext', ['-layout', pdfPath, textPath], { stdio: 'ignore' })
    const text = readFileSync(textPath, 'utf8')
    check('PDF 里能抽到表注', /Table 1|表 1/.test(text))
    check('PDF 里能抽到图注', /Figure 1|图 1/.test(text))
    check('PDF 里能抽到参考文献', /References|参考文献/.test(text))
  } catch {
    check('PDF 文字可抽取', false, 'pdftotext 不可用')
  }
}

console.log('\n四、清理')
if (!keep) rmSync(tmpRoot, { recursive: true, force: true })
else console.log(`  保留：${tmpRoot}`)

const passed = checks.filter((item) => item.ok).length
console.log(`\n论文链路：${passed}/${checks.length} 通过`)
if (failed > 0) {
  console.log('失败项：')
  for (const item of checks.filter((c) => !c.ok)) console.log(`  - ${item.name} ${item.detail}`)
  process.exit(1)
}
writeFileSync(join(HERE, '.e2e-paper-last.json'), `${JSON.stringify({ at: Date.now(), project: candidate.id, checks }, null, 2)}\n`, 'utf8')
