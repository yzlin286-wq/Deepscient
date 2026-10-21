/**
 * 研究流程教练：把 data/workflow.json 的 S0–S11 门，对着课题的实际状态逐条判。
 *
 * 三条设计原则
 *   1. 检查不了的写 manual，不猜。猜 pass 比不检查更坏——它会让人以为做过了。
 *   2. 阻塞项只压真正的阻塞。把 warning 也标成 blocking，用户会学会无视红色。
 *   3. 每条失败都带 fix：一个具体到能直接调用的下一步，不是「请完善方案」这种话。
 */
import { readFileSync } from 'node:fs'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getProject, projectDir, ethicsStatus } from '../lab/project.js'

let workflowCache = null

export function loadWorkflow() {
  if (workflowCache) return workflowCache
  workflowCache = JSON.parse(readFileSync(new URL('../../../data/workflow.json', import.meta.url), 'utf8'))
  return workflowCache
}

export function clearWorkflowCache() {
  workflowCache = null
}

export function listStages() {
  return loadWorkflow().stages.map((s) => ({
    id: s.id,
    code: s.code,
    label: s.label,
    goal: s.goal,
    toolCount: s.tools.length,
    gateCount: s.gates.length,
  }))
}

/** 取字段，支持 a.b.c 路径。 */
function pick(obj, path) {
  if (!obj) return undefined
  let cur = obj
  for (const part of String(path).split('.')) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[part]
  }
  return cur
}

/** 某检验登记的备选检验 id（来自 statistics.json，不是临时想的）。 */
function fallbackIds(testId) {
  try {
    const data = JSON.parse(readFileSync(new URL('../../../data/statistics.json', import.meta.url), 'utf8'))
    const tests = data.tests ?? {}
    /* statistics.json 的 tests 是以 id 为键的对象；早期版本是数组，两种都认。 */
    const test = Array.isArray(tests) ? tests.find((t) => t.id === testId) : tests[testId]
    return Array.isArray(test?.fallback) ? test.fallback : []
  } catch {
    return []
  }
}

/** 找到挂在这个课题上的稿件目录（稿件正文是文件，目录里还有 lint.json / build.json）。 */
function projectManuscriptDirs(store, projectId) {
  try {
    const rows = store.db.prepare('SELECT id FROM manuscript WHERE project_id = ?').all(projectId)
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    return rows.map((r) => ({ id: r.id, dir: join(home, 'science', 'manuscripts', r.id) }))
  } catch {
    return []
  }
}

