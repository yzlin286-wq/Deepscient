/**
 * 契约验证：不依赖 UI、不依赖会话，直接在本进程里跑一遍科研工具插件。
 *
 *   node scripts/verify-tools.mjs
 *
 * 做四件事：
 *   1. 从运行中的 dsh 安装位置解析 defineTool（与 lib/tools.js 同一套规则）
 *   2. 用假 ctx 收集注册的工具定义
 *   3. 用官方 schema 编译器把 parameters / output.schema 编成 JSON Schema（非法即抛）
 *   4. 真跑一次 science_preflight（deep:false），校验返回形状
 *
 * 退出码 0 = 通过，1 = 失败。CI 与升级后回归都用它。
 */
import { join } from 'node:path'
import { apply as applyTools, resolveDshToolsPackage } from '../lib/tools.js'

const results = []
const fail = (msg) => { results.push(['FAIL', msg]) }
const pass = (msg) => { results.push(['PASS', msg]) }

const dshTools = resolveDshToolsPackage()
pass(`解析 dsh-tools：${typeof dshTools.defineTool} defineTool / ${typeof dshTools.valueSchemaSpecToJsonSchema} schema-compiler`)

/* ── 假 ctx：只提供 tools.register / logger / get ─────────────────────────── */
const registered = []
const fakeCtx = {
  tools: {
    register(definition) {
      registered.push(definition)
      return () => {}
    },
  },
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  get(key) {
    if (key === 'scienceKit') return undefined
    return undefined
  },
}

try {
  applyTools(fakeCtx)
  pass(`apply 完成，注册 ${registered.length} 个工具`)
} catch (error) {
  fail(`apply 抛错：${error && error.message ? error.message : String(error)}`)
}

/* ── schema 形状校验 ─────────────────────────────────────────────────────── */
/* 注册后的 ToolDefinition 上，parameters / output.schema 已经是编译后的 JSON
 * Schema（defineTool 在注册前就编译过；非法 spec 会直接抛错）。这里只查形状。 */
for (const def of registered) {
  const label = def.name
  const parameters = def.parameters
  const output = def.output?.schema
  if (parameters && parameters.type === 'object' && parameters.properties && typeof parameters.properties === 'object') {
    pass(`${label}: parameters 是 object schema（${Object.keys(parameters.properties).length} 个参数）`)
  } else {
    fail(`${label}: parameters 不是 object schema`)
  }
  if (output && typeof output === 'object') pass(`${label}: output.schema 已编译`)
  else fail(`${label}: output.schema 缺失`)
  if (typeof def.execute !== 'function') fail(`${label}: 缺 execute`)
  else pass(`${label}: execute 是函数`)
  if (typeof def.output?.render !== 'function') fail(`${label}: 缺 output.render`)
  else pass(`${label}: output.render 是函数`)
}

/* ── 真跑一次（只读，不建目录：root 用临时目录） ────────────────────────── */
const target = registered.find((d) => d.name === 'science_preflight')
if (!target) {
  fail('science_preflight 未被注册')
} else {
  const tmpRoot = join(process.cwd(), '.verify-science-root')
  process.env.DSH_HOME = join(tmpRoot, 'home')
  try {
    const value = await target.execute({ deep: false }, { agent: undefined, signal: undefined })
    const checks = [
      ['root 是字符串', typeof value.root === 'string'],
      ['ok 是布尔', typeof value.ok === 'boolean'],
      ['schemaVersion 是数字', typeof value.schemaVersion === 'number'],
      ['skills 有 count', typeof value.skills?.count === 'number'],
      ['binaries 是数组', Array.isArray(value.binaries)],
      ['missing 是数组', Array.isArray(value.missing)],
      ['notes 是数组', Array.isArray(value.notes)],
    ]
    for (const [label, ok] of checks) (ok ? pass : fail)(`execute 返回：${label}`)
    const rendered = target.output.render({ deep: false }, value)
    if (Array.isArray(rendered) && rendered[0]?.type === 'text') pass('render 产出 text block')
    else fail('render 未产出 text block')
  } catch (error) {
    fail(`execute 抛错：${error && error.message ? error.message : String(error)}`)
  }
}

/* ── 汇总 ─────────────────────────────────────────────────────────────────── */
const failed = results.filter(([status]) => status === 'FAIL')
for (const [status, msg] of results) console.log(`${status}  ${msg}`)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  console.error(`\n失败 ${failed.length} 项`)
  process.exit(1)
}
