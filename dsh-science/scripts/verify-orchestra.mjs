#!/usr/bin/env node
/**
 * orchestra 验收：编制 → 计划 → 存储领取 → 调度语义 → 共识门禁 → 隔离。
 *
 *   node scripts/verify-orchestra.mjs [--verbose]
 *
 * 全程离线，只用临时目录里的 SQLite；绝不写真实的 ~/.deepscient 与 ~/.dsh。
 * 每条断言独立捕获异常：一条失败只打印 FAIL，不影响后面的检查继续跑。
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import {
  batchPolicy, canUseTool, escalationPath, listRoles,
} from '../lib/science/orchestra/chart.js'
import {
  buildPlan, loadPlan, persistPlan, planHashOf, seedShards,
} from '../lib/science/orchestra/plan.js'
import { backoffMs, createScheduler } from '../lib/science/orchestra/scheduler.js'
import { aggregate, applyGate, dedupe, escalate } from '../lib/science/orchestra/consensus.js'
import * as consensusImpl from '../lib/science/orchestra/consensus.js'
import { classify } from '../lib/science/orchestra/executors.js'
import { ScienceStore, SCHEMA_VERSION } from '../lib/science/store.js'

const verbose = process.argv.includes('--verbose')
const tmpRoot = mkdtempSync(join(tmpdir(), 'dsh-orch-verify-'))

let pass = 0
let fail = 0
const fails = []
let group = '编制'

function begin(name) {
  group = name
  if (verbose) console.log(`\n── ${name} ──`)
}

/**
 * cond 是布尔表达式（惰性求值），这样某个前置步骤抛错时只会让本条 FAIL。
 * detail 只在失败（或 --verbose）时求值，避免正常路径多算一遍。
 */
function check(label, cond, detail = '') {
  let ok = false
  let error = null
  try {
    ok = cond() === true
  } catch (cause) {
    error = cause
  }
  let text = ''
  if (!ok && error) text = `异常：${error?.message ?? error}`
  else if (!ok || verbose) {
    try {
      text = String((typeof detail === 'function' ? detail() : detail) ?? '')
    } catch {
      text = ''
    }
  }
  if (ok) {
    pass += 1
    console.log(`[${group}] PASS ${label}${text ? ` — ${text}` : ''}`)
    return
  }
  fail += 1
  const line = `${label}${text ? ` — ${text}` : ''}`
  fails.push(`[${group}] ${line}`)
  console.log(`[${group}] FAIL ${line}`)
}

/** 真实数据根的时间戳：只读 stat，不存在也视为未受影响。 */
const mtimeOf = (path) => {
  try { return statSync(path).mtimeMs } catch { return null }
}
const realScienceDb = join(homedir(), '.deepscient', 'science', 'science.db')
const realDsh = join(homedir(), '.dsh')
const scienceMtimeBefore = mtimeOf(realScienceDb)
const dshMtimeBefore = mtimeOf(realDsh)

const dbPath = join(tmpRoot, 'verify.db')
const store = new ScienceStore({ dbPath })

/* ══════════════════════════ A. 编制 ══════════════════════════ */
begin('编制')

const roles = (() => { try { return listRoles() } catch { return [] } })()
check('13 个岗位', () => roles.length === 13, () => `实际 ${roles.length}`)

const layerSet = new Set(roles.map((role) => role.layer))
check('layer 覆盖 L0–L3', () => ['L0', 'L1', 'L2', 'L3'].every((code) => layerSet.has(code)),
  () => `实际 ${[...layerSet].sort().join(',')}`)

check('survey 可用 science_search', () => canUseTool('survey', 'science_search') === true)
check('survey 不可用 science_figure', () => canUseTool('survey', 'science_figure') === false)

const shardWorkerPath = (() => { try { return escalationPath('shard-worker') } catch { return [] } })()
check('shard-worker 上报链末位是 pi',
  () => shardWorkerPath.length >= 2 && shardWorkerPath[shardWorkerPath.length - 1] === 'pi',
  () => shardWorkerPath.join(' → '))

const policy = (() => { try { return batchPolicy() } catch { return {} } })()
check('batchPolicy 数值合法',
  () => policy.maxShardsPerCampaign > 0
    && policy.maxShardsPerBatch > 0
    && policy.voteThreshold > 0 && policy.voteThreshold <= 1
    && policy.llmConcurrency >= 1,
  () => JSON.stringify(policy))

/* ══════════════════════════ B. 计划 ══════════════════════════ */
begin('计划')

const baseQuestion = '24 小时睡眠剥夺是否降低工作记忆容量'
const basePlan = (() => {
  try { return buildPlan({ question: baseQuestion, discipline: '心理学', seed: 7 }) } catch { return null }
})()

