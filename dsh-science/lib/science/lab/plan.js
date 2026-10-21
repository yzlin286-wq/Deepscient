/**
 * 方案：把一个学科包里的设计 + 你的参数，落成一份可执行、可预注册、可被审稿人逐条检查的方案。
 *
 * 输入是「学科 + 设计 + 效应量」，输出是：
 *   - 这个设计的全部前置条件（缺一条就不成立，标成 checkbox）
 *   - 威胁与对策表（来自学科包，不是通用套话）
 *   - 样本量（走 statsmodels，不是拍脑袋）
 *   - 测量与分析方法（含各自的坑）
 *   - 报告规范（机器可校验的 + 需人工对照的）
 *   - 预注册草稿（可直接粘到 OSF / PROSPERO 的字段）
 *
 * 不做的事：不判断这个研究值不值得做，不预测能不能中。
 */
import { randomUUID } from 'node:crypto'
import { loadDiscipline } from '../discipline/index.js'
import { getProject, savePlan } from './project.js'
import { sampleSize, minimumDetectableEffect, designEffect } from './power.js'
import { append } from './provenance.js'

/** 把用户给的效应量参数翻成 power.js 要的 kind。 */
function inferPowerKind(designId, domain, effect) {
  const id = String(designId ?? '')
  if (/anova/.test(id)) return 'anova'
  if (/within|paired|rm-|crossover/.test(id)) return 'paired'
  if (/diagnostic|survival|cohort/.test(id) && typeof effect === 'object') return 'proportions'
  if (typeof effect === 'object' && (effect.p1 !== undefined || effect.p2 !== undefined)) return 'proportions'
  if (/correlation|association|longitudinal/.test(id)) return 'correlation'
  return domain === 'psychology' || domain === 'biomed' ? 'ttest' : 'ttest'
}

/**
 * 生成方案。
 *
 * @param {object} store
 * @param {object} input
 *   projectId      必填
 *   designId       学科包里的 design id；不给就用课题里已存的
 *   hypothesis     假设原文（建议写成「X 会导致 Y，因为 Z」）
 *   primaryOutcome 主结局
 *   effect         效应量：数值（Cohen's d）或 {p1,p2}
 *   alpha/power    默认 0.05 / 0.80
 *   kGroups        组数（ANOVA 用）
 *   clusterSize/icc 聚类设计（给了就自动算设计效应）
 *   prereg         预注册补充字段 {registry, date, analysisPlan}
 */
