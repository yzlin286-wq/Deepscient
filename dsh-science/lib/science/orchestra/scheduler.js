/**
 * orchestra 调度器：租约领取 → 执行/委派 → 落库 → 共识。
 *
 * 为什么所有判断都从库读：同一个 campaign 可能被多个进程、多次 run 交替推进，
 * 任何跨 run 的内存状态都会在崩溃或并发时变成幻觉，只有库里的 state 才可信。
 */
import { cpus } from 'node:os'
import { randomUUID } from 'node:crypto'

const HEARTBEAT_MS = 30000
const MAX_CLAIM = 1000

/** 指数退避封顶 5 分钟：下游故障时不能让重试把队列打成全速。 */
export function backoffMs(attempt) {
  const n = Number.isFinite(Number(attempt)) ? Math.max(0, Math.floor(Number(attempt))) : 0
  return Math.min(300000, 1000 * (2 ** n))
}

function safeJson(text, fallback) {
  if (!text) return fallback
  try { return JSON.parse(text) } catch { return fallback }
}

function emptySummary({ campaignId, mode, owner }) {
  return {
    campaignId,
    mode,
    owner,
    paused: null,
    processed: 0,
    done: 0,
    failed: 0,
    needsReview: 0,
    needsHuman: 0,
    delegated: 0,
    reclaimed: 0,
    queuedLeft: 0,
    elapsedMs: 0,
    throughputPerSec: 0,
    spend: { usd: 0, tokens: 0 },
    delegations: [],
    escalations: [],
    events: [],
  }
}

/** 内置共识：够票且多数占比 ≥ 0.66 才算 done，否则交给人工/复核。 */
const DEFAULT_CONSENSUS = {
  aggregate({ task, votes }) {
    const total = Array.isArray(votes) ? votes.length : 0
    const counts = {}
    for (const vote of votes || []) {
      const key = String(vote?.verdict ?? 'unknown')
      counts[key] = (counts[key] || 0) + 1
    }
    let winner = null
    let top = 0
    for (const [key, n] of Object.entries(counts)) {
      if (n > top) { winner = key; top = n }
    }
    const confidence = total > 0 ? top / total : 0
    const needed = Math.max(1, Number(task?.votes) || 1)
    return {
      verdict: total >= needed && confidence >= 0.66 ? 'done' : 'needs-review',
      winner,
      confidence,
      dissents: total - top,
    }
  },
}

