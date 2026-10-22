/**
 * 战役计划器：把一句研究问题变成可落库、可调度、可重放的 DAG。
 *
 * 设计取舍：
 *   - buildPlan 是纯函数，不碰 store，这样哈希与结构可以脱离数据库做回归测试
 *   - 所有 id 都由 planHash 派生，同一方案重复提交得到同一批主键，仓储层靠唯一键挡重复
 *   - 计划里的 example / projectId 不进哈希：换数据源或换项目仍是同一个科学问题，
 *     不该因此多出一个 campaign
 */
import { createHash } from 'node:crypto'
import { batchPolicy, roleCapacity } from './chart.js'

const VERSION = 1

const DEFAULTS = Object.freeze({
  budgetUsd: 25,
  maxWallClockMin: 480,
  votes: 3,
  literatureCount: 120,
  dataColumns: 2,
  figureCount: 2,
  sections: 6,
  maxAttempts: 3,
})

/** 阶段链就是关键路径：每一步都以上一步的产物为入口，跳步等于跳过证据。 */
const STAGES = Object.freeze([
  { stage: 'S0', title: '选题与范围' },
  { stage: 'S1', title: '文献与现状' },
  { stage: 'S2', title: '假设与设计' },
  { stage: 'S6', title: '执行' },
  { stage: 'S7', title: '分析与作图' },
  { stage: 'S8', title: '写作' },
  { stage: 'S9', title: '审稿门' },
])

function clampNumber(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function clampInt(value, fallback, min, max) {
  return Math.round(clampNumber(value, fallback, min, max))
}

/** 只保留已知键：调用方多塞字段不该改变 planHash。 */
function normaliseConstraints(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const shardCeiling = Math.max(1, Number(batchPolicy().maxShardsPerCampaign) || 50000)
  return {
    budgetUsd: clampNumber(src.budgetUsd, DEFAULTS.budgetUsd, 0.01, 1000000),
    maxWallClockMin: clampInt(src.maxWallClockMin, DEFAULTS.maxWallClockMin, 1, 525600),
    votes: clampInt(src.votes, DEFAULTS.votes, 1, 9),
    literatureCount: clampInt(src.literatureCount, DEFAULTS.literatureCount, 1, shardCeiling),
    dataColumns: clampInt(src.dataColumns, DEFAULTS.dataColumns, 1, 64),
    figureCount: clampInt(src.figureCount, DEFAULTS.figureCount, 1, 32),
    sections: clampInt(src.sections, DEFAULTS.sections, 1, 40),
    maxAttempts: clampInt(src.maxAttempts, DEFAULTS.maxAttempts, 1, 10),
  }
}

/** 问句归一化：只比「问的是什么」，不比分大小写、空格与首尾空白。 */
function normaliseQuestion(question) {
  return String(question ?? '').replace(/\s+/gu, ' ').trim().toLowerCase()
}

function normaliseDiscipline(discipline) {
  const text = String(discipline ?? '').trim()
  return text || 'generic'
}

function normaliseSeed(seed) {
  const n = Number(seed)
  return Number.isFinite(n) ? Math.trunc(n) : 42
}

function normaliseExample(example) {
  const text = String(example ?? '').trim()
  return text || null
}

/** 键排序 + 去 undefined：同一份数据不论键顺序都得到同一串。 */
function canonicalise(value) {
  if (value === null || value === undefined) return null
  const type = typeof value
  if (type === 'number') return Number.isFinite(value) ? value : null
  if (type === 'string' || type === 'boolean') return value
  if (type === 'bigint') return String(value)
  if (Array.isArray(value)) return value.map((item) => canonicalise(item))
  if (type === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue
      out[key] = canonicalise(value[key])
    }
    return out
  }
  // 函数 / symbol 这类无法序列化的值不进哈希，避免不同 Node 版本算出不同结果
  return null
}

export function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalise(value))).digest('hex')
}