export function buildPlan(store, input = {}) {
  const projectId = String(input.projectId ?? '').trim()
  if (!projectId) throw new Error('必须给 projectId')
  const project = getProject(store, projectId)
  if (!project) throw new Error(`课题不存在：${projectId}`)

  const domain = project.domain || 'generic'
  const pack = loadDiscipline(domain) || loadDiscipline('generic')
  if (!pack) throw new Error('读不到学科包')

  const designId = String(input.designId ?? project.designId ?? '').trim()
  const design = (pack.designs ?? []).find((d) => d.id === designId) ?? null
  if (designId && !design) {
    throw new Error(`学科 ${domain} 里没有设计 "${designId}"；可用：${(pack.designs ?? []).map((d) => d.id).join(', ')}`)
  }

  // 样本量
  const alpha = Number(input.alpha ?? pack.statsDefaults?.alpha ?? 0.05)
  const power = Number(input.power ?? 0.8)
  const kGroups = Number.isInteger(input.kGroups) ? input.kGroups : 2
  let cluster = { designEffect: 1 }
  if (input.clusterSize && input.icc !== undefined) {
    cluster = { ...designEffect({ clusterSize: input.clusterSize, icc: input.icc }) }
  }

  let sampleBlock = null
  if (Number.isInteger(input.n) && input.n > 2) {
    // 给定 n 的路线：直接报 MDE。
    // 不要「由 n 反推效应量再反推 n」——那样 ceil 一次就变成 n+1，与用户给的数字对不上。
    const kind = input.powerKind ?? inferPowerKind(designId, domain, undefined)
    const mde = minimumDetectableEffect({ n: input.n, alpha, power, kind, kGroups })
    if (!mde.ok) {
      sampleBlock = { ok: false, method: 'statsmodels（MDE）', error: mde.error, alpha, power }
    } else {
      sampleBlock = {
        ok: true,
        method: `statsmodels.stats.power（MDE，${kind}）`,
        alpha,
        power,
        effect: mde.effect,
        effectKind: mde.effectKind,
        nPerGroup: input.n,
        nTotal: input.n * (kind === 'anova' ? kGroups : 2),
        designEffect: 1,
        achievedPower: power,
        note: '这是给定 n 能检测到的最小效应。比它更小的真实效应会被判为不显著——先确认这个大小在你领域里还算不算有意义。',
        mode: 'mde',
      }
    }
  } else if (input.effect !== undefined && input.effect !== null) {
    const kind = input.powerKind ?? inferPowerKind(designId, domain, input.effect)
    const res = sampleSize({
      kind,
      alpha,
      power,
      effect: input.effect,
      kGroups,
      designEffect: cluster.designEffect,
      tails: input.tails ?? 2,
    })
    if (!res.ok) {
      sampleBlock = { ok: false, method: 'statsmodels', error: res.error, alpha, power }
    } else {
      sampleBlock = {
        ok: true,
        method: `statsmodels.stats.power（${res.kind}）`,
        alpha,
        power,
        effect: res.effect,
        effectKind: res.effectKind,
        nPerGroup: res.nPerGroup,
        nTotal: res.nTotal,
        designEffect: res.designEffect,
        achievedPower: res.achieved_power,
        note: res.note ?? '',
      }
    }
  } else {
    sampleBlock = {
      ok: false,
      method: '未给效应量',
      alpha,
      power,
      error: '没有效应量就算不出样本量。可以给一个数值（Cohen\'s d），或先做 MDE：给定能招到的人数，反推能检测到多大效应。',
    }
  }
  // 设计的选择顺序：主结局测量 → 分析方法 → 审稿攻击（挑这个设计相关的 + 通用的）
  const statsTest = pickTestId(designId, domain)
  const threats = (design?.threats ?? []).map((t) => ({ ...t }))

  const plan = {
    id: `plan_${randomUUID().slice(0, 8)}`,
    projectId,
    createdAt: Date.now(),
    domain,
    domainLabel: pack.label,
    question: project.question ?? '',
    hypothesis: String(input.hypothesis ?? '').trim(),
    primaryOutcome: String(input.primaryOutcome ?? '').trim(),
    designId: design?.id ?? null,
    designLabel: design?.label ?? null,
    design: design
      ? {
        when: design.when,
        requires: design.requires ?? [],
        nRule: design.nRule,
        why: design.why,
        source: design.source,
      }
      : null,
    threats,
    measurements: pickMeasurements(pack, input.primaryOutcome),
    methods: pickMethods(pack, designId),
    statsTest,
    statsDefaults: pack.statsDefaults ?? {},
    reporting: pack.reporting ?? [],
    reportingExternal: pack.reportingExternal ?? [],
    sample: sampleBlock,
    cluster: cluster.designEffect > 1 ? cluster : null,
    exemplarStructure: pack.exemplarStructure ?? null,
    reviewerAttacks: pickAttacks(pack, designId),
    gates: null,
    nextSteps: [],
    prereg: buildPreregDraft({ project, pack, design, input, sampleBlock }),
  }

  plan.gates = buildGates(plan, pack)
  plan.nextSteps = buildNextSteps(plan)

  return plan
}