check('默认 plan 有 7 个 workstream', () => basePlan.workstreams.length === 7,
  () => `实际 ${basePlan?.workstreams?.length}`)
check('默认 plan 有 12 个 task', () => basePlan.tasks.length === 12,
  () => `实际 ${basePlan?.tasks?.length}`)
check('shardBudget.total > 0', () => basePlan.shardBudget.total > 0,
  () => `total=${basePlan?.shardBudget?.total}`)

check('idempotencyKey 唯一', () => {
  const keys = basePlan.shards.map((shard) => shard.idempotencyKey)
  return new Set(keys).size === keys.length && keys.length === basePlan.shards.length
}, () => `${basePlan.shards.length} 条 / ${new Set(basePlan.shards.map((s) => s.idempotencyKey)).size} 个键`)

const topoOk = (() => {
  try {
    const tasks = basePlan.tasks
    const ids = new Set(tasks.map((task) => task.id))
    const indeg = new Map(tasks.map((task) => [task.id, 0]))
    const next = new Map(tasks.map((task) => [task.id, []]))
    for (const task of tasks) {
      for (const dep of task.dependsOn) {
        if (!ids.has(dep)) return { ok: false, reason: `未知依赖 ${dep}` }
        next.get(dep).push(task.id)
        indeg.set(task.id, indeg.get(task.id) + 1)
      }
    }
    const queue = [...indeg.entries()].filter(([, n]) => n === 0).map(([id]) => id)
    let visited = 0
    while (queue.length > 0) {
      const id = queue.pop()
      visited += 1
      for (const to of next.get(id)) {
        const left = indeg.get(to) - 1
        indeg.set(to, left)
        if (left === 0) queue.push(to)
      }
    }
    return { ok: visited === tasks.length, visited, total: tasks.length }
  } catch (error) {
    return { ok: false, reason: error.message }
  }
})()
check('DAG 无环（拓扑排序计数等于 task 数）', () => topoOk.ok === true,
  () => JSON.stringify(topoOk))

const hashArgs = { question: baseQuestion, discipline: '心理学', seed: 7, constraints: { literatureCount: 30 } }
check('planHashOf 幂等', () => planHashOf(hashArgs) === planHashOf(hashArgs),
  () => planHashOf(hashArgs).slice(0, 12))
check('seed 改变则 hash 改变',
  () => planHashOf({ ...hashArgs, seed: 8 }) !== planHashOf(hashArgs))
check('example 改变不影响 hash', () => {
  const a = buildPlan({ question: baseQuestion, example: 'sleep-wm' })
  const b = buildPlan({ question: baseQuestion, example: 'other-dataset' })
  return a.planHash === b.planHash
})

const bigPlan = (() => {
  try {
    return buildPlan({ question: baseQuestion, constraints: { literatureCount: 12000 } })
  } catch { return null }
})()
check('literatureCount=12000 时 total ≥ 12000 且 batches 有值',
  () => bigPlan.shardBudget.total >= 12000
    && Array.isArray(bigPlan.batches) && bigPlan.batches.length > 0
    && bigPlan.batches.every((entry) => entry.shards > 0 && entry.batches > 0),
  () => `total=${bigPlan?.shardBudget?.total} batches=${bigPlan?.batches?.length}`)

check('空 question 抛错', () => {
  try { buildPlan({ question: '   ' }); return false } catch (error) { return /question/.test(error.message) }
})

/* ══════════════════════════ C. 存储与领取 ══════════════════════════ */
begin('存储与领取')

check('schema 版本为 8', () => SCHEMA_VERSION === 8 && store.version() === 8,
  () => `SCHEMA_VERSION=${SCHEMA_VERSION} 库=${store.version()}`)

const tableNames = (() => {
  try {
    return new Set(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name))
  } catch { return new Set() }
})()
const v8Tables = ['campaign', 'campaign_workstream', 'campaign_task', 'campaign_shard',
  'campaign_agent', 'campaign_vote', 'campaign_artifact', 'campaign_event']
check('v8 的 8 张表都存在', () => v8Tables.every((name) => tableNames.has(name)),
  () => `缺 ${v8Tables.filter((name) => !tableNames.has(name)).join(',') || '无'}`)

const plan = (() => {
  try {
    return buildPlan({
      question: '验收用战役：睡眠剥夺与工作记忆',
      discipline: '心理学',
      seed: 11,
      constraints: { literatureCount: 5, dataColumns: 1, figureCount: 1, sections: 2, budgetUsd: 10 },
    })
  } catch { return null }
})()

