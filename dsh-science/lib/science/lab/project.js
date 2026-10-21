/**
 * 课题：一个课题 = 一个能写完的故事。
 *
 * 这里只做三件事：建、读、改状态。判断不在这里——方案在 plan.js，
 * 执行在 runner.js，统计在 stats.js。project 是那条把所有东西串起来的线。
 *
 * 目录布局（$DSH_HOME/science/projects/<id>/）：
 *   project.json    人读的课题卡（与库里同步，库是权威）
 *   plan.md         方案（人读）
 *   data/           原始数据，只读
 *   code/           分析脚本
 *   figures/        图产物
 *   protocols/      实验规程与材料
 *   env/            环境指纹
 *   experiments/<slug>/<runId>/   每一次执行
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { append } from './provenance.js'
import { matchDiscipline, loadDiscipline } from '../discipline/index.js'

export const PROJECT_SUBDIRS = ['data', 'code', 'figures', 'protocols', 'env', 'experiments']
export const PROJECT_STATUSES = ['open', 'designing', 'running', 'analyzing', 'writing', 'done']

export function projectsRoot() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'science', 'projects')
}

export function projectDir(id) {
  return join(projectsRoot(), String(id))
}

function slugify(text) {
  const ascii = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return ascii || 'project'
}

function makeId(title) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `${slugify(title)}-${stamp}-${randomUUID().slice(0, 4)}`
}

/** 建课题：目录 + 库行 + 溯源，一次做完；失败时不留半截目录。 */
export function createProject(store, { title, domain, question, designId, targetJournal, ethics, dataLicense } = {}) {
  const cleanTitle = String(title ?? '').trim()
  if (!cleanTitle) throw new Error('必须给 title')
  const id = makeId(cleanTitle)
  const dir = projectDir(id)
  if (existsSync(dir)) throw new Error(`课题目录已存在：${dir}`)

  const match = matchDiscipline({ domain, journal: targetJournal, question })
  const pack = loadDiscipline(match.id)
  const ethicsRecord = normalizeEthics(ethics, dataLicense)

  for (const sub of PROJECT_SUBDIRS) mkdirSync(join(dir, sub), { recursive: true })

  const now = Date.now()
  const card = {
    id,
    title: cleanTitle,
    domain: match.id,
    domainLabel: pack?.label ?? match.id,
    match: { matchedBy: match.matchedBy, confidence: match.confidence, candidates: match.candidates },
    question: question ?? '',
    designId: designId ?? '',
    targetJournal: targetJournal ?? '',
    ethics: ethicsRecord,
    status: 'open',
    createdAt: now,
  }
  writeFileSync(join(dir, 'project.json'), `${JSON.stringify(card, null, 2)}\n`, 'utf8')
  writeFileSync(join(dir, 'env', 'env.json'), `${JSON.stringify({ note: '运行实验时自动填充解释器与库版本', createdAt: now }, null, 2)}\n`, 'utf8')

  store.db.prepare(`
    INSERT INTO project(id, title, domain, question, design_id, target_journal, status, match_json, ethics_json, created_at, updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, cleanTitle, match.id, question ?? null, designId ?? null, targetJournal ?? null, 'open', JSON.stringify(card.match), JSON.stringify(ethicsRecord), now, now)

  append(store, {
    projectId: id,
    subject: 'project',
    subjectId: id,
    action: 'create',
    detail: { title: cleanTitle, domain: match.id, matchedBy: match.matchedBy, hasEthics: ethicsRecord.approvalId !== '' },
  })

  return { ...card, dir, subdirs: PROJECT_SUBDIRS }
}

/**
 * 伦理与数据许可。
 *
 * `ethics` 允许两种写法：一串批号（最常见），或 { approvalId, committee, body, consent }。
 * 字段留空就是留空——不替用户填「已获批准」，因为那句话进了论文就是学术不端。
 */
export function normalizeEthics(ethics, dataLicense) {
  const base = { approvalId: '', committee: '', body: '', consent: '', dataLicense: '', recordedAt: null }
  if (ethics && typeof ethics === 'object') {
    base.approvalId = String(ethics.approvalId ?? '').trim()
    base.committee = String(ethics.committee ?? '').trim()
    base.body = String(ethics.body ?? '').trim()
    base.consent = String(ethics.consent ?? '').trim()
  } else if (ethics !== undefined && ethics !== null) {
    base.approvalId = String(ethics).trim()
  }
  if (dataLicense !== undefined && dataLicense !== null) base.dataLicense = String(dataLicense).trim()
  if (base.approvalId || base.committee || base.consent || base.dataLicense) base.recordedAt = Date.now()
  return base
}

/** 这个课题是否涉及需要伦理备案的对象，以及备案是否齐。 */
export function ethicsStatus(project) {
  const ethics = project?.ethics ?? null
  const missing = []
  if (!ethics || !ethics.approvalId) missing.push('伦理批号（approvalId）')
  if (!ethics || !ethics.body) missing.push('研究对象类型（人类/动物/细胞系/二手数据）')
  return { recorded: Boolean(ethics && ethics.recordedAt), missing, ethics }
}

/** 读课题。id 不存在返回 null。 */
export function getProject(store, id) {
  const row = store.db.prepare('SELECT * FROM project WHERE id = ?').get(String(id))
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    domain: row.domain,
    question: row.question,
    designId: row.design_id,
    targetJournal: row.target_journal,
    status: row.status,
    match: row.match_json ? JSON.parse(row.match_json) : null,
    plan: row.plan_json ? JSON.parse(row.plan_json) : null,
    preregRef: row.prereg_ref,
    ethics: row.ethics_json ? JSON.parse(row.ethics_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dir: projectDir(row.id),
  }
}

/** 列课题，按更新时间倒序。 */
export function listProjects(store, { limit = 30, status } = {}) {
  const rows = status
    ? store.db.prepare('SELECT * FROM project WHERE status = ? ORDER BY updated_at DESC LIMIT ?').all(status, limit)
    : store.db.prepare('SELECT * FROM project ORDER BY updated_at DESC LIMIT ?').all(limit)
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    domain: row.domain,
    status: row.status,
    designId: row.design_id,
    updatedAt: row.updated_at,
    hasPlan: Boolean(row.plan_json),
  }))
}

/**
 * 改状态。状态只能往前走，不能悄悄回退——回退要显式 force。
 * 这条规则存在的原因：把课题从 writing 改回 open 会让人以为「还没做完」，掩盖了已有的分析。
 */
const ORDER = { open: 0, designing: 1, running: 2, analyzing: 3, writing: 4, done: 5 }

export function setStatus(store, id, status, { force = false, actor = 'agent' } = {}) {
  if (!PROJECT_STATUSES.includes(status)) throw new Error(`未知状态：${status}`)
  const project = getProject(store, id)
  if (!project) throw new Error(`课题不存在：${id}`)
  if (!force && ORDER[status] < ORDER[project.status]) {
    throw new Error(`状态不能从 ${project.status} 回退到 ${status}（要回退请显式 force）`)
  }
  const now = Date.now()
  store.db.prepare('UPDATE project SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id)
  append(store, {
    projectId: id,
    subject: 'project',
    subjectId: id,
    action: 'update',
    actor,
    detail: { from: project.status, to: status, forced: force },
  })
  return { id, from: project.status, to: status }
}

/** 写方案（plan.js 调）。同时落库与 plan.md。 */
export function savePlan(store, id, plan) {
  const project = getProject(store, id)
  if (!project) throw new Error(`课题不存在：${id}`)
  const now = Date.now()
  store.db.prepare('UPDATE project SET plan_json = ?, design_id = COALESCE(?, design_id), updated_at = ? WHERE id = ?')
    .run(JSON.stringify(plan), plan.designId ?? null, now, id)
  const dir = projectDir(id)
  const md = renderPlanMarkdown(project, plan)
  writeFileSync(join(dir, 'plan.md'), md, 'utf8')
  append(store, {
    projectId: id,
    subject: 'project',
    subjectId: id,
    action: 'update',
    detail: { plan: true, designId: plan.designId, n: plan.sample?.nTotal ?? null },
  })
  return { path: join(dir, 'plan.md'), bytes: Buffer.byteLength(md, 'utf8') }
}

function renderPlanMarkdown(project, plan) {
  const lines = []
  lines.push(`# ${project.title}`, '')
  lines.push(`- 学科：${plan.domainLabel ?? project.domain}（${plan.domain}）`)
  if (plan.designLabel) lines.push(`- 设计：${plan.designLabel}`)
  if (plan.question) lines.push(`- 问题：${plan.question}`)
  if (project.targetJournal) lines.push(`- 目标刊：${project.targetJournal}`)
  lines.push(`- 生成时间：${new Date().toISOString()}`)
  lines.push('')
  if (plan.hypothesis) {
    lines.push('## 假设', '', plan.hypothesis, '')
  }
  if (plan.sample) {
    lines.push('## 样本量', '')
    lines.push(`- 依据：${plan.sample.method}`)
    lines.push(`- 参数：α=${plan.sample.alpha}，power=${plan.sample.power}，效应量=${plan.sample.effect}（${plan.sample.effectKind}）`)
    lines.push(`- 结果：每组 ${plan.sample.nPerGroup ?? '—'}，总计 ${plan.sample.nTotal}`)
    if (plan.sample.designEffect > 1) lines.push(`- 设计效应校正：×${plan.sample.designEffect}`)
    lines.push('')
  }
  if (plan.design?.requires?.length) {
    lines.push('## 前置条件（缺一条这个设计就不成立）', '')
    for (const r of plan.design.requires) lines.push(`- [ ] ${r}`)
    lines.push('')
  }
  if (plan.threats?.length) {
    lines.push('## 威胁与对策', '', '| 风险 | 对策 |', '| --- | --- |')
    for (const t of plan.threats) lines.push(`| ${t.risk} | ${t.mitigation} |`)
    lines.push('')
  }
  if (plan.measurements?.length) {
    lines.push('## 测量', '')
    for (const m of plan.measurements) lines.push(`- **${m.label}**（${m.unit}）：${m.how}；伪迹：${m.artifact}；校准：${m.calibration}`)
    lines.push('')
  }
  if (plan.methods?.length) {
    lines.push('## 分析计划', '')
    for (const m of plan.methods) lines.push(`- **${m.label}**（${m.tool}）：适用 ${m.when}；注意 ${m.pitfall}`)
    lines.push('')
  }
  if (plan.reporting?.length || plan.reportingExternal?.length) {
    lines.push('## 报告规范', '')
    if (plan.reporting?.length) lines.push(`- 机器可校验：${plan.reporting.join('、')}`)
    if (plan.reportingExternal?.length) lines.push(`- 外部标准（需人工对照）：${plan.reportingExternal.join('、')}`)
    lines.push('')
  }
  if (plan.nextSteps?.length) {
    lines.push('## 下一步', '')
    for (const s of plan.nextSteps) lines.push(`- [ ] ${s}`)
    lines.push('')
  }
  return lines.join('\n')
}

/** 从磁盘 project.json 反读（库丢了还能救回来）。 */
export function readCard(id) {
  const file = join(projectDir(id), 'project.json')
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8'))
}