/** 该设计最可能对应的检验 id（statistics.json 里的）。用于把方案接到具体工具上。 */
function pickTestId(designId, domain) {
  const table = {
    'rct-parallel': 'ttest-welch',
    'cohort-prospective': 'cox',
    'case-control': 'logit',
    'diagnostic-accuracy': 'bland-altman',
    'systematic-review': 'random-effects',
    'animal-experiment': 'ttest-welch',
    'between-2': 'ttest-welch',
    'within-2x2': 'rm-anova',
    'pretest-posttest-control': 'anova-oneway',
    'longitudinal-panel': 'mixedlm',
    replication: 'ttest-welch',
    'experience-sampling': 'mixedlm',
    'benchmark-comparison': 'ttest-rel',
    ablation: 'ttest-rel',
    'scaling-law': 'ols',
    'human-eval': 'kendall',
    'systems-benchmark': 'mannwhitney',
    'theoretical-analysis': 'permutation',
    did: 'ols-robust',
    rdd: 'ols-robust',
    iv: 'ols-robust',
    'event-study': 'ols-robust',
    'rct-field': 'ttest-welch',
    'synthetic-control': 'permutation',
    'q1-basic': 'ttest-welch',
    'qm-mm': 'ttest-welch',
    'qm-reaction': 'rm-anova',
    'design-factorial': 'anova-oneway',
    'design-instrument': 'ols',
    'design-sim': 'ttest-rel',
    'design-field': 'anova-oneway',
    'design-mems': 'ols',
    'design-cert': 'anova-oneway',
    'design-nano': 'ttest-welch',
    'design-synth': 'anova-oneway',
    'design-scaling': 'ttest-rel',
    'design-aging': 'mixedlm',
    'design-invivo': 'ttest-welch',
    'design-exvivo': 'ttest-welch',
    'design-multiomics': 'fdr_bh',
    'design-crispr': 'fisher',
    'design-electro': 'ttest-welch',
    'design-imaging': 'permutation-anova',
    'design-behav': 'ttest-welch',
    'design-optics': 'ttest-welch',
    'design-detector': 'poisson',
    'design-sim-physics': 'permutation',
    'design-survey': 'mixedlm',
    'design-field-eco': 'mixedlm',
    'design-remote': 'ols-robust',
    'design-lab-meso': 'anova-oneway',
    'design-bench-eng': 'ttest-rel',
    'design-sys-eng': 'ttest-welch',
    'design-rcbd': 'anova-oneway',
    'design-split-plot': 'mixedlm',
    'design-multi-env': 'mixedlm',
    'design-sensory': 'friedman',
    'design-shelf': 'mixedlm',
    'design-animal-feed': 'mixedlm',
  }
  if (table[designId]) return table[designId]
  if (domain === 'ml-cs') return 'ttest-rel'
  if (domain === 'economics') return 'ols-robust'
  if (domain === 'neuroscience') return 'permutation-anova'
  return 'ttest-welch'
}

function pickMeasurements(pack, primaryOutcome) {
  const all = pack.measurements ?? []
  const key = String(primaryOutcome ?? '').toLowerCase()
  if (!key) return all.slice(0, 3)
  const hit = all.filter((m) => `${m.label}${m.how}`.toLowerCase().includes(key))
  return (hit.length > 0 ? hit : all).slice(0, 3)
}

function pickMethods(pack, designId) {
  const all = pack.methods ?? []
  const wanted = new Set()
  const id = String(designId ?? '')
  if (/within|paired|rm-|crossover|longitudinal|panel|experience/.test(id)) {
    for (const m of all) if (/混合|multilevel|rm-anova|重复/.test(`${m.id}${m.label}`)) wanted.add(m.id)
  }
  if (/benchmark|ablation|systems|scaling/.test(id)) {
    for (const m of all) if (/种子|bootstrap|多重/.test(`${m.label}${m.why}`)) wanted.add(m.id)
  }
  if (/did|rdd|iv|event|synthetic/.test(id)) {
    for (const m of all) if (/聚类|robust|固定效应|bootstrap/.test(`${m.id}${m.label}`)) wanted.add(m.id)
  }
  const picked = all.filter((m) => wanted.has(m.id))
  const rest = all.filter((m) => !wanted.has(m.id))
  return [...picked, ...rest].slice(0, 4)
}