export function createScheduler({ store, executors, consensus = null, logger = null } = {}) {
  if (!store) throw new Error('science/orchestra: 需要 store')
  if (!executors) throw new Error('science/orchestra: 需要 executors')
  const consensusImpl = consensus && typeof consensus.aggregate === 'function' ? consensus : DEFAULT_CONSENSUS

  /** 每轮把内存里发生的事同时写库与 summary，工具层不用再查一遍事件表。 */
  function emit(ctx, kind, shardId = null, detail = null) {
    try {
      store.appendEvent({ campaignId: ctx.campaignId, shardId, kind, detail })
    } catch (error) {
      logger?.warn?.(`science/orchestra: 事件写入失败 ${kind}: ${error.message}`)
    }
    ctx.summary.events.push({ kind, shardId: shardId ?? null, detail: detail ?? null })
  }

  function getTask(ctx, taskId) {
    if (!taskId) return null
    if (ctx.tasks.has(taskId)) return ctx.tasks.get(taskId)
    const row = store.db.prepare('SELECT * FROM campaign_task WHERE id = ?').get(taskId)
    const task = row
      ? { ...row, gate: safeJson(row.gate_json, null), dependsOn: safeJson(row.depends_on_json, []) }
      : null
    ctx.tasks.set(taskId, task)
    return task
  }

  function budgetExceeded(ctx) {
    const limit = Number(ctx.campaign?.budget?.usd)
    if (!Number.isFinite(limit)) return false
    return ctx.spend.usd >= limit
  }

  /**
   * 门禁来源：分片自己的 gate 优先于任务级 gate（单个分片可以比任务更严）。
   * 两个来源都从已读到的行里取，行长什么样就解析什么样，不额外查库。
   */
  function gateFor(shard, task) {
    const fromShard = shard?.gate ?? safeJson(shard?.gate_json, null)
    if (fromShard) return fromShard
    return task?.gate ?? safeJson(task?.gate_json, null)
  }

  /** 有 gate 且共识实现支持时才算门禁；默认共识没有 applyGate，跳过而不是崩。 */
  function checkGate(gate, result) {
    if (!gate || typeof consensusImpl.applyGate !== 'function') return null
    return consensusImpl.applyGate({ gate, result })
  }

  /**
   * 冲突升级：needs-review 不能只改一个 state 就完事，必须留下「该谁来看」的痕迹。
   * 默认共识只有 aggregate，没有 escalate 时安静跳过，换实现不该让调度崩掉。
   */
  function escalateReview(ctx, shard, task, reason) {
    if (typeof consensusImpl.escalate !== 'function') return null
    let esc = null
    try {
      esc = consensusImpl.escalate({ task, reason })
    } catch (error) {
      logger?.warn?.(`science/orchestra: 升级失败 ${shard.id}: ${error.message}`)
      return null
    }
    if (!esc) return null
    emit(ctx, 'escalated', shard.id, { role: esc.role, path: esc.path, reason: esc.reason })
    ctx.summary.escalations.push({
      shardId: shard.id,
      taskId: shard.task_id ?? null,
      role: esc.role ?? null,
      path: esc.path ?? [],
      reason: esc.reason ?? null,
    })
    return esc
  }

  function addSpend(ctx, { tokensUsed, spendUsd } = {}) {
    const tokens = Number(tokensUsed)
    const usd = Number(spendUsd)
    if (!Number.isFinite(tokens) && !Number.isFinite(usd)) return
    ctx.spend.usd += Number.isFinite(usd) ? usd : 0
    ctx.spend.tokens += Number.isFinite(tokens) ? tokens : 0
    ctx.summary.spend = { usd: ctx.spend.usd, tokens: ctx.spend.tokens }
    try {
      store.updateCampaign(ctx.campaignId, { spend: { usd: ctx.spend.usd, tokens: ctx.spend.tokens } })
    } catch (error) {
      logger?.warn?.(`science/orchestra: 预算写入失败: ${error.message}`)
    }
  }

  function campaignStats(campaignId) {
    return store.campaignStats({ campaignId })
  }

  /** 全部分片要么 done 要么 needs-human 才算收工；只在首次写 completed。 */
  function maybeComplete(ctx) {
    const row = store.db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN state='done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN state='needs-human' THEN 1 ELSE 0 END) AS human
      FROM campaign_shard WHERE campaign_id = ?
    `).get(ctx.campaignId)
    const total = Number(row?.total) || 0
    const done = Number(row?.done) || 0
    const human = Number(row?.human) || 0
    if (total === 0 || done + human < total) return false
    const campaign = store.getCampaign(ctx.campaignId)
    if (campaign?.state === 'completed') return true
    store.updateCampaign(ctx.campaignId, { state: 'completed' })
    emit(ctx, 'campaign-completed', null, { done, total })
    return true
  }

  function idlePaused(ctx, stats, overBudget) {
    if (overBudget) return 'budget'
    if (stats.shards.needsHuman > 0 && stats.shards.queued === 0 && stats.shards.leased === 0) return 'paused-human'
    return 'no-work'
  }

  function requeue(shardId, output = null) {
    store.setShardState({ shardId, state: 'queued', output })
  }

  /**
   * 成功落库。votes>1 的分片先投票再看共识：票不够就回队列等下一票，
   * 而不是让一个 shard 的成功直接冒充整个 task 的结论。
   */
  function succeed(ctx, shard, task, result, { owner = ctx.owner, source = 'local' } = {}) {
    const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : []
    const needed = Math.max(1, Number(task?.votes) || 1)
    const needsVote = Number(shard.executor === 'llm') && needed > 1

    // 门禁先于投票与完成：不合格的结果不该被记成一张 done 票。
    const gate = gateFor(shard, task)
    const checked = checkGate(gate, result?.output ?? result)
    if (checked && checked.ok === false) {
      store.setShardState({
        shardId: shard.id,
        state: 'needs-review',
        output: result?.output ?? null,
        error: `gate-failed:${checked.reason}`,
      })
      emit(ctx, 'gate-failed', shard.id, { gate, missing: checked.missing, reason: checked.reason })
      return 'needs-review'
    }

    if (needsVote && source === 'local') {
      store.recordVote({
        campaignId: ctx.campaignId,
        taskId: shard.task_id,
        shardId: shard.id,
        voter: ctx.owner,
        verdict: 'done',
        evidenceWeight: result?.evidenceWeight ?? 1,
        payload: result?.output ?? null,
      })
      const votes = store.listVotes({ taskId: shard.task_id })
      if (votes.length < needed) {
        requeue(shard.id, result?.output ?? null)
        return 'vote-waiting'
      }
      const aggregate = consensusImpl.aggregate({ task, votes: [...votes] })
      if (aggregate?.verdict !== 'done') {
        store.setShardState({
          shardId: shard.id,
          state: 'needs-review',
          output: result?.output ?? null,
          error: `consensus:${aggregate?.confidence ?? 0}`,
        })
        escalateReview(ctx, shard, task, aggregate?.reason)
        return 'needs-review'
      }
    }

    const completed = store.completeShard({
      shardId: shard.id,
      owner,
      output: result?.output ?? null,
      gate: result?.gateInput ?? null,
    })
    if (!completed) return 'lost-lease'

    for (const artifact of artifacts) {
      if (!artifact?.kind || !artifact?.path) continue
      store.recordArtifact({
        campaignId: ctx.campaignId,
        taskId: shard.task_id,
        shardId: shard.id,
        kind: artifact.kind,
        path: artifact.path,
        sha256: artifact.sha256 ?? null,
        bytes: artifact.bytes ?? null,
        producerRole: shard.role ?? null,
        tool: artifact.tool ?? null,
        inputHash: artifact.inputHash ?? null,
      })
    }
    return 'done'
  }

  function fail(ctx, shard, error, { owner = ctx.owner } = {}) {
    const now = Date.now()
    const attempt = (Number(shard.attempt) || 0) + 1
    const retryAt = now + backoffMs(attempt)
    const message = error === null || error === undefined ? 'unknown' : String(error)
    const res = store.failShard({ shardId: shard.id, owner, error: message, now, retryAt })
    // 租约已被别人接管时 failShard 不改行，不能误报一次失败。
    if (res.attempt === (Number(shard.attempt) || 0) && res.state === shard.state) return 'lost-lease'
    if (res.state === 'queued') {
      emit(ctx, 'shard-retried', shard.id, { taskId: shard.task_id, attempt: res.attempt, error: message, retryAt })
      return 'retried'
    }
    emit(ctx, 'shard-failed', shard.id, { taskId: shard.task_id, attempt: res.attempt, error: message })
    return 'failed'
  }

  /** 单个 shard 的一次尝试：分类 → 执行 → 结果落库。 */
  async function executeOne(ctx, shard) {
    const task = getTask(ctx, shard.task_id) || { id: shard.task_id, votes: 1 }
    // 同一 shard 在单次 run 里最多执行 votes+1 次（投票需要重复跑），防止自定义共识死循环。
    const seen = ctx.execCounts.get(shard.id) || 0
    const cap = Math.max(1, Number(task.votes) || 1) + 1
    if (seen >= cap) return 'skipped'
    ctx.execCounts.set(shard.id, seen + 1)

    let kind = shard.executor || 'local'
    try {
      if (typeof executors.classify === 'function') kind = executors.classify({ task, shard }) || kind
    } catch (error) {
      logger?.warn?.(`science/orchestra: classify 失败 ${shard.id}: ${error.message}`)
    }

    if (kind === 'human') {
      store.setShardState({ shardId: shard.id, state: 'needs-human' })
      emit(ctx, 'shard-needs-human', shard.id, { taskId: shard.task_id, reason: 'classify' })
      return 'needs-human'
    }
    if (kind !== 'local') {
      // local worker 只干 local 的活，其余交给 delegate 模式，别在这里硬跑。
      requeue(shard.id)
      return 'deferred'
    }

    const hb = setInterval(() => {
      try {
        store.heartbeat({ owner: ctx.owner, shardIds: [shard.id], now: Date.now(), leaseMs: ctx.leaseMs })
      } catch (error) {
        logger?.warn?.(`science/orchestra: 心跳失败 ${shard.id}: ${error.message}`)
      }
    }, HEARTBEAT_MS)
    hb.unref?.()

    let result
    try {
      result = await executors.local({
        store,
        campaign: ctx.campaign,
        task,
        shard,
        workdir: ctx.workdir,
      })
    } catch (error) {
      result = { ok: false, error: error?.message || String(error) }
    } finally {
      clearInterval(hb)
    }
    if (!result || typeof result !== 'object') result = { ok: false, error: 'executor 返回非对象' }

    addSpend(ctx, result)
    if (result.ok === true) return succeed(ctx, shard, task, result)
    return fail(ctx, shard, result.error ?? 'executor-failed')
  }

  /** 固定数量 worker 从同一个队列取片：并发上限就是 worker 数，不再叠加。 */
  async function drain(ctx, shards) {
    let cursor = 0
    const worker = async () => {
      while (cursor < shards.length) {
        const shard = shards[cursor]
        cursor += 1
        const outcome = await executeOne(ctx, shard)
        if (outcome === 'skipped' || outcome === 'deferred') {
          requeue(shard.id)
          continue
        }
        if (outcome === 'done') ctx.summary.done += 1
        else if (outcome === 'needs-review') ctx.summary.needsReview += 1
        else if (outcome === 'needs-human') ctx.summary.needsHuman += 1
        else if (outcome === 'failed' || outcome === 'retried') ctx.summary.failed += 1
        ctx.summary.processed += 1
      }
    }
    const width = Math.max(1, Math.min(ctx.localConcurrency, shards.length))
    await Promise.all(Array.from({ length: width }, () => worker()))
  }

  /** 只领 llm 片并生成 brief；不执行，交给上层派子智能体。 */
  async function delegateOnce(ctx, limit) {
    if (!(limit > 0)) return 0
    if (typeof executors.delegate !== 'function') {
      throw new Error('science/orchestra: delegate 模式需要 executors.delegate')
    }
    const rows = store.claimShards({
      campaignId: ctx.campaignId,
      owner: ctx.owner,
      limit: Math.min(MAX_CLAIM, limit),
      now: Date.now(),
      leaseMs: ctx.leaseMs,
      executorIn: ['llm'],
    })
    for (const shard of rows) {
      const task = getTask(ctx, shard.task_id) || { id: shard.task_id, votes: 1 }
      let handed
      try {
        handed = executors.delegate({ store, campaign: ctx.campaign, task, shard })
      } catch (error) {
        logger?.warn?.(`science/orchestra: delegate 失败 ${shard.id}: ${error.message}`)
        handed = { brief: { error: error.message }, tokensEstimate: 0 }
      }
      const role = shard.role ?? task.role ?? null
      const brief = handed?.brief ?? null
      const tokensEstimate = Number(handed?.tokensEstimate) || 0
      // 委派不是执行：attempt 不变，只把锁还回队列，等结果由 ingest 送回。
      requeue(shard.id)
      emit(ctx, 'shard-delegated', shard.id, { taskId: shard.task_id, role, tokensEstimate })
      ctx.summary.delegations.push({ shardId: shard.id, taskId: shard.task_id, role, brief, tokensEstimate })
    }
    return rows.length
  }

  function agePriorities(campaignId, now) {
    // now 只为调用方签名一致；老化是纯计数操作，不需要时间戳。
    void now
    const res = store.db.prepare(`
      UPDATE campaign_shard SET priority = MAX(10, priority - 1)
      WHERE campaign_id = ? AND state = 'queued'
    `).run(campaignId)
    return Number(res.changes) || 0
  }

  /** 派单主循环：每一轮都重新从库里读状态，因此任意时刻中断都能续跑。 */
  async function loop(ctx, { maxShards, highWatermark, delegateBatch, llmConcurrency }) {
    const { campaignId, summary } = ctx
    let stop = 'no-work'
    let round = 0

    while (true) {
      round += 1
      summary.reclaimed += store.reapExpiredLeases({ campaignId, now: Date.now() }).length
      if (round % 20 === 0) agePriorities(campaignId, Date.now())

      ctx.campaign = store.getCampaign(campaignId) || ctx.campaign
      if (maybeComplete(ctx)) { stop = null; break }

      const stats = campaignStats(campaignId)
      const overBudget = budgetExceeded(ctx)
      if (overBudget && !ctx.budgetTripped) {
        ctx.budgetTripped = true
        emit(ctx, 'budget-tripped', null, {
          budgetUsd: Number(ctx.campaign?.budget?.usd),
          spendUsd: ctx.spend.usd,
        })
      }

      if (stats.shards.queued > highWatermark) {
        emit(ctx, 'backpressure', null, { queued: stats.shards.queued, highWatermark })
        stop = 'backpressure'
        break
      }
      if (summary.processed >= maxShards) { stop = 'max-shards'; break }

      const remaining = Number.isFinite(maxShards) ? maxShards - summary.processed : Infinity

      if (ctx.mode === 'delegate') {
        if (overBudget) { stop = 'budget'; break }
        const n = await delegateOnce(ctx, Math.min(delegateBatch, remaining))
        summary.delegated += n
        stop = n > 0 ? 'awaiting-delegation' : idlePaused(ctx, stats, overBudget)
        break
      }

      const claimLimit = Math.min(MAX_CLAIM, ctx.localConcurrency * 2,
        Number.isFinite(remaining) ? remaining : MAX_CLAIM)
      const rows = claimLimit > 0
        ? store.claimShards({
          campaignId,
          owner: ctx.owner,
          limit: claimLimit,
          now: Date.now(),
          leaseMs: ctx.leaseMs,
          executorIn: ['local'],
        })
        : []

      if (rows.length === 0) {
        if (ctx.mode === 'auto' && !overBudget) {
          const n = await delegateOnce(ctx, Math.min(delegateBatch, llmConcurrency, remaining))
          summary.delegated += n
          stop = n > 0 ? 'awaiting-delegation' : idlePaused(ctx, stats, overBudget)
        } else {
          stop = idlePaused(ctx, stats, overBudget)
        }
        break
      }

      const before = summary.processed
      await drain(ctx, rows)
      // 领到却一个都没跑（全被跳过），说明继续领只会原地打转。
      if (summary.processed === before) { stop = idlePaused(ctx, stats, overBudget); break }
    }

    summary.paused = stop
  }

  /** ingest 模式的单条结果落库：投票 → 共识 → done / needs-review / queued。 */
  function ingestOne(ctx, shard, task, item) {
    const needed = Math.max(1, Number(task?.votes) || 1)
    store.recordVote({
      campaignId: ctx.campaignId,
      taskId: shard.task_id,
      shardId: shard.id,
      voter: ctx.owner,
      verdict: 'done',
      evidenceWeight: item.evidenceWeight ?? 1,
      payload: item.output ?? null,
    })
    if (needed > 1) {
      const votes = store.listVotes({ taskId: shard.task_id })
      if (votes.length < needed) {
        requeue(shard.id, item.output ?? null)
        return 'vote-waiting'
      }
      const aggregate = consensusImpl.aggregate({ task, votes: [...votes] })
      if (aggregate?.verdict !== 'done') {
        store.setShardState({
          shardId: shard.id,
          state: 'needs-review',
          output: item.output ?? null,
          error: `consensus:${aggregate?.confidence ?? 0}`,
        })
        escalateReview(ctx, shard, task, aggregate?.reason)
        return 'needs-review'
      }
    }
    // ingest 的结果来自外部 agent，不持有本进程租约，因此不校验 owner。
    const completed = store.completeShard({ shardId: shard.id, owner: null, output: item.output ?? null })
    return completed ? 'done' : 'lost-lease'
  }

  function ingestInto(ctx, results) {
    const { campaignId, summary } = ctx
    for (const item of results) {
      if (!item?.shardId) continue
      const row = store.db.prepare('SELECT * FROM campaign_shard WHERE id = ? AND campaign_id = ?')
        .get(item.shardId, campaignId)
      if (!row) continue
      const task = getTask(ctx, row.task_id) || { id: row.task_id, votes: 1 }
      addSpend(ctx, item)
      summary.processed += 1

      if (item.verdict === 'done') {
        const outcome = ingestOne(ctx, row, task, item)
        if (outcome === 'done') summary.done += 1
        else if (outcome === 'needs-review') summary.needsReview += 1
      } else {
        const outcome = fail(ctx, row, item.error ?? 'ingest-failed', { owner: null })
        if (outcome === 'retried' || outcome === 'failed') summary.failed += 1
      }
    }
    maybeComplete(ctx)
  }

  async function run(options = {}) {
    const campaignId = options?.campaignId
    if (!campaignId) throw new Error('science/orchestra: run 需要 campaignId')
    const mode = options.mode || 'local'
    if (!['local', 'delegate', 'ingest', 'auto'].includes(mode)) {
      throw new Error(`science/orchestra: 未知 mode ${mode}`)
    }
    const maxShards = options.maxShards === undefined || options.maxShards === null || options.maxShards === Infinity
      ? Infinity
      : Math.max(0, Math.floor(Number(options.maxShards) || 0))
    const owner = options.owner || `sched-${process.pid}-${randomUUID().slice(0, 6)}`
    const leaseMs = Math.max(1000, Number(options.leaseMs) || 120000)
    const highWatermark = Number.isFinite(Number(options.highWatermark)) ? Number(options.highWatermark) : 20000
    const delegateBatch = Math.max(1, Math.floor(Number(options.delegateBatch) || 6))
    const llmConcurrency = Math.max(1, Math.floor(Number(options.llmConcurrency) || 6))
    const defaultLocal = Math.max(1, cpus().length - 1)
    const localConcurrency = Math.max(1, Math.floor(Number(options.localConcurrency) || defaultLocal))

    const campaign = store.getCampaign(campaignId)
    if (!campaign) throw new Error(`science/orchestra: campaign 不存在 ${campaignId}`)

    const summary = emptySummary({ campaignId, mode, owner })
    const spend = {
      usd: Number(campaign.spend?.usd) || 0,
      tokens: Number(campaign.spend?.tokens) || 0,
    }
    summary.spend = { ...spend }

    const ctx = {
      campaignId,
      mode,
      owner,
      leaseMs,
      campaign,
      summary,
      spend,
      startedAt: Date.now(),
      budgetTripped: false,
      tasks: new Map(),
      execCounts: new Map(),
      workdir: options.workdir ?? null,
      localConcurrency,
    }

    emit(ctx, 'campaign-started', null, {
      mode,
      owner,
      maxShards: Number.isFinite(maxShards) ? maxShards : null,
    })

    if (mode === 'ingest') {
      if (!Array.isArray(options.results)) throw new Error('science/orchestra: ingest 模式需要 results')
      ingestInto(ctx, options.results)
    } else {
      await loop(ctx, { maxShards, highWatermark, delegateBatch, llmConcurrency })
    }

    const stats = campaignStats(campaignId)
    summary.queuedLeft = stats.shards.queued
    summary.spend = { usd: ctx.spend.usd, tokens: ctx.spend.tokens }
    summary.elapsedMs = Date.now() - ctx.startedAt
    summary.throughputPerSec = summary.elapsedMs > 0
      ? Math.round((summary.processed / (summary.elapsedMs / 1000)) * 1000) / 1000
      : 0
    return summary
  }

  function status(campaignId) {
    const campaign = store.getCampaign(campaignId)
    if (!campaign) return null
    const stats = campaignStats(campaignId)
    const counts = store.db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN state='done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN state='needs-human' THEN 1 ELSE 0 END) AS human
      FROM campaign_shard WHERE campaign_id = ?
    `).get(campaignId)
    const total = Number(counts?.total) || 0
    const done = Number(counts?.done) || 0
    const human = Number(counts?.human) || 0
    const nonHuman = Math.max(0, total - human)
    const progress = nonHuman > 0 ? Math.min(1, Math.max(0, done / nonHuman)) : 0

    const distribution = (column) => {
      const rows = store.db.prepare(
        `SELECT ${column} AS k, COUNT(*) AS n FROM campaign_shard WHERE campaign_id = ? GROUP BY ${column}`,
      ).all(campaignId)
      const out = {}
      for (const row of rows) out[row.k ?? 'unknown'] = Number(row.n) || 0
      return out
    }

    const events = store.listEvents({ campaignId, limit: 50 }).map((event) => ({
      id: event.id,
      kind: event.kind,
      shardId: event.shard_id,
      detail: event.detail,
      createdAt: event.created_at,
    }))

    return {
      campaign: {
        id: campaign.id,
        projectId: campaign.project_id,
        question: campaign.question,
        discipline: campaign.discipline,
        state: campaign.state,
        budget: campaign.budget ? { ...campaign.budget } : null,
        spend: campaign.spend ? { ...campaign.spend } : null,
        createdAt: campaign.created_at,
        updatedAt: campaign.updated_at,
      },
      stats: {
        tasks: { ...stats.tasks },
        shards: { ...stats.shards },
        events: stats.events,
      },
      total,
      done,
      human,
      progress,
      distribution: {
        byExecutor: distribution('executor'),
        byRole: distribution('role'),
        byState: distribution('state'),
      },
      events,
    }
  }

  function reap(campaignId) {
    return { reclaimed: store.reapExpiredLeases({ campaignId, now: Date.now() }).length }
  }

  async function ingest({ campaignId, results } = {}) {
    if (!campaignId) throw new Error('science/orchestra: ingest 需要 campaignId')
    const campaign = store.getCampaign(campaignId)
    if (!campaign) throw new Error(`science/orchestra: campaign 不存在 ${campaignId}`)
    const summary = emptySummary({ campaignId, mode: 'ingest', owner: 'ingest' })
    const spend = {
      usd: Number(campaign.spend?.usd) || 0,
      tokens: Number(campaign.spend?.tokens) || 0,
    }
    summary.spend = { ...spend }
    const ctx = {
      campaignId,
      mode: 'ingest',
      owner: 'ingest',
      leaseMs: 120000,
      campaign,
      summary,
      spend,
      startedAt: Date.now(),
      budgetTripped: false,
      tasks: new Map(),
      execCounts: new Map(),
      workdir: null,
      localConcurrency: 1,
    }
    ingestInto(ctx, Array.isArray(results) ? results : [])
    const stats = campaignStats(campaignId)
    summary.queuedLeft = stats.shards.queued
    summary.spend = { usd: ctx.spend.usd, tokens: ctx.spend.tokens }
    summary.elapsedMs = Date.now() - ctx.startedAt
    summary.throughputPerSec = summary.elapsedMs > 0
      ? Math.round((summary.processed / (summary.elapsedMs / 1000)) * 1000) / 1000
      : 0
    summary.paused = stats.shards.queued > 0 ? null : 'no-work'
    return summary
  }

  return { run, status, ingest, reap, agePriorities }
}

export default { createScheduler, backoffMs }