const persisted = (() => {
  try { return persistPlan(store, plan) } catch (error) { return { error: error.message } }
})()

const countShards = () => Number(store.db.prepare('SELECT COUNT(*) AS n FROM campaign_shard WHERE campaign_id = ?')
  .get(plan.campaign.id)?.n) || 0

const shardCountAfterPersist = (() => { try { return countShards() } catch { return -1 } })()

const reseed = (() => { try { return seedShards(store, plan) } catch (error) { return { error: error.message } } })()
check('insertShards 幂等（重复插入不增加）',
  () => reseed.inserted === 0 && countShards() === shardCountAfterPersist
    && shardCountAfterPersist === plan.shards.length,
  () => `inserted=${reseed.inserted} 前后=${shardCountAfterPersist}/${countShards()}`)

const loaded = (() => { try { return loadPlan(store, plan.campaign.id) } catch { return null } })()
check('loadPlan 读回 7 工作流 / 12 任务 / 全部分片',
  () => loaded.workstreams.length === 7 && loaded.tasks.length === 12 && loaded.shards.length === plan.shards.length,
  () => `${loaded?.workstreams?.length}/${loaded?.tasks?.length}/${loaded?.shards?.length}`)

const campaignId = plan?.campaign?.id ?? '__missing__'
const claimA = (() => {
  try {
    return store.claimShards({ campaignId, owner: 'verify-a', limit: 3, now: Date.now(), leaseMs: 120000 })
  } catch { return [] }
})()
const claimB = (() => {
  try {
    return store.claimShards({ campaignId, owner: 'verify-b', limit: 3, now: Date.now(), leaseMs: 120000 })
  } catch { return [] }
})()
check('claimShards 两次领取 id 无交集', () => {
  const a = new Set(claimA.map((row) => row.id))
  return claimA.length === 3 && claimB.length === 3 && claimB.every((row) => !a.has(row.id))
}, () => `A=${claimA.length} B=${claimB.length}`)

const completeTarget = claimA[0]?.id ?? null
const completeOk = (() => {
  try { return store.completeShard({ shardId: completeTarget, owner: 'verify-a', output: { ok: true } }) } catch { return false }
})()
const completeState = (() => {
  try { return store.db.prepare('SELECT state FROM campaign_shard WHERE id = ?').get(completeTarget)?.state } catch { return null }
})()
check('completeShard 后 state=done',
  () => completeOk === true && completeState === 'done',
  () => `changes=${completeOk} state=${completeState}`)

const claimC = (() => {
  try {
    return store.claimShards({ campaignId, owner: 'verify-c', limit: 2, now: Date.now(), leaseMs: 1000 })
  } catch { return [] }
})()
const reaped = (() => {
  try { return store.reapExpiredLeases({ campaignId, now: Date.now() + 5000 }) } catch { return [] }
})()
const reapedRow = (() => {
  try {
    return store.db.prepare('SELECT state, attempt FROM campaign_shard WHERE id = ?').get(claimC[0]?.id)
  } catch { return null }
})()
check('租约过期回收后 attempt+1 且回到队列',
  () => claimC.length === 2 && reaped.length >= 2
    && Number(reapedRow?.attempt) === 1 && reapedRow?.state === 'queued',
  () => `reaped=${reaped.length} attempt=${reapedRow?.attempt} state=${reapedRow?.state}`)

const claimD = (() => {
  try {
    return store.claimShards({ campaignId, owner: 'verify-d', limit: 2, now: Date.now(), leaseMs: 120000 })
  } catch { return [] }
})()
const failTarget = claimD[0]?.id ?? null
const failRes = (() => {
  try {
    return store.failShard({ shardId: failTarget, owner: 'verify-d', error: '验收故意失败', now: Date.now(), maxAttempts: 1 })
  } catch { return { state: null, attempt: 0 } }
})()
const failState = (() => {
  try { return store.db.prepare('SELECT state FROM campaign_shard WHERE id = ?').get(failTarget)?.state } catch { return null }
})()
check('failShard 超 maxAttempts → failed',
  () => failRes.state === 'failed' && failState === 'failed',
  () => `state=${failRes.state}/${failState} attempt=${failRes.attempt}`)

const stats = (() => { try { return store.campaignStats({ campaignId }) } catch { return null } })()
check('campaignStats 数字自洽', () => {
  const shards = plan.shards.length
  const sum = stats.shards.queued + stats.shards.leased + stats.shards.done
    + stats.shards.failed + stats.shards.needsReview + stats.shards.needsHuman
  return stats.tasks.total === 12 && sum === shards && stats.shards.done === 1 && stats.shards.failed === 1
}, () => JSON.stringify(stats?.shards))

