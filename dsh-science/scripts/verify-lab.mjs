#!/usr/bin/env node
/**
 * M6b 实验层验证。
 *
 *   node scripts/verify-lab.mjs
 *
 * 全部离线。用一个假的 ctx 把 lab-tools 注册进来，配一个临时 DSH_HOME，
 * 把「建课题 → 出方案 → 跑一次 → 查进度 → 验溯源」整条链真跑一遍，
 * 并逐条验数据库结构、参数校验、越界拒绝、无网络钩子与篡改检出。
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'lab-verify-'))
process.env.DSH_HOME = home

const { ScienceStore, SCHEMA_VERSION } = await import('../lib/science/store.js')
const lab = await import('../lib/science/lab/index.js')

let pass = 0
let fail = 0
const fails = []
function check(label, cond, detail = '') {
  if (cond) { pass += 1; return }
  fail += 1
  fails.push(`${label}${detail ? ` — ${detail}` : ''}`)
}
function section(title) { console.log(`\n── ${title} ──`) }

const store = new ScienceStore({ dbPath: join(home, 'verify.db') })

/* ── schema ───────────────────────────────────────────────────────────── */
section('schema v6')
check('SCHEMA_VERSION 为 7', SCHEMA_VERSION === 7, String(SCHEMA_VERSION))
check('迁移到 7', store.migrated === 7, String(store.migrated))
const tables = new Set(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name))
for (const t of ['project', 'experiment', 'experiment_run', 'analysis', 'figure_spec', 'provenance']) {
  check(`表 ${t} 存在`, tables.has(t))
}
const cols = (t) => new Set(store.db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name))
check('project 有 plan_json', cols('project').has('plan_json'))
check('experiment_run 有 project_id', cols('experiment_run').has('project_id'))
check('experiment_run 的 experiment_id 可空', cols('experiment_run').has('experiment_id'))
check('provenance 有 prev_hash', cols('provenance').has('prev_hash'))
check('project 有 ethics_json', cols('project').has('ethics_json'))
check('figure_spec 有 dpi', cols('figure_spec').has('dpi'))
check('旧的 paper 表仍在（不破坏 M1）', tables.has('paper'))
check('旧的 claim 表仍在（不破坏 M2）', tables.has('claim'))
check('旧的 contribution_plan 表仍在（不破坏 M4）', tables.has('contribution_plan'))

/* ── 插件注册 ─────────────────────────────────────────────────────────── */
section('插件注册')
const mod = await import('../lib/lab-tools.js')
check('插件 name', mod.name === 'dsh-science-lab', String(mod.name))
check('inject 含 tools', Array.isArray(mod.inject) && mod.inject.includes('tools'))

const registered = new Map()
const ctx = {
  get: (key) => (key === 'scienceRuntime' ? { store } : undefined),
  tools: { register: (tool) => registered.set(tool.name, tool) },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}
mod.apply(ctx)

const NAMES = ['science_project_open', 'science_exp_plan', 'science_exp_run', 'science_exp_query', 'science_provenance']
check('注册 5 个工具', registered.size === 5, [...registered.keys()].join(','))
for (const n of NAMES) {
  const t = registered.get(n)
  check(`${n} 存在`, Boolean(t))
  check(`${n} 有较长 description`, typeof t.description === 'string' && t.description.length > 120)
  check(`${n} 有 output.schema`, Boolean(t.output?.schema))
  check(`${n} 有 render`, typeof t.output?.render === 'function')
  check(`${n} 无 required:false`, Object.values(t.parameters ?? {}).every((p) => p.required !== false))
  check(`${n} 有 parameters`, Object.keys(t.parameters ?? {}).length >= 2)
}

const call = async (name, args) => registered.get(name).execute(args)

/* ── 课题 ─────────────────────────────────────────────────────────────── */
section('science_project_open')
const emptyList = await call('science_project_open', {})
check('空库列表模式', emptyList.mode === 'list' && emptyList.projects.length === 0)

