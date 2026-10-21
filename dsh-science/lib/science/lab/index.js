/**
 * M6 实验层（lab）的入口。
 *
 * 模块分工：
 *   project.js   课题：建 / 读 / 改状态 / 存方案
 *   plan.js      方案：学科设计 → 前置条件 + 威胁 + 样本量 + 预注册草稿 + 关口
 *   power.js     样本量与 MDE（statsmodels，走 Python）
 *   runner.js    执行：受控目录 + 无网络钩子 + 输入/产物指纹
 *   query.js     聚合：课题总览、分析列表、图列表
 *   provenance.js 溯源：链式 hash，可验证是否被改动
 *   stats.js     统计执行器（M6c）
 *   figures.js   作图执行器（M6c）
 */
export * as project from './project.js'
export * as plan from './plan.js'
export * as power from './power.js'
export * as runner from './runner.js'
export * as query from './query.js'
export * as provenance from './provenance.js'
export * as stats from './stats.js'
export * as figures from './figures.js'

export {
  createProject, getProject, listProjects, setStatus, savePlan, readCard,
  projectDir, projectsRoot, PROJECT_SUBDIRS, PROJECT_STATUSES,
} from './project.js'
export {
  buildPlan, persistPlan, createExperiment, getExperiment, listExperiments,
} from './plan.js'
export { sampleSize, minimumDetectableEffect, designEffect, resolvePython, runPy } from './power.js'
export { runExperiment, getRun, listRuns, assertInside, probeEnv } from './runner.js'
export { projectOverview, listAnalyses, getAnalysis, listFigures } from './query.js'
export { append as logEvent, listByProject, listBySubject, verifyChain, stableJson } from './provenance.js'
export { runStats, renderResultMarkdown, parseCsv, readProjectCsv, getTest, listTestIds, loadStatistics } from './stats.js'
export { runFigure, listPresets as listFigurePresets, PRESETS as FIGURE_PRESETS } from './figures.js'
