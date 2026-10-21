/**
 * 需求梳理层（preset 平面）：把「我想研究点什么」变成一份能开工的研究需求书。
 *
 * 为什么要有这一层：新手最常卡的地方不是不会做实验，是**说不清要做什么**。
 * 一句话描述交给 agent，agent 顺着往下做，做到 S3 才发现"样本量算不出来"、
 * 做到 S1 才发现"检索范围没定义"——返工成本全在后期。
 * 这一层的职责是**在动手之前把缺的信息问出来**，并且诚实地列出缺口。
 *
 * 三条纪律：
 *   1. 缺口是算出来的，不是感觉出来的：每条 gap 有 key、为什么缺、补上它能解锁什么。
 *   2. 不替用户编答案。缺 ethics 就是缺，不填「待补」占位。
 *   3. 落的是文件不是数据库表：需求书人要看、要改、要版本对比，JSON 文件比表更合适。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveDshToolsPackage } from './tools.js'
import * as lab from './science/lab/index.js'

const dshTools = resolveDshToolsPackage()
const defineTool = dshTools.defineTool || dshTools.default?.defineTool
if (typeof defineTool !== 'function') throw new Error('dsh-science/brief-tools: defineTool 不可用')

export const name = 'dsh-science-brief'
export const inject = ['tools']

/** 数据根：DSH_HOME 优先，否则 ~/.deepscient。跟 host 侧的判定保持一致。 */
function dshHome() {
  const raw = (process.env.DSH_HOME || '').trim()
  return raw ? resolve(raw) : join(homedir(), '.deepscient')
}

/** 需求书目录：跟科研数据根同层，方便备份与人工编辑。 */
function briefDir() {
  return join(dshHome(), 'science', 'briefs')
}