/* ══════════════════════════ D. 调度语义 ══════════════════════════ */
begin('调度语义')

/** 每个场景一套独立的 campaign/task/shard，互不干扰。 */
function createScene({ id, count = 0, shards = null, budgetUsd = null, taskExecutor = 'local', taskVotes = 1 }) {
  const list = shards ?? Array.from({ length: count }, () => ({}))
  const sceneCampaign = `cmp_scene_${id}`
  const sceneTask = `tk_scene_${id}`
  store.createCampaign({
    id: sceneCampaign,
    question: `调度场景 ${id}`,
    planHash: `plan_scene_${id}`,
    budget: budgetUsd === null ? null : { usd: budgetUsd, tokens: 1000000 },
  })
  store.insertTasks([{
    id: sceneTask,
    campaignId: sceneCampaign,
    workstreamId: null,
    title: `场景 ${id}`,
    role: 'shard-worker',
    executor: taskExecutor,
    dependsOn: [],
    priority: 10,
    votes: taskVotes,
    shards: list.length,
  }])
  store.insertShards(list.map((entry, index) => ({
    id: `sd_scene_${id}_${index}`,
    campaignId: sceneCampaign,
    taskId: sceneTask,
    shardIndex: index,
    role: 'shard-worker',
    executor: entry.executor ?? 'local',
    kind: entry.kind ?? 'noop',
    payload: { index },
    idempotencyKey: `${sceneCampaign}:${sceneTask}:${index}`,
    priority: entry.priority ?? 10,
    maxAttempts: entry.maxAttempts ?? 3,
    gate: entry.gate ?? null,
  })))
  return sceneCampaign
}

const sceneShardState = (campaign, index = 0) => {
  try {
    return store.db.prepare('SELECT state, attempt, next_run_at FROM campaign_shard WHERE id = ?')
      .get(`sd_scene_${campaign.replace('cmp_scene_', '')}_${index}`) ?? null
  } catch { return null }
}
const sceneShardId = (id, index = 0) => `sd_scene_${id}_${index}`

/* D1：200 个 local 分片、并发 8 → 全部 done，每个只跑一次 */
try {
  const counts = new Map()
  const executors = {
    classify,
    local: async ({ shard }) => {
      counts.set(shard.id, (counts.get(shard.id) ?? 0) + 1)
      await new Promise((r) => setImmediate(r))
      return { ok: true, output: { noop: true } }
    },
  }
  const scheduler = createScheduler({ store, executors })
  const scene = createScene({ id: 'd1', count: 200 })
  const summary = await scheduler.run({
    campaignId: scene, mode: 'local', localConcurrency: 8,
    highWatermark: 100000, maxShards: Infinity,
  })
  check('200 个 local 分片并发 8 → done=200',
    () => summary.done === 200, () => `done=${summary.done} paused=${summary.paused}`)
  check('200 个分片每个恰好执行 1 次',
    () => counts.size === 200 && [...counts.values()].every((n) => n === 1),
    () => `size=${counts.size} max=${Math.max(...counts.values())}`)
} catch (error) {
  check('D1 200 分片场景可完成', () => false, () => `场景异常：${error.message}`)
}

/* D2：失败一次后重试成功，attempt 停在 1 */
try {
  const tries = new Map()
  const executors = {
    classify,
    local: async ({ shard }) => {
      const n = (tries.get(shard.id) ?? 0) + 1
      tries.set(shard.id, n)
      if (n === 1) return { ok: false, error: '瞬时失败' }
      return { ok: true, output: { attempt: n } }
    },
  }
  const scheduler = createScheduler({ store, executors })
  const scene = createScene({ id: 'd2', count: 1 })
  const first = await scheduler.run({ campaignId: scene, mode: 'local', localConcurrency: 1, highWatermark: 1000 })
  const afterFirst = sceneShardState(scene)
  check('执行失败后回到队列（attempt=1）',
    () => first.failed === 1 && first.done === 0
      && afterFirst?.state === 'queued' && Number(afterFirst?.attempt) === 1,
    () => JSON.stringify({ failed: first.failed, ...afterFirst }))
  // 退避 2s 是真实语义；这里把 next_run_at 拨回现在，模拟等待到期后再跑一轮
  store.db.prepare('UPDATE campaign_shard SET next_run_at = 0 WHERE id = ?').run(sceneShardId('d2'))
  const second = await scheduler.run({ campaignId: scene, mode: 'local', localConcurrency: 1, highWatermark: 1000 })
  const afterSecond = sceneShardState(scene)
  check('重试成功后 done 且 attempt 仍为 1',
    () => second.done === 1 && afterSecond?.state === 'done' && Number(afterSecond?.attempt) === 1,
    () => JSON.stringify({ done: second.done, ...afterSecond }))
  check('失败一次的分片总共只执行 2 次', () => tries.get(sceneShardId('d2')) === 2,
    () => String(tries.get(sceneShardId('d2'))))
} catch (error) {
  check('D2 失败重试场景可完成', () => false, () => `场景异常：${error.message}`)
}

