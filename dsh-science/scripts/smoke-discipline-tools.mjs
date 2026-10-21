#!/usr/bin/env node
/**
 * 学科工具层冒烟：不给真 dsh 也能验。
 *
 * 用一个假的 ctx 注册 discipline-tools 的两个工具，逐个真调一遍，
 * 断言返回字段形状、裁剪行为、以及 generic 兜底不崩。
 *
 *   node scripts/smoke-discipline-tools.mjs
 */
let pass = 0
let fail = 0
const fails = []
function check(label, cond, detail = '') {
  if (cond) { pass += 1; return }
  fail += 1
  fails.push(`${label}${detail ? ` — ${detail}` : ''}`)
}
function section(title) { console.log(`\n── ${title} ──`) }

const mod = await import('../lib/discipline-tools.js')
check('插件导出 name', mod.name === 'dsh-science-discipline', String(mod.name))
check('插件 inject tools', Array.isArray(mod.inject) && mod.inject.includes('tools'))

const registered = new Map()
const ctx = {
  get: () => undefined,
  tools: { register: (tool) => registered.set(tool.name, tool) },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}

mod.apply(ctx)
section('注册')
check('注册 2 个工具', registered.size === 2, [...registered.keys()].join(','))
for (const name of ['science_discipline_profile', 'science_discipline_list']) {
  const tool = registered.get(name)
  check(`${name} 存在`, Boolean(tool))
  check(`${name} 有 description`, typeof tool.description === 'string' && tool.description.length > 40)
  check(`${name} 有 parameters`, Boolean(tool.parameters) && Object.keys(tool.parameters).length > 0)
  check(`${name} 有 output.schema`, Boolean(tool.output?.schema))
  check(`${name} 有 render`, typeof tool.output?.render === 'function')
  check(`${name} 没有把参数标成 required:false`, Object.values(tool.parameters ?? {}).every((p) => p.required !== false))
}

/** 校验返回值是否满足 output.schema 的 required 列表（浅层 + 一层数组）。 */
function assertShape(label, schema, value) {
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    if (spec.required) check(`${label}.${key} 有值`, value[key] !== undefined && value[key] !== null, JSON.stringify(value[key]))
    if (spec.type === 'array' && Array.isArray(value[key]) && spec.items?.properties) {
      for (const item of value[key]) {
        for (const [ikey, ispec] of Object.entries(spec.items.properties)) {
          if (ispec.required) check(`${label}.${key}[].${ikey} 有值`, item[ikey] !== undefined, JSON.stringify(item))
        }
      }
    }
  }
}

const profile = registered.get('science_discipline_profile')
const list = registered.get('science_discipline_list')

/* ── 列表 ─────────────────────────────────────────────────────────────── */
section('science_discipline_list')
const l1 = await list.execute({})
assertShape('list', list.output.schema, l1)
check('列出 13 个学科', l1.count === 13, String(l1.count))
check('全部结构有效', l1.disciplines.every((d) => d.valid !== false), JSON.stringify(l1.disciplines.filter((d) => d.valid === false)))
const listText = list.output.render({}, l1)[0].text
check('渲染包含 biomed', listText.includes('biomed'))
const l2 = await list.execute({ verbose: true })
check('verbose 带设计与方法计数', l2.disciplines.some((d) => typeof d.designs === 'number'))
check('verbose 带 headline', l2.disciplines.filter((d) => d.id !== 'generic').every((d) => d.headline && d.headline.length > 5))

/* ── 画像：显式学科 ───────────────────────────────────────────────────── */
section('science_discipline_profile — 显式学科')
const p1 = await profile.execute({ domain: 'biomed' })
assertShape('profile', profile.output.schema, p1)
check('命中 biomed', p1.domain === 'biomed')
check('matchedBy=explicit', p1.matchedBy === 'explicit', p1.matchedBy)
check('有 headline', p1.headline.length > 5)
check('计数与实际一致', p1.counts.designs === p1.counts.designs && p1.counts.methods >= 5)
check('默认每题 4 条', p1.designs.length <= 4, String(p1.designs.length))
check('标出被截断', p1.truncated.designs === (p1.counts.designs > 4), JSON.stringify(p1.truncated))
check('带审稿攻击', p1.reviewerAttacks.length >= 1)
check('带顶刊门槛', p1.benchmarks.length >= 1)
check('门槛不含录用措辞', !/(录用|中稿|acceptance)/.test(JSON.stringify(p1.benchmarks)))
check('带 beginner 块', Boolean(p1.beginner?.what) && Boolean(p1.beginner?.nextCall))
const t1 = profile.output.render({}, p1)[0].text
check('渲染含设计名', p1.designs.some((d) => t1.includes(d.label)))
check('渲染含审稿问题', t1.includes(p1.reviewerAttacks[0].attack.slice(0, 8)))