export function planHashOf({ question, discipline, constraints, seed } = {}) {
  const normalised = normaliseQuestion(question)
  if (!normalised) throw new Error('planHashOf 需要非空的 question')
  return stableHash({
    version: VERSION,
    question: normalised,
    discipline: normaliseDiscipline(discipline),
    constraints: normaliseConstraints(constraints),
    seed: normaliseSeed(seed),
  })
}

export function buildPlan(input = {}) {
  const question = String(input.question ?? '').trim()
  if (!question) throw new Error('必须给出研究问题 question')
  const discipline = normaliseDiscipline(input.discipline)
  const seed = normaliseSeed(input.seed)
  const constraints = normaliseConstraints(input.constraints)
  const example = normaliseExample(input.example)
  const projectId = input.projectId ? String(input.projectId) : null

  const planHash = planHashOf({ question, discipline, constraints, seed })
  const key = planHash.slice(0, 8)
  const campaignId = `cmp_${key}`
  const wsId = (stage) => `ws_${key}_${stage}`
  const tkId = (slug) => `tk_${key}_${slug}`
  const sdId = (slug, index) => `sd_${key}_${slug}_${index}`

  const workstreams = STAGES.map((entry, index) => ({
    id: wsId(entry.stage),
    stageId: entry.stage,
    title: entry.title,
    // S2 同时吃 S0 的问题与 S1 的证据，所以不是简单串行
    dependsOn: index === 0
      ? []
      : (entry.stage === 'S2' ? [wsId('S0'), wsId('S1')] : [wsId(STAGES[index - 1].stage)]),
    orderIndex: index,
  }))

  const statsTaskId = tkId('s7-stats')
  const defs = [
    {
      slug: 's0-framing',
      stage: 'S0',
      title: '把研究问题收紧成一句可证伪的话',
      role: 'strategist',
      executor: 'llm',
      gate: { tool: 'science_novelty', require: 'pass' },
      shardCount: 1,
      dependsOn: [],
      priority: 10,
      payload: () => ({ question, discipline }),
    },
    {
      slug: 's0-ethics',
      stage: 'S0',
      title: '登记伦理与数据许可',
      role: 'data-steward',
      executor: 'human',
      gate: null,
      shardCount: 1,
      dependsOn: ['s0-framing'],
      priority: 20,
      payload: () => ({ question, discipline }),
    },
    {
      slug: 's1-retrieve',
      stage: 'S1',
      title: '多源检索并留下检索式',
      role: 'survey',
      executor: 'llm',
      gate: null,
      shardCount: 1,
      dependsOn: ['s0-ethics'],
      priority: 30,
      payload: () => ({ question, discipline, limit: constraints.literatureCount }),
    },
    {
      slug: 's1-extract',
      stage: 'S1',
      title: '逐条抽取文献证据',
      role: 'shard-worker',
      executor: 'local',
      kind: 'literature.extract',
      gate: null,
      shardCount: constraints.literatureCount,
      dependsOn: ['s1-retrieve'],
      priority: 40,
      payload: (index) => ({ index, example, offline: true }),
    },
    {
      slug: 's2-design',
      stage: 'S2',
      title: '选定设计、假设与主结局',
      role: 'methodologist',
      executor: 'llm',
      gate: { tool: 'science_stats', require: 'pass' },
      shardCount: 1,
      dependsOn: ['s1-extract'],
      priority: 50,
      payload: () => ({ question, discipline, literatureCount: constraints.literatureCount }),
    },
    {
      slug: 's6-load',
      stage: 'S6',
      title: '装载数据并锁定环境',
      role: 'experimenter',
      executor: 'local',
      kind: 'data.load',
      gate: null,
      shardCount: 1,
      dependsOn: ['s2-design'],
      priority: 60,
      payload: () => ({ example, csv: 'data.csv' }),
    },
    {
      slug: 's7-stats',
      stage: 'S7',
      title: '按事前方案跑配对检验',
      role: 'analyst',
      executor: 'local',
      kind: 'stats.paired',
      gate: null,
      shardCount: Math.max(1, constraints.dataColumns),
      dependsOn: ['s6-load'],
      priority: 70,
      // 列名只在示例数据集上确定；其他数据源交给执行端按字典解析，不在这里猜
      payload: (index) => (example === 'sleep-wm'
        ? { example, csv: 'data.csv', a: 'well_rested', b: 'sleep_deprived', index }
        : { example, csv: 'data.csv', index, columns: null }),
    },
    {
      slug: 's7-figure',
      stage: 'S7',
      title: '出期刊规格的配对图',
      role: 'analyst',
      executor: 'local',
      kind: 'figure.paired',
      gate: null,
      shardCount: constraints.figureCount,
      dependsOn: ['s7-stats'],
      priority: 80,
      payload: (index) => ({ statsTaskId, index, style: 'single-column' }),
    },
    {
      slug: 's8-draft',
      stage: 'S8',
      title: '按目标刊结构起草正文',
      role: 'writer',
      executor: 'llm',
      gate: { tool: 'science_manuscript_lint', require: 'pass' },
      shardCount: 1,
      dependsOn: ['s7-figure'],
      priority: 90,
      payload: () => ({ question, discipline, sections: constraints.sections, statsTaskId }),
    },
    {
      slug: 's8-sections',
      stage: 'S8',
      title: '逐节改写并核对数字',
      role: 'shard-worker',
      executor: 'local',
      kind: 'manuscript.section',
      gate: null,
      shardCount: constraints.sections,
      dependsOn: ['s8-draft'],
      priority: 100,
      payload: (index) => ({ sectionIndex: index, total: constraints.sections, statsTaskId }),
    },
    {
      slug: 's9-audit',
      stage: 'S9',
      title: '按顶刊审稿标准打一遍',
      role: 'critic',
      executor: 'llm',
      gate: { tool: 'science_paper_audit', require: 'pass' },
      shardCount: 1,
      dependsOn: ['s8-sections'],
      priority: 110,
      payload: () => ({ question, statsTaskId }),
    },
    {
      slug: 's9-release',
      stage: 'S9',
      title: 'PI 终审放行',
      role: 'pi',
      executor: 'human',
      gate: null,
      shardCount: 1,
      dependsOn: ['s9-audit'],
      priority: 120,
      payload: () => ({ question }),
    },
  ]

  const tasks = defs.map((def) => ({
    id: tkId(def.slug),
    workstreamId: wsId(def.stage),
    title: def.title,
    role: def.role,
    executor: def.executor,
    gate: def.gate ? { ...def.gate } : null,
    dependsOn: def.dependsOn.map((slug) => tkId(slug)),
    priority: def.priority,
    // 只有需要判断的任务才投票；确定性分片多投几票只是烧钱
    votes: def.gate ? constraints.votes : 1,
    shards: def.shardCount,
  }))
  const taskById = new Map(tasks.map((task) => [task.id, task]))

  const shards = []
  for (const def of defs) {
    const task = taskById.get(tkId(def.slug))
    for (let index = 0; index < task.shards; index += 1) {
      shards.push({
        id: sdId(def.slug, index),
        taskId: task.id,
        shardIndex: index,
        role: task.role,
        executor: task.executor,
        kind: def.kind ?? null,
        payload: def.payload(index),
        idempotencyKey: `${campaignId}:${task.id}:${index}`,
        priority: task.priority,
        maxAttempts: constraints.maxAttempts,
        gate: task.gate ? { ...task.gate } : null,
      })
    }
  }

  const byWorkstream = {}
  for (const def of defs) {
    byWorkstream[def.stage] = (byWorkstream[def.stage] ?? 0) + taskById.get(tkId(def.slug)).shards
  }
  const byRole = {}
  for (const shard of shards) byRole[shard.role] = (byRole[shard.role] ?? 0) + 1

  const policy = batchPolicy()
  const batches = buildBatches(shards, policy)

  return {
    version: VERSION,
    planHash,
    seed,
    campaign: {
      id: campaignId,
      projectId,
      question,
      discipline,
      constraints,
      budget: {
        usd: constraints.budgetUsd,
        // 文献抽取是 token 大头，按条数线性给预算，避免大面积长文抽取时中途断粮
        tokens: 400000 + constraints.literatureCount * 1200,
      },
      spend: { usd: 0, tokens: 0 },
      state: 'planned',
    },
    workstreams,
    tasks,
    shards,
    shardBudget: { total: shards.length, byWorkstream, byRole },
    batches,
    criticalPath: STAGES.map((entry) => entry.stage),
  }
}