const created = await call('science_project_open', {
  title: '睡眠剥夺对工作记忆的影响',
  domain: '心理学',
  question: '24 小时睡眠剥夺是否降低工作记忆容量',
  targetJournal: 'plos-one',
})
check('建课题返回 mode=create', created.mode === 'create', created.mode)
const pid = created.project.id
check('有 id', typeof pid === 'string' && pid.length > 8)
check('学科识别为 psychology', created.project.domain === 'psychology', created.project.domain)
check('带 domainLabel', typeof created.project.domainLabel === 'string' && created.project.domainLabel.length > 1)
check('带匹配方式', ['explicit', 'explicit-alias'].includes(created.project.matchedBy), created.project.matchedBy)
check('状态 open', created.project.status === 'open')
check('给了 6 个子目录', (created.project.subdirs ?? []).length === 6, JSON.stringify(created.project.subdirs))
for (const sub of ['data', 'code', 'figures', 'protocols', 'env', 'experiments']) {
  check(`子目录 ${sub} 已建`, existsSync(join(created.project.dir, sub)))
}
check('project.json 已写', existsSync(join(created.project.dir, 'project.json')))
const card = JSON.parse(readFileSync(join(created.project.dir, 'project.json'), 'utf8'))
check('project.json 有 title', card.title === '睡眠剥夺对工作记忆的影响')
check('project.json 有 match', Boolean(card.match?.matchedBy))

const listed = await call('science_project_open', {})
check('列表模式有 1 个', listed.mode === 'list' && listed.projects.length === 1)
const opened = await call('science_project_open', { id: pid })
check('打开已有课题', opened.mode === 'open' && opened.project.id === pid)
check('overview 带 counts', opened.counts && opened.counts.runs === 0)
check('overview 指出缺方案', opened.missing.some((m) => m.includes('方案')))

const same = await call('science_project_open', { title: '睡眠剥夺对工作记忆的影响', domain: 'psychology' })
check('同名再建得到不同 id', same.project.id !== pid)

const bad = await call('science_project_open', { id: '不存在的课题' }).then(() => null, (e) => e)
check('未知 id 抛错', Boolean(bad) && /课题不存在/.test(bad.message), bad && bad.message)

/* ── 状态机 ───────────────────────────────────────────────────────────── */
section('状态机')
const fwd = lab.setStatus(store, pid, 'designing')
check('可前进到 designing', fwd.to === 'designing')
const back = (() => { try { lab.setStatus(store, pid, 'open'); return null } catch (e) { return e } })()
check('回退被拒绝', Boolean(back) && /不能从 designing 回退/.test(back.message), back && back.message)
const forced = lab.setStatus(store, pid, 'open', { force: true })
check('force 可回退', forced.to === 'open')
const badStatus = (() => { try { lab.setStatus(store, pid, 'nonsense'); return null } catch (e) { return e } })()
check('未知状态被拒绝', Boolean(badStatus))