function readJsonIfExists(path) {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function countRows(store, table, projectId) {
  try {
    const allowed = new Set(['paper', 'claim', 'manuscript', 'audit_run', 'experiment_run', 'analysis', 'figure_spec', 'experiment', 'provenance'])
    if (!allowed.has(table)) return null
    const hasProject = store.db.prepare(`PRAGMA table_info(${table})`).all().some((r) => r.name === 'project_id')
    if (!hasProject) {
      return store.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c
    }
    return store.db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE project_id = ?`).get(projectId).c
  } catch {
    return null
  }
}

function dirHasFiles(dir, rel) {
  try {
    const full = join(dir, rel)
    if (!existsSync(full)) return false
    return readdirSync(full).length > 0
  } catch {
    return false
  }
}

/**
 * 判一条 check。
 * 返回 { status: 'pass' | 'fail' | 'skip' | 'manual', detail }
 *
 * skip 的语义是「无法判定」——不是因为不重要，而是因为数据不在库里。
 * 调用方必须把 skip 与 fail 区别展示，否则 skip 会被当成本来就不用做。
 */
export function evaluate(check, context) {
  const { store, project, plan, projectId, dir } = context
  const kind = check.kind

  if (kind === 'manual') return { status: 'manual', detail: '' }
  if (!project) return { status: 'fail', detail: '课题不存在' }

  if (kind === 'project') {
    return { status: 'pass', detail: project.id }
  }

  if (kind === 'projectField') {
    const value = pick(project, check.field)
    if (value === undefined || value === null || value === '') return { status: 'fail', detail: `字段 ${check.field} 为空` }
    const min = check.minLength ?? 1
    if (typeof value === 'string' && value.trim().length < min) {
      return { status: 'fail', detail: `字段 ${check.field} 太短（${value.trim().length} < ${min}）` }
    }
    return { status: 'pass', detail: String(value).slice(0, 60) }
  }

  if (kind === 'planField') {
    if (!plan) return { status: 'fail', detail: '还没有方案（science_exp_plan）' }
    const value = pick(plan, check.field)
    if (value === undefined || value === null || value === '') return { status: 'fail', detail: `方案字段 ${check.field} 为空` }
    if (typeof value === 'boolean') return value ? { status: 'pass', detail: '' } : { status: 'fail', detail: `方案字段 ${check.field} 为 false` }
    const min = check.minLength ?? 1
    if (typeof value === 'string' && value.trim().length < min) return { status: 'fail', detail: '太短' }
    return { status: 'pass', detail: String(value).slice(0, 60) }
  }

  if (kind === 'planHas') {
    if (!plan) return { status: 'fail', detail: '还没有方案' }
    const value = pick(plan, check.field)
    if (!Array.isArray(value)) return { status: 'skip', detail: `方案里没有 ${check.field}` }
    return value.length > 0 ? { status: 'pass', detail: `${value.length} 条` } : { status: 'fail', detail: `${check.field} 为空` }
  }

  if (kind === 'planConditional') {
    const clustered = /cluster|multi-site|multi-env|school|village/.test(String(project.designId ?? ''))
    if (!clustered) return { status: 'skip', detail: '不是聚类设计，不适用' }
    const value = pick(plan, check.field)
    return value ? { status: 'pass', detail: '' } : { status: 'fail', detail: '聚类设计但没算设计效应' }
  }

  if (kind === 'ethics') {
    const eth = ethicsStatus(project)
    if (eth.recorded) return { status: 'pass', detail: eth.ethics.approvalId || '已登记' }
    return { status: 'fail', detail: `缺 ${eth.missing.join('、')}` }
  }

  if (kind === 'prereg') {
    if (project.preregRef) return { status: 'pass', detail: project.preregRef }
    return { status: 'fail', detail: '没有预注册编号（prereg_ref）' }
  }

  if (kind === 'count') {
    const n = countRows(store, check.table, projectId)
    if (n === null) return { status: 'skip', detail: `表 ${check.table} 不可查` }
    if (check.where === 'hasFulltext') {
      try {
        const withFulltext = store.db.prepare(
          "SELECT COUNT(*) AS c FROM paper WHERE COALESCE(oa_pdf_url,'') != '' OR COALESCE(oa_landing_url,'') != ''",
        ).get().c
        return withFulltext >= check.min ? { status: 'pass', detail: `${withFulltext} 条有全文` } : { status: 'fail', detail: `只有 ${withFulltext} 条有全文（需 ≥${check.min}）` }
      } catch {
        return { status: 'skip', detail: 'paper 表没有全文列' }
      }
    }
    if (check.where === 'hasEffectSize') {
      try {
        const rows = store.db.prepare('SELECT result_json FROM analysis WHERE project_id = ?').all(projectId)
        const withEs = rows.filter((r) => {
          try {
            const parsed = JSON.parse(r.result_json)
            return parsed?.effectSize && parsed.effectSize.value !== null && parsed.effectSize.value !== undefined
          } catch { return false }
        }).length
        return withEs >= check.min ? { status: 'pass', detail: `${withEs} 条带效应量` } : { status: 'fail', detail: `只有 ${withEs} 条带效应量` }
      } catch {
        return { status: 'skip', detail: 'analysis 表不可查' }
      }
    }
    return n >= check.min ? { status: 'pass', detail: `${n} 条（需 ≥${check.min}）` } : { status: 'fail', detail: `${n} 条（需 ≥${check.min}）` }
  }

  if (kind === 'dirNonEmpty') {
    return dirHasFiles(dir, check.path)
      ? { status: 'pass', detail: `${check.path}/ 有内容` }
      : { status: 'fail', detail: `${check.path}/ 为空或不存在` }
  }

  if (kind === 'assumptionClean') {
    try {
      const rows = store.db.prepare('SELECT test_id, assumptions_json FROM analysis WHERE project_id = ?').all(projectId)
      if (rows.length === 0) return { status: 'skip', detail: '还没有分析记录' }
      const runIds = new Set(rows.map((r) => r.test_id))
      const dirty = []
      for (const row of rows) {
        let parsed = []
        try { parsed = JSON.parse(row.assumptions_json ?? '[]') } catch { parsed = [] }
        if (!parsed.some((a) => a.ok === false)) continue
        /* 假设不过 ≠ 这一阶段没过。真正的标准是：有没有跑过登记的备选检验，
           并且那个备选检验也在记录里。做过退让就是处理了；没做才是问题。 */
        const fb = fallbackIds(row.test_id)
        const handled = fb.some((id) => runIds.has(id))
        if (!handled) dirty.push(row.test_id)
      }
      return dirty.length === 0
        ? { status: 'pass', detail: rows.length > 1 ? `假设不满足处已跑备选检验` : '' }
        : { status: 'fail', detail: `${[...new Set(dirty)].join('、')} 假设不满足且没有备选检验记录` }
    } catch {
      return { status: 'skip', detail: 'analysis 表不可查' }
    }
  }

  if (kind === 'figureReady') {
    try {
      const rows = store.db.prepare('SELECT spec_json, dpi, width_mm FROM figure_spec WHERE project_id = ?').all(projectId)
      if (rows.length === 0) return { status: 'skip', detail: '还没有图' }
      const bad = rows.filter((r) => (r.dpi ?? 0) < 300 || (r.width_mm ?? 0) < 40)
      return bad.length === 0 ? { status: 'pass', detail: `${rows.length} 张` } : { status: 'fail', detail: `${bad.length} 张不达标` }
    } catch {
      return { status: 'skip', detail: 'figure_spec 表不可查' }
    }
  }

  if (kind === 'provenanceOk') {
    try {
      const { verifyChain } = context
      const chain = verifyChain(store, projectId)
      return chain.ok
        ? { status: 'pass', detail: `${chain.entries} 条` }
        : { status: 'fail', detail: `${chain.problems.length} 处异常` }
    } catch {
      return { status: 'skip', detail: '溯源不可查' }
    }
  }

  if (kind === 'auditsForProject') {
    /* audit_run 挂在稿件上（manuscript_id），不挂课题。
       直接按 project_id 数会数成全库的审计次数——那是别人的研究成果。 */
    try {
      const ids = store.db.prepare('SELECT id FROM manuscript WHERE project_id = ?').all(projectId).map((r) => r.id)
      if (ids.length === 0) return { status: 'fail', detail: '还没有挂到课题的稿件，无从审计' }
      const placeholders = ids.map(() => '?').join(',')
      const n = store.db.prepare(`SELECT COUNT(*) AS c FROM audit_run WHERE manuscript_id IN (${placeholders})`).get(...ids).c
      return n >= (check.min ?? 1)
        ? { status: 'pass', detail: `${n} 次` }
        : { status: 'skip', detail: '还没跑过 science_paper_audit（带 manuscriptId 才会落库）' }
    } catch {
      return { status: 'skip', detail: 'audit_run 表不可查' }
    }
  }

  if (kind === 'manuscriptLint') {
    const dirs = projectManuscriptDirs(store, projectId)
    if (dirs.length === 0) return { status: 'fail', detail: '还没有挂到课题的稿件' }
    const reports = dirs.map((d) => readJsonIfExists(join(d.dir, 'lint.json'))).filter(Boolean)
    if (reports.length === 0) return { status: 'skip', detail: '稿件还没跑过 science_manuscript_lint' }
    const blocking = reports.reduce((n, r) => n + (r.blocking ?? 0), 0)
    if (blocking === 0) return { status: 'pass', detail: `block 0（warn ${reports.reduce((n, r) => n + (r.warning ?? 0), 0)}）` }
    const codes = [...new Set(reports.flatMap((r) => r.codes ?? []))]
    return { status: 'fail', detail: `${blocking} 个 block：${codes.join('、')}` }
  }

  if (kind === 'manuscriptBundle') {
    const dirs = projectManuscriptDirs(store, projectId)
    if (dirs.length === 0) return { status: 'fail', detail: '还没有挂到课题的稿件' }
    const reports = dirs.map((d) => readJsonIfExists(join(d.dir, 'build.json'))).filter(Boolean)
    if (reports.length === 0) return { status: 'skip', detail: '还没跑过 science_manuscript_build' }
    const okFormats = [...new Set(reports.flatMap((r) => (r.artifacts ?? []).filter((a) => a.ok).map((a) => String(a.kind ?? a.format ?? ''))))].filter(Boolean)
    if (okFormats.length >= 2) return { status: 'pass', detail: `${okFormats.join(' / ')}` }
    return { status: 'fail', detail: `只出了 ${okFormats.join('/') || '（无）'}，投稿系统常常要 2 种以上` }
  }

  if (kind === 'formatCheck') {
    /* 环境检查是"这台机器装了什么"，与课题无关，靠 tex 编译结果反推：
       出过 pdf 说明环境至少够用；没出过就是没证据。 */
    const dirs = projectManuscriptDirs(store, projectId)
    const reports = dirs.map((d) => readJsonIfExists(join(d.dir, 'build.json'))).filter(Boolean)
    const pdf = reports.some((r) => (r.artifacts ?? []).some((a) => String(a.kind ?? a.format ?? '') === 'pdf' && a.ok))
    return pdf
      ? { status: 'pass', detail: 'PDF 出件成功，TeX 环境够用' }
      : { status: 'skip', detail: '还没有成功的 PDF 出件记录' }
  }

  return { status: 'skip', detail: `未知检查类型 ${kind}` }
}

/**
 * 判一个阶段的全部门。
 *
 * complete 的定义：没有 fail 且没有 skip —— skip 意味着"没查过"，不能算过关。
 * 这与 verify 脚本里的 "missing ⇒ skip, never pass" 是同一条原则。
 */
export function stageStatus(store, projectId, stageId, options = {}) {
  const wf = loadWorkflow()
  const stage = wf.stages.find((s) => s.id === stageId || s.code === stageId)
  if (!stage) throw new Error(`没有阶段 ${stageId}；可用：${wf.stages.map((s) => s.id).join(', ')}`)

  const project = getProject(store, projectId)
  if (!project) throw new Error(`课题不存在：${projectId}`)
  const dir = projectDir(projectId)
  const context = {
    store,
    project,
    plan: project.plan,
    projectId,
    dir,
    verifyChain: options.verifyChain,
  }

  const gates = stage.gates.map((g) => {
    const result = evaluate(g.check, context)
    return {
      id: g.id,
      label: g.label,
      severity: g.severity,
      status: result.status,
      detail: result.detail,
      fix: g.fix,
    }
  })

  const blocking = gates.filter((g) => g.severity === 'blocking' && g.status !== 'pass').length
  const warnings = gates.filter((g) => g.severity === 'warning' && g.status === 'fail').length
  const skipped = gates.filter((g) => g.status === 'skip').length
  const manual = gates.filter((g) => g.status === 'manual').length

  return {
    id: stage.id,
    label: stage.label,
    goal: stage.goal,
    gates,
    blocking,
    warnings,
    skipped,
    manual,
    // complete 的含义是「机器能查的都过了」：
    // skip 说明这件事还没留下记录，warning 说明有该修没修的，两者都不算过。
    // manual 项永远不会变成 pass，所以不计入 complete——但它们一直显示，不会消失。
    complete: blocking === 0 && warnings === 0 && skipped === 0,
    tools: stage.tools,
    artifacts: stage.artifacts,
    failureModes: stage.failureModes,
  }
}

/** 全流程体检：哪些阶段过了、卡在哪、下一步做什么。 */
export function advise(store, projectId, options = {}) {
  const wf = loadWorkflow()
  const project = getProject(store, projectId)
  if (!project) throw new Error(`课题不存在：${projectId}`)

  const stages = wf.stages.map((s) => stageStatus(store, projectId, s.id, options))
  const firstIncomplete = stages.find((s) => !s.complete) ?? null

  // 下一步的取法有优先级：先阻塞，再警告，再「没留下记录」，最后才是自查项。
  // 只取 blocking 会让「当前阶段没有阻塞项但也没做完」的情况变成一片空白——
  // 那时用户最需要的恰恰是那句「去看这些自查项」。
  let chosen = []
  let reason = ''
  if (firstIncomplete) {
    const failing = firstIncomplete.gates.filter((g) => g.status === 'fail')
    const blocking = failing.filter((g) => g.severity === 'blocking')
    const warn = failing.filter((g) => g.severity === 'warning')
    const skipped = firstIncomplete.gates.filter((g) => g.status === 'skip')
    const manual = firstIncomplete.gates.filter((g) => g.status === 'manual')
    if (blocking.length) { chosen = blocking; reason = 'blocking' }
    else if (warn.length) { chosen = warn; reason = 'warning' }
    else if (skipped.length) { chosen = skipped; reason = 'unrecorded' }
    else { chosen = manual; reason = 'self-check' }
  }

  const nextActions = chosen.map((g) => ({
    gate: g.id,
    label: g.label,
    fix: g.fix,
    detail: g.detail,
    reason,
  }))

  return {
    projectId,
    project: {
      id: project.id,
      title: project.title,
      domain: project.domain,
      status: project.status,
      designId: project.designId,
      targetJournal: project.targetJournal,
    },
    current: firstIncomplete ? { id: firstIncomplete.id, label: firstIncomplete.label, goal: firstIncomplete.goal } : null,
    stages: stages.map((s) => ({
      id: s.id,
      label: s.label,
      complete: s.complete,
      blocking: s.blocking,
      warnings: s.warnings,
      skipped: s.skipped,
      manual: s.manual,
    })),
    nextActions,
    tools: firstIncomplete ? firstIncomplete.tools : [],
    failureModes: firstIncomplete ? firstIncomplete.failureModes : [],
    globalRules: wf.globalRules,
    done: stages.every((s) => s.complete),
  }
}