/**
 * 每岗位一批。capacity 报岗位容量；真正切批时再压上「单批上限」与 llm 并发，
 * 否则 12000 条抽取会被算成 1 批，跟实际能同时开多少 worker 对不上。
 */
function buildBatches(shards, policy) {
  const perRole = new Map()
  for (const shard of shards) {
    const entry = perRole.get(shard.role) ?? { role: shard.role, shards: 0, executor: shard.executor }
    entry.shards += 1
    if (shard.executor === 'llm') entry.executor = 'llm'
    perRole.set(shard.role, entry)
  }
  const batchCeiling = Math.max(1, Number(policy.maxShardsPerBatch) || 2000)
  const llmConcurrency = Math.max(1, Number(policy.llmConcurrency) || 1)
  return [...perRole.values()]
    .map((entry) => {
      const capacity = roleCapacity(entry.role)
      const raw = capacity > 0 ? capacity : 1
      const perBatch = entry.executor === 'llm'
        ? Math.min(raw, llmConcurrency)
        : Math.min(raw, batchCeiling)
      return {
        role: entry.role,
        shards: entry.shards,
        capacity,
        batches: Math.max(1, Math.ceil(entry.shards / Math.max(1, perBatch))),
      }
    })
    .sort((a, b) => a.role.localeCompare(b.role))
}