/* D3：背压 */
try {
  const executors = { classify, local: async () => ({ ok: true }) }
  const scheduler = createScheduler({ store, executors })
  const scene = createScene({ id: 'd3', count: 5 })
  const summary = await scheduler.run({
    campaignId: scene, mode: 'local', localConcurrency: 2, highWatermark: 1, maxShards: Infinity,
  })
  check('queued > highWatermark 时 paused=backpressure 且 processed=0',
    () => summary.paused === 'backpressure' && summary.processed === 0 && summary.done === 0,
    () => `paused=${summary.paused} processed=${summary.processed}`)
  check('背压事件已记录',
    () => summary.events.some((event) => event.kind === 'backpressure'))
} catch (error) {
  check('D3 背压场景可完成', () => false, () => `场景异常：${error.message}`)
}

/* D4：预算为 0 → llm 不跑，local 跑完，事件有 budget-tripped */
try {
  const executors = { classify, local: async () => ({ ok: true, output: { noop: true } }) }
  const scheduler = createScheduler({ store, executors })
  const scene = createScene({
    id: 'd4',
    shards: [
      ...Array.from({ length: 5 }, () => ({ executor: 'local' })),
      ...Array.from({ length: 5 }, () => ({ executor: 'llm' })),
    ],
    budgetUsd: 0,
  })
  const summary = await scheduler.run({
    campaignId: scene, mode: 'local', localConcurrency: 4, highWatermark: 1000, maxShards: Infinity,
  })
  check('预算 0 时 5 个 local 跑完、5 个 llm 留在队列',
    () => summary.done === 5 && summary.queuedLeft === 5,
    () => `done=${summary.done} queuedLeft=${summary.queuedLeft} paused=${summary.paused}`)
  check('预算 0 时一个 llm 分片都没执行',
    () => {
      const rows = store.db.prepare("SELECT COUNT(*) AS n FROM campaign_shard WHERE campaign_id = ? AND executor='llm' AND state='queued'").get(scene)
      return Number(rows?.n) === 5
    })
  check('事件流含 budget-tripped',
    () => summary.events.some((event) => event.kind === 'budget-tripped'))
} catch (error) {
  check('D4 预算场景可完成', () => false, () => `场景异常：${error.message}`)
}

/* D5：delegate → 3 个委派，库里仍 queued */
try {
  const briefs = []
  const executors = {
    classify,
    local: async () => ({ ok: true }),
    delegate: ({ shard }) => {
      briefs.push(shard.id)
      return { brief: { shardId: shard.id }, tokensEstimate: 100 }
    },
  }
  const scheduler = createScheduler({ store, executors })
  const scene = createScene({
    id: 'd5', shards: Array.from({ length: 3 }, () => ({ executor: 'llm' })),
  })
  const summary = await scheduler.run({
    campaignId: scene, mode: 'delegate', localConcurrency: 2, highWatermark: 1000, maxShards: Infinity,
  })
  check('delegate 模式委派 3 个 llm 分片',
    () => summary.delegated === 3 && summary.delegations.length === 3 && briefs.length === 3,
    () => `delegated=${summary.delegated}`)
  check('委派后分片仍在库里 queued', () => {
    const row = store.db.prepare("SELECT COUNT(*) AS n FROM campaign_shard WHERE campaign_id = ? AND state='queued'").get(scene)
    return Number(row?.n) === 3
  })
  check('委派事件与暂停原因正确',
    () => summary.paused === 'awaiting-delegation'
      && summary.events.filter((event) => event.kind === 'shard-delegated').length === 3,
    () => `paused=${summary.paused}`)
} catch (error) {
  check('D5 委派场景可完成', () => false, () => `场景异常：${error.message}`)
}

