#!/usr/bin/env node
/**
 * 工具层冒烟：不给真 dsh 也能验。
 *
 * 用一个假的 ctx 把 manuscript-tools 的四个工具注册进来，逐个真调一遍，
 * 断言返回的字段形状和落盘结果。DSH_HOME 指到临时目录，不碰真实研究工作区。
 *
 *   node scripts/smoke-manuscript-tools.mjs
 */
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'ms-smoke-'))
process.env.DSH_HOME = home

let pass = 0
let fail = 0
const fails = []
function check(label, cond, detail = '') {
  if (cond) { pass += 1; return }
  fail += 1
  fails.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

const mod = await import('../lib/manuscript-tools.js')
check('插件导出 name', mod.name === 'dsh-science-manuscript', String(mod.name))
check('插件 inject tools', Array.isArray(mod.inject) && mod.inject.includes('tools'))

const registered = new Map()
const ctx = {
  get: () => undefined,
  tools: {
    register: (tool) => registered.set(tool.name, tool),
  },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}

mod.apply(ctx)
check('注册 4 个工具', registered.size === 4, [...registered.keys()].join(','))
for (const name of ['science_manuscript_new', 'science_manuscript_lint', 'science_manuscript_build', 'science_format_check']) {
  const tool = registered.get(name)
  check(`${name} 存在`, Boolean(tool))
  check(`${name} 有 description`, typeof tool.description === 'string' && tool.description.length > 40)
  check(`${name} 有 parameters`, Boolean(tool.parameters) && Object.keys(tool.parameters).length > 0)
  check(`${name} 有 output.schema`, Boolean(tool.output?.schema))
  check(`${name} 有 render`, typeof tool.output?.render === 'function')
  check(`${name} required 只出现在必填项`,
    Object.values(tool.parameters).every((param) => param.required !== false))
}

/* ── new ───────────────────────────────────────────────────────────── */
const created = await registered.get('science_manuscript_new').execute({
  id: 'smoke-paper',
  title: 'Orthogonalized Momentum Bounds the Effective Learning Rate',
  journal: 'nature',
  design: 'theory',
  keywords: ['muon', 'optimizer'],
  authorName: 'Zhang Wei',
})
check('new 返回 id', created.id === 'smoke-paper', String(created.id))
check('new 落了 paper.md', existsSync(created.sourcePath))
check('new 落了 references.yml', existsSync(created.referencesPath))
check('new 建了 figures 目录', existsSync(join(created.dir, 'figures')))
check('new 建了 build 目录', existsSync(join(created.dir, 'build')))
check('new 族正确', created.familyId === 'nature', String(created.familyId))
check('new 引文风格', created.citationStyle === 'nature', String(created.citationStyle))
check('new 有 TODO 计数', created.todoCount > 0, String(created.todoCount))
check('new 章节列表非空', created.sections.length >= 3, JSON.stringify(created.sections))
check('new 源文件带 front matter', readFileSync(created.sourcePath, 'utf8').startsWith('---'))

const again = await registered.get('science_manuscript_new').execute({ id: 'smoke-paper' }).then(
  () => ({ threw: false }),
  (error) => ({ threw: true, message: error.message }),
)
check('new 覆盖时拒绝', again.threw === true, JSON.stringify(again))

const forced = await registered.get('science_manuscript_new').execute({ id: 'smoke-paper', overwrite: true })
check('new overwrite 成功', forced.id === 'smoke-paper')

/* ── lint ──────────────────────────────────────────────────────────── */
const linted = await registered.get('science_manuscript_lint').execute({ id: 'smoke-paper' })
check('lint 返回 ok 布尔', typeof linted.ok === 'boolean')
check('lint 返回 metrics', Boolean(linted.metrics) && Number.isFinite(linted.metrics.words))
check('lint 返回 findings 数组', Array.isArray(linted.findings))
check('lint 每条有 severity', linted.findings.every((f) => ['block', 'warn', 'info', 'pass'].includes(f.severity)))
/* 骨架稿该被"标记"，不一定是被 block。
   这条早先断言 ok === false，实际上依赖了一个缺陷：解析器没剥 HTML 注释，
   于是注释里的示例 `[@key]` / `\ref{fig:name}` 被当成真引用，凭空造出两条永远修不掉的 block。
   注释剥掉之后，全 TODO 的骨架只有 warn 级（TODO 标题、缺摘要、缺关键词）——
   这正是应有的行为：稿件没写完不等于有硬伤。 */
check('lint 骨架稿应被标记（warn 或 block）', linted.ok === false || linted.warning > 0,
  `blocking=${linted.blocking} warning=${linted.warning}`)
check('lint 不会凭空报"引用不存在"', !linted.findings.some((f) => f.code === 'cite-undefined'),
  linted.findings.filter((f) => f.code === 'cite-undefined').map((f) => f.message).join('；'))
check('lint 抓到 TODO 标题过长/缺引言之一',
  linted.findings.length > 0, String(linted.findings.length))

const blockOnly = await registered.get('science_manuscript_lint').execute({ id: 'smoke-paper', severity: 'block' })
check('lint severity 过滤生效', blockOnly.findings.every((f) => f.severity === 'block'),
  JSON.stringify([...new Set(blockOnly.findings.map((f) => f.severity))]))
check('lint 过滤后条数不超过全量', blockOnly.findings.length <= linted.findings.length)

/* ── format_check ──────────────────────────────────────────────────── */
const fmt = await registered.get('science_format_check').execute({})
check('format_check 有 engines', Array.isArray(fmt.engines) && fmt.engines.length >= 4, String(fmt.engines.length))
check('format_check 有 classes', Array.isArray(fmt.classes) && fmt.classes.length >= 5)
check('format_check 有 families', Array.isArray(fmt.families) && fmt.families.length >= 12, String(fmt.families.length))
check('format_check 列出稿件', fmt.manuscripts.includes('smoke-paper'), JSON.stringify(fmt.manuscripts))
check('format_check 给 reachable', Array.isArray(fmt.reachable) && fmt.reachable.includes('docx'))
check('format_check 族字段完整',
  fmt.families.every((f) => f.id && f.latexClass && f.pageSize && Number.isFinite(f.bodyPt)))

/* ── build ─────────────────────────────────────────────────────────── */
const built = await registered.get('science_manuscript_build').execute({
  id: 'smoke-paper',
  targets: ['latex', 'html', 'jats', 'docx'],
})
check('build 返回 ok', built.ok === true, JSON.stringify(built.artifacts.map((a) => `${a.kind}:${a.path ? 'ok' : 'fail'}`)))
check('build 出 latex', built.artifacts.some((a) => a.kind === 'latex' && a.bytes > 400))
check('build 出 html', built.artifacts.some((a) => a.kind === 'html' && a.bytes > 1500))
check('build 出 jats', built.artifacts.some((a) => a.kind === 'jats' && a.bytes > 800))
const docxArtifact = built.artifacts.find((a) => a.kind === 'docx')
check('build 出 docx', Boolean(docxArtifact) && docxArtifact.bytes > 8000, JSON.stringify(docxArtifact))
check('build 记录 blocking', Number.isFinite(built.blocking))
check('build 记录词数', Number.isFinite(built.words))
check('build 输出目录', existsSync(built.outDir))
check('build 落盘文件数 ≥4',
  readdirSync(built.outDir).length >= 4, JSON.stringify(readdirSync(built.outDir)))

/* ── build 换刊 ─────────────────────────────────────────────────────── */
const cellBuild = await registered.get('science_manuscript_build').execute({
  id: 'smoke-paper',
  journal: 'cell',
  targets: ['html'],
})
check('换刊构建成功', cellBuild.ok === true, JSON.stringify(cellBuild.artifacts))
check('换刊族变了', cellBuild.familyId === 'cell', String(cellBuild.familyId))
check('换刊引文变了', cellBuild.citationStyle === 'cell', String(cellBuild.citationStyle))

/* ── 错误路径 ──────────────────────────────────────────────────────── */
const missing = await registered.get('science_manuscript_lint').execute({ id: 'no-such-paper' }).then(
  () => ({ threw: false }),
  (error) => ({ threw: true, message: error.message }),
)
check('不存在稿件报错', missing.threw === true, JSON.stringify(missing))

const noId = await registered.get('science_manuscript_build').execute({ targets: ['html'] }).then(
  () => ({ threw: false }),
  (error) => ({ threw: true }),
)
check('缺 id/dir 报错', noId.threw === true)

console.log('')
if (fails.length > 0) {
  console.log('失败项：')
  for (const item of fails) console.log(`  ✗ ${item}`)
  console.log('')
}
console.log(`${pass}/${pass + fail} 通过（工具层冒烟）`)
rmSync(home, { recursive: true, force: true })
if (fail > 0) process.exitCode = 1
