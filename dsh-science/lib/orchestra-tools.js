/**
 * 调度层工具（preset 平面）：把「编制 → 战役计划 → 有界并发调度 → 状态 → 交付物」交给模型。
 *
 *   science_org_chart         谁在岗、谁能用哪个工具、谁能一票否决、往上报给谁
 *   science_campaign_plan     一句话问题 → 可落库、可重放、可调度的 DAG
 *   science_campaign_run      推一轮：本地执行 / 生成委派单 / 回收外部结果
 *   science_campaign_status   进度、六态分片、最近事件
 *   science_campaign_report   证据 → report.md / paper.md / evidence.json
 *
 * 这一层不重新实现任何判断：编制读 chart.js，计划读 plan.js，调度读 scheduler.js，
 * 交付物读 report.js。工具只做「参数收窄 + 结果裁剪 + 中文渲染」。
 */
import { resolveDshToolsPackage } from './tools.js'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { orgSummary, assertTool, can, escalationPath, batchPolicy } from './science/orchestra/chart.js'
import { buildPlan, planHashOf, persistPlan, loadPlan, planSummary } from './science/orchestra/plan.js'
import { createScheduler } from './science/orchestra/scheduler.js'
import { createExecutors } from './science/orchestra/executors.js'
import * as consensus from './science/orchestra/consensus.js'
import { generateDeliverables } from './science/orchestra/report.js'

const dshTools = resolveDshToolsPackage()
const defineTool = dshTools.defineTool || dshTools.default?.defineTool
if (typeof defineTool !== 'function') throw new Error('dsh-science/orchestra-tools: defineTool 不可用')

export const name = 'dsh-science-orchestra'
export const inject = ['tools']

/** 只用 host 平面发布的运行时；没有 store 就没法写战役，直接给可读错误。 */
function runtimeOf(ctx) {
  const rt = ctx.get('scienceRuntime')
  if (!rt?.store) throw new Error('科研运行时未就绪：先跑 science_preflight')
  return rt
}

function scienceRootOf(ctx) {
  const kit = ctx.get('scienceKit')
  if (!kit?.root) throw new Error('科研数据根未就绪')
  return kit.root
}

function workdirOf(root, campaignId) {
  const dir = join(root, 'campaigns', campaignId)
  mkdirSync(dir, { recursive: true })
  return dir
}

function makeScheduler(ctx) {
  const { store } = runtimeOf(ctx)
  const root = scienceRootOf(ctx)
  const executors = createExecutors({
    store,
    workdirFor: ({ campaign }) => workdirOf(root, campaign.id),
  })
  return { store, root, scheduler: createScheduler({ store, executors, consensus }) }
}

/** 失败也要能读：模型需要可读失败，而不是一页调用栈。 */
const failed = (error) => ({ ok: false, error: error && error.message ? error.message : String(error) })

/**
 * 越权不能只回一个 ok:false：模型还要能在战役事件里看到「谁想用哪个工具」。
 * 战役不存在、运行时未就绪或写库失败都只让 eventRecorded=false，不让查询本身崩。
 */
function recordAuthorityDenied(ctx, campaignId, detail) {
  const id = String(campaignId ?? '').trim()
  if (!id) return false
  try {
    const { store } = runtimeOf(ctx)
    if (!store.getCampaign(id)) return false
    store.appendEvent({ campaignId: id, kind: 'authority-denied', detail })
    return true
  } catch {
    return false
  }
}

const text = (lines) => [{ type: 'text', text: lines.join('\n') }]

/** 输出去 null：组织的 reportsTo、事件的 shardId 天然可为空，而 schema 里它们是有值字段。 */
function compact(value) {
  if (Array.isArray(value)) return value.map((entry) => compact(entry))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, entry] of Object.entries(value)) {
      if (entry === null || entry === undefined) continue
      out[key] = compact(entry)
    }
    return out
  }
  return value
}

