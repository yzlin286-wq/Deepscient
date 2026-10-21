/**
 * M6 实验层工具（preset 平面）。
 *
 * 五个工具覆盖「从一句话问题到一次可复现的实验」的机械部分：
 *   science_project_open    建/开/列课题 —— 课题是后面一切的主键
 *   science_exp_plan        出方案 —— 设计前置条件、威胁、样本量、预注册草稿、关口
 *   science_exp_run         跑一次 —— 受控目录、无网络、输入与产物指纹
 *   science_exp_query       看进度 —— 课题总览、执行、分析、图
 *   science_provenance      验溯源 —— 链式 hash，能查出被改动的那一行
 *
 * 判断不在这里：这个设计适不适合你的问题在 discipline 层，统计该不该用那个检验在 statistics 层。
 * 这一层只负责把决定落成可核查的记录。
 */
import { resolveDshToolsPackage } from './tools.js'
import * as lab from './science/lab/index.js'

const dshTools = resolveDshToolsPackage()
const defineTool = dshTools.defineTool || dshTools.default?.defineTool
if (typeof defineTool !== 'function') throw new Error('dsh-science/lab-tools: defineTool 不可用')

export const name = 'dsh-science-lab'
export const inject = ['tools']

function storeOf(ctx) {
  const rt = ctx.get('scienceRuntime')
  if (!rt || !rt.store) {
    throw new Error('科研运行时未就绪：SQLite 初始化失败，先跑 science_preflight 看错误')
  }
  return rt.store
}

const rethrow = (error) => {
  const message = error && error.message ? error.message : String(error)
  throw new Error(`实验工具失败：${message}`)
}

const gateItem = () => ({
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    label: { type: 'string', required: true },
    severity: { type: 'string', required: true },
    ok: { type: 'boolean', required: true },
    message: { type: 'string' },
    fix: { type: 'string' },
  },
})