/* D6：ingest 3 条结果 → done=3 */
try {
  const executors = { classify, local: async () => ({ ok: true }), delegate: () => ({ brief: null }) }
  const scheduler = createScheduler({ store, executors })
  const scene = createScene({ id: 'd6', count: 3 })
  const results = [0, 1, 2].map((index) => ({
    shardId: sceneShardId('d6', index), verdict: 'done', output: { index },
  }))
  const summary = await scheduler.run({ campaignId: scene, mode: 'ingest', results })
  check('ingest 3 条结果 → done=3',
    () => summary.done === 3 && summary.failed === 0,
    () => `done=${summary.done} failed=${summary.failed}`)
  check('ingest 后库里 3 个分片都是 done', () => {
    const row = store.db.prepare("SELECT COUNT(*) AS n FROM campaign_shard WHERE campaign_id = ? AND state='done'").get(scene)
    return Number(row?.n) === 3
  })
} catch (error) {
  check('D6 ingest 场景可完成', () => false, () => `场景异常：${error.message}`)
}

/* D7：human 分片 → needs-human，且不执行 */
try {
  let executed = 0
  const executors = { classify, local: async () => { executed += 1; return { ok: true } } }
  const scheduler = createScheduler({ store, executors })
  const scene = createScene({ id: 'd7', count: 1, taskExecutor: 'human' })
  const summary = await scheduler.run({ campaignId: scene, mode: 'local', localConcurrency: 1, highWatermark: 1000 })
  const row = sceneShardState(scene)
  check('human 分片进入 needs-human 且未执行',
    () => summary.needsHuman === 1 && executed === 0 && row?.state === 'needs-human',
    () => `needsHuman=${summary.needsHuman} executed=${executed} state=${row?.state}`)
} catch (error) {
  check('D7 human 场景可完成', () => false, () => `场景异常：${error.message}`)
}

/* D8：maxShards 截断 */
try {
  const executors = { classify, local: async () => ({ ok: true }) }
  const scheduler = createScheduler({ store, executors })
  const scene = createScene({ id: 'd8', count: 30 })
  const summary = await scheduler.run({
    campaignId: scene, mode: 'local', localConcurrency: 4, highWatermark: 1000, maxShards: 10,
  })
  check('maxShards=10 → processed=10', () => summary.processed === 10 && summary.done === 10,
    () => `processed=${summary.processed} done=${summary.done} paused=${summary.paused}`)
} catch (error) {
  check('D8 maxShards 场景可完成', () => false, () => `场景异常：${error.message}`)
}

/* D9：崩溃恢复 —— 第二轮 run 不重复已 done 的分片 */
try {
  const counts = new Map()
  const executors = {
    classify,
    local: async ({ shard }) => {
      counts.set(shard.id, (counts.get(shard.id) ?? 0) + 1)
      return { ok: true, output: { noop: true } }
    },
  }
  const scheduler = createScheduler({ store, executors })
  const scene = createScene({ id: 'd9', count: 10 })
  const first = await scheduler.run({
    campaignId: scene, mode: 'local', localConcurrency: 2, highWatermark: 1000, maxShards: 4,
  })
  const second = await scheduler.run({
    campaignId: scene, mode: 'local', localConcurrency: 3, highWatermark: 1000, maxShards: Infinity,
  })
  const doneRow = store.db.prepare("SELECT COUNT(*) AS n FROM campaign_shard WHERE campaign_id = ? AND state='done'").get(scene)
  check('第一轮只完成 4 个', () => first.done === 4, () => `done=${first.done}`)
  check('第二轮只补剩下的 6 个', () => second.done === 6, () => `done=${second.done}`)
  check('恢复后总数 10 且没有任何分片被执行两次',
    () => Number(doneRow?.n) === 10 && counts.size === 10 && [...counts.values()].every((n) => n === 1),
    () => `db=${doneRow?.n} size=${counts.size}`)
} catch (error) {
  check('D9 崩溃恢复场景可完成', () => false, () => `场景异常：${error.message}`)
}

check('backoffMs(0)=1000', () => backoffMs(0) === 1000, () => String(backoffMs(0)))
check('backoffMs(20)=300000（封顶 5 分钟）', () => backoffMs(20) === 300000, () => String(backoffMs(20)))

/* ══════════════════════════ E. 共识与门禁 ══════════════════════════ */
begin('共识与门禁')

const vote = (id, verdict, extra = {}) => ({
  id, verdict, voter: `voter-${id}`, evidence_weight: 1, created_at: Number(id.replace(/\D/g, '')) || 0, ...extra,
})

const votes3Done = aggregate({ task: { votes: 3 }, votes: [vote('v1', 'done'), vote('v2', 'done'), vote('v3', 'done')] })
check('3 票一致 → done 且 dissents=0',
  () => votes3Done.verdict === 'done' && votes3Done.dissents === 0,
  () => JSON.stringify(votes3Done))