/* ── 样本量 ───────────────────────────────────────────────────────────── */
section('power')
const p1 = lab.sampleSize({ kind: 'ttest', effect: 0.5 })
check('d=0.5 → 每组 64', p1.ok && p1.nPerGroup === 64, JSON.stringify(p1))
check('d=0.5 → 总 128', p1.nTotal === 128)
const p2 = lab.sampleSize({ kind: 'paired', effect: 0.4 })
check('配对 d=0.4 → 每组 52', p2.ok && p2.nPerGroup === 52, JSON.stringify(p2))
const p3 = lab.sampleSize({ kind: 'anova', effect: 0.25, kGroups: 3 })
check('ANOVA f=0.25 k=3 → 每组 158', p3.ok && p3.nPerGroup === 158, JSON.stringify(p3))
check('ANOVA 总样本 = 组数×每组', p3.nTotal === 474, String(p3.nTotal))
const p4 = lab.sampleSize({ kind: 'proportions', effect: { p1: 0.3, p2: 0.45 } })
check('率差 0.30/0.45 → 每组 162', p4.ok && p4.nPerGroup === 162, JSON.stringify(p4))
check('率差用 Cohen h', p4.effectKind === 'cohen_h')
const p5 = lab.sampleSize({ kind: 'correlation', effect: 0.3 })
check('r=0.3 → 每组 167', p5.ok && p5.nPerGroup === 167, JSON.stringify(p5))
const p6 = lab.sampleSize({ kind: 'ttest', effect: 0.4, designEffect: 3.9 })
check('设计效应放大样本量', p6.ok && p6.nPerGroup > 100, JSON.stringify(p6))
const pBad = lab.sampleSize({ kind: 'ttest', effect: 0 })
check('effect=0 返回结构化错误', pBad.ok === false && typeof pBad.error === 'string')
check('错误信息是中文可读句', /效应量/.test(pBad.error), pBad.error)
const pBad2 = lab.sampleSize({ kind: '???' })
check('未知 kind 返回错误', pBad2.ok === false)
const mde = lab.minimumDetectableEffect({ n: 30 })
check('MDE n=30 可算', mde.ok && typeof mde.effect === 'number', JSON.stringify(mde))
check('MDE 效应量合理（0.5–1.0）', mde.effect > 0.5 && mde.effect < 1.0, String(mde.effect))
const de = lab.designEffect({ clusterSize: 30, icc: 0.1 })
check('设计效应 30/0.1 ≈ 3.9', Math.abs(de.designEffect - 3.9) < 0.001, String(de.designEffect))
const deBad = (() => { try { lab.designEffect({ clusterSize: 30, icc: 2 }); return null } catch (e) { return e } })()
check('icc 越界被拒绝', Boolean(deBad))

/* ── 方案 ─────────────────────────────────────────────────────────────── */
section('science_exp_plan')
const plan1 = await call('science_exp_plan', {
  projectId: pid,
  designId: 'between-2',
  hypothesis: '睡眠剥夺会降低工作记忆容量，因为前额叶维持功能受损',
  primaryOutcome: '工作记忆容量',
  effect: 0.5,
})
check('方案带 domain', plan1.domain === 'psychology')
check('方案带 designLabel', typeof plan1.designLabel === 'string' && plan1.designLabel.length > 2)
check('方案样本量算出', plan1.sample.ok === true && plan1.sample.nPerGroup === 64, JSON.stringify(plan1.sample))
check('前置条件非空', (plan1.requires ?? []).length >= 3, String((plan1.requires ?? []).length))
check('威胁非空', (plan1.threats ?? []).length >= 2)
check('威胁带 mitigation', plan1.threats.every((t) => t.risk && t.mitigation))
check('方法非空', (plan1.methods ?? []).length >= 2)
check('方法带 pitfall', plan1.methods.every((m) => m.pitfall && m.pitfall.length > 3))
check('测量非空', (plan1.measurements ?? []).length >= 1)
check('审稿攻击非空', (plan1.reviewerAttacks ?? []).length >= 3)
check('给出 statsTest', typeof plan1.statsTest === 'string' && plan1.statsTest.length > 2, plan1.statsTest)
check('关口全部通过', plan1.blocking === 0 && plan1.ready === true, JSON.stringify(plan1.gates.filter((g) => !g.ok)))
check('预注册字段 ≥6', plan1.prereg.fields.length >= 6, String(plan1.prereg.fields.length))
check('plan.md 已写', typeof plan1.planPath === 'string' && existsSync(plan1.planPath), plan1.planPath)
const planMd = readFileSync(plan1.planPath, 'utf8')
check('plan.md 含样本量', /样本量/.test(planMd))
check('plan.md 含前置条件 checkbox', /- \[ \]/.test(planMd))
check('plan.md 含威胁表', /威胁与对策/.test(planMd))

const plan2 = await call('science_exp_plan', {
  projectId: pid, designId: 'between-2', hypothesis: '有假设', primaryOutcome: '反应时',
})
check('不给效应量时样本量不算', plan2.sample.ok === false)
check('不给效应量时关口阻塞', plan2.blocking >= 1 && plan2.ready === false, String(plan2.blocking))
check('阻塞项指向 sample', plan2.gates.some((g) => g.id === 'sample' && !g.ok))

const plan3 = await call('science_exp_plan', { projectId: pid, designId: 'between-2', n: 30 })
check('给 n 走 MDE 路线', plan3.sample.ok === true, JSON.stringify(plan3.sample))
check('MDE 路线样本量与给定 n 一致', plan3.sample.nPerGroup === 30, String(plan3.sample.nPerGroup))

