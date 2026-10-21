/**
 * 流程教练工具：science_study_coach。
 *
 * 这是给"第一次做研究的人"用的那一层：不是告诉他统计怎么算，而是告诉他
 * 现在处在哪一步、这一步还差什么、下一步该调哪个工具。所有判断都来自
 * data/workflow.json 与库里真实状态，不是模型凭印象说的。
 */
import { resolveDshToolsPackage } from './tools.js'
import * as lab from './science/lab/index.js'
import { loadWorkflow, listStages, stageStatus, advise } from './science/discipline/coach.js'

const dshTools = resolveDshToolsPackage()
const defineTool = dshTools.defineTool || dshTools.default?.defineTool
if (typeof defineTool !== 'function') throw new Error('dsh-science/coach-tools: defineTool 不可用')

export const name = 'dsh-science-coach'
export const inject = ['tools']

function storeOf(ctx) {
  const rt = ctx.get('scienceRuntime')
  if (!rt || !rt.store) throw new Error('科研运行时未就绪：SQLite 初始化失败，先跑 science_preflight 看错误')
  return rt.store
}

const rethrow = (error) => {
  const message = error && error.message ? error.message : String(error)
  throw new Error(`流程教练失败：${message}`)
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'science_study_coach',
    description:
      'Tell the researcher exactly where the study stands against the S0–S11 workflow, gate by gate, and what to call next. '
      + 'Checks are evaluated against real project state — question, plan, sample size, ethics record, data files, run and '
      + 'analysis records, figures, provenance chain. Anything that cannot be verified from the database is reported as skip '
      + 'or manual, never as pass. Use it at the start of a session, when stuck, and before writing the Methods section.',
    parameters: {
      projectId: { type: 'string', description: 'Project id. Omit with listStages=true to see the workflow itself.' },
      stage: { type: 'string', description: 'Inspect one stage only: S0 … S11. Omit for a full sweep.' },
      listStages: { type: 'boolean', description: 'Set true to list the S0–S11 stages and stop.' },
      verbose: { type: 'boolean', description: 'Include every gate, including the ones that already pass.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          projectId: { type: 'string' },
          project: {
            type: 'object', additionalProperties: false,
            properties: {
              id: { type: 'string' }, title: { type: 'string' }, domain: { type: 'string' },
              status: { type: 'string' }, designId: { type: 'string' }, targetJournal: { type: 'string' },
            },
          },
          current: {
            type: 'object', additionalProperties: false,
            properties: { id: { type: 'string', required: true }, label: { type: 'string' }, goal: { type: 'string' } },
          },
          stages: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                label: { type: 'string' },
                complete: { type: 'boolean' },
                blocking: { type: 'integer' },
                warnings: { type: 'integer' },
                skipped: { type: 'integer' },
                manual: { type: 'integer' },
              },
            },
          },
          gates: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                label: { type: 'string' },
                severity: { type: 'string' },
                status: { type: 'string', required: true },
                detail: { type: 'string' },
                fix: { type: 'string' },
              },
            },
          },
          nextActions: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                gate: { type: 'string' }, label: { type: 'string' }, detail: { type: 'string' }, fix: { type: 'string' }, reason: { type: 'string' },
              },
            },
          },
          tools: { type: 'array', items: { type: 'string' } },
          failureModes: { type: 'array', items: { type: 'string' } },
          globalRules: { type: 'array', items: { type: 'string' } },
          done: { type: 'boolean' },
          stagesList: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true }, label: { type: 'string' }, goal: { type: 'string' },
                gateCount: { type: 'integer' }, toolCount: { type: 'integer' },
              },
            },
          },
          error: { type: 'string' },
        },
      },
      render: (_args, v) => {
        if (v.stagesList) {
          return [{
            type: 'text',
            text: ['研究流程 S0–S11：', ...v.stagesList.map((s) => `${s.id} ${s.label}（${s.gateCount} 个门 · ${s.toolCount} 个工具）\n    ${s.goal}`)].join('\n'),
          }]
        }
        if (!v.ok) return [{ type: 'text', text: `流程体检未完成：${v.error}` }]

        const lines = []
        if (v.project) lines.push(`${v.project.title}（${v.project.id}）· ${v.project.domain ?? '—'} · ${v.project.status}`)
        if (v.current) {
          lines.push('', `当前阶段：${v.current.id} ${v.current.label}`)
          lines.push(`这一阶段要解决的问题：${v.current.goal}`)
        } else if (v.done) {
          lines.push('', '全部阶段通过。')
        }

        if (v.stages?.length > 1) {
          lines.push('', '全流程：')
          for (const s of v.stages) {
            const mark = s.complete ? '✓' : s.blocking > 0 ? '✗' : '·'
            const bits = []
            if (s.blocking) bits.push(`阻塞 ${s.blocking}`)
            if (s.warnings) bits.push(`警告 ${s.warnings}`)
            if (s.skipped) bits.push(`未判定 ${s.skipped}`)
            lines.push(`${mark} ${s.id} ${s.label}${bits.length ? ` — ${bits.join('，')}` : ''}`)
          }
        }

        if (v.gates?.length) {
          const shown = v.gates.filter((g) => g.status !== 'pass')
          if (shown.length) {
            lines.push('', '未通过的门：')
            for (const g of shown) {
              const tag = g.status === 'manual' ? '自查' : g.status === 'skip' ? '未判定' : g.severity
              lines.push(`- [${tag}] ${g.label}${g.detail ? `：${g.detail}` : ''}`)
              if (g.fix) lines.push(`   → ${g.fix}`)
            }
          } else {
            lines.push('', '这一阶段的机器可查门全部通过。')
          }
        }

        if (v.nextActions?.length) {
          lines.push('', '下一步（按顺序）：')
          for (const a of v.nextActions) lines.push(`- ${a.fix ?? a.label}`)
        }
        if (v.tools?.length) lines.push('', `本阶段会用到的工具：${v.tools.join(' → ')}`)
        if (v.failureModes?.length) {
          lines.push('', '这一步最容易错的地方：')
          for (const f of v.failureModes) lines.push(`- ${f}`)
        }
        if (v.globalRules?.length) {
          lines.push('', '全程有效：')
          for (const r of v.globalRules) lines.push(`- ${r}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      try {
        if (args.listStages) {
          return { ok: true, stagesList: listStages() }
        }
        const store = storeOf(ctx)
        const projectId = String(args.projectId ?? '').trim()
        if (!projectId) throw new Error('必须给 projectId（或用 listStages 看流程本身）')

        const verifyChain = (s, id) => lab.verifyChain(s, id)

        if (args.stage) {
          const status = stageStatus(store, projectId, args.stage, { verifyChain })
          const gates = args.verbose ? status.gates : status.gates.filter((g) => g.status !== 'pass')
          return {
            ok: true,
            projectId,
            current: { id: status.id, label: status.label, goal: status.goal },
            gates,
            nextActions: status.gates
              .filter((g) => g.severity === 'blocking' && g.status !== 'pass')
              .map((g) => ({ gate: g.id, label: g.label, detail: g.detail, fix: g.fix, reason: g.severity })),
            tools: status.tools,
            failureModes: status.failureModes,
            done: status.complete,
          }
        }

        const result = advise(store, projectId, { verifyChain })
        return {
          ok: true,
          projectId,
          project: result.project,
          current: result.current ?? undefined,
          stages: result.stages,
          nextActions: result.nextActions,
          tools: result.tools,
          failureModes: result.failureModes,
          globalRules: result.globalRules,
          done: result.done,
        }
      } catch (error) {
        rethrow(error)
      }
    },
  }))

  /* 流程本身也可读，不必先有课题 */
  ctx.tools.register(defineTool({
    name: 'science_workflow_stages',
    description:
      'Print the research workflow itself: stages S0–S11, each with its goal, gates and the checks behind them. '
      + 'Use it to explain what the process looks like before a project exists, or to answer "what does a complete study need".',
    parameters: {
      stage: { type: 'string', description: 'One stage id (S0 … S11). Omit for all stages.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          stages: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                label: { type: 'string' },
                goal: { type: 'string' },
                gates: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      id: { type: 'string' }, label: { type: 'string' }, severity: { type: 'string' }, fix: { type: 'string' },
                    },
                  },
                },
                tools: { type: 'array', items: { type: 'string' } },
                artifacts: { type: 'array', items: { type: 'string' } },
                failureModes: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          globalRules: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, v) => {
        const lines = []
        for (const s of v.stages) {
          lines.push(`${s.id} ${s.label}`)
          lines.push(`  目标：${s.goal}`)
          lines.push(`  门：${s.gates.map((g) => `${g.label}${g.severity === 'blocking' ? '（阻塞）' : g.severity === 'manual' ? '（自查）' : ''}`).join(' · ')}`)
          if (s.tools.length) lines.push(`  工具：${s.tools.join(' → ')}`)
          if (s.artifacts.length) lines.push(`  产出：${s.artifacts.join('、')}`)
          if (s.failureModes.length) lines.push(`  常见错误：${s.failureModes.join('；')}`)
          lines.push('')
        }
        if (v.globalRules.length) {
          lines.push('全程有效：')
          for (const r of v.globalRules) lines.push(`- ${r}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const wf = loadWorkflow()
      const wanted = args.stage ? wf.stages.filter((s) => s.id === args.stage || s.code === args.stage) : wf.stages
      if (wanted.length === 0) throw new Error(`没有阶段 ${args.stage}；可用：${wf.stages.map((s) => s.id).join(', ')}`)
      return {
        ok: true,
        stages: wanted.map((s) => ({
          id: s.id,
          label: s.label,
          goal: s.goal,
          gates: s.gates.map((g) => ({ id: g.id, label: g.label, severity: g.severity, fix: g.fix })),
          tools: s.tools,
          artifacts: s.artifacts,
          failureModes: s.failureModes,
        })),
        globalRules: wf.globalRules,
      }
    },
  }))
}
