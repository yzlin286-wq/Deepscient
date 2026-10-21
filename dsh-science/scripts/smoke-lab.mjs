#!/usr/bin/env node
/**
 * 工具层冒烟：把 lab / analysis / coach 三组工具真的注册一遍，逐个调一次。
 *
 *   node scripts/smoke-lab.mjs
 *
 * 与 verify-*.mjs 的分工：
 *   verify-*.mjs  验行为正确性（数字对不对、门判得对不对）
 *   本文件         验工具层契约（注册成功、schema 合法、render 不炸、参数校验生效）
 *
 * 工具层的错误最贵——schema 写错会让整个插件装载失败，而不是某个调用失败。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'smoke-lab-'))
process.env.DSH_HOME = home

const { ScienceStore } = await import('../lib/science/store.js')
const store = new ScienceStore({ dbPath: join(home, 'smoke.db') })

let pass = 0
let fail = 0
const fails = []
function check(label, cond, detail = '') {
  if (cond) { pass += 1; return }
  fail += 1
  fails.push(`${label}${detail ? ` — ${detail}` : ''}`)
}
function section(t) { console.log(`\n── ${t} ──`) }

const ctx = {
  get: (key) => (key === 'scienceRuntime' ? { store } : undefined),
  tools: { register: () => {} },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}

/* ── 注册 ─────────────────────────────────────────────────────────────── */
section('注册')
const modules = [
  ['../lib/lab-tools.js', 'dsh-science-lab', ['science_project_open', 'science_exp_plan', 'science_exp_run', 'science_exp_query', 'science_provenance']],
  ['../lib/analysis-tools.js', 'dsh-science-analysis', ['science_stats', 'science_figure']],
  ['../lib/coach-tools.js', 'dsh-science-coach', ['science_study_coach', 'science_workflow_stages']],
]

const all = new Map()
for (const [path, expectName, expectTools] of modules) {
  const mod = await import(path)
  check(`${expectName} 导出 name`, mod.name === expectName, mod.name)
  check(`${expectName} inject 含 tools`, Array.isArray(mod.inject) && mod.inject.includes('tools'))
  const local = new Map()
  mod.apply({ ...ctx, tools: { register: (tool) => local.set(tool.name, tool) } })
  check(`${expectName} 注册 ${expectTools.length} 个工具`, local.size === expectTools.length, [...local.keys()].join(','))
  for (const name of expectTools) {
    const tool = local.get(name)
    check(`${name} 已注册`, Boolean(tool))
    if (!tool) continue
    all.set(name, tool)
    check(`${name} 有 name/description`, tool.name === name && typeof tool.description === 'string')
    check(`${name} description 足够长`, tool.description.length > 150, String(tool.description.length))
    check(`${name} 有 parameters`, tool.parameters && typeof tool.parameters === 'object' && Object.keys(tool.parameters).length >= 1)
    check(`${name} parameters 无 required:false`, Object.values(tool.parameters).every((p) => p?.required !== false))
    check(`${name} 有 output.schema`, Boolean(tool.output?.schema))
    check(`${name} 有 render`, typeof tool.output?.render === 'function')
    check(`${name} 有 execute`, typeof tool.execute === 'function')
    // render 不能依赖外部状态：用一份最小假值试一次
    try {
      const rendered = tool.output.render({}, renderStub(name))
      check(`${name} render 返回 text 块`, Array.isArray(rendered) && rendered.length > 0 && rendered[0].type === 'text')
    } catch (error) {
      check(`${name} render 不抛错`, false, error.message)
    }
  }
}

check('三组共注册 9 个工具', all.size === 9, String(all.size))

/** 每个工具 render 的最小可渲染值。字段缺失时应降级而不是抛错。 */
function renderStub(name) {
  const base = { ok: true }
  const stubs = {
    science_project_open: { ...base, mode: 'create', project: { id: 'p1', title: 'T', domain: 'psychology', status: 'open', dir: 'D' }, missing: ['方案'] },
    science_exp_plan: { ...base, projectId: 'p1', domain: 'psychology', designId: 'between-2', designLabel: '两组', sample: { ok: true, nPerGroup: 64, nTotal: 128, method: 'm', alpha: 0.05, power: 0.8, effect: '0.5', effectKind: 'cohens-d', designEffect: 1 }, requires: ['x'], threats: [{ risk: 'r', mitigation: 'm' }], methods: [{ id: 'm', label: 'M', tool: 't', pitfall: 'p' }], gates: [{ id: 'g', label: 'G', severity: 'blocking', ok: false }], blocking: 1, ready: false, prereg: { registry: 'OSF', fields: [{ key: 'k', label: 'K', value: 'v' }] }, reviewerAttacks: [{ attack: 'a', defense: 'd' }], nextSteps: ['s'] },
    science_exp_run: { ...base, id: 'r1', status: 'ok', dir: 'D', seed: 1, network: false, ms: 10, inputs: [], outputs: [{ path: 'o.json', sha256: 'a'.repeat(64), bytes: 3 }] },
    science_exp_query: { ...base, what: 'overview', project: { id: 'p1', title: 'T' }, counts: { experiments: 0, runs: 0, okRuns: 0, failedRuns: 0, analyses: 0, figures: 0 }, missing: [], provenance: { ok: true, entries: 1, problems: 0 } },
    science_provenance: { ...base, projectId: 'p1', entries: 2, verified: true, head: 'h', problems: [], timeline: [{ seq: 1, action: 'create', subject: 'project', hash: 'abcdef0123456789', at: 1 }], note: 'n' },
    science_stats: { ...base, testId: 'ttest-welch', label: 'W', statistic: 1, p: 0.04, effectSize: { kind: 'cohens-d', value: 0.5, ci: [-0.1, 1.1] }, n: { a: 2 }, assumptions: [], warnings: [], markdown: '### x' },
    science_figure: { ...base, kind: 'bar', files: [{ path: 'figures/a.pdf', format: 'pdf', bytes: 10 }], widthMm: 85, heightMm: 60, dpi: 600, fontSize: 7, checks: [{ id: 'font', ok: true, detail: 'd' }], ready: true },
    science_study_coach: { ...base, projectId: 'p1', current: { id: 'S0', label: '选题', goal: 'g' }, stages: [{ id: 'S0', label: '选题', complete: false, blocking: 1, warnings: 0, skipped: 0, manual: 0 }], nextActions: [{ gate: 'g', label: 'G', fix: 'f' }], tools: [], failureModes: [], globalRules: ['r'], done: false },
    science_workflow_stages: { ...base, stages: [{ id: 'S0', label: '选题', goal: 'g', gates: [], tools: [], artifacts: [], failureModes: [] }], globalRules: ['r'] },
  }
  return stubs[name] ?? base
}