function ensureDir() {
  const dir = briefDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function briefPath(id) {
  return join(briefDir(), `${id}.json`)
}

function readBrief(id) {
  const path = briefPath(id)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function writeBrief(brief) {
  ensureDir()
  brief.updatedAt = new Date().toISOString()
  writeFileSync(briefPath(brief.id), JSON.stringify(brief, null, 2) + '\n')
  return brief
}

function newId() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `brief-${stamp}`
}

/** 「感兴趣」「想研究」这类词说明问题还没收窄。 */
const VAGUE = /感兴趣|想研究|想了解|探索一下|看看能不能|大概|可能跟.*有关|interesting|curious|explore|maybe/i
/** 有比较、有变量、有时间点的句子更像真问题。 */
const SPECIFIC = [/比|对比|相比|差异|影响|关系|预测|versus|vs\.?|compared|effect of|relationship/i,
  /[前后]|基线|随访|时间点|随访|baseline|follow-?up|over \d+ (day|week|month|year)/i]

/**
 * 缺口判定：纯规则，可解释。
 * 每条 gap 带 unlocks —— 说清「补上它，哪一步就不卡」，这比只说"必填"有用。
 */
function findGaps(brief) {
  const gaps = []

  const question = String(brief.question ?? '').trim()
  if (!question) {
    gaps.push({ key: 'question', severity: 'blocking', why: '没有问题就没有课题。', unlocks: 'S0 选题、S1 检索式、S2 设计' })
  } else {
    if (question.length < 15) {
      gaps.push({ key: 'question.short', severity: 'warning', why: '问题太短，通常缺变量或比较对象。', unlocks: 'S2 选设计' })
    }
    if (VAGUE.test(question) && !SPECIFIC.some((re) => re.test(question))) {
      gaps.push({
        key: 'question.vague',
        severity: 'blocking',
        why: '这个问题还停在「感兴趣」的层面：没有比较对象、没有可测的变量、没有时间点。',
        unlocks: 'S2 设计、S3 样本量',
        fix: '照这个句式重写一次：「在<对象>中，<自变量>相比<对照>，对<因变量>的影响，观察<多久>」。',
      })
    }
    if (!SPECIFIC.some((re) => re.test(question))) {
      gaps.push({ key: 'question.no-comparison', severity: 'warning', why: '没看出比较或时间结构，审稿人会问「你和谁比」。', unlocks: 'S2 设计' })
    }
  }

  if (!String(brief.domain ?? '').trim()) {
    gaps.push({ key: 'domain', severity: 'blocking', why: '没有领域就无法给设计选项与审稿标准。', unlocks: 'S2 设计、S10 报告规范' })
  }

  const resources = brief.resources ?? {}
  if (!String(resources.data ?? '').trim() && !String(resources.subjects ?? '').trim() && !String(resources.equipment ?? '').trim()) {
    gaps.push({
      key: 'resources',
      severity: 'blocking',
      why: '完全没说手上有什么：已有数据？能招到被试？有设备？',
      unlocks: 'S3 样本量、S5 采集',
      fix: '三选一写清：已有数据集（含来源与许可）、能招到的样本（人群与量级）、可用的设备或平台。',
    })
  }

  const timeline = brief.timeline ?? {}
  if (!String(timeline.deadline ?? '').trim()) {
    gaps.push({ key: 'timeline', severity: 'warning', why: '没有截止时间，无法判断该做前瞻还是回溯。', unlocks: 'S2 设计选型' })
  }
  if (!String(timeline.people ?? '').trim()) {
    gaps.push({ key: 'timeline.people', severity: 'warning', why: '没说有几个人做，工作量估不出来。', unlocks: '排期与返修人力' })
  }

  if (!String(brief.deliverables ?? '').trim()) {
    gaps.push({
      key: 'deliverables',
      severity: 'warning',
      why: '没说目标产出：会议摘要、期刊论文、预注册、还是内部报告。',
      unlocks: 'S9 写作、S11 选刊',
    })
  }

  const constraints = brief.constraints ?? {}
  const human = /人|患者|被试|儿童|学生|病人|human|patient|participant|subject/i.test(question + ' ' + (resources.subjects ?? ''))
  if (human && !String(constraints.ethics ?? '').trim()) {
    gaps.push({
      key: 'ethics',
      severity: 'blocking',
      why: '看起来涉及人，但没写伦理备案（批号 / 委员会 / 知情同意）。',
      unlocks: 'S0 门、S5 采集',
      fix: '有批号就填批号；还没申请就先写「待申请」，并说明打算走哪家伦理委员会——这一项绝不能空着进 S5。',
    })
  }
  if (!String(constraints.license ?? '').trim()) {
    gaps.push({ key: 'license', severity: 'warning', why: '数据使用许可没写，二次分析可能违规。', unlocks: 'S6 数据管理' })
  }

  return gaps
}

function summarize(brief) {
  const gaps = brief.gaps ?? []
  const blocking = gaps.filter((g) => g.severity === 'blocking')
  return {
    id: brief.id,
    question: brief.question ?? '',
    domain: brief.domain ?? '',
    ready: blocking.length === 0,
    blocking: blocking.length,
    warnings: gaps.filter((g) => g.severity === 'warning').length,
    nextStep: blocking.length
      ? `还差 ${blocking.length} 项关键信息：${blocking.map((g) => g.key).join('、')}`
      : '可以进 S0：调用 science_project_open 建课题，再 science_study_coach 看第一个门。',
  }
}

const briefShape = () => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    question: { type: 'string' },
    domain: { type: 'string' },
    resources: {
      type: 'object', additionalProperties: true,
      properties: { data: { type: 'string' }, subjects: { type: 'string' }, equipment: { type: 'string' } },
    },
    timeline: {
      type: 'object', additionalProperties: true,
      properties: { deadline: { type: 'string' }, people: { type: 'string' } },
    },
    deliverables: { type: 'string' },
    constraints: {
      type: 'object', additionalProperties: true,
      properties: { ethics: { type: 'string' }, license: { type: 'string' }, funding: { type: 'string' } },
    },
    raw: { type: 'string' },
    gaps: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: true,
        properties: {
          key: { type: 'string' }, severity: { type: 'string' }, why: { type: 'string' },
          unlocks: { type: 'string' }, fix: { type: 'string' },
        },
      },
    },
    summary: { type: 'object', additionalProperties: true, properties: {} },
    nextStep: { type: 'string' },
    projectId: { type: 'string' },
    briefs: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } },
  },
})

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'science_requirement_brief',
    description:
      'Turn a vague "I want to study something" into a research requirement brief the project can actually start from. '
      + 'Actions: draft (structure a raw description into fields and compute the information gaps), '
      + 'refine (merge one more round of answers into an existing brief), '
      + 'commit (validate and create the project), read, list. '
      + 'Every gap carries why it matters and which stage it unblocks, so the questions you ask the user are the ones '
      + 'that actually prevent rework later. '
      + 'Deterministic rules only — it never invents an ethics number or a sample size. '
      + 'Use this on the first turn of a new research conversation, before science_project_open.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'draft | refine | commit | read | list',
      },
      id: { type: 'string', description: 'Brief id. Required for refine, commit and read.' },
      raw: { type: 'string', description: 'The user\'s own words, verbatim. Use for draft; keep it even after structuring.' },
      question: { type: 'string', description: 'The research question in one sentence: object + variable + comparison + timepoint.' },
      domain: { type: 'string', description: 'Field, e.g. biomed / neuroscience / psychology / economics / ml-cs.' },
      data: { type: 'string', description: 'Existing data you already have, with source and licence.' },
      subjects: { type: 'string', description: 'Who or what you can recruit or sample, and roughly how many.' },
      equipment: { type: 'string', description: 'Instruments, platforms, compute you can actually use.' },
      deadline: { type: 'string', description: 'When it must be done, e.g. "2027-03 投稿" or "6 months".' },
      people: { type: 'string', description: 'How many people work on it and in what roles.' },
      deliverables: { type: 'string', description: 'Target output: conference abstract / journal paper / preregistration / internal report.' },
      ethics: { type: 'string', description: 'Ethics approval id or the committee you plan to use. Never invent one.' },
      license: { type: 'string', description: 'Data use agreement or licence.' },
      funding: { type: 'string', description: 'Funding source, if any.' },
    },
    output: {
      schema: briefShape(),
      render: (_args, value) => {
        if (!value || value.id === undefined) return '需求梳理未执行'
        if (Array.isArray(value.briefs)) {
          const lines = [`共 ${value.briefs.length} 份需求书`]
          for (const b of value.briefs) lines.push(`- ${b.id}｜${b.question || '(未填问题)'}｜${b.ready ? '可开工' : `缺 ${b.blocking} 项`}`)
          return lines.join('\n')
        }
        const lines = []
        if (value.summary) {
          lines.push(`需求书 ${value.id}｜${value.summary.ready ? '可开工' : `阻塞 ${value.summary.blocking} 项 / 提醒 ${value.summary.warnings} 项`}`)
          if (value.question) lines.push(`问题：${value.question}`)
          if (value.domain) lines.push(`领域：${value.domain}`)
        }
        if (Array.isArray(value.gaps) && value.gaps.length) {
          lines.push('', '缺口：')
          for (const g of value.gaps) {
            lines.push(`- [${g.severity}] ${g.key}：${g.why}`)
            if (g.unlocks) lines.push(`  补上它能解锁：${g.unlocks}`)
            if (g.fix) lines.push(`  怎么补：${g.fix}`)
          }
        }
        if (value.projectId) lines.push('', `已建课题：${value.projectId}`)
        if (value.nextStep) lines.push('', value.nextStep)
        return lines.join('\n')
      },
    },
    execute(args) {
      const action = String(args.action ?? '').trim()

      if (action === 'list') {
        ensureDir()
        const ids = readdirSync(briefDir()).filter((f) => f.startsWith('brief-') && f.endsWith('.json'))
        const briefs = ids
          .map((f) => readBrief(f.replace(/\.json$/, '')))
          .filter(Boolean)
          .map((b) => summarize(b))
          .sort((a, b) => String(b.id).localeCompare(String(a.id)))
        return { briefs }
      }

      if (action === 'read') {
        const brief = readBrief(String(args.id ?? ''))
        if (!brief) return { error: 'not-found', message: `没有这份需求书：${args.id}` }
        return { ...brief, summary: summarize(brief) }
      }

      if (action === 'draft' || action === 'refine') {
        const existing = action === 'refine' ? readBrief(String(args.id ?? '')) : null
        if (action === 'refine' && !existing) {
          return { error: 'not-found', message: `没有这份需求书：${args.id}` }
        }
        const base = existing ?? {
          id: newId(),
          createdAt: new Date().toISOString(),
          question: '',
          domain: '',
          resources: {},
          timeline: {},
          deliverables: '',
          constraints: {},
          raw: '',
        }

        const pick = (value, fallback) => (value === undefined || value === null || String(value).trim() === '' ? fallback : String(value).trim())

        const brief = {
          ...base,
          question: pick(args.question, base.question),
          domain: pick(args.domain, base.domain),
          resources: {
            data: pick(args.data, base.resources?.data ?? ''),
            subjects: pick(args.subjects, base.resources?.subjects ?? ''),
            equipment: pick(args.equipment, base.resources?.equipment ?? ''),
          },
          timeline: {
            deadline: pick(args.deadline, base.timeline?.deadline ?? ''),
            people: pick(args.people, base.timeline?.people ?? ''),
          },
          deliverables: pick(args.deliverables, base.deliverables),
          constraints: {
            ethics: pick(args.ethics, base.constraints?.ethics ?? ''),
            license: pick(args.license, base.constraints?.license ?? ''),
            funding: pick(args.funding, base.constraints?.funding ?? ''),
          },
          raw: pick(args.raw, base.raw),
        }
        brief.gaps = findGaps(brief)
        writeBrief(brief)
        const summary = summarize(brief)
        return { ...brief, summary, nextStep: summary.nextStep }
      }

      if (action === 'commit') {
        const brief = readBrief(String(args.id ?? ''))
        if (!brief) return { error: 'not-found', message: `没有这份需求书：${args.id}` }

        // 重新算一遍：草稿可能被人手改过 JSON，不能信旧的 gaps。
        const gaps = findGaps(brief)
        const blocking = gaps.filter((g) => g.severity === 'blocking')
        if (blocking.length) {
          return {
            ...brief,
            gaps,
            error: 'not-ready',
            message: `还差 ${blocking.length} 项关键信息，先补齐再建课题：${blocking.map((g) => g.key).join('、')}`,
            summary: summarize({ ...brief, gaps }),
          }
        }

        const store = (() => {
          const rt = ctx.get('scienceRuntime')
          return rt?.store ?? null
        })()
        if (!store) return { error: 'no-store', message: '科研运行时未就绪，先跑 science_preflight。' }

        const created = lab.createProject(store, {
          title: String(brief.question).slice(0, 80),
          domain: brief.domain,
          question: brief.question,
          ethics: brief.constraints?.ethics || undefined,
          dataLicense: brief.constraints?.license || undefined,
        })

        brief.gaps = gaps
        brief.projectId = created.id ?? created.projectId ?? null
        brief.committedAt = new Date().toISOString()
        writeBrief(brief)

        return {
          ...brief,
          summary: summarize({ ...brief, gaps }),
          nextStep: brief.projectId
            ? `课题已建：${brief.projectId}。下一步 science_study_coach 看 S0 的门。`
            : '课题已建，但没拿到 id，用 science_project_open 的 list 模式确认。',
        }
      }

      return { error: 'bad-action', message: `不认识的 action：${action}（draft / refine / commit / read / list）` }
    },
  }))
}