/* ── 画像：verbose ───────────────────────────────────────────────────── */
section('science_discipline_profile — verbose')
const p2 = await profile.execute({ domain: 'psychology', verbose: true })
check('verbose 不截断', p2.truncated.designs === false && p2.truncated.methods === false, JSON.stringify(p2.truncated))
check('verbose 给全部设计', p2.designs.length === p2.counts.designs, `${p2.designs.length}/${p2.counts.designs}`)
check('verbose 给全部方法', p2.methods.length === p2.counts.methods)

/* ── 画像：中文与问题文本 ─────────────────────────────────────────────── */
section('science_discipline_profile — 模糊输入')
const p3 = await profile.execute({ domain: '心理学' })
check('中文名命中', p3.domain === 'psychology', `${p3.domain}/${p3.matchedBy}`)
const p4 = await profile.execute({ question: '我想用 fMRI 研究注意力的神经机制' })
check('问题文本命中神经科学', p4.domain === 'neuroscience', `${p4.domain}/${p4.matchedBy}`)
const p5 = await profile.execute({ question: '用双重差分评估这项政策的就业效果' })
check('政策评估问题命中经济学', p5.domain === 'economics', `${p5.domain}/${p5.matchedBy}`)

/* ── 画像：generic 兜底 ──────────────────────────────────────────────── */
section('science_discipline_profile — generic')
const g1 = await profile.execute({ domain: '完全不存在的学科zzz' })
assertShape('generic', profile.output.schema, g1)
check('退回 generic', g1.domain === 'generic')
check('generic 也给出可用内容', g1.designs.length >= 1 && g1.methods.length >= 1)
check('generic 明说没匹配上', g1.beginner.what.includes('没识别'))
const gText = profile.output.render({}, g1)[0].text
check('generic 渲染有提示', gText.includes('没匹配到具体学科'))
const g2 = await profile.execute({})
check('空参数不崩', g2.domain === 'generic')

/* ── 反向检索 ─────────────────────────────────────────────────────────── */
section('反向检索')
const r1 = await profile.execute({ tool: 'RDKit' })
check('RDKit 反查到化学或材料', r1.reverseMatches.some((x) => x.id === 'chemistry' || x.id === 'materials'), JSON.stringify(r1.reverseMatches))
const r2 = await profile.execute({ design: '重复测量' })
check('重复测量反查到学科', r2.reverseMatches.length >= 1, JSON.stringify(r2.reverseMatches))
const r3 = await profile.execute({ method: '混合模型' })
check('混合模型反查到学科', r3.reverseMatches.length >= 1, JSON.stringify(r3.reverseMatches))
const r4 = await profile.execute({ design: '不存在的设计zzz' })
check('未知设计返回空', r4.reverseMatches.length === 0)

/* ── 参数健壮性 ───────────────────────────────────────────────────────── */
section('参数健壮性')
const s1 = await profile.execute({ domain: 'biomed', limit: 1 })
check('limit=1 生效', s1.designs.length <= 1, String(s1.designs.length))
const s2 = await profile.execute({ domain: 'biomed', limit: 0 })
check('limit=0 退回默认 4', s2.designs.length <= 4)
const s3 = await profile.execute({ domain: 'biomed', limit: -3 })
check('limit 负数退回默认', s3.designs.length <= 4)
const s4 = await profile.execute({ domain: 123 }).then(() => null, (e) => e)
check('非字符串 domain 被参数校验挡下', Boolean(s4) && s4.code === 'INVALID_ARGS', String(s4 && s4.code))
const s5 = await profile.execute({ journal: 'nature' })
check('期刊输入不崩', typeof s5.domain === 'string')
const s6 = await profile.execute({ publisher: 'Elsevier' })
check('出版社输入不崩', typeof s6.domain === 'string')

console.log('')
if (fail === 0) {
  console.log(`${pass}/${pass} 通过（学科工具冒烟）`)
  process.exit(0)
}
console.log(`${pass}/${pass + fail} 通过，${fail} 项失败：`)
for (const f of fails) console.log(`  FAIL  ${f}`)
process.exit(1)