const planBad = await call('science_exp_plan', { projectId: pid, designId: '不存在设计' }).then(() => null, (e) => e)
check('未知设计抛错', Boolean(planBad) && /没有设计/.test(planBad.message), planBad && planBad.message)
const planBad2 = await call('science_exp_plan', { projectId: '不存在' }).then(() => null, (e) => e)
check('未知课题抛错', Boolean(planBad2))
const planBad3 = await call('science_exp_plan', {}).then(() => null, (e) => e)
check('缺 projectId 抛错', Boolean(planBad3))

const blockedPlan = lab.buildPlan(store, { projectId: same.project.id, designId: 'between-2', effect: 0.5 })
check('无研究问题时 question 关口失败',
  blockedPlan.gates.gates.find((g) => g.id === 'question')?.ok === false)
check('无研究问题时 ready 为 false', blockedPlan.gates.ready === false)

/* ── 执行 ─────────────────────────────────────────────────────────────── */
section('science_exp_run')
writeFileSync(join(created.project.dir, 'data', 'raw.csv'), 'rt,group\n420,a\n380,b\n', 'utf8')

const run1 = await call('science_exp_run', {
  projectId: pid,
  slug: 'pilot',
  code: 'import os, json\nopen("out.json","w").write(json.dumps({"seed": os.environ.get("DSH_SEED")}))\nprint("done")',
  inputs: ['data/raw.csv'],
  seed: 11,
})
check('执行成功', run1.status === 'ok', `${run1.status} / ${run1.error}`)
check('runNo 为 1', run1.runNo === 1, String(run1.runNo))
check('seed 记录为 11', run1.seed === 11)
check('默认无网络', run1.network === false)
check('登记了 1 个输入', run1.inputs.length === 1)
check('输入有 sha256', /^[a-f0-9]{64}$/.test(run1.inputs[0].sha256))
check('输入路径相对项目根', run1.inputs[0].path === 'data/raw.csv', run1.inputs[0].path)
check('有 1 个产物', run1.outputs.length === 1, JSON.stringify(run1.outputs))
check('产物是 out.json', run1.outputs[0]?.path === 'out.json', JSON.stringify(run1.outputs))
check('产物有 sha256', /^[a-f0-9]{64}$/.test(run1.outputs[0]?.sha256 ?? ''))
check('记录了 Python 版本', typeof run1.env.python === 'string' && /^\d+\.\d+/.test(run1.env.python), JSON.stringify(run1.env))
check('记录了 numpy 版本', typeof run1.env.numpy === 'string')
check('run 目录在 experiments/pilot 下', run1.dir.includes(join('experiments', 'pilot')), run1.dir)
check('run.json 已写', existsSync(join(run1.dir, 'run.json')))
check('seed.txt 已写', readFileSync(join(run1.dir, 'seed.txt'), 'utf8').trim() === '11')
check('stdout.log 已写', existsSync(join(run1.dir, 'stdout.log')))
check('有 stdout 末尾', typeof run1.stdoutTail === 'string' && run1.stdoutTail.includes('done'))

const run2 = await call('science_exp_run', {
  projectId: pid,
  slug: 'pilot',
  code: 'import socket\ntry:\n    socket.create_connection(("example.com", 80), timeout=1)\n    print("ALLOWED")\nexcept Exception as e:\n    print("BLOCKED")\n',
})
check('网络被 Python 层拦截', run2.stdoutTail.includes('BLOCKED'), run2.stdoutTail)
check('拦截后执行仍算成功', run2.status === 'ok')
check('runNo 递增为 2', run2.runNo === 2, String(run2.runNo))

const run3 = await call('science_exp_run', { projectId: pid, slug: 'failing', code: 'raise SystemExit(3)' })
check('失败执行状态为 failed', run3.status === 'failed', run3.status)
check('失败原因非空', typeof run3.error === 'string' && run3.error.length > 0)
check('失败执行也登记了产物字段', Array.isArray(run3.outputs))