function chunked(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function parseJson(text, fallback) {
  if (text === null || text === undefined || text === '') return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

/**
 * force 重跑必须换一整套 id。
 * 否则 INSERT OR REPLACE 会覆盖上一轮的工作流与任务，INSERT OR IGNORE 会把分片静默丢掉，
 * 结果就是「第二遍什么都没跑」却查不到任何错误。
 */
function rekeyPlan(plan, { planHash, stamp }) {
  const next = structuredClone(plan)
  const suffix = `_v${stamp}`
  const campaignId = `${next.campaign.id}${suffix}`
  const wsIdMap = new Map(next.workstreams.map((ws) => [ws.id, `${ws.id}${suffix}`]))
  const taskIdMap = new Map(next.tasks.map((task) => [task.id, `${task.id}${suffix}`]))

  const swapId = (value) => {
    if (typeof value === 'string') return taskIdMap.get(value) ?? value
    if (Array.isArray(value)) return value.map(swapId)
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) value[key] = swapId(value[key])
      return value
    }
    return value
  }

  next.planHash = planHash
  next.campaign = { ...next.campaign, id: campaignId }
  for (const ws of next.workstreams) {
    ws.id = wsIdMap.get(ws.id) ?? ws.id
    ws.dependsOn = (ws.dependsOn ?? []).map((id) => wsIdMap.get(id) ?? id)
  }
  for (const task of next.tasks) {
    task.id = taskIdMap.get(task.id) ?? task.id
    task.workstreamId = wsIdMap.get(task.workstreamId) ?? task.workstreamId
    task.dependsOn = (task.dependsOn ?? []).map((id) => taskIdMap.get(id) ?? id)
  }
  for (const shard of next.shards) {
    shard.id = `${shard.id}${suffix}`
    shard.taskId = taskIdMap.get(shard.taskId) ?? shard.taskId
    shard.payload = swapId(shard.payload)
    shard.idempotencyKey = `${campaignId}:${shard.taskId}:${shard.shardIndex}`
  }
  return next
}