export function apply(ctx) {
  ctx.get('logger') || console

  /* ── 1. 课题 ─────────────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_project_open',
    description:
      'Create a research project, open an existing one, or list them. A project is the spine the whole study hangs on: '
      + 'it fixes the field, the question, the design and the target journal, and every plan, run and analysis afterwards '
      + 'is attached to it. Creating one also lays out data/ code/ figures/ protocols/ env/ experiments/ so raw data never '
      + 'gets overwritten by analysis output. Pass { title } to create, { id } to open, nothing to list.',
    parameters: {
      id: { type: 'string', description: 'Existing project id. Opens it and returns the overview.' },
      title: { type: 'string', description: 'New project title. Required when creating.' },
      domain: { type: 'string', description: 'Field: biomed, neuroscience, psychology, economics, ml-cs, chemistry, materials, physics, earth-env, engineering, agri-food, social-humanities. Chinese names work.' },
      question: { type: 'string', description: 'The research question in one sentence: object + variable + comparison + timepoint.' },
      designId: { type: 'string', description: 'Study design id from the field pack, e.g. "rct-parallel", "did". Optional at creation; science_exp_plan can set it later.' },
      targetJournal: { type: 'string', description: 'Target journal id from journals.json. Used to narrow the field when domain is omitted.' },
      ethics: {
        description: 'Ethics approval. Either the approval id as a string, or {approvalId, committee, body, consent} where body is 人类/动物/细胞系/二手数据/不涉及. Recorded verbatim and surfaced as a gate; never inferred.',
        oneOf: [
          { type: 'string' },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              approvalId: { type: 'string' },
              committee: { type: 'string' },
              body: { type: 'string' },
              consent: { type: 'string' },
            },
          },
        ],
      },
      dataLicense: { type: 'string', description: 'Data use agreement or licence, e.g. "DUA-2026-114" or "CC BY 4.0".' },
      status: { type: 'string', description: 'List mode filter: open, designing, running, analyzing, writing, done.' },
      limit: { type: 'integer', description: 'List mode page size. Defaults to 20.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          mode: { type: 'string', required: true },
          project: {
            type: 'object', additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              title: { type: 'string', required: true },
              domain: { type: 'string' },
              domainLabel: { type: 'string' },
              status: { type: 'string' },
              designId: { type: 'string' },
              question: { type: 'string' },
              dir: { type: 'string' },
              matchedBy: { type: 'string' },
              confidence: { type: 'string' },
              subdirs: { type: 'array', items: { type: 'string' } },
              ethicsRecorded: { type: 'boolean' },
              ethicsMissing: { type: 'array', items: { type: 'string' } },
            },
          },
          counts: {
            type: 'object', additionalProperties: false,
            properties: {
              experiments: { type: 'integer' }, runs: { type: 'integer' }, okRuns: { type: 'integer' },
              failedRuns: { type: 'integer' }, analyses: { type: 'integer' }, figures: { type: 'integer' },
            },
          },
          missing: { type: 'array', items: { type: 'string' } },
          projects: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                domain: { type: 'string' },
                status: { type: 'string' },
                hasPlan: { type: 'boolean' },
              },
            },
          },
          nextCall: { type: 'string' },
        },
      },
      render: (_args, v) => {
        if (v.mode === 'list') {
          if (!v.projects.length) return [{ type: 'text', text: '还没有课题。用 science_project_open { title: "…", domain: "…" } 建一个。' }]
          return [{
            type: 'text',
            text: [`共 ${v.projects.length} 个课题：`, ...v.projects.map((p) => `- ${p.title}（${p.id}）· ${p.domain ?? '—'} · ${p.status}${p.hasPlan ? ' · 已有方案' : ''}`), '', v.nextCall ?? ''].filter(Boolean).join('\n'),
          }]
        }
        const p = v.project
        const lines = []
        lines.push(`${v.mode === 'create' ? '已建课题' : '课题'}：${p.title}`)
        lines.push(`id：${p.id}`)
        lines.push(`学科：${p.domainLabel ?? p.domain}${p.confidence ? `（匹配 ${p.matchedBy}，置信度 ${p.confidence}）` : ''}`)
        if (p.designId) lines.push(`设计：${p.designId}`)
        if (p.question) lines.push(`问题：${p.question}`)
        lines.push(`状态：${p.status}`)
        lines.push(`目录：${p.dir}`)
        if (p.subdirs?.length) lines.push(`子目录：${p.subdirs.join(' / ')}`)
        if (v.counts) {
          lines.push('', `进度：实验 ${v.counts.experiments} · 执行 ${v.counts.runs}（成功 ${v.counts.okRuns}，失败 ${v.counts.failedRuns}）· 分析 ${v.counts.analyses} · 图 ${v.counts.figures}`)
        }
        if (v.missing?.length) {
          lines.push('', '还缺：')
          for (const m of v.missing) lines.push(`- ${m}`)
        }
        if (v.nextCall) lines.push('', `下一步：${v.nextCall}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      try {
        const store = storeOf(ctx)
        const id = String(args.id ?? '').trim()
        const title = String(args.title ?? '').trim()

        if (!id && !title) {
          const projects = lab.listProjects(store, { limit: Number(args.limit) || 20, status: args.status })
          return {
            mode: 'list',
            projects: projects.map((p) => ({ id: p.id, title: p.title, domain: p.domain, status: p.status, hasPlan: p.hasPlan })),
            nextCall: projects.length ? `science_project_open { id: "${projects[0].id}" }` : 'science_project_open { title: "…", domain: "…" }',
          }
        }

        if (title && !id) {
          const created = lab.createProject(store, {
            title,
            domain: args.domain,
            question: args.question,
            designId: args.designId,
            targetJournal: args.targetJournal,
            ethics: args.ethics,
            dataLicense: args.dataLicense,
          })
          const stored = lab.project.getProject(store, created.id)
          const ethics = lab.project.ethicsStatus(stored)
          return {
            mode: 'create',
            project: {
              id: created.id,
              title: created.title,
              domain: created.domain,
              domainLabel: created.domainLabel,
              status: created.status,
              designId: created.designId,
              question: created.question,
              dir: created.dir,
              matchedBy: created.match?.matchedBy,
              confidence: created.match?.confidence,
              subdirs: created.subdirs,
              ethicsRecorded: ethics.recorded,
              ethicsMissing: ethics.missing,
            },
            missing: [
              '方案（跑 science_exp_plan）',
              ...(ethics.recorded ? [] : [`伦理备案（${ethics.missing.join('、')}）`]),
            ],
            nextCall: `science_exp_plan { projectId: "${created.id}", designId: "<设计 id>", effect: 0.5 }`,
          }
        }

        const overview = lab.projectOverview(store, id)
        if (!overview) throw new Error(`课题不存在：${id}`)
        return {
          mode: 'open',
          project: {
            id: overview.project.id,
            title: overview.project.title,
            domain: overview.project.domain,
            status: overview.project.status,
            designId: overview.project.designId,
            question: overview.project.question,
            dir: overview.project.dir,
          },
          counts: overview.counts,
          missing: overview.missing,
          nextCall: overview.missing.length ? `先补：${overview.missing[0]}` : 'science_exp_query { projectId: "' + id + '" }',
        }
      } catch (error) {
        rethrow(error)
      }
    },
  }))

  /* ── 2. 方案 ─────────────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_exp_plan',
    description:
      'Turn a field design into an executable plan: the design preconditions as a checklist, the threats reviewers will '
      + 'raise, the sample size from statsmodels, the measurements and analysis methods with their pitfalls, the reporting '
      + 'standards, and a preregistration draft. Also runs gate checks and tells you what is blocking. Give an effect size '
      + 'to get n; give n instead to get the minimum detectable effect. Writes plan.md into the project when save is true.',
    parameters: {
      projectId: { type: 'string', description: 'Project id from science_project_open.' },
      designId: { type: 'string', description: 'Design id from the field pack, e.g. "rct-parallel", "within-2x2", "did", "benchmark-comparison".' },
      hypothesis: { type: 'string', description: 'Falsifiable hypothesis: "X causes Y, because Z; if we see not-Y it is refuted".' },
      primaryOutcome: { type: 'string', description: 'The single primary outcome. Everything else must be secondary or exploratory.' },
      effect: {
        description: 'Effect size. A number means Cohen\'s d (or f for ANOVA). An object {p1,p2} means two proportions.',
        oneOf: [
          { type: 'number' },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              p1: { type: 'number' },
              p2: { type: 'number' },
            },
          },
        ],
      },
      powerKind: { type: 'string', description: 'Override the inferred power calculation: ttest, paired, anova, proportions, correlation.' },
      alpha: { type: 'number', description: 'Type I error rate. Defaults to the field default (usually 0.05).' },
      power: { type: 'number', description: 'Target power. Defaults to 0.80; use 0.90 for replication studies.' },
      kGroups: { type: 'integer', description: 'Number of groups for ANOVA.' },
      clusterSize: { type: 'integer', description: 'Average cluster size when randomization is by cluster (class, village, ward).' },
      icc: { type: 'number', description: 'Intraclass correlation. Together with clusterSize this yields the design effect 1+(m-1)rho.' },
      tails: { type: 'integer', description: '1 or 2. Defaults to 2; one-sided only with an ex-ante directional hypothesis.' },
      n: { type: 'integer', description: 'Instead of an effect size: existing per-group n, to get the minimum detectable effect.' },
      save: { type: 'boolean', description: 'Write plan.md and store the plan. Defaults to true.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          domain: { type: 'string', required: true },
          domainLabel: { type: 'string' },
          designId: { type: 'string' },
          designLabel: { type: 'string' },
          designWhy: { type: 'string' },
          designSource: { type: 'string' },
          requires: { type: 'array', items: { type: 'string' } },
          threats: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: { risk: { type: 'string', required: true }, mitigation: { type: 'string', required: true } },
            },
          },
          sample: {
            type: 'object', additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true },
              method: { type: 'string' }, alpha: { type: 'number' }, power: { type: 'number' },
              effect: { type: 'string' }, effectKind: { type: 'string' },
              nPerGroup: { type: 'integer' }, nTotal: { type: 'integer' },
              designEffect: { type: 'number' }, achievedPower: { type: 'number' },
              note: { type: 'string' }, error: { type: 'string' },
            },
          },
          cluster: {
            type: 'object', additionalProperties: false,
            properties: { designEffect: { type: 'number' }, icc: { type: 'number' }, clusterSize: { type: 'integer' }, note: { type: 'string' } },
          },
          measurements: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true }, label: { type: 'string', required: true },
                unit: { type: 'string' }, how: { type: 'string' }, artifact: { type: 'string' }, calibration: { type: 'string' },
              },
            },
          },
          methods: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true }, label: { type: 'string', required: true },
                tool: { type: 'string' }, when: { type: 'string' }, pitfall: { type: 'string' },
              },
            },
          },
          statsTest: { type: 'string' },
          statsDefaults: {
            type: 'object', additionalProperties: false,
            properties: {
              alpha: { type: 'number' }, correction: { type: 'string' }, effect: { type: 'string' }, tails: { type: 'integer' },
            },
          },
          reporting: { type: 'array', items: { type: 'string' } },
          reportingExternal: { type: 'array', items: { type: 'string' } },
          gates: { type: 'array', items: gateItem() },
          blocking: { type: 'integer' },
          ready: { type: 'boolean' },
          prereg: {
            type: 'object', additionalProperties: false,
            properties: {
              registry: { type: 'string' },
              note: { type: 'string' },
              fields: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false,
                  properties: { key: { type: 'string', required: true }, label: { type: 'string', required: true }, value: { type: 'string' } },
                },
              },
            },
          },
          reviewerAttacks: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: { attack: { type: 'string', required: true }, defense: { type: 'string', required: true } },
            },
          },
          planPath: { type: 'string' },
          nextSteps: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, v) => {
        const lines = []
        lines.push(`${v.domainLabel ?? v.domain} · ${v.designLabel ?? '（未选设计）'}${v.designId ? `（${v.designId}）` : ''}`)
        if (v.designWhy) lines.push(`为什么用这个设计：${v.designWhy}${v.designSource ? `（${v.designSource}）` : ''}`)
        if (v.sample?.ok) {
          lines.push('', `样本量：每组 ${v.sample.nPerGroup}，总计 ${v.sample.nTotal}`)
          lines.push(`  依据 ${v.sample.method}，α=${v.sample.alpha}，power=${v.sample.power}，效应量 ${v.sample.effect}（${v.sample.effectKind}）`)
          if (v.sample.designEffect > 1) lines.push(`  已乘设计效应 ×${v.sample.designEffect.toFixed(2)}`)
          if (v.sample.note) lines.push(`  ${v.sample.note}`)
        } else {
          lines.push('', `样本量：未算出。${v.sample?.error ?? ''}`)
        }
        if (v.requires?.length) {
          lines.push('', '前置条件（缺一条这个设计就不成立）：')
          for (const r of v.requires) lines.push(`- [ ] ${r}`)
        }
        if (v.threats?.length) {
          lines.push('', '威胁与对策：')
          for (const t of v.threats) lines.push(`- ${t.risk} → ${t.mitigation}`)
        }
        if (v.methods?.length) {
          lines.push('', '分析计划：')
          for (const m of v.methods) lines.push(`- ${m.label}（${m.tool}）：注意 ${m.pitfall}`)
        }
        if (v.gates?.length) {
          lines.push('', `关口检查：${v.ready ? '全部通过，可以往下走' : `还有 ${v.blocking} 项阻塞`}`)
          for (const g of v.gates) {
            if (g.ok) continue
            lines.push(`- [${g.severity}] ${g.label}${g.message ? `：${g.message}` : ''}${g.fix ? ` → ${g.fix}` : ''}`)
          }
        }
        if (v.prereg?.fields?.length) {
          lines.push('', `预注册草稿（${v.prereg.registry}）：`)
          for (const f of v.prereg.fields) lines.push(`- ${f.label}：${f.value || '（待填）'}`)
        }
        if (v.reviewerAttacks?.length) {
          lines.push('', '审稿人会先打这里：')
          for (const a of v.reviewerAttacks) lines.push(`- ${a.attack}\n  → ${a.defense}`)
        }
        if (v.planPath) lines.push('', `方案已写入：${v.planPath}`)
        if (v.nextSteps?.length) {
          lines.push('', '下一步：')
          for (const s of v.nextSteps) lines.push(`- ${s}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      try {
        const store = storeOf(ctx)
        const projectId = String(args.projectId ?? '').trim()
        if (!projectId) throw new Error('必须给 projectId（先跑 science_project_open）')

        const planInput = {
          projectId,
          designId: args.designId,
          hypothesis: args.hypothesis,
          primaryOutcome: args.primaryOutcome,
          alpha: args.alpha,
          power: args.power,
          kGroups: args.kGroups,
          clusterSize: args.clusterSize,
          icc: args.icc,
          tails: args.tails,
          powerKind: args.powerKind,
          // 给 n 走 MDE，给 effect 走样本量。两个都给时 n 优先——因为 n 是已经确定的事实。
          n: args.n,
          effect: args.effect,
        }

        const plan = lab.buildPlan(store, planInput)
        let planPath = null
        if (args.save !== false) {
          planPath = lab.persistPlan(store, plan).path
        }

        return {
          projectId: plan.projectId,
          domain: plan.domain,
          domainLabel: plan.domainLabel,
          designId: plan.designId ?? '',
          designLabel: plan.designLabel ?? '',
          designWhy: plan.design?.why ?? '',
          designSource: plan.design?.source ?? '',
          requires: plan.design?.requires ?? [],
          threats: plan.threats,
          sample: plan.sample.ok === false && plan.sample.error
            ? { ...plan.sample, effect: '' }
            : { ...plan.sample, effect: plan.sample.effect === undefined ? '' : String(plan.sample.effect) },
          cluster: plan.cluster ?? undefined,
          measurements: plan.measurements.map((m) => ({ id: m.id, label: m.label, unit: m.unit, how: m.how, artifact: m.artifact, calibration: m.calibration })),
          methods: plan.methods.map((m) => ({ id: m.id, label: m.label, tool: m.tool, when: m.when, pitfall: m.pitfall })),
          statsTest: plan.statsTest,
          statsDefaults: plan.statsDefaults,
          reporting: plan.reporting,
          reportingExternal: plan.reportingExternal,
          gates: plan.gates.gates,
          blocking: plan.gates.blocking,
          ready: plan.gates.ready,
          prereg: plan.prereg,
          reviewerAttacks: plan.reviewerAttacks,
          planPath: planPath ?? undefined,
          nextSteps: plan.nextSteps,
        }
      } catch (error) {
        rethrow(error)
      }
    },
  }))

  /* ── 3. 执行 ─────────────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_exp_run',
    description:
      'Run one Python script inside the project sandbox and record everything needed to reproduce it: input file hashes, '
      + 'output file hashes, interpreter and library versions, the seed. Writes only inside experiments/<slug>/<runId>/. '
      + 'Python-level network access is blocked unless network is true, and the run record says which it was. '
      + 'Python errors come back as structured fields, not raw tracebacks.',
    parameters: {
      projectId: { type: 'string', description: 'Project id.' },
      slug: { type: 'string', description: 'Experiment short name; becomes experiments/<slug>/ and groups runs together.' },
      script: { type: 'string', description: 'Path to a script inside the project, e.g. "code/run.py". Must stay inside the project.' },
      code: { type: 'string', description: 'Inline Python source instead of a script file. Written to the run directory as run.py.' },
      args: { type: 'array', items: { type: 'string' }, description: 'Arguments passed to the script.' },
      inputs: { type: 'array', items: { type: 'string' }, description: 'Input files to fingerprint, relative to the project root, e.g. ["data/raw.csv"].' },
      seed: { type: 'integer', description: 'Random seed. Written to seed.txt and exported as DSH_SEED.' },
      network: { type: 'boolean', description: 'Allow Python-level network access. Defaults to false.' },
      timeoutMs: { type: 'integer', description: 'Timeout in milliseconds. Defaults to 300000.' },
      experimentId: { type: 'string', description: 'Attach this run to an experiment row from science_exp_plan.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          runNo: { type: 'integer' },
          status: { type: 'string', required: true },
          dir: { type: 'string', required: true },
          seed: { type: 'integer' },
          network: { type: 'boolean' },
          ms: { type: 'integer' },
          error: { type: 'string' },
          inputs: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                path: { type: 'string', required: true }, sha256: { type: 'string', required: true }, bytes: { type: 'integer' },
              },
            },
          },
          outputs: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                path: { type: 'string', required: true }, sha256: { type: 'string', required: true }, bytes: { type: 'integer' },
              },
            },
          },
          env: {
            type: 'object', additionalProperties: false,
            properties: { python: { type: 'string' }, platform: { type: 'string' }, numpy: { type: 'string' }, scipy: { type: 'string' }, statsmodels: { type: 'string' } },
          },
          stdoutTail: { type: 'string' },
          stderrTail: { type: 'string' },
          nextCall: { type: 'string' },
        },
      },
      render: (_args, v) => {
        const lines = []
        lines.push(`执行 ${v.id}（${v.status === 'ok' ? '成功' : '失败'}）${v.ms !== undefined ? ` · ${v.ms} ms` : ''}`)
        lines.push(`目录：${v.dir}`)
        lines.push(`seed ${v.seed} · 网络 ${v.network ? '允许' : '已禁用（Python 层）'}`)
        if (v.env?.python) lines.push(`环境：Python ${v.env.python}${v.env.numpy ? ` · numpy ${v.env.numpy}` : ''}${v.env.statsmodels ? ` · statsmodels ${v.env.statsmodels}` : ''}`)
        if (v.inputs?.length) {
          lines.push('', '输入指纹：')
          for (const f of v.inputs) lines.push(`- ${f.path} · ${f.bytes} B · ${f.sha256.slice(0, 12)}…`)
        }
        if (v.outputs?.length) {
          lines.push('', `产物 ${v.outputs.length} 个：`)
          for (const f of v.outputs.slice(0, 8)) lines.push(`- ${f.path} · ${f.bytes} B · ${f.sha256.slice(0, 12)}…`)
        } else {
          lines.push('', '没有新增产物文件。')
        }
        if (v.stdoutTail) lines.push('', 'stdout 末尾：', v.stdoutTail)
        if (v.status !== 'ok' && v.error) lines.push('', `失败原因：${v.error}`)
        if (v.nextCall) lines.push('', `下一步：${v.nextCall}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      try {
        const store = storeOf(ctx)
        const projectId = String(args.projectId ?? '').trim()
        if (!projectId) throw new Error('必须给 projectId')
        if (!args.script && !args.code) throw new Error('必须给 script（项目内脚本路径）或 code（内联源码）')

        const record = lab.runExperiment(store, {
          projectId,
          slug: args.slug,
          script: args.script,
          code: args.code,
          args: args.args,
          inputs: args.inputs,
          seed: args.seed,
          network: args.network,
          timeoutMs: args.timeoutMs,
          experimentId: args.experimentId,
        })

        return {
          id: record.id,
          runNo: record.runNo,
          status: record.status,
          dir: record.dir,
          seed: record.seed,
          network: record.network,
          ms: record.ms,
          error: record.error ?? undefined,
          inputs: record.inputs,
          outputs: record.outputs,
          env: {
            python: record.env?.python,
            platform: record.env?.platform,
            numpy: record.env?.numpy ?? undefined,
            scipy: record.env?.scipy ?? undefined,
            statsmodels: record.env?.statsmodels ?? undefined,
          },
          stdoutTail: record.stdoutTail || undefined,
          stderrTail: record.stderrTail || undefined,
          nextCall: record.status === 'ok'
            ? `science_exp_query { projectId: "${projectId}", what: "runs" }`
            : '看 stderrTail 与目录里的 stderr.log；失败的执行也已经记进溯源链',
        }
      } catch (error) {
        rethrow(error)
      }
    },
  }))

  /* ── 4. 查询 ─────────────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_exp_query',
    description:
      'Look up where a project actually stands: overview with counts and what is still missing, the list of runs with '
      + 'their status, the analyses already run, or the figures already produced. Use it before deciding the next step '
      + 'so you are not guessing from memory.',
    parameters: {
      projectId: { type: 'string', description: 'Project id.' },
      what: { type: 'string', description: 'overview (default) | runs | analyses | figures | run' },
      runId: { type: 'string', description: 'With what="run": the run id to open in full.' },
      testId: { type: 'string', description: 'With what="analyses": filter by statistics test id.' },
      limit: { type: 'integer', description: 'Page size. Defaults to 20.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          what: { type: 'string', required: true },
          project: {
            type: 'object', additionalProperties: false,
            properties: {
              id: { type: 'string', required: true }, title: { type: 'string', required: true },
              domain: { type: 'string' }, status: { type: 'string' }, question: { type: 'string' }, dir: { type: 'string' },
            },
          },
          counts: {
            type: 'object', additionalProperties: false,
            properties: {
              experiments: { type: 'integer' }, runs: { type: 'integer' }, okRuns: { type: 'integer' },
              failedRuns: { type: 'integer' }, analyses: { type: 'integer' }, figures: { type: 'integer' },
            },
          },
          runs: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true }, runNo: { type: 'integer' }, status: { type: 'string' },
                seed: { type: 'integer' }, network: { type: 'boolean' }, ms: { type: 'integer' },
                outputs: { type: 'integer' }, startedAt: { type: 'integer' },
              },
            },
          },
          analyses: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true }, kind: { type: 'string' }, testId: { type: 'string' },
                method: { type: 'string' }, summary: { type: 'string' }, createdAt: { type: 'integer' },
              },
            },
          },
          figures: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true }, kind: { type: 'string' }, path: { type: 'string' },
                widthMm: { type: 'number' }, heightMm: { type: 'number' }, dpi: { type: 'integer' },
              },
            },
          },
          missing: { type: 'array', items: { type: 'string' } },
          provenance: {
            type: 'object', additionalProperties: false,
            properties: { ok: { type: 'boolean' }, entries: { type: 'integer' }, problems: { type: 'integer' } },
          },
          nextCall: { type: 'string' },
        },
      },
      render: (_args, v) => {
        const lines = []
        if (v.project) lines.push(`${v.project.title}（${v.project.id}）· ${v.project.domain ?? '—'} · ${v.project.status}`)
        if (v.counts) {
          lines.push(`实验 ${v.counts.experiments} · 执行 ${v.counts.runs}（成功 ${v.counts.okRuns}，失败 ${v.counts.failedRuns}）· 分析 ${v.counts.analyses} · 图 ${v.counts.figures}`)
        }
        if (v.provenance) lines.push(`溯源：${v.provenance.entries} 条，${v.provenance.ok ? '链完整' : `${v.provenance.problems} 处异常`}`)
        if (v.missing?.length) {
          lines.push('', '还缺：')
          for (const m of v.missing) lines.push(`- ${m}`)
        }
        if (v.runs?.length) {
          lines.push('', '执行记录：')
          for (const r of v.runs) lines.push(`- ${r.id} · ${r.status} · seed ${r.seed} · ${r.outputs} 产物 · ${r.ms} ms`)
        }
        if (v.analyses?.length) {
          lines.push('', '分析记录：')
          for (const a of v.analyses) lines.push(`- ${a.id} · ${a.testId ?? a.kind} · ${a.method ?? '—'} · ${a.summary}`)
        }
        if (v.figures?.length) {
          lines.push('', '图：')
          for (const f of v.figures) lines.push(`- ${f.path} · ${f.widthMm}×${f.heightMm} mm · ${f.dpi} dpi`)
        }
        if (v.nextCall) lines.push('', `下一步：${v.nextCall}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      try {
        const store = storeOf(ctx)
        const projectId = String(args.projectId ?? '').trim()
        if (!projectId) throw new Error('必须给 projectId')
        const what = String(args.what ?? 'overview')
        const limit = Number(args.limit) || 20

        if (what === 'run') {
          const runId = String(args.runId ?? '').trim()
          if (!runId) throw new Error('what="run" 时必须给 runId')
          const run = lab.getRun(store, runId)
          if (!run) throw new Error(`执行记录不存在：${runId}`)
          return {
            what: 'run',
            runs: [{
              id: run.id, runNo: run.runNo, status: run.status, seed: run.seed,
              network: run.network, ms: run.ms, outputs: run.outputs.length, startedAt: run.startedAt,
            }],
            nextCall: `science_provenance { projectId: "${projectId}" }`,
          }
        }

        const overview = lab.projectOverview(store, projectId, { runLimit: limit })
        if (!overview) throw new Error(`课题不存在：${projectId}`)

        const base = {
          what,
          project: {
            id: overview.project.id,
            title: overview.project.title,
            domain: overview.project.domain,
            status: overview.project.status,
            question: overview.project.question,
            dir: overview.project.dir,
          },
          counts: overview.counts,
          missing: overview.missing,
          provenance: { ok: overview.provenance.ok, entries: overview.provenance.entries, problems: overview.provenance.problems.length },
        }

        if (what === 'runs') {
          return { ...base, runs: overview.runs, nextCall: overview.runs.length ? undefined : '还没有执行记录：跑 science_exp_run' }
        }
        if (what === 'analyses') {
          const analyses = lab.listAnalyses(store, projectId, { limit, testId: args.testId })
          return { ...base, analyses, nextCall: analyses.length ? undefined : '还没有分析记录：跑 science_stats' }
        }
        if (what === 'figures') {
          const figures = lab.listFigures(store, projectId, { limit })
          return { ...base, figures, nextCall: figures.length ? undefined : '还没有图：跑 science_figure' }
        }
        return {
          ...base,
          runs: overview.runs,
          analyses: overview.analyses,
          figures: overview.figures,
          nextCall: overview.missing.length ? `先补：${overview.missing[0]}` : undefined,
        }
      } catch (error) {
        rethrow(error)
      }
    },
  }))

  /* ── 5. 溯源 ─────────────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_provenance',
    description:
      'Show and verify the project audit chain. Every create, plan, run and analysis appends a row whose hash covers the '
      + 'previous hash, so a deleted row, a reordered row, or an edited row shows up as a concrete problem instead of '
      + 'silently passing. Use it before writing the Methods section and before archiving, to prove what was actually done.',
    parameters: {
      projectId: { type: 'string', description: 'Project id.' },
      subject: { type: 'string', description: 'Filter to one object type: project | experiment | run | analysis | figure.' },
      subjectId: { type: 'string', description: 'Filter to one object id.' },
      verify: { type: 'boolean', description: 'Recompute the chain and report problems. Defaults to true.' },
      limit: { type: 'integer', description: 'Max entries. Defaults to 50.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          entries: { type: 'integer', required: true },
          verified: { type: 'boolean' },
          head: { type: 'string' },
          problems: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true }, seq: { type: 'integer' },
                expected: { type: 'integer' }, id: { type: 'string' },
              },
            },
          },
          timeline: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                seq: { type: 'integer', required: true },
                action: { type: 'string', required: true },
                subject: { type: 'string' },
                subjectId: { type: 'string' },
                hash: { type: 'string' },
                at: { type: 'integer' },
              },
            },
          },
          note: { type: 'string' },
        },
      },
      render: (_args, v) => {
        const lines = []
        lines.push(`溯源链：${v.entries} 条${v.verified === undefined ? '' : v.verified ? '，校验通过' : '，发现问题'}`)
        if (v.head) lines.push(`链头：${v.head.slice(0, 16)}…`)
        if (v.problems?.length) {
          lines.push('', '问题：')
          for (const p of v.problems) lines.push(`- ${p.kind}${p.seq !== undefined ? ` @seq ${p.seq}` : ''}${p.id ? `（${p.id}）` : ''}`)
        }
        if (v.timeline?.length) {
          lines.push('', '时间线：')
          for (const t of v.timeline) lines.push(`${String(t.seq).padStart(2, '0')}. ${t.action} · ${t.subject}${t.subjectId ? ` ${t.subjectId}` : ''}`)
        }
        if (v.note) lines.push('', v.note)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      try {
        const store = storeOf(ctx)
        const projectId = String(args.projectId ?? '').trim()
        if (!projectId) throw new Error('必须给 projectId')
        const limit = Number(args.limit) || 50

        let timeline = lab.listByProject(store, projectId, { limit })
        if (args.subject) {
          timeline = timeline.filter((e) => e.subject === args.subject)
        }
        if (args.subjectId) {
          timeline = timeline.filter((e) => e.subjectId === String(args.subjectId))
        }

        const shouldVerify = args.verify !== false
        const chain = shouldVerify ? lab.verifyChain(store, projectId) : null

        return {
          projectId,
          entries: timeline.length,
          verified: chain ? chain.ok : undefined,
          head: chain?.head ?? undefined,
          problems: chain ? chain.problems.map((p) => ({ kind: p.kind, seq: p.seq, expected: p.expected, id: p.id })) : [],
          timeline: timeline.map((e) => ({
            seq: e.seq,
            action: e.action,
            subject: e.subject,
            subjectId: e.subjectId,
            hash: e.hash.slice(0, 16),
            at: e.createdAt,
          })),
          note: chain && !chain.ok
            ? '链有问题：说明中间有记录被删、被改或顺序被动过。写方法段前先把这条查清楚。'
            : '链式 hash 能检出删除、改写与错序，但它不是防篡改证明——有库写权限的人可以重建整条链。它的作用是让无意改写留下痕迹。',
        }
      } catch (error) {
        rethrow(error)
      }
    },
  }))
}
