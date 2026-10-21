/**
 * M6 学科与方法导航工具（preset 平面）。
 *
 * 这一层回答的是「我做这个方向，方法上该怎么走路」：
 *   science_discipline_profile  学科画像：问题类型 / 设计范式 / 测量 / 方法 / 工具 / 审稿攻击 / 顶刊门槛
 *
 * 与 M2 的 science_journal_fit 分工：那套选「投哪个刊」，这套选「用哪个设计、哪个方法、哪个软件」。
 * 学科知识全在 data/disciplines/*.json，本文件只做匹配、裁剪与叙述。
 */
import { resolveDshToolsPackage } from './tools.js'
import {
  loadIndex,
  loadDiscipline,
  matchDiscipline,
  searchDisciplines,
  findTool,
  listDisciplines,
  validateDiscipline,
} from './science/discipline/index.js'

const dshTools = resolveDshToolsPackage()
const defineTool = dshTools.defineTool || dshTools.default?.defineTool
if (typeof defineTool !== 'function') throw new Error('dsh-science/discipline-tools: defineTool 不可用')

export const name = 'dsh-science-discipline'
export const inject = ['tools']

const rethrow = (error) => {
  const message = error && error.message ? error.message : String(error)
  throw new Error(`学科工具失败：${message}`)
}

/** 统一切片：默认只给前 limit 条，并标出被截断。 */
function take(list, limit, verbose) {
  const arr = Array.isArray(list) ? list : []
  if (verbose || arr.length <= limit) return { items: arr, truncated: false, total: arr.length }
  return { items: arr.slice(0, limit), truncated: true, total: arr.length }
}

const beginner = (what, why, commonMistakes, terms, nextCall) => ({
  what, why, commonMistakes, terms: terms ?? [], nextCall: nextCall ?? '',
})

/** 输出 schema 的复用片段（避免 $ref）。 */
const designItem = () => ({
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    label: { type: 'string', required: true },
    when: { type: 'string', required: true },
    requires: { type: 'array', items: { type: 'string' } },
    nRule: { type: 'string', required: true },
    threats: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { risk: { type: 'string', required: true }, mitigation: { type: 'string', required: true } },
      },
    },
    why: { type: 'string', required: true },
    source: { type: 'string', required: true },
  },
})

const methodItem = () => ({
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    label: { type: 'string', required: true },
    when: { type: 'string', required: true },
    assumptions: { type: 'array', items: { type: 'string' } },
    tool: { type: 'string', required: true },
    pitfall: { type: 'string', required: true },
    why: { type: 'string', required: true },
  },
})

const toolItem = () => ({
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    label: { type: 'string', required: true },
    kind: { type: 'string', required: true },
    install: { type: 'string', required: true },
    minimalScript: { type: 'string', required: true },
    alt: { type: 'array', items: { type: 'string' } },
    offline: { type: 'boolean' },
    license: { type: 'string', required: true },
    note: { type: 'string' },
  },
})