const votes2to1 = aggregate({ task: { votes: 3 }, votes: [vote('v1', 'done'), vote('v2', 'done'), vote('v3', 'failed')] })
check('2:1 → done 且 dissents=1',
  () => votes2to1.verdict === 'done' && votes2to1.dissents === 1,
  () => JSON.stringify(votes2to1))

const votesSplit = aggregate({ task: { votes: 3 }, votes: [vote('v1', 'done'), vote('v2', 'failed'), vote('v3', 'failed')] })
check('三票分裂（无多数）→ needs-review',
  () => votesSplit.verdict === 'needs-review' && votesSplit.reason === 'winner-failed',
  () => JSON.stringify(votesSplit))

const votesVeto = aggregate({ task: { votes: 3 }, votes: [vote('v1', 'done'), vote('v2', 'done'), vote('v3', 'veto')] })
check('含 veto → needs-review 且 reason 指向 veto',
  () => votesVeto.verdict === 'needs-review' && String(votesVeto.reason).startsWith('veto:'),
  () => String(votesVeto.reason))

const votesFew = aggregate({ task: { votes: 3 }, votes: [vote('v1', 'done'), vote('v2', 'done')] })
check('票数不足 → needs-review / not-enough-votes',
  () => votesFew.verdict === 'needs-review' && votesFew.reason === 'not-enough-votes',
  () => String(votesFew.reason))

const doiDedupe = (() => {
  try {
    return dedupe([
      { doi: '10.1000/ABC' },
      { doi: 'doi:10.1000/abc' },
      { doi: 'https://doi.org/10.1000/abc' },
      { doi: '10.1000/other' },
    ])
  } catch { return { unique: [], duplicates: [] } }
})()
check('doi 去重（前缀/大小写/URL 归一）',
  () => doiDedupe.unique.length === 2 && doiDedupe.duplicates.length === 2
    && doiDedupe.duplicates.every((entry) => entry.reason.startsWith('duplicate:doi:')),
  () => `unique=${doiDedupe.unique.length} dup=${doiDedupe.duplicates.length}`)

const titleDedupe = (() => {
  try {
    return dedupe([
      { title: 'Sleep Deprivation and Working Memory' },
      { title: 'sleep-deprivation and working-memory!' },
    ], { key: 'title' })
  } catch { return { unique: [], duplicates: [] } }
})()
check('title 去重（标点/大小写归一）',
  () => titleDedupe.unique.length === 1 && titleDedupe.duplicates.length === 1,
  () => `unique=${titleDedupe.unique.length} dup=${titleDedupe.duplicates.length}`)

const gateFail = applyGate({
  gate: { tool: 'science_stats', require: 'effectSize.value' },
  result: { effectSize: {} },
})
check('applyGate 点路径缺失 → ok=false 且 missing 指出路径',
  () => gateFail.ok === false && Array.isArray(gateFail.missing) && gateFail.missing.includes('effectSize.value'),
  () => JSON.stringify(gateFail))
check('空 gate 视为放行',
  () => applyGate({ gate: null, result: null }).ok === true)

const escalation = (() => { try { return escalate({ reason: 'method assumption 不成立' }) } catch { return null } })()
const escalationData = (() => { try { return escalate({ reason: 'data license 缺失' }) } catch { return null } })()
check('escalate 关键词选岗且 path 末位是 pi',
  () => escalation.role === 'methodologist'
    && escalation.path[escalation.path.length - 1] === 'pi'
    && escalationData.role === 'data-steward'
    && escalationData.path[escalationData.path.length - 1] === 'pi',
  () => `${escalation?.role}:${escalation?.path?.join('→')} / ${escalationData?.role}:${escalationData?.path?.join('→')}`)

/* E1：executor 说 ok，但产出过不了 shard 的 gate → needs-review，不 complete */
try {
  const executors = { classify, local: async () => ({ ok: true, output: { ok: false } }) }
  const scheduler = createScheduler({ store, executors, consensus: consensusImpl })
  const scene = createScene({
    id: 'e1', shards: [{ gate: { tool: 'science_stats', require: 'ok' } }],
  })
  const summary = await scheduler.run({
    campaignId: scene, mode: 'local', localConcurrency: 1, highWatermark: 1000, maxShards: Infinity,
  })
  const row = sceneShardState(scene)
  const events = store.listEvents({ campaignId: scene, limit: 200 })
  check('gate 不通过 → 分片 needs-review 且落 gate-failed 事件',
    () => row?.state === 'needs-review' && summary.done === 0 && summary.needsReview === 1
      && events.some((event) => event.kind === 'gate-failed' && event.shard_id === sceneShardId('e1')),
    () => JSON.stringify({ state: row?.state, done: summary.done, needsReview: summary.needsReview, events: events.map((e) => e.kind) }))
} catch (error) {
  check('E1 gate 场景可完成', () => false, () => `场景异常：${error.message}`)
}

