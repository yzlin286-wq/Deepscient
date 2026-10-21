/**
 * 发表前的三道独立关卡（preset 平面）：查重、校对、顶刊达标评估。
 *
 * 为什么单独成模块：这三件事都属于「对自己稿子的独立核查」，与 method-tools 里那批
 * 「面向期刊与投稿路线」的工具职责不同，也与 manuscript-tools 的「生成与出件」相反——
 * 这里只做**判定**，不改稿。
 *
 * 三条纪律：
 *   1. 确定性：同输入同输出，纯本地计算，不联网，可进 CI。
 *   2. 不编造：库里没有的数据标 skipped，不给一个看起来通过的分数。
 *   3. 每条发现都要带「在哪、凭什么、怎么改」，让人能直接动手。
 */
import { resolveDshToolsPackage } from './tools.js'

const dshTools = resolveDshToolsPackage()
const defineTool = dshTools.defineTool || dshTools.default?.defineTool
if (typeof defineTool !== 'function') throw new Error('dsh-science/gate-tools: defineTool 不可用')

export const name = 'dsh-science-gate'
export const inject = ['tools']

/* ── 共用：句段归一与 shingle ─────────────────────────────────────────────── */

const CJK = /\p{Script=Han}/u

/** 归一化：去掉不影响语义的排版差异，避免把格式差当成重复。 */
function normalize(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[`*_>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** 以词为单位切 shingle；CJK 按字切（没有空格分词）。 */
function shingles(text, size = 5) {
  const tokens = CJK.test(text)
    ? [...normalize(text).replace(/[^\p{Script=Han}\p{L}\p{N}]+/gu, '')]
    : normalize(text).replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter(Boolean)
  const out = new Set()
  for (let i = 0; i + size <= tokens.length; i += 1) out.add(tokens.slice(i, i + size).join(' '))
  return out
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const item of a) if (b.has(item)) shared += 1
  return shared / (a.size + b.size - shared)
}

function paragraphs(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 120)
}

/** 取科研库；拿不到就返回 null，调用方据此标 skipped 而不是假装数过。 */
function storeOf(ctx) {
  try {
    return ctx.get('scienceRuntime')?.store ?? null
  } catch {
    return null
  }
}

function manuscriptText(ctx, manuscriptId) {
  if (!manuscriptId) return null
  const store = storeOf(ctx)
  if (!store) return null
  try {
    const row = store.db.prepare('SELECT * FROM manuscript WHERE id = ?').get(manuscriptId)
    if (!row) return null
    return row.body_md ?? row.body ?? row.text ?? null
  } catch {
    return null
  }
}

export function apply(ctx) {
  /* ── 1. 查重 ─────────────────────────────────────────────────────────── */

  ctx.tools.register(defineTool({
    name: 'science_similarity_check',
    description:
      'Check a manuscript for self-overlap before submission: duplicated paragraphs inside the draft, '
      + 'overlap with papers already in the local library (self-plagiarism / salami slices), and overlap '
      + 'with the published version of the same work (duplicate-publication risk). '
      + 'Uses 5-gram shingle Jaccard on normalised text, so layout and markup differences do not count as overlap. '
      + 'This is not a plagiarism database — it only compares against what is in the local library. '
      + 'Returns every finding with where it is, the overlap ratio, and a concrete fix.',
    parameters: {
      text: { type: 'string', description: 'Manuscript body to check. Required when manuscriptId is not given.' },
      manuscriptId: { type: 'string', description: 'Stored manuscript id; reads its body when text is absent.' },
      projectId: { type: 'string', description: 'Project id; enables comparison against that project\'s library records.' },
      threshold: { type: 'number', description: 'Overlap ratio that counts as a finding. Default 0.35.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          threshold: { type: 'number' },
          paragraphs: { type: 'integer' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                kind: { type: 'string' },
                severity: { type: 'string' },
                where: { type: 'string' },
                overlap: { type: 'number' },
                fix: { type: 'string' },
              },
            },
          },
          summary: { type: 'object', additionalProperties: true, properties: {} },
        },
      },
      render: (_args, value) => {
        if (!value || value.ok === undefined) return '查重未执行'
        const lines = [`阈值 ${value.threshold}｜段落 ${value.paragraphs}｜发现 ${value.findings?.length ?? 0} 条`]
        for (const f of value.findings ?? []) {
          lines.push(`- [${f.severity}] ${f.where}｜重叠 ${f.overlap}`)
          if (f.fix) lines.push(`  改法：${f.fix}`)
        }
        if (value.summary?.note) lines.push(value.summary.note)
        return lines.join('\n')
      },
    },
    execute: async (args) => {
      const threshold = Number(args.threshold ?? 0.35)
      const body = String(args.text ?? '') || manuscriptText(ctx, args.manuscriptId) || ''
      if (!body.trim()) {
        return { ok: false, error: 'no-text', message: '既没有 text，也没有可读的 manuscriptId。' }
      }

      const findings = []
      const skipped = []

      // 1a. 稿内重复段落
      const paras = paragraphs(body)
      const shingleCache = paras.map((p) => shingles(p))
      for (let i = 0; i < paras.length; i += 1) {
        for (let j = i + 1; j < paras.length; j += 1) {
          const overlap = jaccard(shingleCache[i], shingleCache[j])
          if (overlap >= 0.6) {
            findings.push({
              kind: 'internal-duplicate',
              severity: 'blocking',
              where: `段落 ${i + 1} 与段落 ${j + 1}`,
              overlap: Number(overlap.toFixed(3)),
              excerpt: paras[i].slice(0, 80),
              fix: '两段说同一件事就合并成一段；确实要重复强调，改成正文一次、讨论里换个角度一次，不要整段搬运。',
            })
          }
        }
      }

      // 1b. 与库内文献的自我重复
      const store = storeOf(ctx)
      if (!store) {
        skipped.push({ check: 'library-overlap', reason: '科研库运行时不可用' })
      } else {
        const bodyShingles = shingles(body, 8)
        try {
          const rows = args.projectId
            ? store.db.prepare('SELECT title, abstract, doi FROM paper WHERE project_id = ?').all(args.projectId)
            : store.db.prepare('SELECT title, abstract, doi FROM paper').all()
          for (const row of rows) {
            const source = `${row.title ?? ''} ${row.abstract ?? ''}`.trim()
            if (source.length < 200) continue
            const overlap = jaccard(bodyShingles, shingles(source, 8))
            if (overlap >= threshold) {
              findings.push({
                kind: 'library-overlap',
                severity: overlap >= 0.6 ? 'blocking' : 'warning',
                where: row.doi ? `与库内文献 ${row.doi}` : `与库内文献「${String(row.title ?? '').slice(0, 40)}」`,
                overlap: Number(overlap.toFixed(3)),
                fix: '这段与已入库文献高度接近：确认是引用后改写，还是把自己的旧文搬过来了。前者要带引号与出处，后者要按重复发表处理并在 cover letter 里声明。',
              })
            }
          }
        } catch (error) {
          skipped.push({ check: 'library-overlap', reason: error.message })
        }
      }

      // 1c. 同项目其他稿件的重复发表风险
      if (store && args.projectId) {
        try {
          const rows = store.db
            .prepare('SELECT id, title FROM manuscript WHERE project_id = ? AND id IS NOT ?')
            .all(args.projectId, args.manuscriptId ?? '')
          const bodyShingles = shingles(body, 8)
          for (const row of rows) {
            const other = manuscriptText(ctx, row.id)
            if (!other || other.length < 400) continue
            const overlap = jaccard(bodyShingles, shingles(other, 8))
            if (overlap >= threshold) {
              findings.push({
                kind: 'salami',
                severity: 'blocking',
                where: `与同项目稿件「${String(row.title ?? row.id).slice(0, 40)}」`,
                overlap: Number(overlap.toFixed(3)),
                fix: '同一课题拆成多篇时，两篇的重叠部分只能在方法里有、且必须互相引用；结果是新的就不能照搬段落。',
              })
            }
          }
        } catch (error) {
          skipped.push({ check: 'salami', reason: error.message })
        }
      } else if (!store) {
        skipped.push({ check: 'salami', reason: '科研库运行时不可用' })
      }

      const blocking = findings.filter((f) => f.severity === 'blocking').length
      return {
        ok: blocking === 0,
        threshold,
        paragraphs: paras.length,
        findings,
        skipped,
        summary: {
          blocking,
          warnings: findings.filter((f) => f.severity === 'warning').length,
          note: findings.length === 0 ? '未发现达到阈值的重叠；这只覆盖本机库，不是查重数据库。' : undefined,
        },
      }
    },
  }))

  /* ── 2. 校对 ─────────────────────────────────────────────────────────── */

  ctx.tools.register(defineTool({
    name: 'science_proofread',
    description:
      'Proofread a manuscript body for mechanical and internal-consistency problems that reviewers silently '
      + 'mark you down for: missing space before units (5mg), doubled or misplaced spaces, undefined '
      + 'abbreviations at first use, non-consecutive figure/table numbering, non-consecutive citation numbers, '
      + 'unbalanced brackets, and CJK/latin text glued together. '
      + 'Pure local rules, no model call, no rewriting — it reports line numbers and a concrete fix each. '
      + 'Run it after each round of edits and before science_manuscript_build.',
    parameters: {
      text: { type: 'string', description: 'Manuscript body to proofread. Required when manuscriptId is not given.' },
      manuscriptId: { type: 'string', description: 'Stored manuscript id; reads its body when text is absent.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                kind: { type: 'string' },
                severity: { type: 'string' },
                line: { type: 'integer' },
                excerpt: { type: 'string' },
                fix: { type: 'string' },
              },
            },
          },
          summary: { type: 'object', additionalProperties: true, properties: {} },
        },
      },
      render: (_args, value) => {
        if (!value || value.ok === undefined) return '校对未执行'
        const lines = [`阻塞 ${value.summary?.blocking ?? 0}｜警告 ${value.summary?.warnings ?? 0}`]
        for (const f of (value.findings ?? []).slice(0, 40)) {
          lines.push(`- [${f.severity}] 第 ${f.line} 行 ${f.kind}：${f.fix}`)
        }
        if ((value.findings ?? []).length > 40) lines.push(`…另有 ${value.findings.length - 40} 条`)
        return lines.join('\n')
      },
    },
    execute: async (args) => {
      const body = String(args.text ?? '') || manuscriptText(ctx, args.manuscriptId) || ''
      if (!body.trim()) {
        return { ok: false, error: 'no-text', message: '既没有 text，也没有可读的 manuscriptId。' }
      }

      const findings = []
      const lines = body.split(/\r?\n/)
      const push = (kind, severity, line, excerpt, fix) =>
        findings.push({ kind, severity, line, excerpt: excerpt.slice(0, 90), fix })

      // 2a. 数字与单位
      const unitRe = /\b(\d+(?:\.\d+)?)(mg|kg|g|ml|mL|L|cm|mm|µm|nm|m|s|ms|min|h|day|d|week|wk|yr|Hz|kHz|MHz|V|mV|A|mA|W|kW|°C|K|mol|mmol|µmol|nmol|M|mM|µM|nM|pM|Pa|kPa|MPa|bar|Da|kDa|rpm|g\/L|mg\/L|µg|ng|pg|IU|U)\b/g
      for (let i = 0; i < lines.length; i += 1) {
        for (const m of lines[i].matchAll(unitRe)) {
          push('unit-spacing', 'warning', i + 1, m[0], `数字与单位之间加空格：${m[1]} ${m[2]}（% 与 ° 除外）。`)
        }
      }

      // 2b. 空格与标点
      for (let i = 0; i < lines.length; i += 1) {
        if (/\S {2,}\S/.test(lines[i])) push('double-space', 'warning', i + 1, lines[i], '多个连续空格改成一个。')
        if (/\s+[,.;:?!]/.test(lines[i])) push('space-before-punct', 'warning', i + 1, lines[i], '去掉标点前的空格。')
      }

      // 2c. 缩写首次使用未定义
      const abbrRe = /\b[A-Z]{2,6}\b/g
      const seen = new Map()
      for (let i = 0; i < lines.length; i += 1) {
        for (const m of lines[i].matchAll(abbrRe)) {
          const token = m[0]
          if (['PDF', 'DOCX', 'HTML', 'JATS', 'DOI', 'URL', 'NA', 'SD', 'SEM', 'CI', 'OR', 'AND', 'THE'].includes(token)) continue
          if (!seen.has(token)) {
            seen.set(token, i + 1)
            // 首次出现处或其前 120 字里要有 (XXX) 形式的展开
            const window = lines[i].slice(Math.max(0, m.index - 160), m.index + token.length + 24)
            const defined = new RegExp(`\\(${token}\\)`).test(window)
            if (!defined && !/^[A-Z]{2,6}$/.test(lines[i].trim())) {
              push('abbr-undefined', 'warning', i + 1, token,
                `缩写 ${token} 首次出现时没有括号定义；写成「全称（${token}）」，或删掉这个缩写直接用全称。`)
            }
          }
        }
      }

      // 2d. 图表序号连续性
      const collectNumbers = (pattern) => {
        const nums = []
        for (const line of lines) for (const m of line.matchAll(pattern)) nums.push(Number(m[1]))
        return [...new Set(nums)].sort((a, b) => a - b)
      }
      const figNums = collectNumbers(/\b(?:Fig(?:ure)?\.?)\s*(\d{1,2})\b/g)
      const tabNums = collectNumbers(/\bTable\s*(\d{1,2})\b/g)
      for (const [label, nums] of [['Fig.', figNums], ['Table', tabNums]]) {
        if (nums.length === 0) continue
        const missing = []
        for (let n = 1; n <= nums[nums.length - 1]; n += 1) if (!nums.includes(n)) missing.push(n)
        if (missing.length) {
          push('numbering-gap', 'blocking', 0, `${label} ${nums.join(',')}`,
            `${label} 序号缺 ${missing.join('、')}：要么补回被删的图表，要么重排并同步改正文引用。`)
        }
      }

      // 2e. 引用编号连续性
      const citeNums = []
      for (const line of lines) {
        for (const m of line.matchAll(/\[(\d{1,3})(?:[,\-–]\s*\d{1,3})*\]/g)) {
          for (const part of m[0].slice(1, -1).split(/[,\-–]/)) {
            const n = Number(part.trim())
            if (Number.isFinite(n)) citeNums.push(n)
          }
        }
      }
      const uniqCites = [...new Set(citeNums)].sort((a, b) => a - b)
      if (uniqCites.length) {
        const gap = []
        for (let n = 1; n <= uniqCites[uniqCites.length - 1]; n += 1) if (!uniqCites.includes(n)) gap.push(n)
        if (gap.length) {
          push('cite-gap', 'blocking', 0, `[${uniqCites.join(',')}]`,
            `引用编号缺 ${gap.join('、')}：文献表与正文引用已经对不上，按引用顺序重排。`)
        }
      }

      // 2f. 括号配对
      const balance = ['()', '[]', '{}'].map(([open, close]) => {
        const o = (body.match(new RegExp(`\\${open}`, 'g')) ?? []).length
        const c = (body.match(new RegExp(`\\${close}`, 'g')) ?? []).length
        return { pair: `${open}${close}`, open: o, close: c, ok: o === c }
      })
      for (const item of balance) {
        if (!item.ok) {
          push('bracket', 'blocking', 0, `${item.pair} ${item.open}/${item.close}`,
            `${item.pair} 不配对（${item.open} 开 / ${item.close} 闭），排版会错位。`)
        }
      }

      // 2g. 中英混排粘连
      for (let i = 0; i < lines.length; i += 1) {
        if (/[\u3400-\u9fff][A-Za-z]|[A-Za-z][\u3400-\u9fff]/.test(lines[i])) {
          push('cjk-latin', 'warning', i + 1, lines[i], '中文与英文之间加空格，排版才好看。')
        }
      }

      const blocking = findings.filter((f) => f.severity === 'blocking').length
      return {
        ok: blocking === 0,
        findings,
        summary: {
          blocking,
          warnings: findings.filter((f) => f.severity === 'warning').length,
          lines: lines.length,
          figures: figNums.length,
          tables: tabNums.length,
          citations: uniqCites.length,
        },
      }
    },
  }))

  /* ── 3. 顶刊达标评估 ─────────────────────────────────────────────────── */

  ctx.tools.register(defineTool({
    name: 'science_journal_readiness',
    description:
      'Judge whether the current project is actually ready for a top-tier submission, as one verdict over '
      + 'eight weighted dimensions: evidence base, statistical completeness (effect sizes with intervals), '
      + 'figures, manuscript completeness, reporting-standard coverage, provenance chain, preregistration, '
      + 'and internal audit. '
      + 'Reads the local science store; any dimension it cannot compute is reported as skipped instead of '
      + 'counted as passing. Returns verdict below / near / ready plus per-dimension got-vs-need and the '
      + 'concrete fix for each gap. Use it before deciding to submit, and again after each revision round.',
    parameters: {
      projectId: { type: 'string', description: 'Project id to evaluate. Required.' },
      targetTier: { type: 'string', description: 'top (default) | field | any — changes the thresholds per dimension.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          verdict: { type: 'string' },
          score: { type: 'number' },
          threshold: { type: 'number' },
          targetTier: { type: 'string' },
          dimensions: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } },
          blockers: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } },
          skipped: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (!value || !value.verdict) return '达标评估未执行'
        const lines = [`${value.verdict}（${Math.round(value.score * 100)}% / 门槛 ${Math.round(value.threshold * 100)}%）`]
        for (const d of value.dimensions ?? []) {
          const mark = d.pass === null ? '跳过' : d.pass ? '达标' : '未达'
          lines.push(`- ${mark}｜${d.label}｜${d.got ?? '?'}/${d.need}`)
          if (d.fix && d.pass === false) lines.push(`  改法：${d.fix}`)
        }
        if (value.note) lines.push(value.note)
        return lines.join('\n')
      },
    },
    execute: async (args) => {
      const projectId = String(args.projectId ?? '')
      if (!projectId) return { ok: false, error: 'no-project', message: '需要 projectId。' }
      const tier = String(args.targetTier ?? 'top')
      const store = storeOf(ctx)
      if (!store) {
        return { ok: false, error: 'no-store', message: '科研库运行时不可用，无法评估。' }
      }

      const count = (table) => {
        try {
          return store.db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE project_id = ?`).get(projectId).c
        } catch {
          return null
        }
      }

      // 每个维度：got / need / weight / 取不到时 why
      const dims = []
      const add = (key, label, got, need, weight, fix, skippedWhy = null) => {
        dims.push({
          key,
          label,
          got,
          need,
          weight,
          pass: got === null ? null : got >= need,
          ...(skippedWhy ? { skipped: skippedWhy } : { fix }),
        })
      }

      const papers = count('paper')
      add('evidence', '证据基础（库内文献）', papers, 10, 1,
        '库里文献不到 10 条：先用 science_lit_query / science_search 补检索，再谈顶刊。')

      // 效应量：看 analysis 表里有多少条带 effect_size
      let withEffect = null
      try {
        withEffect = store.db
          .prepare('SELECT COUNT(*) AS c FROM analysis WHERE project_id = ? AND (effect_size IS NOT NULL OR effect_json IS NOT NULL)')
          .get(projectId).c
      } catch {
        withEffect = null
      }
      add('effect', '统计完整（效应量+区间）', withEffect, 1, 1,
        '没有带效应量的分析记录：science_stats 重跑并保留 effectSize 与区间，只报 p 的稿子在顶刊一审就掉。',
        withEffect === null ? 'analysis 表结构不含 effect_size' : null)

      const figures = count('figure_spec')
      add('figures', '图（期刊规格）', figures, 4, 1,
        '图少于 4 张：顶刊主图通常 4–6 张，用 science_figure 按刊宽出图。')

      const manuscripts = count('manuscript')
      add('manuscript', '稿件', manuscripts, 1, 1,
        '还没有稿件：science_manuscript_new 建稿，再逐段写。')

      let audits = null
      try {
        audits = store.db.prepare('SELECT COUNT(*) AS c FROM audit_run WHERE project_id = ?').get(projectId).c
      } catch {
        audits = null
      }
      add('audit', '内部审稿', audits, 1, 1,
        '没跑过 science_paper_audit：投稿前必须自己按审稿维度打一遍分。',
        audits === null ? 'audit_run 表不可用' : null)

      let provOk = null
      try {
        const row = store.db.prepare('SELECT COUNT(*) AS c FROM provenance WHERE project_id = ?').get(projectId).c
        provOk = row
      } catch {
        provOk = null
      }
      add('provenance', '溯源记录', provOk, 5, 1,
        '溯源记录太少：关键结论要能在 analysis / run 记录里对上，用 science_provenance 查链。',
        provOk === null ? 'provenance 表不可用' : null)

      const project = (() => {
        try {
          return store.db.prepare('SELECT * FROM project WHERE id = ?').get(projectId)
        } catch {
          return null
        }
      })()
      const hasPrereg = project && (project.prereg_ref ?? '').trim().length > 0
      add('prereg', '预注册', hasPrereg ? 1 : 0, 1, 2,
        '没有预注册编号：OSF / PROSPERO 登记后把 DOI 填回课题卡。顶刊对确认性研究越来越看重这一步，权重给到 2。')

      // 报告规范：看稿件是否声明了 CONSORT/PRISMA 等
      let reporting = null
      try {
        const row = store.db.prepare('SELECT body_md, body, text FROM manuscript WHERE project_id = ? LIMIT 1').get(projectId)
        const text = String(row?.body_md ?? row?.body ?? row?.text ?? '')
        reporting = /CONSORT|PRISMA|STROBE|ARRIVE|TRIPOD|MOOSE|COREQ/i.test(text) ? 1 : 0
      } catch {
        reporting = null
      }
      add('reporting', '报告规范对照', reporting, 1, 1,
        '稿件里没提到任何报告规范：按设计选 CONSORT / PRISMA / STROBE / ARRIVE / TRIPOD，并在方法里点名。',
        reporting === null ? '读不到稿件正文' : null)

      const counted = dims.filter((d) => d.pass !== null)
      const weightSum = counted.reduce((n, d) => n + d.weight, 0)
      const earned = counted.filter((d) => d.pass).reduce((n, d) => n + d.weight, 0)
      const score = weightSum === 0 ? 0 : Number((earned / weightSum).toFixed(3))
      const threshold = tier === 'any' ? 0.5 : tier === 'field' ? 0.7 : 0.85
      const verdict = score >= threshold ? 'ready' : score >= threshold - 0.2 ? 'near' : 'below'

      return {
        ok: verdict === 'ready',
        projectId,
        targetTier: tier,
        score,
        threshold,
        verdict,
        dimensions: dims,
        blockers: dims.filter((d) => d.pass === false),
        skipped: dims.filter((d) => d.pass === null).map((d) => ({ key: d.key, why: d.skipped })),
        note: verdict === 'ready'
          ? '达标只说明本机这八项齐了，不预测录用；顶刊还有创新度与领域契合度，那部分看科学_paper_audit 的评分与 science_novelty。'
          : '未达标时不要靠补字数硬凑：先修 blockers 里的项，再重跑本工具。',
      }
    },
  }))
}