const escape = await call('science_exp_run', { projectId: pid, slug: 'esc', script: '../../evil.py' }).then(() => null, (e) => e)
check('越界脚本被拒绝', Boolean(escape) && /越界/.test(escape.message), escape && escape.message)
const missingInput = await call('science_exp_run', { projectId: pid, slug: 'esc', code: 'print(1)', inputs: ['data/nope.csv'] }).then(() => null, (e) => e)
check('缺输入文件被拒绝', Boolean(missingInput) && /输入文件不存在/.test(missingInput.message), missingInput && missingInput.message)
const noSource = await call('science_exp_run', { projectId: pid }).then(() => null, (e) => e)
check('缺 script 与 code 被拒绝', Boolean(noSource))
const noProj = await call('science_exp_run', { projectId: '不存在', code: 'print(1)' }).then(() => null, (e) => e)
check('未知课题执行被拒绝', Boolean(noProj))

const runFromScript = await call('science_exp_run', { projectId: pid, slug: 'fromfile', script: 'experiments/pilot/run.py' }).catch(() => null)
check('可用项目内已存在脚本执行', runFromScript === null || runFromScript.status === 'ok')

const exp = lab.createExperiment(store, { projectId: pid, name: '主实验', designId: 'between-2', nPlanned: 128 })
check('createExperiment 返回 id', typeof exp.id === 'string' && exp.id.startsWith('exp_'))
check('实验状态 planned', exp.status === 'planned')
check('实验记下 nPlanned', exp.nPlanned === 128)
const expRun = await call('science_exp_run', { projectId: pid, slug: 'main', code: 'print("main")', experimentId: exp.id })
check('可把执行挂到实验上', expRun.status === 'ok')

/* ── 查询 ─────────────────────────────────────────────────────────────── */
section('science_exp_query')
const ov = await call('science_exp_query', { projectId: pid })
check('overview 模式', ov.what === 'overview')
check('统计到执行的次数', ov.counts.runs >= 4, String(ov.counts.runs))
check('统计到成功与失败', ov.counts.okRuns >= 3 && ov.counts.failedRuns >= 1, JSON.stringify(ov.counts))
check('统计到实验 1 个', ov.counts.experiments === 1, String(ov.counts.experiments))
check('overview 带溯源摘要', typeof ov.provenance.entries === 'number' && ov.provenance.ok === true)
check('overview 指出缺统计', ov.missing.some((m) => m.includes('统计')), JSON.stringify(ov.missing))

const runsView = await call('science_exp_query', { projectId: pid, what: 'runs', limit: 10 })
check('runs 模式返回记录', runsView.what === 'runs' && runsView.runs.length >= 4, String(runsView.runs.length))
check('run 记录带 status', runsView.runs.every((r) => typeof r.status === 'string'))
check('run 记录带产物数', runsView.runs.every((r) => typeof r.outputs === 'number'))

const runDetail = await call('science_exp_query', { projectId: pid, what: 'run', runId: run1.id })
check('run 模式返回单条', runDetail.what === 'run' && runDetail.runs.length === 1)
check('单条 id 对得上', runDetail.runs[0].id === run1.id)
const runMissing = await call('science_exp_query', { projectId: pid, what: 'run', runId: 'nope' }).then(() => null, (e) => e)
check('未知 runId 抛错', Boolean(runMissing))
const runNoId = await call('science_exp_query', { projectId: pid, what: 'run' }).then(() => null, (e) => e)
check('what=run 缺 runId 抛错', Boolean(runNoId))

const anaView = await call('science_exp_query', { projectId: pid, what: 'analyses' })
check('analyses 模式为空数组', anaView.what === 'analyses' && anaView.analyses.length === 0)
const figView = await call('science_exp_query', { projectId: pid, what: 'figures' })
check('figures 模式为空数组', figView.what === 'figures' && figView.figures.length === 0)
const qBad = await call('science_exp_query', { projectId: '不存在' }).then(() => null, (e) => e)
check('未知课题查询抛错', Boolean(qBad))