/* ── 参数校验 ─────────────────────────────────────────────────────────── */
section('参数校验')
const badType = await all.get('science_project_open').execute({ title: 123 }).then(() => 'no-throw', (e) => e)
check('类型错误被框架拒绝或工具拒绝', badType !== 'no-throw')
const missingProject = await all.get('science_stats').execute({}).then(() => 'no-throw', (e) => e)
check('science_stats 缺 projectId 抛错', typeof missingProject !== 'string' && /projectId/.test(missingProject.message), String(missingProject?.message))

/* ── 真实调用链 ───────────────────────────────────────────────────────── */
section('调用链')
const p = await all.get('science_project_open').execute({ title: '冒烟课题', domain: '心理学', question: '咖啡因是否缩短反应时', ethics: { approvalId: 'IRB-2026-001', body: '人类' } })
check('建课题成功', p.mode === 'create' && typeof p.project.id === 'string')
check('伦理已登记', p.project.ethicsRecorded === true)
check('建课题后缺方案', p.missing.some((m) => m.includes('方案')))
const pid = p.project.id

const plan = await all.get('science_exp_plan').execute({ projectId: pid, designId: 'between-2', hypothesis: '咖啡因缩短反应时，因为提高警觉', primaryOutcome: '反应时', effect: 0.5 })
check('出方案成功', plan.blocking === 0 && plan.ready === true, JSON.stringify(plan.gates?.filter((g) => !g.ok)))
check('方案给了样本量', plan.sample.nPerGroup === 64)
check('方案写了 plan.md', typeof plan.planPath === 'string')

writeFileSync(join(store.dbPath, '..', 'unused.txt'), '', 'utf8')

const run = await all.get('science_exp_run').execute({ projectId: pid, slug: 'smoke', code: 'print(1+1)' })
check('执行成功', run.status === 'ok', run.error)
check('执行默认无网络', run.network === false)

const stats = await all.get('science_stats').execute({ projectId: pid, testId: 'ttest-welch', data: { a: [1, 2, 3, 4, 5], b: [2, 4, 6, 8, 10] } })
check('统计成功', stats.ok === true, stats.error)
check('统计给效应量', stats.effectSize?.kind === 'cohens-d')
check('统计给 markdown', typeof stats.markdown === 'string' && stats.markdown.length > 10)

const fig = await all.get('science_figure').execute({ projectId: pid, kind: 'bar', data: { g1: [1, 2, 3], g2: [2, 3, 4] }, errorType: 'sem', formats: ['pdf'] })
check('作图成功', fig.ok === true, fig.error)
check('图通过自检', fig.ready === true, JSON.stringify(fig.checks?.filter((c) => !c.ok)))

const coach = await all.get('science_study_coach').execute({ projectId: pid })
check('教练成功', coach.ok === true, coach.error)
check('教练指出当前阶段', typeof coach.current?.id === 'string', String(coach.current?.id))
check('教练给了下一步', coach.nextActions.length >= 1, String(coach.nextActions.length))
check('教练有 12 个阶段', coach.stages.length === 12, String(coach.stages.length))

const wf = await all.get('science_workflow_stages').execute({})
check('流程可独立读取', wf.ok === true && wf.stages.length === 12)
const wfOne = await all.get('science_workflow_stages').execute({ stage: 'S3' })
check('可按阶段读流程', wfOne.stages.length === 1 && wfOne.stages[0].id === 'S3')
const wfBad = await all.get('science_workflow_stages').execute({ stage: 'S99' }).then(() => 'no-throw', (e) => e)
check('未知阶段抛错', wfBad !== 'no-throw')

const prov = await all.get('science_provenance').execute({ projectId: pid })
check('溯源成功', prov.verified === true, JSON.stringify(prov.problems))
check('溯源含 4 类动作', prov.timeline.length >= 4, String(prov.timeline.length))

const unsupported = await all.get('science_stats').execute({ projectId: pid, testId: 'fine-gray', data: { a: [1, 2] } })
check('未实现检验 ok=false', unsupported.ok === false)
check('未实现检验带 supported', Array.isArray(unsupported.supported) && unsupported.supported.length > 20)

/* ── 收尾 ─────────────────────────────────────────────────────────────── */
try { store.db.close() } catch { /* 已关 */ }
try { rmSync(home, { recursive: true, force: true }) } catch { /* Windows 偶发 EPERM */ }

console.log('')
if (fail === 0) {
  console.log(`${pass}/${pass} 通过（工具层冒烟）`)
  process.exit(0)
}
console.log(`${pass}/${pass + fail} 通过，${fail} 项失败：`)
for (const f of fails) console.log(`  FAIL  ${f}`)
process.exit(1)
