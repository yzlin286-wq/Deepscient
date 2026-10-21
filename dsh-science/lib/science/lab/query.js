/**
 * 查询：把库里散落的 project / experiment / run / analysis / figure 拼成能读的一张图。
 *
 * 这一层不做判断，只做聚合与裁剪——但裁剪规则很重要：
 * 默认只给最近几次，因为研究者在推进时关心"上一次怎么样"，
 * 而写论文时要的是"全部"，那时传 limit 更大的值。
 */
import { getProject, projectDir, ethicsStatus } from './project.js'
import { listRuns, getRun } from './runner.js'
import { listExperiments } from './plan.js'
import { listByProject, verifyChain } from './provenance.js'

/** 课题总览：一次调用回答「我这个课题现在到哪一步了」。 */
export function projectOverview(store, projectId, { runLimit = 5 } = {}) {
  const project = getProject(store, projectId)
  if (!project) return null
  const experiments = listExperiments(store, projectId)
  const runs = listRuns(store, projectId, { limit: runLimit })
  const analyses = listAnalyses(store, projectId, { limit: 10 })
  const figures = listFigures(store, projectId, { limit: 10 })
  const chain = verifyChain(store, projectId)

  const counts = {
    experiments: experiments.length,
    runs: store.db.prepare('SELECT COUNT(*) AS c FROM experiment_run WHERE project_id = ?').get(projectId).c,
    okRuns: store.db.prepare("SELECT COUNT(*) AS c FROM experiment_run WHERE project_id = ? AND status = 'ok'").get(projectId).c,
    failedRuns: store.db.prepare("SELECT COUNT(*) AS c FROM experiment_run WHERE project_id = ? AND status = 'failed'").get(projectId).c,
    analyses: store.db.prepare('SELECT COUNT(*) AS c FROM analysis WHERE project_id = ?').get(projectId).c,
    figures: store.db.prepare('SELECT COUNT(*) AS c FROM figure_spec WHERE project_id = ?').get(projectId).c,
  }

  const missing = []
  if (!project.plan) missing.push('方案（跑 science_exp_plan）')
  if (counts.runs === 0) missing.push('一次执行记录（跑 science_exp_run）')
  if (counts.analyses === 0) missing.push('统计分析（跑 science_stats）')
  if (counts.figures === 0) missing.push('图（跑 science_figure）')
  if (!project.preregRef) missing.push('预注册 DOI（填到课题卡里）')
  const ethics = ethicsStatus(project)
  if (!ethics.recorded) missing.push(`伦理备案（${ethics.missing.join('、')}）`)

  return {
    project: {
      id: project.id,
      title: project.title,
      domain: project.domain,
      status: project.status,
      designId: project.designId,
      question: project.question,
      preregRef: project.preregRef,
      ethics: project.ethics,
      dir: project.dir,
    },
    counts,
    experiments,
    runs,
    analyses,
    figures,
    missing,
    provenance: { ok: chain.ok, entries: chain.entries, head: chain.head, problems: chain.problems },
  }
}

/** 列统计与作图结果。 */
export function listAnalyses(store, projectId, { limit = 20, testId } = {}) {
  const rows = testId
    ? store.db.prepare('SELECT * FROM analysis WHERE project_id = ? AND test_id = ? ORDER BY created_at DESC LIMIT ?').all(projectId, testId, limit)
    : store.db.prepare('SELECT * FROM analysis WHERE project_id = ? ORDER BY created_at DESC LIMIT ?').all(projectId, limit)
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    testId: row.test_id,
    method: row.method,
    seed: row.seed,
    createdAt: row.created_at,
    summary: summarizeResult(row.result_json),
  }))
}

export function getAnalysis(store, id) {
  const row = store.db.prepare('SELECT * FROM analysis WHERE id = ?').get(String(id))
  if (!row) return null
  return {
    id: row.id,
    projectId: row.project_id,
    runId: row.run_id,
    kind: row.kind,
    testId: row.test_id,
    spec: row.spec_json ? JSON.parse(row.spec_json) : null,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    method: row.method,
    seed: row.seed,
    assumptions: row.assumptions_json ? JSON.parse(row.assumptions_json) : null,
    createdAt: row.created_at,
  }
}

export function listFigures(store, projectId, { limit = 20 } = {}) {
  return store.db.prepare('SELECT * FROM figure_spec WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, limit)
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      path: row.path,
      widthMm: row.width_mm,
      heightMm: row.height_mm,
      dpi: row.dpi,
      analysisId: row.analysis_id,
      createdAt: row.created_at,
    }))
}

/** 从 result_json 里抽一句话摘要。 */
function summarizeResult(resultJson) {
  if (!resultJson) return ''
  let r
  try { r = JSON.parse(resultJson) } catch { return '' }
  if (r.summary) return String(r.summary)
  const bits = []
  if (r.statistic !== undefined) bits.push(`统计量 ${formatNum(r.statistic)}`)
  if (r.df !== undefined) bits.push(`df ${formatNum(r.df)}`)
  if (r.p !== undefined) bits.push(`p ${formatP(r.p)}`)
  if (r.effectSize !== undefined && r.effectSize !== null) bits.push(`效应量 ${formatNum(r.effectSize)}`)
  return bits.join('，')
}

function formatNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? (Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(3)) : String(v)
}

function formatP(p) {
  const n = Number(p)
  if (!Number.isFinite(n)) return String(p)
  return n < 0.001 ? '< .001' : n.toFixed(3).replace(/^0/, '')
}

/** 按对象取溯源链。 */
export function traceSubject(store, subject, subjectId) {
  return listByProject(store, String(subjectId)).length > 0
    ? listByProject(store, String(subjectId))
    : []
}

export { listByProject, verifyChain, listRuns, getRun, projectDir }