export function persistPlan(store, plan, { force = false } = {}) {
  if (!store || typeof store.createCampaign !== 'function') throw new Error('persistPlan 需要一个 ScienceStore 实例')
  const source = plan?.campaign
  if (!source) throw new Error('方案缺少 campaign')
  // 从库里读回来的 plan 把 hash 放在 campaign 上（plan_hash），两种来源都认
  const baseHash = String(plan.planHash ?? source.planHash ?? source.plan_hash ?? '')
  if (!baseHash) throw new Error('方案缺少 planHash')

  const existing = store.getCampaignByPlanHash(baseHash)
  if (existing && !force) {
    return { campaignId: existing.id, created: false, planHash: baseHash, existed: true, inserted: 0 }
  }

  const stamp = Date.now().toString(36)
  const planHash = force ? `${baseHash}-v${stamp}` : baseHash
  const target = force ? rekeyPlan(plan, { planHash, stamp }) : plan
  const campaignId = target.campaign.id

  let createdId = null
  try {
    createdId = store.createCampaign({
      id: campaignId,
      projectId: target.campaign.projectId ?? null,
      question: target.campaign.question,
      discipline: target.campaign.discipline ?? null,
      constraints: target.campaign.constraints ?? null,
      planHash,
      seed: target.seed,
      state: target.campaign.state || 'planned',
      budget: target.campaign.budget ?? null,
      spend: target.campaign.spend ?? null,
    })
  } catch (error) {
    // 并发下另一进程可能刚写完同 hash：按已存在处理，绝不跑第二遍
    if (/plan-hash-exists/.test(String(error.message))) {
      const raced = store.getCampaignByPlanHash(planHash)
      if (raced) return { campaignId: raced.id, created: false, planHash, existed: true, inserted: 0 }
    }
    throw error
  }

  // store 的方法各自开事务，这里不能再包 BEGIN（SQLite 不支持嵌套）
  for (const ws of target.workstreams ?? []) {
    store.upsertWorkstream({
      id: ws.id,
      campaignId,
      stageId: ws.stageId ?? null,
      title: ws.title ?? null,
      dependsOn: ws.dependsOn ?? [],
      orderIndex: Number.isFinite(ws.orderIndex) ? ws.orderIndex : 0,
    })
  }

  const taskRows = (target.tasks ?? []).map((task) => ({ ...task, campaignId }))
  for (const batch of chunked(taskRows, 500)) store.insertTasks(batch)

  const shardRows = (target.shards ?? []).map((shard) => ({ ...shard, campaignId }))
  let inserted = 0
  for (const batch of chunked(shardRows, 500)) inserted += store.insertShards(batch)

  return { campaignId: createdId || campaignId, created: true, planHash, existed: false, inserted }
}

/**
 * 从库读回四层结构。仓储层只暴露写入接口，这里做只读查询，
 * 免得为了读回计划再往 store 上开后门方法。
 */
