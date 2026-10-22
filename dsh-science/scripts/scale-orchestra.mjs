#!/usr/bin/env node
/**
 * orchestra 压测：默认造 12000 个 local 分片，用真实调度器全跑一遍。
 *
 *   node scripts/scale-orchestra.mjs --shards 12000 [--concurrency 8] [--json]
 *
 * 断言四件事：done=N、failed=0、duplicateEffects=0、missing=0。
 * 只统计，不写真实数据根：所有数据都在 mkdtemp 出来的临时目录里。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ScienceStore } from '../lib/science/store.js'
import { createScheduler } from '../lib/science/orchestra/scheduler.js'

const argv = process.argv.slice(2)
const jsonMode = argv.includes('--json')

/** 同时接受 `--shards 12000` 与 `--shards=12000` 两种写法。 */
function intArg(name, fallback) {
  const inline = argv.find((item) => item.startsWith(`${name}=`))
  if (inline) {
    const n = Number(inline.slice(name.length + 1))
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
  }
  const index = argv.indexOf(name)
  if (index === -1) return fallback
  const n = Number(argv[index + 1])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

const totalShards = intArg('--shards', 12000)
const concurrency = intArg('--concurrency', 8)

const now = Date.now()
const campaignId = `cmp_scale_${now.toString(36)}`
const taskId = `tk_scale_${now.toString(36)}`
const tmpRoot = mkdtempSync(join(tmpdir(), 'dsh-orch-scale-'))
const dbPath = join(tmpRoot, 'scale.db')

/** 固定种子的 LCG：priority 是随机分布，但每次跑出来的队列形状一致，便于对比。 */
let seed = 20261022
function nextRandom() {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

const counts = new Map()
const durationsMs = []
let completed = 0
let peakRss = process.memoryUsage().rss

let store = null
let summary = null
let setupMs = 0
let runMs = 0
let dbDone = 0
let dbQueued = 0
let crashed = null

try {
  const setupStart = Date.now()
  store = new ScienceStore({ dbPath })

  store.createCampaign({
    id: campaignId,
    question: `orchestra 压测：${totalShards} 个 local 分片`,
    discipline: '压测',
    planHash: `plan_scale_${now.toString(36)}`,
    budget: { usd: 1000, tokens: 1_000_000_000 },
  })
  store.insertTasks([{
    id: taskId,
    campaignId,
    workstreamId: null,
    title: '压测分片',
    role: 'shard-worker',
    executor: 'local',
    dependsOn: [],
    priority: 10,
    votes: 1,
    shards: totalShards,
  }])

  // 按 500 一批入库：store 自己开事务，不能在调用方外面再包 BEGIN
  for (let offset = 0; offset < totalShards; offset += 500) {
    const end = Math.min(totalShards, offset + 500)
    const batch = []
    for (let index = offset; index < end; index += 1) {
      batch.push({
        id: `sd_scale_${index}`,
        campaignId,
        taskId,
        shardIndex: index,
        role: 'shard-worker',
        executor: 'local',
        kind: 'noop',
        payload: { index },
        // priority 随机落在 10–200，用来验证领取顺序与老化逻辑不被单一优先级骗过
        priority: 10 + Math.floor(nextRandom() * 191),
        idempotencyKey: `${campaignId}:${taskId}:${index}`,
        maxAttempts: 3,
      })
    }
    store.insertShards(batch)
  }
  setupMs = Date.now() - setupStart

  const executors = {
    async local({ shard }) {
      const startedAt = process.hrtime.bigint()
      counts.set(shard.id, (counts.get(shard.id) ?? 0) + 1)
      await new Promise((r) => setImmediate(r))
      durationsMs.push(Number(process.hrtime.bigint() - startedAt) / 1e6)

      completed += 1
      if (completed % 500 === 0) {
        const rss = process.memoryUsage().rss
        if (rss > peakRss) peakRss = rss
      }
      if (completed % 1000 === 0 && completed < totalShards) {
        process.stderr.write(`  进度 ${completed}/${totalShards}\n`)
      }
      return { ok: true, output: { noop: true } }
    },
  }

  const scheduler = createScheduler({ store, executors })
  const runStart = Date.now()
  summary = await scheduler.run({
    campaignId,
    mode: 'local',
    localConcurrency: concurrency,
    highWatermark: totalShards * 2,
    maxShards: Infinity,
  })
  runMs = Date.now() - runStart

  dbDone = Number(store.db.prepare(
    "SELECT COUNT(*) AS n FROM campaign_shard WHERE campaign_id = ? AND state='done'",
  ).get(campaignId)?.n) || 0
  dbQueued = Number(store.db.prepare(
    "SELECT COUNT(*) AS n FROM campaign_shard WHERE campaign_id = ? AND state='queued'",
  ).get(campaignId)?.n) || 0
} catch (error) {
  crashed = error
} finally {
  try { store?.db?.close() } catch { /* 已关闭 */ }
  try { rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 临时目录残留无害 */ }
}

/* ── 统计 ─────────────────────────────────────────────────────────────── */

const done = summary?.done ?? 0
const failed = summary?.failed ?? 0
const duplicateEffects = [...counts.values()].filter((n) => n !== 1).length
const missing = totalShards - counts.size
const totalMs = setupMs + runMs
const throughput = runMs > 0 ? Math.round((done / (runMs / 1000)) * 100) / 100 : 0

const sorted = durationsMs.slice().sort((a, b) => a - b)
const percentile = (p) => {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return Math.round(sorted[index] * 1000) / 1000
}
const p50 = percentile(0.5)
const p95 = percentile(0.95)
const peakRssMb = Math.round((peakRss / 1024 / 1024) * 10) / 10

const ok = crashed === null && done === totalShards && failed === 0 && duplicateEffects === 0 && missing === 0

const report = {
  shards: totalShards,
  concurrency,
  done,
  failed,
  duplicateEffects,
  missing,
  dbDone,
  dbQueued,
  setupMs,
  runMs,
  totalMs,
  throughputPerSec: throughput,
  p50Ms: p50,
  p95Ms: p95,
  peakRssMb,
  ok,
  ...(crashed ? { error: crashed.message } : {}),
}

if (jsonMode) {
  console.log(JSON.stringify(report))
} else {
  const rows = [
    ['分片数', String(totalShards)],
    ['并发', String(concurrency)],
    ['done', String(done)],
    ['failed', String(failed)],
    ['duplicateEffects', String(duplicateEffects)],
    ['missing', String(missing)],
    ['库内 done / queued', `${dbDone} / ${dbQueued}`],
    ['装库耗时', `${setupMs} ms`],
    ['调度耗时', `${runMs} ms`],
    ['总耗时', `${totalMs} ms`],
    ['吞吐', `${throughput} shard/s`],
    ['P50 单分片', `${p50} ms`],
    ['P95 单分片', `${p95} ms`],
    ['峰值 RSS', `${peakRssMb} MB`],
  ]
  console.log('orchestra 压测结果')
  for (const [key, value] of rows) console.log(`  ${key.padEnd(20, ' ')} ${value}`)
  if (crashed) console.log(`  错误                 ${crashed.message}`)
}

process.exit(ok ? 0 : 1)
