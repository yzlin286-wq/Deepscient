/**
 * 战役交付物：把 campaign_shard 的真实输出变成可核验的证据、报告与稿件。
 *
 * 设计取舍：
 *   - 只读库：报告里的每个数字都能追到某个已完成分片，缺证据只进 gaps，绝不补齐
 *   - 纯函数式渲染：同输入必得同字节，幂等判定才有意义，因此不写时间戳与运行耗时
 *   - 路径只写相对量：报告/稿件/清单要能直接进仓库，不能混进本机绝对路径
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { loadPlan } from './plan.js'

/** 分片输出里带 elapsedMs，它每次运行都不同；参与哈希会让幂等永远失败。 */
const HASH_IGNORED = new Set(['elapsedMs'])

const STATS_ITEMS = [
  { field: 'n', claim: '有效配对数', unit: '对' },
  { field: 'statistic', claim: '配对 t 统计量', unit: 't' },
  { field: 'df', claim: '自由度', unit: 'df' },
  { field: 'p', claim: '双侧 p 值', unit: 'p' },
  { field: 'meanDiff', claim: '平均差值', unit: 'mean difference' },
  { field: 'effectSize', claim: "效应量 Cohen's dz", unit: 'dz' },
]

const sha256Text = (text) => createHash('sha256').update(String(text), 'utf8').digest('hex')

/** 键排序后序列化：只比内容，不比字段顺序。 */
function canonicalise(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((entry) => canonicalise(entry))
  if (typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      if (HASH_IGNORED.has(key) || value[key] === undefined) continue
      out[key] = canonicalise(value[key])
    }
    return out
  }
  return null
}

