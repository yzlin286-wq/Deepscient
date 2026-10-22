/**
 * orchestra 真实交付闭环演示：建战役 → 本地执行 → 生成交付物。
 *
 *   node scripts/demo-campaign.mjs --example sleep-wm --seed 42
 *
 * 设计取舍：
 *   - 数据根与用户真实库隔离：只往 <home>/science/campaigns 下写，重复跑不会污染课题数据
 *   - votes 固定为 1：llm 分片本来就留在队列里等外部 agent，投票只会把演示卡住
 *   - 退出码按 failed 分片判定，便于 CI 直接把「跑失败」当红灯
 */
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { ScienceStore } from '../lib/science/store.js'
import { buildPlan, persistPlan } from '../lib/science/orchestra/plan.js'
import { createExecutors } from '../lib/science/orchestra/executors.js'
import { createScheduler } from '../lib/science/orchestra/scheduler.js'
import { generateDeliverables } from '../lib/science/orchestra/report.js'

const QUESTION = '睡眠剥夺对工作记忆容量的影响：一项随机对照实验'

function usage() {
  return [
    '用法：node scripts/demo-campaign.mjs --example sleep-wm --seed 42',
    '  [--home <数据根>] [--literature 120] [--sections 6] [--figures 2] [--force] [--json]',
  ].join('\n')
}

function parseIntArg(raw, name, min, max) {
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`${name} 需要数字，收到 ${raw}`)
  const value = Math.trunc(n)
  if (value < min || value > max) throw new Error(`${name} 超出范围 [${min}, ${max}]：${value}`)
  return value
}

function parseArgs(argv) {
  const out = {
    example: 'sleep-wm',
    seed: 42,
    home: null,
    literature: 120,
    sections: 6,
    figures: 2,
    force: false,
    json: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--example') out.example = String(argv[++i] ?? '')
    else if (arg === '--seed') out.seed = parseIntArg(argv[++i], '--seed', -2147483648, 2147483647)
    else if (arg === '--home') out.home = String(argv[++i] ?? '')
    else if (arg === '--literature') out.literature = parseIntArg(argv[++i], '--literature', 1, 50000)
    else if (arg === '--sections') out.sections = parseIntArg(argv[++i], '--sections', 1, 40)
    else if (arg === '--figures') out.figures = parseIntArg(argv[++i], '--figures', 1, 32)
    else if (arg === '--force') out.force = true
    else if (arg === '--json') out.json = true
    else if (arg === '--help' || arg === '-h') {
      console.log(usage())
      process.exit(0)
    } else {
      throw new Error(`未知参数：${arg}`)
    }
  }
  if (!out.example) throw new Error('--example 不能为空')
  return out
}

/** 展开 ~：Windows 下用户手输 --home ~/x 时不能被当成相对路径。 */
function resolveHome(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2))
  return isAbsolute(text) ? text : resolve(process.cwd(), text)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const home = resolveHome(args.home)
    ?? resolveHome(process.env.DSH_HOME)
    ?? join(homedir(), '.deepscient')
  const scienceRoot = join(home, 'science')
  const campaignsDir = join(scienceRoot, 'campaigns')
  mkdirSync(campaignsDir, { recursive: true })

  const store = new ScienceStore({ dbPath: join(scienceRoot, 'science.db') })
  try {
    const plan = buildPlan({
      question: QUESTION,
      discipline: 'neuroscience',
      example: args.example,
      seed: args.seed,
      constraints: {
        literatureCount: args.literature,
        sections: args.sections,
        figureCount: args.figures,
        votes: 1,
      },
    })

    const persisted = persistPlan(store, plan, { force: args.force })
    const campaignId = persisted.campaignId
    const workdir = join(campaignsDir, campaignId)
    mkdirSync(workdir, { recursive: true })

    const executors = createExecutors({ store, workdirFor: () => workdir })
    const scheduler = createScheduler({ store, executors })
    const runOptions = {
      campaignId,
      mode: 'local',
      workdir,
      localConcurrency: 4,
      highWatermark: 100000,
    }
    await scheduler.run(runOptions)

    /* 领片只看优先级、不看依赖，同一批里作图可能先于统计被领走。
       调度器把这类失败放回队列并给了退避时间，这里等到退避结束再续跑，
       否则演示会停在「图没生成、小节只写了一半」的中间态。 */
    for (let round = 0; round < 6; round += 1) {
      const pending = store.db.prepare(`
        SELECT COUNT(*) AS n, MIN(next_run_at) AS next_at FROM campaign_shard
        WHERE campaign_id = ? AND state = 'queued' AND executor = 'local'
      `).get(campaignId)
      if (!Number(pending?.n)) break
      const waitMs = Math.max(0, Number(pending.next_at) - Date.now()) + 50
      if (waitMs > 0.05) await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 5000)))
      await scheduler.run(runOptions)
    }

    const out = generateDeliverables({ store, campaignId, outDir: join(workdir, 'deliverables') })
    const stats = store.campaignStats({ campaignId })
    const exitCode = stats.shards.failed > 0 ? 1 : 0

    const manifestFiles = out.files.map((file) => ({
      path: file.path,
      bytes: file.bytes,
      sha256: file.sha256,
    }))

    if (args.json) {
      console.log(JSON.stringify({
        campaignId,
        planHash: persisted.planHash,
        example: args.example,
        seed: args.seed,
        tasks: stats.tasks,
        shards: stats.shards,
        outDir: out.outDir,
        files: manifestFiles,
        idempotent: out.idempotent,
        exitCode,
      }))
    } else {
      console.log(`campaignId: ${campaignId}`)
      console.log(`planHash: ${persisted.planHash}`)
      console.log(`数据根: ${scienceRoot}`)
      console.log(`任务: ${stats.tasks.total} · 分片: ${stats.shards.done + stats.shards.failed + stats.shards.needsHuman + stats.shards.needsReview + stats.shards.queued}`)
      console.log(`状态: done ${stats.shards.done} · failed ${stats.shards.failed} · needs-human ${stats.shards.needsHuman} · needs-review ${stats.shards.needsReview} · queued ${stats.shards.queued}`)
      console.log(`交付目录: ${out.outDir}`)
      console.log('交付文件:')
      for (const file of out.files) {
        console.log(`  ${file.path}  ${file.bytes} B  sha256:${file.sha256.slice(0, 12)}`)
      }
      console.log(`idempotent: ${out.idempotent}`)
    }

    process.exitCode = exitCode
  } finally {
    store.close()
  }
}

main().catch((error) => {
  console.error(`演示失败：${error?.stack ?? error}`)
  process.exitCode = 1
})