/* E2：ingest 一条 done 让 task 凑满票，其中一张是否决票 → needs-review + escalated */
try {
  const executors = { classify, local: async () => ({ ok: true }), delegate: () => ({ brief: null }) }
  const scheduler = createScheduler({ store, executors, consensus: consensusImpl })
  const scene = createScene({ id: 'e2', shards: [{ executor: 'llm' }], taskVotes: 3 })
  const taskId = 'tk_scene_e2'
  const shardId = sceneShardId('e2')
  store.recordVote({ campaignId: scene, taskId, shardId, voter: 'voter-a', verdict: 'done' })
  store.recordVote({ campaignId: scene, taskId, shardId, voter: 'voter-b', verdict: 'done' })
  store.recordVote({ campaignId: scene, taskId, shardId, voter: 'methodologist', verdict: 'veto' })
  const summary = await scheduler.run({
    campaignId: scene, mode: 'ingest', results: [{ shardId, verdict: 'done', output: { ok: true } }],
  })
  const row = sceneShardState(scene)
  const events = store.listEvents({ campaignId: scene, limit: 200 })
  const escalations = summary.escalations ?? []
  check('ingest 含 veto → needs-review + escalated 且升级到方法学/数据岗',
    () => row?.state === 'needs-review'
      && events.some((event) => event.kind === 'escalated' && event.shard_id === shardId)
      && escalations.length >= 1
      && ['methodologist', 'data-steward'].includes(escalations[0]?.role),
    () => JSON.stringify({ state: row?.state, events: events.map((e) => e.kind), escalations }))
} catch (error) {
  check('E2 veto 升级场景可完成', () => false, () => `场景异常：${error.message}`)
}

/* E3：science_org_chart 越权检查失败时把 authority-denied 写进战役事件 */
try {
  const { apply: applyOrchestraTools } = await import('../lib/orchestra-tools.js')
  const registered = []
  const fakeCtx = {
    tools: { register: (tool) => registered.push(tool) },
    get: (key) => (key === 'scienceRuntime' ? { store } : undefined),
  }
  applyOrchestraTools(fakeCtx)
  const tool = registered.find((entry) => entry.name === 'science_org_chart')
  const scene = createScene({ id: 'e3', count: 1 })
  const res = await tool.execute({ role: 'survey', tool: 'science_figure', campaignId: scene })
  const events = store.listEvents({ campaignId: scene, limit: 200 })
  check('science_org_chart 越权 → ok=false + authority-denied 事件 + eventRecorded=true',
    () => Boolean(tool) && res?.ok === false && res?.check?.ok === false && res?.eventRecorded === true
      && events.some((event) => event.kind === 'authority-denied'
        && event.shard_id === null && event.detail?.role === 'survey'),
    () => JSON.stringify({ ok: res?.ok, eventRecorded: res?.eventRecorded, events: events.map((e) => e.kind) }))
} catch (error) {
  check('E3 越权事件场景可完成', () => false, () => `场景异常：${error.message}`)
}


/* ══════════════════════════ F. 隔离 ══════════════════════════ */
begin('隔离')

check('数据库与临时文件都落在临时目录内', () => {
  const root = resolve(tmpRoot)
  const inside = (path) => resolve(path).startsWith(root + sep)
  if (!inside(dbPath) || !existsSync(dbPath)) return false
  const entries = readdirSync(tmpRoot)
  return entries.length > 0 && entries.every((name) => inside(join(tmpRoot, name)))
}, () => dbPath)

check('真实 ~/.deepscient/science/science.db 未被触碰',
  () => mtimeOf(realScienceDb) === scienceMtimeBefore,
  () => `${scienceMtimeBefore} → ${mtimeOf(realScienceDb)}`)

check('真实 ~/.dsh 未被触碰',
  () => mtimeOf(realDsh) === dshMtimeBefore,
  () => `${dshMtimeBefore} → ${mtimeOf(realDsh)}`)

/* ── 收尾 ─────────────────────────────────────────────────────────────── */
// Windows 上 WAL 还开着时目录删不掉：先关连接，删不掉也不影响结论
try { store.db.close() } catch { /* 已关闭 */ }
try { rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 临时目录残留无害 */ }

console.log('')
if (fail === 0) {
  console.log(`结果：${pass} 项全部通过（0 失败）`)
  process.exit(0)
}
console.log(`结果：${pass + fail} 项中 ${fail} 项失败`)
for (const line of fails) console.log(`  FAIL  ${line}`)
process.exit(1)