function pickAttacks(pack, designId) {
  const all = pack.reviewerAttacks ?? []
  const id = String(designId ?? '')
  const order = all.slice()
  if (/rct|rct-field|between|pretest/.test(id)) {
    order.sort((a, b) => (/(样本量|预注册|主结局|多重)/.test(b.attack) ? 1 : 0) - (/(样本量|预注册|主结局|多重)/.test(a.attack) ? 1 : 0))
  }
  return order.slice(0, 5)
}

/**
 * 关口：方案阶段的自动检查。
 * 每条都带 severity —— blocking 的问题不修就没法往下走。
 */
function buildGates(plan, pack) {
  const gates = []
  const push = (id, label, severity, ok, message, fix) => gates.push({ id, label, severity, ok, message, fix })

  push('question', '研究问题已写明', 'blocking', plan.question.length >= 8,
    plan.question ? '' : '课题还没有研究问题', '补 question：对象 + 变量 + 比较 + 时点')
  push('design', '设计已选定且在该学科里存在', 'blocking', Boolean(plan.designId),
    plan.designId ? '' : '还没选设计', `从 ${(pack.designs ?? []).map((d) => d.id).slice(0, 6).join(' / ')} 里选一个`)
  push('hypothesis', '假设写成可证伪的形式', 'warning', plan.hypothesis.length >= 10,
    plan.hypothesis ? '' : '假设为空或太短', '写成「X 会导致 Y，因为 Z；如果看到 ¬Y 就推翻」')
  push('outcome', '主结局已定义', 'blocking', plan.primaryOutcome.length >= 2,
    plan.primaryOutcome ? '' : '没有主结局', '只定一个主结局；其余标为次要或探索性')
  push('sample', '样本量有依据', 'blocking', plan.sample?.ok === true,
    plan.sample?.ok ? '' : (plan.sample?.error ?? '没算样本量'), '给效应量重算，或用 MDE 反推')
  push('reporting', '报告规范已确定', 'warning', (plan.reporting?.length ?? 0) + (plan.reportingExternal?.length ?? 0) > 0,
    '', '多数设计有对应的报告规范；没有的话至少在方法里列出报告清单')
  push('prereg', '预注册字段已备好', 'warning', Boolean(plan.prereg?.fields?.length),
    '', '把 prereg 段贴到 OSF/PROSPERO')

  const blocking = gates.filter((g) => g.severity === 'blocking' && !g.ok).length
  return { gates, blocking, ready: blocking === 0 }
}

function buildPreregDraft({ project, pack, design, input, sampleBlock }) {
  const fields = [
    { key: 'title', label: '题目', value: project.title },
    { key: 'question', label: '研究问题', value: project.question ?? '' },
    { key: 'hypothesis', label: '假设（含证伪条件）', value: input.hypothesis ?? '' },
    { key: 'design', label: '设计', value: design ? `${design.label}（${design.id}）` : '' },
    { key: 'sample', label: '样本量与其依据', value: sampleBlock?.ok ? `每组 ${sampleBlock.nPerGroup}，总计 ${sampleBlock.nTotal}；${sampleBlock.method}，α=${sampleBlock.alpha}，power=${sampleBlock.power}，效应量 ${sampleBlock.effect}（${sampleBlock.effectKind}）` : '待补' },
    { key: 'primaryOutcome', label: '主结局', value: input.primaryOutcome ?? '' },
    { key: 'analysisPlan', label: '分析计划', value: (pack.methods ?? []).slice(0, 3).map((m) => `${m.label}（${m.tool}）`).join('；') },
    { key: 'exclusions', label: '排除标准', value: '待写：必须事前写定，且分析时不得因结果改规则' },
    { key: 'multipleComparison', label: '多重比较政策', value: `主假设不校正并声明；其余用 ${pack.statsDefaults?.correction ?? 'holm'}` },
  ]
  return {
    registry: input.prereg?.registry ?? 'OSF',
    note: '这些字段对应 OSF 预注册模板的主要条目；粘过去之前把「待写」全部填掉。',
    fields,
  }
}