function stableHash(value) {
  return sha256Text(JSON.stringify(canonicalise(value)))
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function finite(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** 统一样式：整数原样，p 用科学计数法，其余保留 4 位，便于报告与稿件对齐。 */
function formatValue(value, unit = '') {
  if (typeof value === 'string') return value
  const n = finite(value)
  if (n === null) return String(value ?? '')
  if (Number.isInteger(n)) return String(n)
  if (unit === 'p' && n !== 0 && Math.abs(n) < 1e-4) return n.toExponential(2)
  return n.toFixed(4)
}

/** 统计输出里参与 figure inputHash 的字段：全部确定性字段，剔除耗时。 */
function statsValueOf(output) {
  if (!output || typeof output !== 'object') return null
  const effect = output.effectSize && typeof output.effectSize === 'object'
    ? output.effectSize
    : null
  return {
    n: finite(output.n),
    meanA: finite(output.meanA),
    meanB: finite(output.meanB),
    meanDiff: finite(output.meanDiff),
    sdDiff: finite(output.sdDiff),
    statistic: finite(output.statistic),
    p: finite(output.p),
    df: finite(output.df),
    effectSize: effect ? { kind: effect.kind ?? null, value: finite(effect.value), ci: effect.ci ?? null } : null,
    csvSha256: output.csvSha256 ?? null,
    columns: output.columns ?? null,
  }
}

function parseMaybeJson(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') return value
  try { return JSON.parse(String(value)) } catch { return null }
}

function outputOf(shard) {
  const parsed = parseMaybeJson(shard?.output)
  return parsed && typeof parsed === 'object' ? parsed : null
}

/** 已完成分片按 task_id、shard_index 排序：items 顺序稳定，报告才能逐字节复现。 */
function orderedShards(plan) {
  return [...(plan.shards ?? [])].sort((a, b) => {
    const byTask = String(a.taskId).localeCompare(String(b.taskId))
    if (byTask !== 0) return byTask
    if (Number(a.shardIndex) !== Number(b.shardIndex)) return Number(a.shardIndex) - Number(b.shardIndex)
    return String(a.id).localeCompare(String(b.id))
  })
}

function collect({ store, campaignId } = {}) {
  if (!store) throw new Error('需要 ScienceStore 实例')
  if (!campaignId) throw new Error('需要 campaignId')

  const plan = loadPlan(store, campaignId)
  const campaign = plan.campaign ?? {}
  const question = String(campaign.question ?? '')
  const planHash = String(campaign.plan_hash ?? campaign.planHash ?? '')
  const shards = orderedShards(plan)
  const taskTitle = new Map((plan.tasks ?? []).map((task) => [task.id, task.title]))

  const done = shards.filter((shard) => shard.state === 'done')
  const statsOutputs = new Map()
  for (const shard of done) {
    if (shard.kind !== 'stats.paired') continue
    const output = outputOf(shard)
    if (output) statsOutputs.set(shard.taskId, output)
  }
  const figureInputHash = (taskId) => {
    const stats = statsOutputs.get(String(taskId ?? ''))
    const value = statsValueOf(stats)
    return value ? stableHash(value) : null
  }

  const items = []

  for (const shard of done) {
    const output = outputOf(shard)
    if (!output) continue
    const source = { table: 'campaign_shard', taskId: shard.taskId, shardId: shard.id }
    const shardIndex = Number(shard.shardIndex) || 0

    if (shard.kind === 'stats.paired') {
      const inputHash = output.csvSha256 ?? stableHash(shard.payload ?? null)
      for (const spec of STATS_ITEMS) {
        let value
        if (spec.field === 'effectSize') {
          value = finite(output.effectSize?.value)
        } else {
          value = finite(output[spec.field])
        }
        if (value === null) continue
        items.push({
          id: `${shard.id}:${spec.field}`,
          claim: spec.claim,
          value,
          unit: spec.unit,
          source,
          tool: 'science_stats',
          inputHash,
        })
      }
      continue
    }

    if (shard.kind === 'data.load') {
      // executors 的 data.load 输出字段是 sha256；兼容上游曾用过的 csvSha256
      const dataHash = output.sha256 ?? output.csvSha256 ?? null
      const inputHash = stableHash(shard.payload ?? null)
      const rows = finite(output.rows)
      if (rows !== null) {
        items.push({
          id: `${shard.id}:rows`, claim: '装载数据行数', value: rows, unit: '行', source, tool: 'science_data', inputHash,
        })
      }
      if (Array.isArray(output.columns) && output.columns.length > 0) {
        items.push({
          id: `${shard.id}:columns`, claim: '装载数据列名', value: output.columns.join(', '), unit: '列', source, tool: 'science_data', inputHash,
        })
      }
      if (dataHash) {
        items.push({
          id: `${shard.id}:sha256`, claim: '数据文件 sha256', value: String(dataHash), unit: 'sha256', source, tool: 'science_data', inputHash,
        })
      }
    }
  }

  /* figure 的 sha256 只存在 campaign_artifact 里（executors 的 output.files 不含哈希），
     所以按产物表取，而不是重新读文件。 */
  const artifacts = typeof store.listArtifacts === 'function'
    ? store.listArtifacts({ campaignId })
    : []
  const shardById = new Map(shards.map((shard) => [shard.id, shard]))
  const figures = artifacts
    .filter((artifact) => artifact.kind === 'figure' && artifact.sha256)
    .map((artifact) => {
      const shard = shardById.get(artifact.shard_id) ?? null
      return {
        artifact,
        taskId: artifact.task_id ?? shard?.taskId ?? '',
        shardIndex: Number(shard?.shardIndex) || 0,
        format: extname(String(artifact.path ?? '')).replace('.', '').toLowerCase() || 'file',
      }
    })
    .sort((a, b) => {
      const byTask = String(a.taskId).localeCompare(String(b.taskId))
      if (byTask !== 0) return byTask
      if (a.shardIndex !== b.shardIndex) return a.shardIndex - b.shardIndex
      return a.format.localeCompare(b.format)
    })

  for (const entry of figures) {
    const shard = shardById.get(entry.artifact.shard_id) ?? null
    const payload = shard?.payload && typeof shard.payload === 'object' ? shard.payload : {}
    // figure 分片自己的 taskId 不是统计任务；按 payload 指回的 statsTaskId 取上游统计值
    const statsTaskId = payload.statsTaskId ?? payload.stats_task_id ?? null
    items.push({
      id: `${entry.artifact.shard_id ?? entry.artifact.id}:${entry.format}`,
      claim: `配对图 ${entry.format.toUpperCase()}（${basename(String(entry.artifact.path ?? ''))}）`,
      value: String(entry.artifact.sha256),
      unit: 'sha256',
      source: {
        table: 'campaign_shard',
        taskId: entry.taskId,
        shardId: entry.artifact.shard_id ?? shard?.id ?? null,
      },
      tool: entry.artifact.tool ?? 'science_figure',
      inputHash: figureInputHash(statsTaskId)
        ?? entry.artifact.input_hash
        ?? stableHash(shard?.payload ?? null),
    })
  }

  /* 产物表按 task_id + shard_index 排序输出：调用方拿到的 items 顺序不随查询计划变化 */
  const shardIndexById = new Map(shards.map((shard) => [shard.id, Number(shard.shardIndex) || 0]))
  const ordered = items
    .map((item, seq) => ({ item, seq }))
    .sort((a, b) => {
      const byTask = String(a.item.source.taskId).localeCompare(String(b.item.source.taskId))
      if (byTask !== 0) return byTask
      const ai = shardIndexById.get(a.item.source.shardId) ?? 0
      const bi = shardIndexById.get(b.item.source.shardId) ?? 0
      if (ai !== bi) return ai - bi
      return a.seq - b.seq
    })
    .map((entry) => entry.item)

  const gaps = []
  const literatureMissing = shards.filter((shard) => {
    const output = outputOf(shard)
    return shard.kind === 'literature.extract' && output?.missing === true
  }).length
  if (literatureMissing > 0) {
    gaps.push({
      id: 'gap-literature-offline',
      kind: 'literature-offline',
      detail: `${literatureMissing} 条文献分片无本地来源`,
      impact: '综述与新颖性判断仅覆盖本地参考',
      next: '联网后跑 science_search 或补齐 refs.json',
    })
  }

  const groupByTask = (state) => {
    const counts = new Map()
    for (const shard of shards) {
      if (shard.state !== state) continue
      counts.set(shard.taskId, (counts.get(shard.taskId) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  }

  for (const [taskId, count] of groupByTask('needs-human')) {
    const title = taskTitle.get(taskId)
    gaps.push({
      id: `gap-human-${taskId}`,
      kind: 'human-gate',
      detail: `${taskId}${title ? `「${title}」` : ''}有 ${count} 个分片待人工处理`,
      impact: '伦理登记或 PI 放行未完成，当前结论不得视为已获批',
      next: '由数据管理员 / PI 在人工门禁签核后重新调度',
    })
  }

  for (const [taskId, count] of groupByTask('needs-review')) {
    const title = taskTitle.get(taskId)
    gaps.push({
      id: `gap-review-${taskId}`,
      kind: 'gate-blocked',
      detail: `${taskId}${title ? `「${title}」` : ''}有 ${count} 个分片未通过门禁或共识`,
      impact: '该环节的结论不可直接引用',
      next: '人工复核该分片的工具输出，确认后放行或重跑',
    })
  }

  const failed = groupByTask('failed')
  if (failed.length > 0) {
    const total = failed.reduce((sum, entry) => sum + entry[1], 0)
    gaps.push({
      id: 'gap-shard-failed',
      kind: 'shard-failed',
      detail: `${total} 个分片执行失败（涉及 ${failed.length} 个任务）`,
      impact: '对应证据缺失，交付物只覆盖已成功的分片',
      next: '查看分片 error 与重试次数，修正输入后重跑该任务',
    })
  }

  if (statsOutputs.size === 0) {
    gaps.push({
      id: 'gap-missing-stats',
      kind: 'missing-stats',
      detail: '没有任何已完成的 stats.paired 分片',
      impact: '无法给出可核验的定量结论',
      next: '检查数据装载与统计分片的失败原因后重跑',
    })
  }

  return {
    plan,
    artifacts,
    evidence: { campaignId, question, planHash, items: ordered, gaps },
  }
}

export function buildEvidence({ store, campaignId }) {
  return collect({ store, campaignId }).evidence
}

function statsField(items, claim) {
  return items.find((item) => item.claim === claim) ?? null
}

/** 结论只允许出现 items 里的数字；一条都凑不出时明确说明没有定量结论。 */
function conclusionBullets(items) {
  const n = statsField(items, '有效配对数')
  const statistic = statsField(items, '配对 t 统计量')
  const df = statsField(items, '自由度')
  const p = statsField(items, '双侧 p 值')
  const meanDiff = statsField(items, '平均差值')
  const dz = statsField(items, "效应量 Cohen's dz")
  const rows = statsField(items, '装载数据行数')
  const columns = statsField(items, '装载数据列名')
  const dataHash = statsField(items, '数据文件 sha256')

  const bullets = []
  if (n && statistic && df && p) {
    bullets.push(`配对样本 n = ${formatValue(n.value)}（df = ${formatValue(df.value)}），双侧配对 t 检验 t(${formatValue(df.value)}) = ${formatValue(statistic.value)}，p = ${formatValue(p.value, 'p')}。`)
  }
  if (meanDiff && dz) {
    bullets.push(`平均差值为 ${formatValue(meanDiff.value)}，效应量 Cohen's dz = ${formatValue(dz.value)}；差值符号表示两个条件之间的方向。`)
  }
  if (rows && columns) {
    bullets.push(`数据装载校验为 ${formatValue(rows.value)} 行、${String(columns.value).split(',').length} 列，列名为 ${columns.value}。`)
  }
  if (dataHash) {
    bullets.push(`数据文件 sha256 前 12 位为 ${String(dataHash.value).slice(0, 12)}，可作为输入未被改动的校验点。`)
  }
  if (p && finite(p.value) !== null && Number(p.value) < 0.05 && bullets.length > 0) {
    bullets.push(`p = ${formatValue(p.value, 'p')} 低于事前约定的 α = 0.05，本次比较达到常规显著性阈值。`)
  }

  return bullets.length > 0 ? bullets : ['本战役未产生可核验的定量结论。']
}

function composeReport({ store, campaignId, evidence, plan }) {
  const items = evidence.items
  const gaps = evidence.gaps
  const shards = plan.shards ?? []
  const lines = []

  lines.push(`# ${evidence.question || campaignId} · 战役报告`, '')

  lines.push('## 结论', '')
  for (const bullet of conclusionBullets(items)) lines.push(`- ${bullet}`)
  lines.push('')

  lines.push('## 证据表', '')
  lines.push('| 指标 | 值 | 来源 | 输入哈希前 12 位 |')
  lines.push('| --- | --- | --- | --- |')
  if (items.length === 0) {
    lines.push('| （无） | — | — | — |')
  } else {
    for (const item of items) {
      const source = `${item.source.table} · ${item.source.taskId}#${item.source.shardId ? item.source.shardId.split('_').pop() : '?'}`
      lines.push(`| ${item.claim} | ${formatValue(item.value, item.unit)} | ${source} | ${String(item.inputHash ?? '').slice(0, 12)} |`)
    }
  }
  lines.push('')

  lines.push('## 缺口与下一步', '')
  if (gaps.length === 0) {
    lines.push('无')
  } else {
    for (const gap of gaps) {
      lines.push(`- **${gap.kind}**：${gap.detail}；影响：${gap.impact}；下一步：${gap.next}`)
    }
  }
  lines.push('')

  const stats = typeof store.campaignStats === 'function'
    ? store.campaignStats({ campaignId })
    : { tasks: { total: 0 }, shards: {} }
  const byRole = {}
  for (const shard of shards) {
    const role = String(shard.role ?? 'unknown')
    byRole[role] = (byRole[role] ?? 0) + 1
  }
  const roleLine = Object.keys(byRole).sort().map((role) => `${role} ${byRole[role]}`).join(' · ') || '无'
  let voteCount = 0
  let escalateCount = 0
  try {
    voteCount = typeof store.listVotes === 'function' ? store.listVotes({ campaignId }).length : 0
    const events = typeof store.listEvents === 'function' ? store.listEvents({ campaignId, limit: 2000 }) : []
    escalateCount = events.filter((event) => event.kind === 'shard-needs-human').length
  } catch { /* 事件/投票读不到不影响主体报告；计数按 0 呈现 */ }

  lines.push('## 组织与调度', '')
  lines.push(`- 岗位分工：${roleLine}`)
  lines.push(`- 任务与分片：任务 ${stats.tasks?.total ?? (plan.tasks ?? []).length} 个 · 分片 ${shards.length} 个`)
  lines.push(`- 分片状态：完成 ${stats.shards?.done ?? 0} · 失败 ${stats.shards?.failed ?? 0} · 待人工 ${stats.shards?.needsHuman ?? 0} · 待复核 ${stats.shards?.needsReview ?? 0} · 队列 ${stats.shards?.queued ?? 0}`)
  lines.push(`- 协作：投票记录 ${voteCount} 条 · 转人工事件 ${escalateCount} 条`)
  lines.push('')

  return lines.join('\n')
}

export function renderReport({ store, campaignId }) {
  const collected = collect({ store, campaignId })
  const markdown = composeReport({ store, campaignId, evidence: collected.evidence, plan: collected.plan })
  return { markdown, evidence: collected.evidence, gaps: collected.evidence.gaps }
}

function softwareLine(plan, statsTaskIdHint) {
  // 工具输出只记 backend，不记版本号；scipy 分支就按 scipy 写，不编造版本
  for (const shard of plan.shards ?? []) {
    if (shard.kind !== 'stats.paired' || shard.state !== 'done') continue
    const output = outputOf(shard)
    if (!output) continue
    if (statsTaskIdHint && shard.taskId !== statsTaskIdHint) continue
    return output.backend === 'js'
      ? '统计实现为本地 JS 兜底（与 `scipy.stats.ttest_rel` 同口径），工具输出未记录 scipy 版本号'
      : '统计软件为 scipy，工具输出未记录具体版本号'
  }
  return '统计软件为 scipy（工具输出未提供版本信息）'
}

function composePaper({ evidence, plan }) {
  const items = evidence.items
  const gaps = evidence.gaps
  const n = statsField(items, '有效配对数')
  const statistic = statsField(items, '配对 t 统计量')
  const df = statsField(items, '自由度')
  const p = statsField(items, '双侧 p 值')
  const meanDiff = statsField(items, '平均差值')
  const dz = statsField(items, "效应量 Cohen's dz")

  const lines = []
  lines.push('---')
  lines.push(`title: "${String(evidence.question || '').replace(/"/g, '\\"')}"`)
  lines.push('journal: 待定')
  lines.push('status: draft')
  lines.push(`campaign: ${evidence.campaignId}`)
  lines.push('---', '')
  lines.push(`# ${evidence.question}`, '')

  lines.push('## 摘要', '')
  if (n && statistic && p && dz) {
    const dfText = df ? `(${formatValue(df.value)})` : ''
    const diffText = meanDiff ? `，平均差值为 ${formatValue(meanDiff.value)}` : ''
    lines.push(`在 n = ${formatValue(n.value)} 对有效观测中，双侧配对 t 检验得到 t${dfText} = ${formatValue(statistic.value)}，p = ${formatValue(p.value, 'p')}，效应量 Cohen's dz = ${formatValue(dz.value)}${diffText}。`)
  } else {
    lines.push('本战役未产生可核验的统计量，摘要不含 n、统计量、p 值与效应量。相关缺口见「局限」。')
  }
  lines.push('')

  lines.push('## 方法', '')
  lines.push('采用被试内（配对）设计，对同一批观测在两个条件下的取值做双侧配对样本 t 检验（two-sided paired t-test），差值自由度按 n − 1 计算，显著性水平取 α = 0.05。')
  lines.push(`${softwareLine(plan, null)}。`)
  lines.push('')

  lines.push('## 结果', '')
  lines.push('| 指标 | 值 | 来源 |')
  lines.push('| --- | --- | --- |')
  const wanted = [
    ['有效配对数', n], ['配对 t 统计量', statistic], ['自由度', df],
    ['双侧 p 值', p], ['平均差值', meanDiff], ["效应量 Cohen's dz", dz],
  ]
  let tableRows = 0
  for (const [label, item] of wanted) {
    if (!item) continue
    lines.push(`| ${label} | ${formatValue(item.value, item.unit)} | ${item.source.taskId} |`)
    tableRows += 1
  }
  if (tableRows === 0) lines.push('| （无） | — | — |')
  lines.push('')
  if (n && statistic && p) {
    lines.push(`上表显示，在 n = ${formatValue(n.value)} 的配对样本中 t = ${formatValue(statistic.value)}、p = ${formatValue(p.value, 'p')}，差异的方向与幅度以平均差值为准。`)
  } else {
    lines.push('上表没有可核验的统计量，结果部分不作数值解释。')
  }
  lines.push('')

  lines.push('## 局限', '')
  if (gaps.length === 0) {
    lines.push('- 未记录到缺口。')
  } else {
    for (const gap of gaps) {
      lines.push(`- ${gap.detail}；影响：${gap.impact}；下一步：${gap.next}`)
    }
  }
  lines.push('')
  lines.push('<!-- generator: dsh-science/orchestra -->')

  return lines.join('\n')
}

export function renderPaper({ store, campaignId }) {
  const collected = collect({ store, campaignId })
  const markdown = composePaper({ evidence: collected.evidence, plan: collected.plan })
  return { markdown, evidence: collected.evidence }
}

/** 交付物默认落在战役工作目录：<science>/campaigns/<campaignId>/deliverables。 */
function defaultOutDir(store, campaignId) {
  const dbPath = String(store?.dbPath ?? '')
  if (!dbPath) throw new Error('无法推导交付目录：store 缺少 dbPath')
  return join(dirname(dbPath), 'campaigns', campaignId, 'deliverables')
}

function writeText(path, content) {
  writeFileSync(path, content, 'utf8')
}

export function generateDeliverables({ store, campaignId, outDir = null, options = {} } = {}) {
  void options
  const collected = collect({ store, campaignId })
  const evidence = collected.evidence
  const plan = collected.plan
  const targetDir = outDir ? String(outDir) : defaultOutDir(store, campaignId)
  const figuresDir = join(targetDir, 'figures')
  mkdirSync(figuresDir, { recursive: true })

  const reportMarkdown = composeReport({ store, campaignId, evidence, plan })
  const paperMarkdown = composePaper({ evidence, plan })
  const evidenceJson = JSON.stringify(evidence, null, 2)

  const reportPath = join(targetDir, 'report.md')
  const paperPath = join(targetDir, 'paper.md')
  const evidencePath = join(targetDir, 'evidence.json')
  writeText(reportPath, reportMarkdown)
  writeText(paperPath, paperMarkdown)
  writeText(evidencePath, evidenceJson)

  const reportSha = sha256File(reportPath)
  const files = [
    {
      path: 'report.md',
      absPath: reportPath,
      sha256: reportSha,
      bytes: statSync(reportPath).size,
      kind: 'report',
      role: 'project-manager',
      tool: 'science_campaign_report',
      inputHash: evidence.planHash,
    },
    {
      path: 'paper.md',
      absPath: paperPath,
      sha256: sha256File(paperPath),
      bytes: statSync(paperPath).size,
      kind: 'paper',
      role: 'writer',
      tool: 'science_paper_draft',
      // 论文的数字全部来自报告里的证据，因此用报告的哈希作为输入指纹
      inputHash: reportSha,
    },
    {
      path: 'evidence.json',
      absPath: evidencePath,
      sha256: sha256File(evidencePath),
      bytes: statSync(evidencePath).size,
      kind: 'evidence',
      role: 'analyst',
      tool: 'science_evidence',
      inputHash: sha256Text(evidence.items.map((item) => String(item.value)).join('')),
    },
  ]

  /* 图片按 basename 落盘：executors 已保证同名文件对应同一份内容，
     换目录只改位置不改名字，读者能直接对上图注。 */
  const figureArtifacts = collected.artifacts
    .filter((artifact) => artifact.kind === 'figure' && artifact.path)
    .sort((a, b) => String(a.path).localeCompare(String(b.path)))
  for (const artifact of figureArtifacts) {
    const source = String(artifact.path)
    if (!existsSync(source)) throw new Error(`figure 产物不存在：${source}`)
    const name = basename(source)
    const destination = join(figuresDir, name)
    copyFileSync(source, destination)
    files.push({
      path: `figures/${name}`,
      absPath: destination,
      sha256: sha256File(destination),
      bytes: statSync(destination).size,
      kind: 'figure',
      role: artifact.producer_role ?? 'analyst',
      tool: artifact.tool ?? 'science_figure',
      inputHash: artifact.input_hash ?? null,
    })
  }

  const manifestPath = join(targetDir, 'manifest.json')
  let idempotent = false
  if (existsSync(manifestPath)) {
    try {
      const previous = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const previousFiles = new Map(
        (Array.isArray(previous?.files) ? previous.files : []).map((entry) => [String(entry.path), String(entry.sha256)]),
      )
      // 只比文件指纹：generatedAt 与 manifest 自身不算交付内容
      idempotent = files.length === previousFiles.size
        && files.every((entry) => previousFiles.get(entry.path) === entry.sha256)
    } catch {
      idempotent = false
    }
  }

  const manifest = {
    campaignId,
    planHash: evidence.planHash,
    generatedAt: new Date().toISOString(),
    files: files.map(({ path, sha256, bytes, kind, role, tool, inputHash }) => ({
      path, sha256, bytes, kind, role, tool, inputHash,
    })),
    gaps: evidence.gaps,
    idempotent,
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  return { outDir: targetDir, files, manifestPath, reportPath, idempotent }
}