const roleItem = () => ({
  type: 'object', additionalProperties: true,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    layer: { type: 'string' },
    reportsTo: { type: 'string' },
    duty: { type: 'string' },
    authority: { type: 'array', items: { type: 'string' } },
    capacity: { type: 'integer' },
    costTier: { type: 'string' },
    toolSurface: { type: 'array', items: { type: 'string' } },
  },
})

const checkShape = () => ({
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string' },
    ok: { type: 'boolean' },
    action: { type: 'string' },
    tool: { type: 'string' },
    reason: { type: 'string' },
  },
})

export function apply(ctx) {
  /* ── science_org_chart ────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_org_chart',
    description:
      'Read the campaign org chart: which roles exist, their layer, duty, authority, capacity and allowed tool surface. '
      + 'Pass role+tool to check whether that role may call that tool, or role+action to check a permission '
      + '(decide / approve / review / execute / veto / schedule); both also return the escalation path. '
      + 'Call this before assigning work so you never hand a shard to a role that cannot legally run it.',
    parameters: {
      role: { type: 'string', description: 'Role id, e.g. pi, lead, analyst, data-steward, methodologist.' },
      action: { type: 'string', enum: ['decide', 'approve', 'review', 'execute', 'veto', 'schedule'], description: 'Permission to check for the role.' },
      tool: { type: 'string', description: 'Tool name to check against the role tool surface. Prefix wildcards like science_* are supported.' },
      campaignId: { type: 'string', description: 'Campaign id to attach an authority-denied event to when the check fails.' },
      verbose: { type: 'boolean', description: 'Include per-role tool surfaces in the rendered text.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          roles: { type: 'array', items: roleItem() },
          role: { ...roleItem() },
          layers: { type: 'object', additionalProperties: true },
          vetoRoles: { type: 'array', items: { type: 'string' } },
          batchPolicy: { type: 'object', additionalProperties: true },
          escalation: { type: 'array', items: { type: 'string' } },
          check: checkShape(),
          eventRecorded: { type: 'boolean' },
          error: { type: 'string' },
        },
      },
      render: (args, v) => {
        // 越权检查不通过时 ok 也是 false，但编制已经读到了：照常渲染并在检查行说明原因。
        if (!v.ok && !v.check) return text([`组织编制读取失败：${v.error}`])
        const roles = v.roles ?? []
        const layers = v.layers ?? {}
        const layerText = Object.entries(layers).map(([code, name]) => `${code}=${name}`).join('、')
        const lines = [
          `岗位 ${roles.length} 个｜层级 ${Object.keys(layers).length} 个：${layerText || '无'}`,
          `一票否决席位：${(v.vetoRoles ?? []).join('、') || '无'}`,
        ]
        if (v.role) {
          lines.push('', `${v.role.id}｜${v.role.name}（${v.role.layer}）`)
          lines.push(`职责：${v.role.duty ?? '未填'}`)
          lines.push(`权限：${(v.role.authority ?? []).join(' / ') || '无'}；容量 ${v.role.capacity ?? 0}`)
          if (v.escalation?.length) lines.push(`上报路径：${v.escalation.join(' → ')}`)
        }
        if (v.check) {
          const verdict = v.check.ok === true ? '通过' : '不通过'
          const subject = v.check.tool ? `工具 ${v.check.tool}` : `动作 ${v.check.action ?? ''}`
          lines.push('', `检查 ${subject}：${verdict} — ${v.check.reason ?? ''}`)
        }
        const policy = v.batchPolicy ?? {}
        if (Object.keys(policy).length > 0) {
          lines.push(`批策略：${Object.entries(policy).map(([k, val]) => `${k}=${val}`).join(' | ')}`)
        }
        if (args.verbose) {
          lines.push('', '岗位一览：')
          for (const role of roles) {
            lines.push(`- ${role.id}｜${role.name}｜${role.layer}｜容量 ${role.capacity}｜工具 ${(role.toolSurface ?? []).length} 个`)
          }
        }
        return text(lines)
      },
    },
    async execute(args) {
      try {
        const summary = orgSummary()
        const layers = {}
        for (const [code, meta] of Object.entries(summary.layers ?? {})) {
          layers[code] = meta?.name ?? code
        }
        const roleId = String(args.role ?? '').trim()
        const base = {
          ok: true,
          roles: summary.roles.map((role) => compact(role)),
          layers,
          vetoRoles: summary.vetoRoles,
          batchPolicy: summary.batchPolicy,
        }

        if (!roleId) return base

        const entry = summary.roles.find((role) => role.id === roleId)
        if (!entry) return { ok: false, error: 'unknown-role' }

        const result = { ...base, role: compact(entry), escalation: escalationPath(roleId), eventRecorded: false }
        const toolName = String(args.tool ?? '').trim()
        const action = String(args.action ?? '').trim()
        if (toolName) {
          const checked = assertTool(roleId, toolName)
          result.check = {
            kind: 'tool',
            ok: checked.ok,
            tool: toolName,
            reason: checked.ok ? `允许使用 ${toolName}` : checked.reason,
          }
          if (checked.ok === false) {
            result.ok = false
            result.eventRecorded = recordAuthorityDenied(ctx, args.campaignId, {
              role: roleId,
              tool: toolName,
              action: action || null,
              reason: checked.reason,
            })
          }
        } else if (action) {
          const allowed = can(roleId, action)
          result.check = {
            kind: 'action',
            ok: allowed,
            action,
            reason: allowed
              ? `允许执行 ${action}`
              : `岗位 ${roleId} 没有 ${action} 权限；升级到 ${escalationPath(roleId)[1] ?? 'pi'}`,
          }
        }
        return result
      } catch (error) {
        return failed(error)
      }
    },
  }))

  /* ── science_campaign_plan ────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_campaign_plan',
    description:
      'Turn one research question into a persisted campaign DAG: workstreams S0→S9, tasks with executors and gates, '
      + 'and shards with idempotency keys. The plan hash is derived from the question, discipline, constraints and seed, '
      + 'so re-submitting the same plan returns the existing campaign instead of creating a duplicate. '
      + 'Pass force:true only when you deliberately want a fresh run with a new set of ids. '
      + 'This tool plans; it does not execute shards.',
    parameters: {
      question: { type: 'string', required: true, description: 'The research question. One falsifiable sentence.' },
      discipline: { type: 'string', description: 'Field id, e.g. neuroscience / biomed / psychology / economics / ml-cs. Defaults to generic.' },
      projectId: { type: 'string', description: 'Attach the campaign to an existing project. Not part of the plan hash.' },
      seed: { type: 'integer', description: 'Seed recorded with the campaign. Defaults to 42.' },
      example: { type: 'string', description: 'Bundled example dataset id, e.g. sleep-wm, rt-caffeine, trial-survival. Not part of the plan hash.' },
      literatureCount: { type: 'integer', description: 'Number of literature extraction shards. Defaults to 120.' },
      dataColumns: { type: 'integer', description: 'Number of stats shards (one per analysed column). Defaults to 2.' },
      figureCount: { type: 'integer', description: 'Number of figures. Defaults to 2.' },
      sections: { type: 'integer', description: 'Number of manuscript section shards. Defaults to 6.' },
      votes: { type: 'integer', description: 'Votes per gated task (1-9). Defaults to 3.' },
      budgetUsd: { type: 'number', description: 'Budget ceiling in USD. Defaults to 25.' },
      maxWallClockMin: { type: 'integer', description: 'Wall-clock budget in minutes. Defaults to 480.' },
      force: { type: 'boolean', description: 'Persist a re-keyed copy even when the same plan hash already exists.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          campaignId: { type: 'string' },
          created: { type: 'boolean' },
          existed: { type: 'boolean' },
          planHash: { type: 'string' },
          workstreams: { type: 'integer' },
          tasks: { type: 'integer' },
          shards: { type: 'integer' },
          shardBudget: {
            type: 'object', additionalProperties: true,
            properties: {
              total: { type: 'integer' },
              byWorkstream: { type: 'object', additionalProperties: true },
              byRole: { type: 'object', additionalProperties: true },
            },
          },
          batches: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                role: { type: 'string' },
                shards: { type: 'integer' },
                capacity: { type: 'integer' },
                batches: { type: 'integer' },
              },
            },
          },
          criticalPath: { type: 'array', items: { type: 'string' } },
          batchesNote: { type: 'string' },
          hint: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, v) => {
        if (!v.ok) return text([`战役计划未建立：${v.error}`])
        const lines = [
          `战役 ${v.campaignId}｜${v.created ? '新建' : '已存在（未重复写入）'}`,
          `计划哈希 ${String(v.planHash ?? '').slice(0, 12)}｜工作流 ${v.workstreams} 个｜任务 ${v.tasks} 个｜分片 ${v.shards} 个`,
        ]
        const budget = v.shardBudget ?? {}
        const byRole = Object.entries(budget.byRole ?? {}).map(([role, n]) => `${role} ${n}`).join('、')
        lines.push(`分片预算：总计 ${budget.total ?? v.shards}${byRole ? `（${byRole}）` : ''}`)
        if (v.batches?.length) {
          lines.push('批次：' + v.batches.map((b) => `${b.role} ${b.shards} 片 → ${b.batches} 批（容量 ${b.capacity}）`).join('；'))
        }
        lines.push(`关键路径：${(v.criticalPath ?? []).join(' → ')}`)
        if (v.batchesNote) lines.push('', v.batchesNote)
        if (v.hint) lines.push(v.hint)
        return text(lines)
      },
    },
    async execute(args) {
      try {
        const plan = buildPlan({
          question: args.question,
          discipline: args.discipline,
          projectId: args.projectId,
          seed: args.seed,
          example: args.example,
          constraints: {
            literatureCount: args.literatureCount,
            dataColumns: args.dataColumns,
            figureCount: args.figureCount,
            sections: args.sections,
            votes: args.votes,
            budgetUsd: args.budgetUsd,
            maxWallClockMin: args.maxWallClockMin,
          },
        })
        const store = runtimeOf(ctx).store
        const saved = persistPlan(store, plan, { force: args.force === true })
        const summary = planSummary(plan)

        return {
          ok: true,
          campaignId: saved.campaignId,
          created: saved.created,
          existed: saved.created === false,
          planHash: saved.planHash,
          workstreams: summary.stageCount,
          tasks: summary.taskCount,
          shards: summary.shardCount,
          shardBudget: {
            total: summary.shardCount,
            byWorkstream: { ...(plan.shardBudget?.byWorkstream ?? {}) },
            byRole: { ...(plan.shardBudget?.byRole ?? {}) },
          },
          batches: summary.batches,
          criticalPath: summary.criticalPath,
          batchesNote: '批次数按岗位容量与单批上限估算；实际并发由 science_campaign_run 的 localConcurrency 决定，'
            + '投票任务（votes>1）会在共识未达阈值时回到队列等下一票。',
          ...(saved.created === false
            ? { hint: '同一计划已存在：直接复用该 campaignId 继续调度；要另起一轮请传 force:true（会换一整套 id）。' }
            : {}),
        }
      } catch (error) {
        return failed(error)
      }
    },
  }))

  /* ── science_campaign_run ─────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_campaign_run',
    description:
      'Advance one campaign by a bounded round. mode local claims and executes local shards (stats, figures, sections, '
      + 'data load); mode delegate only emits subagent briefs for llm shards and returns the queue; mode ingest records '
      + 'results handed back from those agents; mode auto does local work then delegates what is left. '
      + 'maxShards caps this round so the call stays bounded. Progress lives in the database, so re-running resumes '
      + 'instead of restarting.',
    parameters: {
      campaignId: { type: 'string', required: true, description: 'Campaign id from science_campaign_plan.' },
      mode: { type: 'string', enum: ['local', 'delegate', 'ingest', 'auto'], description: 'Defaults to local.' },
      maxShards: { type: 'integer', description: 'Process at most this many shards in this round.' },
      localConcurrency: { type: 'integer', description: 'Local worker count. Defaults to CPU count - 1.' },
      llmConcurrency: { type: 'integer', description: 'Cap on llm shards claimed per delegate round. Defaults to 6.' },
      delegateBatch: { type: 'integer', description: 'Max briefs per delegate round. Defaults to 6.' },
      results: {
        type: 'array',
        description: 'ingest mode: [{shardId, verdict:"done"|"failed", output, error, tokensUsed, spendUsd}].',
        items: { type: 'object', additionalProperties: true },
      },
      highWatermark: { type: 'integer', description: 'Pause when the queued backlog exceeds this. Defaults to 20000.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          campaignId: { type: 'string' },
          mode: { type: 'string' },
          paused: { type: 'string' },
          processed: { type: 'integer' },
          done: { type: 'integer' },
          failed: { type: 'integer' },
          needsReview: { type: 'integer' },
          needsHuman: { type: 'integer' },
          delegated: { type: 'integer' },
          reclaimed: { type: 'integer' },
          queuedLeft: { type: 'integer' },
          elapsedMs: { type: 'integer' },
          throughputPerSec: { type: 'number' },
          spend: {
            type: 'object', additionalProperties: false,
            properties: { usd: { type: 'number' }, tokens: { type: 'number' } },
          },
          delegations: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: true,
              properties: {
                shardId: { type: 'string' },
                taskId: { type: 'string' },
                role: { type: 'string' },
                tokensEstimate: { type: 'number' },
                brief: { type: 'object', additionalProperties: true },
              },
            },
          },
          delegationsTruncated: { type: 'boolean' },
          eventsCount: { type: 'integer' },
          error: { type: 'string' },
        },
      },
      render: (_args, v) => {
        if (!v.ok) return text([`调度未执行：${v.error}`])
        const spend = v.spend ?? {}
        const lines = [
          `战役 ${v.campaignId}｜模式 ${v.mode}｜暂停原因 ${v.paused ?? '无（已收工或达上限）'}`,
          `本轮 processed ${v.processed}｜done ${v.done}｜failed ${v.failed}｜needsHuman ${v.needsHuman}｜needsReview ${v.needsReview}`,
          `队列剩余 ${v.queuedLeft}｜委派 ${v.delegated}｜回收租约 ${v.reclaimed}｜耗时 ${v.elapsedMs} ms｜吞吐 ${v.throughputPerSec}/s`,
          `花费 $${Number(spend.usd ?? 0).toFixed(4)}｜tokens ${spend.tokens ?? 0}`,
        ]
        if (v.delegations?.length) {
          lines.push('', '委派单：')
          for (const d of v.delegations) {
            lines.push(`- ${d.role ?? 'unknown'} · ${d.brief?.task?.title ?? d.taskId ?? d.shardId}`)
          }
          if (v.delegationsTruncated) lines.push('（其余委派单已省略）')
        }
        return text(lines)
      },
    },
    async execute(args) {
      try {
        const campaignId = String(args.campaignId ?? '').trim()
        if (!campaignId) throw new Error('必须给 campaignId')
        const { store, root, scheduler } = makeScheduler(ctx)
        if (!store.getCampaign(campaignId)) throw new Error(`战役不存在：${campaignId}`)

        const summary = await scheduler.run({
          campaignId,
          mode: args.mode,
          maxShards: args.maxShards,
          localConcurrency: args.localConcurrency,
          llmConcurrency: args.llmConcurrency,
          delegateBatch: args.delegateBatch,
          results: args.results,
          highWatermark: args.highWatermark,
          workdir: workdirOf(root, campaignId),
        })

        const delegations = summary.delegations ?? []
        return {
          ok: true,
          campaignId,
          mode: summary.mode,
          paused: summary.paused,
          processed: summary.processed,
          done: summary.done,
          failed: summary.failed,
          needsReview: summary.needsReview,
          needsHuman: summary.needsHuman,
          delegated: summary.delegated,
          reclaimed: summary.reclaimed,
          queuedLeft: summary.queuedLeft,
          elapsedMs: summary.elapsedMs,
          throughputPerSec: summary.throughputPerSec,
          spend: { usd: Number(summary.spend?.usd) || 0, tokens: Number(summary.spend?.tokens) || 0 },
          delegations: delegations.slice(0, 6),
          delegationsTruncated: delegations.length > 6,
          eventsCount: (summary.events ?? []).length,
        }
      } catch (error) {
        return failed(error)
      }
    },
  }))

  /* ── science_campaign_status ──────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_campaign_status',
    description:
      'Read campaign progress: percentage complete, shard counts in all six states (queued, leased, done, failed, '
      + 'needs-review, needs-human), spend, distribution by executor/role, and the latest events. '
      + 'Without campaignId it lists the 10 most recent campaigns instead. Use it before and after every run.',
    parameters: {
      campaignId: { type: 'string', description: 'Campaign id. Omit to list recent campaigns.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          campaignId: { type: 'string' },
          campaign: { type: 'object', additionalProperties: true },
          progress: { type: 'number' },
          total: { type: 'integer' },
          done: { type: 'integer' },
          human: { type: 'integer' },
          stats: { type: 'object', additionalProperties: true },
          distribution: { type: 'object', additionalProperties: true },
          events: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: true,
              properties: {
                id: { type: 'integer' },
                kind: { type: 'string' },
                shardId: { type: 'string' },
                detail: { type: 'object', additionalProperties: true },
                createdAt: { type: 'integer' },
              },
            },
          },
          campaigns: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: true,
              properties: {
                id: { type: 'string' }, question: { type: 'string' }, state: { type: 'string' },
                discipline: { type: 'string' }, spend: { type: 'object', additionalProperties: true },
              },
            },
          },
          error: { type: 'string' },
        },
      },
      render: (_args, v) => {
        if (!v.ok) return text([`战役状态读取失败：${v.error}`])
        if (v.campaigns) {
          if (!v.campaigns.length) return text(['尚无战役：先跑 science_campaign_plan'])
          const lines = [`最近 ${v.campaigns.length} 个战役：`]
          for (const c of v.campaigns) {
            lines.push(`- ${c.id}｜${c.state ?? '?'}｜${c.question ?? ''}`)
          }
          return text(lines)
        }
        const shards = v.stats?.shards ?? {}
        const spend = v.campaign?.spend ?? {}
        const lines = [
          `战役 ${v.campaignId}｜${v.campaign?.state ?? '?'}｜进度 ${(Number(v.progress) * 100).toFixed(1)}%（${v.done}/${v.total}，人工 ${v.human}）`,
          `分片：queued ${shards.queued ?? 0}｜leased ${shards.leased ?? 0}｜done ${shards.done ?? 0}｜failed ${shards.failed ?? 0}`
            + `｜needs-review ${shards.needsReview ?? 0}｜needs-human ${shards.needsHuman ?? 0}`,
          `花费 $${Number(spend.usd ?? 0).toFixed(4)}｜tokens ${spend.tokens ?? 0}`,
        ]
        if (v.events?.length) {
          lines.push('', '最近事件：')
          for (const e of v.events.slice(-5)) {
            lines.push(`- ${e.kind}${e.shardId ? `（${e.shardId}）` : ''}`)
          }
        }
        return text(lines)
      },
    },
    async execute(args) {
      try {
        const campaignId = String(args.campaignId ?? '').trim()
        const { store, scheduler } = makeScheduler(ctx)
        if (!campaignId) {
          const campaigns = store.listCampaigns({ limit: 10 }).map((c) => compact({
            id: c.id,
            question: c.question,
            state: c.state,
            discipline: c.discipline,
            spend: { ...(c.spend ?? {}) },
          }))
          return { ok: true, campaigns }
        }

        const status = scheduler.status(campaignId)
        if (!status) throw new Error(`战役不存在：${campaignId}`)
        return {
          ok: true,
          campaignId,
          campaign: compact(status.campaign),
          progress: status.progress,
          total: status.total,
          done: status.done,
          human: status.human,
          stats: status.stats,
          distribution: status.distribution,
          events: compact((status.events ?? []).slice(-20)),
        }
      } catch (error) {
        return failed(error)
      }
    },
  }))

  /* ── science_campaign_report ──────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_campaign_report',
    description:
      'Turn a campaign into deliverables: report.md (conclusions + evidence table + gaps), paper.md (draft keyed to '
      + 'the same evidence), evidence.json (every claim traced to a shard) and copies of the figure artifacts. '
      + 'Every number comes from a completed shard; missing evidence goes into gaps instead of being invented. '
      + 'Re-running on unchanged shards produces byte-identical files, reported via idempotent.',
    parameters: {
      campaignId: { type: 'string', required: true, description: 'Campaign id.' },
      outDir: { type: 'string', description: 'Output directory. Defaults to <science>/campaigns/<campaignId>/deliverables.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          outDir: { type: 'string' },
          files: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                path: { type: 'string' },
                sha256: { type: 'string' },
                bytes: { type: 'integer' },
                kind: { type: 'string' },
                role: { type: 'string' },
                tool: { type: 'string' },
              },
            },
          },
          manifestPath: { type: 'string' },
          reportPath: { type: 'string' },
          idempotent: { type: 'boolean' },
          error: { type: 'string' },
        },
      },
      render: (_args, v) => {
        if (!v.ok) return text([`交付物未生成：${v.error}`])
        const lines = [
          `交付目录 ${v.outDir}`,
          `幂等：${v.idempotent ? '与上次逐字节相同' : '内容有变化（或首次生成）'}｜文件 ${v.files?.length ?? 0} 个`,
        ]
        for (const f of v.files ?? []) {
          lines.push(`- ${f.path}｜${f.bytes} B｜sha256 ${String(f.sha256 ?? '').slice(0, 12)}`)
        }
        return text(lines)
      },
    },
    async execute(args) {
      try {
        const campaignId = String(args.campaignId ?? '').trim()
        if (!campaignId) throw new Error('必须给 campaignId')
        const store = runtimeOf(ctx).store
        const root = scienceRootOf(ctx)
        if (!store.getCampaign(campaignId)) throw new Error(`战役不存在：${campaignId}`)
        const requested = String(args.outDir ?? '').trim()
        const outDir = requested || join(workdirOf(root, campaignId), 'deliverables')

        const result = generateDeliverables({ store, campaignId, outDir })
        if (!existsSync(result.reportPath)) throw new Error(`报告未落盘：${result.reportPath}`)
        return {
          ok: true,
          outDir: result.outDir,
          files: result.files.map((f) => ({
            path: f.path,
            sha256: f.sha256,
            bytes: f.bytes,
            kind: f.kind,
            role: f.role,
            tool: f.tool,
          })),
          manifestPath: result.manifestPath,
          reportPath: result.reportPath,
          idempotent: result.idempotent,
        }
      } catch (error) {
        return failed(error)
      }
    },
  }))

  void planHashOf
  void loadPlan
  void batchPolicy
}