export function loadPlan(store, campaignId) {
  if (!store?.db) throw new Error('loadPlan 需要一个 ScienceStore 实例')
  const campaign = store.getCampaign(campaignId)
  if (!campaign) throw new Error(`战役不存在：${campaignId}`)

  const workstreams = store.db.prepare(
    'SELECT * FROM campaign_workstream WHERE campaign_id = ? ORDER BY order_index ASC, id ASC',
  ).all(campaignId).map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    stageId: row.stage_id,
    title: row.title,
    dependsOn: parseJson(row.depends_on_json, []),
    orderIndex: Number(row.order_index) || 0,
    createdAt: row.created_at,
  }))

  const tasks = store.db.prepare(
    'SELECT * FROM campaign_task WHERE campaign_id = ? ORDER BY priority ASC, id ASC',
  ).all(campaignId).map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    workstreamId: row.workstream_id,
    title: row.title,
    role: row.role,
    executor: row.executor,
    gate: parseJson(row.gate_json, null),
    dependsOn: parseJson(row.depends_on_json, []),
    priority: Number(row.priority) || 0,
    votes: Number(row.votes) || 0,
    shards: Number(row.shards) || 0,
    state: row.state,
    createdAt: row.created_at,
  }))

  const shards = store.db.prepare(
    'SELECT * FROM campaign_shard WHERE campaign_id = ? ORDER BY task_id ASC, shard_index ASC, id ASC',
  ).all(campaignId).map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    taskId: row.task_id,
    shardIndex: Number(row.shard_index) || 0,
    role: row.role,
    executor: row.executor,
    kind: row.kind,
    payload: parseJson(row.payload_json, null),
    idempotencyKey: row.idempotency_key,
    state: row.state,
    priority: Number(row.priority) || 0,
    attempt: Number(row.attempt) || 0,
    maxAttempts: Number(row.max_attempts) || 0,
    nextRunAt: Number(row.next_run_at) || 0,
    gate: parseJson(row.gate_json, null),
    output: parseJson(row.output_json, null),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))

  return { campaign, workstreams, tasks, shards }
}

/** 分片入库按 500 一批：单事务太大时 WAL 会把内存顶上去。 */
export function seedShards(store, plan) {
  if (!store?.db) throw new Error('seedShards 需要一个 ScienceStore 实例')
  const campaignId = plan?.campaign?.id
  if (!campaignId) throw new Error('方案缺少 campaign.id')
  if (!store.getCampaign(campaignId)) throw new Error(`战役不存在：${campaignId}`)

  const rows = (plan.shards ?? []).map((shard) => ({ ...shard, campaignId }))
  let inserted = 0
  for (const batch of chunked(rows, 500)) inserted += store.insertShards(batch)
  return { inserted, total: rows.length }
}

/** 工具层只该看到这些：结构规模、成本、闸门，不铺开每条分片的 payload。 */
export function planSummary(plan) {
  if (!plan?.campaign) throw new Error('planSummary 需要 buildPlan 产出的方案')
  const stageOf = new Map((plan.workstreams ?? []).map((ws) => [ws.id, ws.stageId]))
  const stageRows = new Map((plan.workstreams ?? []).map((ws) => [
    ws.stageId,
    { stageId: ws.stageId, title: ws.title, tasks: 0, shards: 0 },
  ]))
  for (const task of plan.tasks ?? []) {
    const row = stageRows.get(stageOf.get(task.workstreamId))
    if (!row) continue
    row.tasks += 1
    row.shards += Number(task.shards) || 0
  }

  return {
    version: plan.version,
    planHash: plan.planHash,
    seed: plan.seed,
    campaignId: plan.campaign.id,
    projectId: plan.campaign.projectId ?? null,
    question: plan.campaign.question,
    discipline: plan.campaign.discipline,
    constraints: { ...plan.campaign.constraints },
    budget: { ...plan.campaign.budget },
    state: plan.campaign.state,
    stageCount: (plan.workstreams ?? []).length,
    taskCount: (plan.tasks ?? []).length,
    shardCount: plan.shardBudget?.total ?? (plan.shards ?? []).length,
    stages: [...stageRows.values()],
    byRole: { ...(plan.shardBudget?.byRole ?? {}) },
    batches: (plan.batches ?? []).map((entry) => ({ ...entry })),
    criticalPath: [...(plan.criticalPath ?? [])],
    gates: (plan.tasks ?? [])
      .filter((task) => task.gate)
      .map((task) => ({ taskId: task.id, tool: task.gate.tool, require: task.gate.require })),
  }
}