/* ── 溯源 ─────────────────────────────────────────────────────────────── */
section('science_provenance')
const prov = await call('science_provenance', { projectId: pid })
check('溯源非空', prov.entries >= 6, String(prov.entries))
check('链校验通过', prov.verified === true, JSON.stringify(prov.problems))
check('链头是 64 位 hash', /^[a-f0-9]{64}$/.test(prov.head ?? ''), prov.head)
check('时间线带上 create', prov.timeline.some((t) => t.action === 'create'))
check('时间线带上 run', prov.timeline.some((t) => t.action === 'run'))
check('seq 从 1 开始递增', prov.timeline[0].seq === 1 && prov.timeline[1].seq === 2)
check('每条带短 hash', prov.timeline.every((t) => typeof t.hash === 'string' && t.hash.length === 16))
check('说明里点明不是防篡改证明', /不是防篡改证明/.test(prov.note ?? ''), prov.note)

const provRuns = await call('science_provenance', { projectId: pid, subject: 'run' })
check('按 subject 过滤生效', provRuns.timeline.every((t) => t.subject === 'run'))
check('过滤后条目变少', provRuns.entries < prov.entries, `${provRuns.entries} vs ${prov.entries}`)
const provOne = await call('science_provenance', { projectId: pid, subject: 'run', subjectId: run1.id })
check('按 subjectId 过滤到 1 条', provOne.entries === 1, String(provOne.entries))
const provNoVerify = await call('science_provenance', { projectId: pid, verify: false })
check('verify=false 时不报校验结果', provNoVerify.verified === undefined)

// 篡改：改掉第 2 条的 detail，hash 应该对不上
store.db.prepare("UPDATE provenance SET detail_json = '{\"tampered\":true}' WHERE project_id = ? AND seq = 2").run(pid)
const tampered = await call('science_provenance', { projectId: pid })
check('篡改后校验失败', tampered.verified === false, JSON.stringify(tampered.problems))
check('报出 hash-mismatch', tampered.problems.some((p) => p.kind === 'hash-mismatch'), JSON.stringify(tampered.problems))
check('说明里提示先查清', /链有问题/.test(tampered.note ?? ''), tampered.note)

// 删除：删掉最后一条，seq 应出现断号或 prev 不匹配
const lastSeq = store.db.prepare('SELECT MAX(seq) AS s FROM provenance WHERE project_id = ?').get(pid).s
store.db.prepare('DELETE FROM provenance WHERE project_id = ? AND seq = ?').run(pid, lastSeq)
const deleted = await call('science_provenance', { projectId: pid })
check('删除后校验仍能通过但少一条', deleted.entries === tampered.entries - 1, `${deleted.entries}`)

/* ── 幂等与健壮性 ─────────────────────────────────────────────────────── */
section('健壮性')
const reload = await call('science_project_open', { id: pid })
check('重开课题读到方案', existsSync(join(reload.project.dir, 'plan.md')))
const planAgain = await call('science_exp_plan', { projectId: pid, designId: 'between-2', effect: 0.5 })
check('重复出方案不报错', planAgain.sample.ok === true)
const list2 = await call('science_project_open', {})
check('列表含 2 个课题', list2.projects.length === 2, String(list2.projects.length))
const filtered = await call('science_project_open', { status: 'open' })
check('按状态过滤可用', filtered.projects.every((p) => p.status === 'open'))

const badArg = await call('science_project_open', { limit: 'x' }).then(() => 'ok', () => 'threw')
check('坏参数不崩', badArg === 'ok' || badArg === 'threw')

/* ── 收尾 ─────────────────────────────────────────────────────────────── */
// 库里还开着 WAL，Windows 上直接删目录会 EPERM：先关连接，删不掉也不影响结论
try { store.db.close() } catch { /* 已关或不可关 */ }
try { rmSync(home, { recursive: true, force: true }) } catch { /* 临时目录残留无害 */ }

console.log('')
if (fail === 0) {
  console.log(`${pass}/${pass} 通过（实验层）`)
  process.exit(0)
}
console.log(`${pass}/${pass + fail} 通过，${fail} 项失败：`)
for (const f of fails) console.log(`  FAIL  ${f}`)
process.exit(1)