function buildNextSteps(plan) {
  const steps = []
  if (!plan.sample?.ok) steps.push('补效应量或改用 MDE 反推，把样本量定下来')
  const missing = (plan.design?.requires ?? []).filter(Boolean)
  if (missing.length) steps.push(`逐条落实设计前置条件（共 ${missing.length} 条，见 plan.md 的 checkbox）`)
  if (!plan.hypothesis) steps.push('把假设写成可证伪的一句话')
  steps.push('把预注册字段填完并提交到 OSF/PROSPERO，拿到 DOI')
  steps.push('建实验：science_experiment_create，把设计与样本量带过去')
  steps.push(`按方案采集数据，放进 data/，跑 science_exp_run 记录输入与产物指纹`)
  steps.push(`分析：science_stats { testId: "${plan.statsTest}" }，先看假设检查再报结果`)
  return steps
}

/** 建实验行（方案 → 实验）。 */
export function createExperiment(store, input = {}) {
  const projectId = String(input.projectId ?? '').trim()
  if (!projectId) throw new Error('必须给 projectId')
  const project = getProject(store, projectId)
  if (!project) throw new Error(`课题不存在：${projectId}`)

  const name = String(input.name ?? '').trim()
  if (!name) throw new Error('必须给实验名 name')

  const id = `exp_${randomUUID().slice(0, 8)}`
  const now = Date.now()
  const pack = loadDiscipline(project.domain || 'generic')
  const design = (pack?.designs ?? []).find((d) => d.id === (input.designId ?? project.designId))
  const threats = (design?.threats ?? []).map((t) => ({ ...t }))

  store.db.prepare(`
    INSERT INTO experiment(id, project_id, name, design, hypothesis, primary_outcome, n_planned,
                           power_json, prereg_json, threats_json, status, created_at, updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, projectId, name, input.designId ?? project.designId ?? null,
    input.hypothesis ?? null, input.primaryOutcome ?? null,
    Number.isInteger(input.nPlanned) ? input.nPlanned : null,
    input.power ? JSON.stringify(input.power) : null,
    input.prereg ? JSON.stringify(input.prereg) : null,
    JSON.stringify(threats), 'planned', now, now,
  )

  append(store, { projectId, subject: 'experiment', subjectId: id, action: 'create', detail: { name, design: input.designId ?? project.designId ?? null } })
  store.db.prepare("UPDATE project SET status = 'designing', updated_at = ? WHERE id = ? AND status = 'open'").run(now, projectId)

  return { id, projectId, name, design: input.designId ?? project.designId ?? null, nPlanned: input.nPlanned ?? null, status: 'planned' }
}

export function getExperiment(store, id) {
  const row = store.db.prepare('SELECT * FROM experiment WHERE id = ?').get(String(id))
  if (!row) return null
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    design: row.design,
    hypothesis: row.hypothesis,
    primaryOutcome: row.primary_outcome,
    nPlanned: row.n_planned,
    power: row.power_json ? JSON.parse(row.power_json) : null,
    prereg: row.prereg_json ? JSON.parse(row.prereg_json) : null,
    threats: row.threats_json ? JSON.parse(row.threats_json) : [],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listExperiments(store, projectId, { limit = 20 } = {}) {
  return store.db.prepare('SELECT * FROM experiment WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, limit)
    .map((row) => ({
      id: row.id, name: row.name, design: row.design, status: row.status,
      nPlanned: row.n_planned, createdAt: row.created_at,
    }))
}

/** 方案落盘（plan.md + 库）。 */
export function persistPlan(store, plan) {
  return savePlan(store, plan.projectId, plan)
}