export function apply(ctx) {
  ctx.get('logger') || console

  /* ── 学科画像 ─────────────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_discipline_profile',
    description:
      'Look up how a research field actually works: which study designs it accepts, what they require, how many samples, '
      + 'which measurements and analysis methods are standard, which software to install, what reviewers attack first, and '
      + 'what the implicit methodological bar is at top journals. Use when the question is "how do I study this" rather than '
      + '"where do I submit". Pass a domain, a journal, or just describe the question.',
    parameters: {
      domain: { type: 'string', description: 'Field id or name: biomed, neuroscience, psychology, economics, ml-cs, chemistry, materials, physics, earth-env, engineering, agri-food, social-humanities. Chinese names and aliases work too.' },
      question: { type: 'string', description: 'The research question in your own words. Used to match a field and to narrow designs when the domain is ambiguous.' },
      design: { type: 'string', description: 'Reverse lookup: find fields that use this design, e.g. "difference-in-differences", "重复测量", "消融".' },
      method: { type: 'string', description: 'Reverse lookup by analysis method, e.g. "mixed model", "Cox", "多重比较".' },
      tool: { type: 'string', description: 'Reverse lookup by software, e.g. "PsychoPy", "RDKit". Returns install and minimal script.' },
      journal: { type: 'string', description: 'Journal id from journals.json. Narrows the field by its publisher family when domain is omitted.' },
      publisher: { type: 'string', description: 'Publisher family instead of a journal, e.g. "Elsevier", "IEEE".' },
      verbose: { type: 'boolean', description: 'Return every entry instead of the first few. Defaults to false to keep the result readable.' },
      limit: { type: 'integer', description: 'Max entries per section when verbose is false. Defaults to 4.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          domain: { type: 'string', required: true },
          domainLabel: { type: 'string', required: true },
          matchedBy: { type: 'string', required: true },
          confidence: { type: 'string', required: true },
          candidates: { type: 'array', items: { type: 'string' } },
          headline: { type: 'string' },
          counts: {
            type: 'object', additionalProperties: false,
            properties: {
              questionTypes: { type: 'integer' }, designs: { type: 'integer' },
              measurements: { type: 'integer' }, methods: { type: 'integer' },
              tools: { type: 'integer' }, reviewerAttacks: { type: 'integer' },
              benchmarks: { type: 'integer' },
            },
          },
          questionTypes: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true }, label: { type: 'string', required: true },
                when: { type: 'string', required: true }, needs: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          designs: { type: 'array', items: designItem() },
          measurements: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true }, label: { type: 'string', required: true },
                unit: { type: 'string' }, how: { type: 'string' },
                precision: { type: 'string' }, artifact: { type: 'string' }, calibration: { type: 'string' },
              },
            },
          },
          methods: { type: 'array', items: methodItem() },
          tools: { type: 'array', items: toolItem() },
          statsDefaults: {
            type: 'object', additionalProperties: false,
            properties: {
              alpha: { type: 'number' }, correction: { type: 'string' },
              effect: { type: 'string' }, tails: { type: 'integer' },
            },
          },
          reviewerAttacks: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: { attack: { type: 'string', required: true }, defense: { type: 'string', required: true } },
            },
          },
          benchmarks: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                metric: { type: 'string', required: true }, topJournal: { type: 'string', required: true },
                field: { type: 'string' }, source: { type: 'string', required: true },
              },
            },
          },
          exemplarStructure: {
            type: 'object', additionalProperties: false,
            properties: {
              resultsOrder: { type: 'array', items: { type: 'string' } },
              figureBudget: { type: 'integer' },
              note: { type: 'string' },
            },
          },
          reporting: { type: 'array', items: { type: 'string' } },
          truncated: {
            type: 'object', additionalProperties: false,
            properties: {
              designs: { type: 'boolean' }, methods: { type: 'boolean' }, tools: { type: 'boolean' },
              reviewerAttacks: { type: 'boolean' }, benchmarks: { type: 'boolean' },
            },
          },
          reverseMatches: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true }, label: { type: 'string', required: true },
                reasons: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          beginner: {
            type: 'object', additionalProperties: false,
            properties: {
              what: { type: 'string' }, why: { type: 'string' },
              commonMistakes: { type: 'array', items: { type: 'string' } },
              terms: { type: 'array', items: { type: 'string' } },
              nextCall: { type: 'string' },
            },
          },
          nextCall: { type: 'string' },
        },
      },
      render: (_args, v) => {
        const lines = []
        lines.push(`${v.domainLabel}（${v.domain}）· 匹配方式 ${v.matchedBy} · 置信度 ${v.confidence}`)
        if (v.headline) lines.push('', `一句话：${v.headline}`)
        if (v.domain === 'generic') {
          lines.push('', '没匹配到具体学科。补一个 domain 会让设计、统计默认值、报告规范都具体起来——学科包不是装饰，它决定后面每一步的建议。')
          if (v.candidates.length) lines.push(`可能的候选：${v.candidates.join(' / ')}`)
        }
        if (v.questionTypes.length) {
          lines.push('', '## 这个方向能问的问题')
          for (const q of v.questionTypes) lines.push(`- ${q.label}：${q.when}${q.needs?.length ? `（需要：${q.needs.join('、')}）` : ''}`)
        }
        if (v.designs.length) {
          lines.push('', `## 设计范式${v.truncated?.designs ? `（前 ${v.designs.length} / 共 ${v.counts.designs}）` : ''}`)
          for (const d of v.designs) {
            lines.push(`- **${d.label}** — ${d.when}`)
            if (d.requires?.length) lines.push(`  前置：${d.requires.join('；')}`)
            lines.push(`  样本量：${d.nRule}`)
            if (d.threats?.length) lines.push(`  风险：${d.threats.map((t) => `${t.risk}→${t.mitigation}`).join('；')}`)
          }
        }
        if (v.methods.length) {
          lines.push('', `## 分析方法${v.truncated?.methods ? `（前 ${v.methods.length} / 共 ${v.counts.methods}）` : ''}`)
          for (const m of v.methods) lines.push(`- **${m.label}**（${m.tool}）：${m.when}。坑：${m.pitfall}`)
        }
        if (v.tools.length) {
          lines.push('', `## 软件${v.truncated?.tools ? `（前 ${v.tools.length} / 共 ${v.counts.tools}）` : ''}`)
          for (const t of v.tools) lines.push(`- ${t.label}${t.offline ? '' : '（需联网）'}：\`${t.install}\`\n  \`${t.minimalScript}\``)
        }
        if (v.statsDefaults?.alpha !== undefined) {
          lines.push('', `统计默认：α=${v.statsDefaults.alpha} · 校正=${v.statsDefaults.correction ?? '—'} · 效应量=${v.statsDefaults.effect ?? '—'}`)
        }
        if (v.reviewerAttacks.length) {
          lines.push('', `## 审稿人会先打这里${v.truncated?.reviewerAttacks ? '（节选）' : ''}`)
          for (const a of v.reviewerAttacks) lines.push(`- ${a.attack}\n  → ${a.defense}`)
        }
        if (v.benchmarks.length) {
          lines.push('', '## 顶刊的方法学门槛（是门槛，不是中稿率）')
          for (const b of v.benchmarks) lines.push(`- ${b.metric}：顶刊 ${b.topJournal}／领域 ${b.field}（${b.source}）`)
        }
        if (v.exemplarStructure?.resultsOrder?.length) {
          lines.push('', `## Results 该按什么顺序写`)
          lines.push(v.exemplarStructure.resultsOrder.join(' → '))
          if (v.exemplarStructure.note) lines.push(v.exemplarStructure.note)
        }
        if (v.reverseMatches?.length) {
          lines.push('', '## 反向检索命中')
          for (const r of v.reverseMatches) lines.push(`- ${r.label}（${r.id}）：${r.reasons.join('、')}`)
        }
        if (v.beginner) {
          lines.push('', '## 这一步在干什么')
          if (v.beginner.what) lines.push(v.beginner.what)
          if (v.beginner.why) lines.push(v.beginner.why)
          if (v.beginner.commonMistakes?.length) {
            lines.push('常见错误：')
            for (const m of v.beginner.commonMistakes) lines.push(`- ${m}`)
          }
          if (v.beginner.terms?.length) lines.push(`术语：${v.beginner.terms.join('；')}`)
        }
        if (v.nextCall) lines.push('', `下一步：${v.nextCall}`)
        return [{ type: 'text', text: lines.filter((l) => l !== undefined).join('\n') }]
      },
    },
    async execute(args) {
      try {
        const verbose = args.verbose === true
        const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 4

        // 反向检索：给了 design/method/tool 就先跨学科找一遍
        let reverseMatches
        if (args.design || args.method || args.tool) {
          if (args.tool) {
            const found = findTool(args.tool)
            reverseMatches = found.map((t) => ({ id: t.discipline, label: t.label, reasons: ['tools'] }))
          } else {
            reverseMatches = searchDisciplines({ design: args.design, method: args.method })
          }
        }

        const match = matchDiscipline({
          domain: args.domain,
          journal: args.journal,
          publisher: args.publisher,
          question: args.question,
        })

        const pack = loadDiscipline(match.id) || loadDiscipline('generic')
        if (!pack) throw new Error('学科包与 generic 兜底包都读不到，检查 data/disciplines/')

        const check = validateDiscipline(pack)
        const designs = take(pack.designs, limit, verbose)
        const methods = take(pack.methods, limit, verbose)
        const tools = take(pack.tools, limit, verbose)
        const attacks = take(pack.reviewerAttacks, limit, verbose)
        const benchmarks = take(pack.benchmarks, limit, verbose)

        const isGeneric = match.id === 'generic'
        const beginnerBlock = beginner(
          isGeneric
            ? `没识别出具体学科，给的是通用兜底包。`
            : `你问的是${pack.label}的问题。这一层不给你结论，给的是这个领域公认的走路方式：能问什么、用什么设计、要多少样本、用什么方法、装什么软件、审稿人先打哪里。`,
          isGeneric
            ? '先补 domain（例如 biomed / psychology / ml-cs / chemistry），学科定了，后面的设计选择与统计默认值才有依据。'
            : `设计决定证据等级，方法要能通过假设检查。${pack.headline || ''}`,
          isGeneric
            ? ['直接跳到「用什么统计方法」——没有设计和研究问题，统计方法无意义', '把学科包当投稿策略——这里给的是方法学门槛，不是中稿概率']
            : [
              '只看方法不看前置条件：每个设计都有 requires，缺一条这个设计就不成立',
              '照抄「每组 30」这类惯例数字，不做事前功效分析',
              '选软件只看熟悉度，不看它能不能导出可复现的脚本与中间结果',
            ],
          isGeneric ? ['domain', 'design', 'effect size'] : ['design', 'power', 'effect size', 'preregistration', 'multiple comparison'],
          isGeneric
            ? 'science_discipline_profile { domain: "biomed" }（或你所在的方向）'
            : `science_exp_plan { projectId: "<你的课题>", design: "${designs.items[0]?.id ?? 'rct-parallel'}" } —— 把它变成你课题的具体方案与样本量`,
        )

        const warnings = []
        if (!check.ok) warnings.push(`学科包 ${pack.id} 结构不完整：${check.errors.slice(0, 3).join('；')}`)

        return {
          domain: pack.id,
          domainLabel: pack.label,
          matchedBy: match.matchedBy,
          confidence: match.confidence,
          candidates: match.candidates ?? [],
          headline: pack.headline ?? '',
          counts: {
            questionTypes: (pack.questionTypes ?? []).length,
            designs: (pack.designs ?? []).length,
            measurements: (pack.measurements ?? []).length,
            methods: (pack.methods ?? []).length,
            tools: (pack.tools ?? []).length,
            reviewerAttacks: (pack.reviewerAttacks ?? []).length,
            benchmarks: (pack.benchmarks ?? []).length,
          },
          questionTypes: take(pack.questionTypes, verbose ? Infinity : 8, verbose).items,
          designs: designs.items,
          measurements: take(pack.measurements, 4, verbose).items,
          methods: methods.items,
          tools: tools.items,
          statsDefaults: pack.statsDefaults ?? {},
          reviewerAttacks: attacks.items,
          benchmarks: benchmarks.items,
          exemplarStructure: pack.exemplarStructure ?? { resultsOrder: [] },
          reporting: pack.reporting ?? [],
          truncated: {
            designs: designs.truncated,
            methods: methods.truncated,
            tools: tools.truncated,
            reviewerAttacks: attacks.truncated,
            benchmarks: benchmarks.truncated,
          },
          reverseMatches: reverseMatches ?? [],
          beginner: beginnerBlock,
          nextCall: beginnerBlock.nextCall,
          ...(warnings.length ? { warnings } : {}),
        }
      } catch (error) {
        rethrow(error)
      }
    },
  }))

  /* ── 学科清单 ─────────────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_discipline_list',
    description:
      'List the fields this app knows about, with what each covers and how well it is populated. Use when the user is not '
      + 'sure which field their question belongs to, or to check whether a field pack exists before relying on it.',
    parameters: {
      verbose: { type: 'boolean', description: 'Include the headline and coverage counts for each field.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          disciplines: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                label: { type: 'string', required: true },
                headline: { type: 'string' },
                designs: { type: 'integer' }, methods: { type: 'integer' },
                tools: { type: 'integer' }, valid: { type: 'boolean' },
              },
            },
          },
          note: { type: 'string' },
        },
      },
      render: (_args, v) => [{
        type: 'text',
        text: [
          `可用的学科包 ${v.count} 个：`,
          ...v.disciplines.map((d) => `- ${d.label}（${d.id}）${d.valid ? '' : ' ⚠ 结构不完整'}${d.designs !== undefined ? ` · ${d.designs} 设计 / ${d.methods} 方法 / ${d.tools} 工具` : ''}`),
          v.note || '',
        ].filter(Boolean).join('\n'),
      }],
    },
    async execute(args) {
      try {
        const verbose = args.verbose === true
        const listed = listDisciplines().map((entry) => {
          if (entry.id === 'generic') {
            return { id: entry.id, label: entry.label, ...(verbose ? { headline: entry.headline, valid: true } : {}) }
          }
          const pack = loadDiscipline(entry.id)
          if (!pack) return { id: entry.id, label: entry.label, valid: false }
          const check = validateDiscipline(pack)
          return {
            id: entry.id,
            label: entry.label,
            ...(verbose
              ? {
                headline: pack.headline,
                designs: (pack.designs ?? []).length,
                methods: (pack.methods ?? []).length,
                tools: (pack.tools ?? []).length,
                valid: check.ok,
              }
              : { valid: check.ok }),
          }
        })
        return {
          count: listed.length,
          disciplines: listed,
          note: '想知道某个学科具体怎么走：science_discipline_profile { domain: "<id>" }。不知道选哪个就把研究问题原文给 domain。',
        }
      } catch (error) {
        rethrow(error)
      }
    },
  }))
}
