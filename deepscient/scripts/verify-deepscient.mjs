/**
 * DeepScient 验收：一个脚本，把「这个应用真的跑起来了」拆成可复算的断言。
 *
 *   node deepscient/scripts/verify-deepscient.mjs                       # 只跑不需要 token 的部分
 *   node deepscient/scripts/verify-deepscient.mjs --token <index token>  # 连首页、品牌、启动图一起验
 *
 * 验不到的东西说清楚，不假装：
 *   - 版面好不好看、深色模式对比、窄侧栏是否挤：要人眼看，脚本不判；
 *   - 浏览器里真的点开面板：脚本只证明「模块被服务、被加载、注册了那五个槽」。
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = resolve(here, '..')
const repoRoot = resolve(pkgDir, '..')

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const base = flag('url', process.env.DEEPSCIENT_URL || 'http://127.0.0.1:3081')
const token = flag('token', process.env.DEEPSCIENT_TOKEN || '')

// 开发 shell 里的 $DSH_HOME 通常指着另一个实例（~/.dsh）。这里模拟启动器的做法，
// 把它钉到本实例的数据根，否则「设置落在哪」这类断言验的是别人的目录。
const profileHome = join(process.env.USERPROFILE || process.env.HOME, '.deepscient')
if (!flag('home')) process.env.DSH_HOME = profileHome

let passed = 0
const failures = []
function check(label, fn) {
  try {
    fn()
    passed += 1
  } catch (error) {
    failures.push(`${label}: ${error.message}`)
  }
}
async function checkAsync(label, fn) {
  try {
    await fn()
    passed += 1
  } catch (error) {
    failures.push(`${label}: ${error.message}`)
  }
}
function section(title) {
  process.stdout.write(`\n== ${title}\n`)
}

/** 从 dump 里切出一行 Loader 配置（到下一个同级行或段头为止），别用窗口正则猜。 */
function rowBlock(dump, rowId) {
  const lines = dump.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `- id: ${rowId}`)
  if (start < 0) return null
  const block = [lines[start]]
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^- id: /.test(lines[i]) || /^# ==/.test(lines[i])) break
    block.push(lines[i])
  }
  return block.join('\n')
}

/* ── 1. 包本身 ──────────────────────────────────────────────────────────── */

section('包结构')
const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
check('包名是 @local/deepscient', () => assert.equal(manifest.name, '@local/deepscient'))
check('导出 ./client', () => assert.equal(manifest.exports['./client'], './client/index.js'))
check('导出宿主入口', () => assert.equal(manifest.exports['.'], './host/index.js'))
check('声明 bundle patch', () => assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml'))
check('client 平台是 web', () => assert.equal(manifest.dsh.client.platform, 'web'))
check('client 依赖 layout 与 sidebar', () => {
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-layout'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar'))
})
check('client 还依赖会话与聊天（底部胶囊要挂在输入区）', () => {
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-chat'))
})

for (const rel of ['host/index.js', 'host/api.js', 'host/science.js', 'host/settings.js', 'host/content.js', 'host/usage.js', 'host/sources.js', 'client/index.js']) {
  check(`${rel} 语法通过`, () => execFileSync(process.execPath, ['--check', join(pkgDir, rel)], { stdio: 'pipe' }))
}

check('usage/sources 进了 files 清单（tarball 才带得走）', () => {
  assert.ok(manifest.files.includes('host/usage.js'))
  assert.ok(manifest.files.includes('host/sources.js'))
  assert.ok(manifest.files.includes('docs/*.md'), '说明文档的 glob 没在 files 里')
})

const patch = readFileSync(join(pkgDir, 'cordis.patch.yml'), 'utf8')
check('patch 关掉官方品牌占用者', () => assert.match(patch, /id:\s*ui-brand-official[\s\S]*disabled:\s*true/))
check('patch 插入 deepscient 行', () => assert.match(patch, /insert:[\s\S]*id:\s*deepscient[\s\S]*name:\s*'@local\/deepscient'/))
check('patch 不夹带科研工具行（那归 dsh-science）', () => assert.ok(!/science-tools|preset-science\b/.test(patch)))
check('patch 关掉随包的四条预设声明', () => {
  for (const id of ['preset-standard', 'preset-ptc', 'preset-minimal', 'preset-cordis']) {
    assert.match(patch, new RegExp(`id:\\s*${id}[\\s\\S]{0,120}?disabled:\\s*true`), id)
  }
})

// 预设合并：科研声明直接占用 standard 这个 id，所以「标准模式」与「科研模式」是同一个东西。
const sciencePatch = readFileSync(join(repoRoot, 'dsh-science', 'presets', 'science.patch.yml'), 'utf8')
check('科研预设的 config.id 是 standard', () => assert.match(sciencePatch, /config:\s*\n\s*id:\s*standard\b/))
check('科研预设显示名是「科研模式」', () => assert.match(sciencePatch, /name:\s*科研模式/))
check('科研预设排第一', () => assert.match(sciencePatch, /order:\s*1\b/))

const locales = ['zh', 'en'].map((l) => JSON.parse(readFileSync(join(pkgDir, 'locale', `${l}.json`), 'utf8')))
check('中文 locale 有 meta.title', () => assert.match(locales[0].meta.title, /DeepScient/))
check('两份 locale 都有 panel 键', () => {
  assert.ok(locales[0].panel)
  assert.ok(locales[1].panel)
})
check('icon.svg 存在且非空', () => assert.ok(statSync(join(pkgDir, 'icon.svg')).size > 200))

/* ── 2. 宿主半边 ────────────────────────────────────────────────────────── */

section('品牌改名（服务端 tap）')
const host = await import(pathToFileURL(join(pkgDir, 'host', 'index.js')).href)
const raw = '<html><head><title>DeepSeek Harness</title></head><body>x</body></html>'
const branded = host.brandIndex(raw)
check('标题被换成 DeepScient', () => assert.match(branded, /<title>DeepScient · 科研工作台<\/title>/))
check('原标题不再出现', () => assert.ok(!/DeepSeek Harness/.test(branded)))
check('插入且只插入一次 brand 标记', () => assert.equal(branded.match(/data-deepscient="brand"/g).length, 1))
check('幂等：二次调用不再变', () => assert.equal(host.brandIndex(branded), branded))
check('没有 head 也能加', () => assert.match(host.brandIndex('<div>hi</div>'), /data-deepscient="brand"/))
check('注入的注入项声明了 webServer', () => assert.deepEqual(host.inject, ['webServer']))

check('首屏样式摘掉出厂的用量胶囊', () => assert.match(branded, /<style data-deepscient="composer-stats">/))
check('摘的正是 composer-stat=usage 那个节点', () =>
  assert.match(branded, /\[data-composer-stat="usage"\]\{display:none!important\}/))
check('胶囊样式不连累活动指示器', () => assert.ok(!/data-composer-stat="activity"/.test(branded)))
check('胶囊样式也幂等', () => assert.equal(host.brandIndex(branded), branded))
check('样式插在 </head> 之前', () => assert.ok(branded.indexOf('data-deepscient="composer-stats"') < branded.indexOf('</head>')))

const settingsMod = await import(pathToFileURL(join(pkgDir, 'host', 'settings.js')).href)
check('默认 α 是 0.05', () => assert.equal(settingsMod.DEFAULTS.alpha, 0.05))
check('α 越界被丢弃', () => assert.deepEqual(settingsMod.sanitize({ alpha: 99 }), {}))
check('未知键被丢弃', () => assert.deepEqual(settingsMod.sanitize({ nope: 1 }), {}))
check('枚举外的值被丢弃', () => assert.deepEqual(settingsMod.sanitize({ correction: 'magic' }), {}))
check('合法值保留', () => assert.deepEqual(settingsMod.sanitize({ correction: 'holm', alpha: 0.01 }), { correction: 'holm', alpha: 0.01 }))
check('设置文件落在本实例数据根', () => assert.match(settingsMod.settingsPath(), /\.deepscient[\\/]science[\\/]ui-settings\.json$/))

/* ── 2a. 计费与引导的设置项 ─────────────────────────────────────────────── */

section('计费设置')
check('默认计费来源是 newapi', () => assert.equal(settingsMod.DEFAULTS.billingProvider, 'newapi'))
check('中转站地址默认留空（占位，之后填）', () => assert.equal(settingsMod.DEFAULTS.billingBaseUrl, ''))
check('默认币种 CNY', () => assert.equal(settingsMod.DEFAULTS.billingCurrency, 'CNY'))
check('引导默认未完成、停在第 0 步', () => {
  assert.equal(settingsMod.DEFAULTS.onboardingDone, false)
  assert.equal(settingsMod.DEFAULTS.onboardingStep, 0)
})
check('非法计费来源被丢弃', () => assert.deepEqual(settingsMod.sanitize({ billingProvider: 'paypal' }), {}))
check('非 http(s) 的中转站地址被丢弃', () => assert.deepEqual(settingsMod.sanitize({ billingBaseUrl: 'ftp://x' }), {}))
check('合法中转站地址保留', () =>
  assert.deepEqual(settingsMod.sanitize({ billingBaseUrl: 'https://api.example.com' }), { billingBaseUrl: 'https://api.example.com' }))
check('引导步数越界被丢弃', () => assert.deepEqual(settingsMod.sanitize({ onboardingStep: 99 }), {}))
check('价目表非法行被逐行丢掉', () => {
  const values = settingsMod.sanitize({
    billingPriceTable: [
      { provider: 'tree', model: '*', inputPerM: 2, cacheReadPerM: 0.2, outputPerM: 8 },
      { provider: 'x', model: 'y', inputPerM: -1, outputPerM: 1 },
      'not-an-object',
    ],
  })
  assert.equal(values.billingPriceTable.length, 1)
  assert.equal(values.billingPriceTable[0].outputPerM, 8)
})

/* ── 2b. 计费与接入（纯函数与本机文件） ─────────────────────────────────── */

section('token 计费')
const usage = await import(pathToFileURL(join(pkgDir, 'host', 'usage.js')).href)

check('计费索引落在本实例数据根', () => assert.match(usage.usageIndexPath(), /\.deepscient[\\/]science[\\/]usage-index\.json$/))
check('四个区间', () => assert.deepEqual([...usage.RANGES], ['today', '7d', '30d', 'all']))
check('区间越久起点越早', () => {
  const now = Date.now()
  assert.ok(usage.rangeStart('today', now) > usage.rangeStart('7d', now))
  assert.ok(usage.rangeStart('7d', now) > usage.rangeStart('30d', now))
  assert.equal(usage.rangeStart('all', now), 0)
})

// 合成的会话日志：两条回复、两个模型、两天。数字必须能对上账，不靠「大概」。
const synthetic = [
  { type: 'session', id: 'sess-a', time: Date.UTC(2024, 0, 1, 10), data: { cwd: 'C:/lab', agentPreset: 'standard' } },
  { type: 'session/title', data: { title: '睡眠与记忆' } },
  { type: 'request/header', time: Date.UTC(2024, 0, 1, 10), data: { turn: 1, step: 1, header: { config: { provider: 'tree', model: 'deepseek-v4.1-flash' } } } },
  { type: 'assistant/message', time: Date.UTC(2024, 0, 1, 10, 1), data: { turn: 1, step: 1, usage: { inputTokens: 1000, cacheReadTokens: 4000, cacheWriteTokens: 200, outputTokens: 500, totalTokens: 5500 } } },
  { type: 'request/header', time: Date.UTC(2024, 0, 2, 9), data: { turn: 2, step: 1, header: { config: { provider: 'ccagent', model: 'm2' } } } },
  { type: 'assistant/message', time: Date.UTC(2024, 0, 2, 9, 1), data: { turn: 2, step: 1, usage: { inputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100, totalTokens: 300 } } },
  { type: 'assistant/message', time: Date.UTC(2024, 0, 2, 9, 2), data: { turn: 2, step: 1 } },
  '{ 坏行',
].map((row) => (typeof row === 'string' ? row : JSON.stringify(row))).join('\n')

const parsed = usage.parseSessionLog(synthetic, { file: 'demo.zstd' })
check('合计 token 5800', () => assert.equal(parsed.totals.totalTokens, 5800))
check('命中缓存的输入单列', () => assert.equal(parsed.totals.cacheReadTokens, 4000))
check('按模型分了两个桶', () => assert.equal(Object.keys(parsed.byModel).length, 2))
check('按天分了两个桶', () => assert.equal(Object.keys(parsed.byDay).length, 2))
check('坏行与缺 usage 的行都被记账', () => {
  assert.equal(parsed.quality.badLines, 1)
  assert.equal(parsed.quality.withoutUsage, 1)
})
check('会话标题被读出来', () => assert.equal(parsed.meta.title, '睡眠与记忆'))

const table = [
  { provider: 'tree', model: 'deepseek-v4.1-flash', inputPerM: 2, cacheReadPerM: 0.2, outputPerM: 8 },
  { provider: 'ccagent', model: '*', inputPerM: 2, cacheReadPerM: 0.2, outputPerM: 8 },
]
check('价目精确匹配优先', () => assert.equal(usage.priceOf(table, 'tree', 'deepseek-v4.1-flash').outputPerM, 8))
check('通配能兜住没列的模型', () => assert.ok(usage.priceOf(table, 'ccagent', 'm2')))
check('没有价目就返回 null（不瞎算）', () => assert.equal(usage.priceOf([], 'tree', 'x'), null))
check('全通配也能兜住', () => assert.ok(usage.priceOf([{ provider: '*', model: '*', inputPerM: 1, cacheReadPerM: 0.1, outputPerM: 2 }], 'nobody', 'nothing')))

const withCost = usage.usageRange({ range: 'all', priceTable: table, currency: 'CNY' })
check('用量接口能给出区间结果', () => assert.ok(['local-session-log', 'unavailable'].includes(withCost.source)))
check('结果里带索引口径', () => assert.ok(withCost.index && typeof withCost.index.files === 'number'))
check('默认币种是 CNY', () => assert.equal(usage.usageRange({ range: 'today' }).currency, 'CNY'))

section('文献 / 检索 API 接入')
const sourcesMod = await import(pathToFileURL(join(pkgDir, 'host', 'sources.js')).href)
const ledger = sourcesMod.listSources()
check('八个内置源', () => assert.equal(ledger.items.length, 8))
check('内置源 id 齐全', () => {
  const ids = ledger.items.map((i) => i.id)
  for (const id of ['semantic-scholar', 'openalex', 'core', 'unpaywall', 'crossref', 'arxiv', 'zotero', 'exa']) assert.ok(ids.includes(id), id)
})
check('凭据文件路径在数据根下', () => assert.match(ledger.path, /\.deepscient[\\/]science[\\/]config\.json$/))
check('arXiv 标成免凭据', () => assert.equal(ledger.items.find((i) => i.id === 'arxiv').kind, 'none'))
check('哪些字段真的会被工具读，如实标注', () => {
  const wired = Object.fromEntries(ledger.items.map((i) => [i.id, i.wired]))
  assert.equal(wired.openalex, 'runtime')
  assert.equal(wired.unpaywall, 'runtime')
  assert.equal(wired.arxiv, 'runtime')
  assert.equal(wired['semantic-scholar'], 'declared')
  assert.equal(wired.zotero, 'declared')
})
check('列表里不出现明文凭据', () => {
  const text = JSON.stringify(ledger)
  assert.ok(!/sk-[A-Za-z0-9]{10,}/.test(text))
})
check('key 掩码留头尾', () => assert.equal(sourcesMod.mask('key', 'sk-abcdefgh1234'), 'sk-•••1234'))
check('邮箱掩码留首字母与域名', () => assert.equal(sourcesMod.mask('email', 'pi@lab.example'), 'p•••@lab.example'))
check('短值整条打掉', () => assert.equal(sourcesMod.mask('key', 'short'), '••••'))
await checkAsync('未知源给 unknown-source', async () => {
  const res = await sourcesMod.verifySource('nope', { dry: true })
  assert.equal(res.status, 'unknown-source')
})
await checkAsync('免凭据源在 dry 下是 ready', async () => {
  const res = await sourcesMod.verifySource('arxiv', { dry: true })
  assert.equal(res.status, 'ready')
})
await checkAsync('缺凭据源在 dry 下是 no-credential', async () => {
  const saved = process.env.EXA_API_KEY
  delete process.env.EXA_API_KEY
  const res = await sourcesMod.verifySource('exa', { dry: true })
  if (saved !== undefined) process.env.EXA_API_KEY = saved
  assert.equal(res.status, 'no-credential')
})

const scienceMod = await import(pathToFileURL(join(pkgDir, 'host', 'science.js')).href)
const savedHome = process.env.DSH_HOME
delete process.env.DSH_HOME
check('不设 $DSH_HOME 时默认 ~/.deepscient', () => assert.match(scienceMod.dshHome(), /\.deepscient$/))
process.env.DSH_HOME = savedHome
check('$DSH_HOME 显式给出时优先', () => assert.equal(scienceMod.dshHome(), profileHome))

const content = await import(pathToFileURL(join(pkgDir, 'host', 'content.js')).href)
const docs = content.listDocs()
check('说明文档有 9 篇（含 skills / mcp）', () => assert.equal(docs.length, 9, docs.map((d) => d.id).join(',')))
check('第一页是快速上手', () => assert.equal(docs[0].id, 'quickstart'))
check('新增的三篇（引导/计费/接入）都在', () => {
  const ids = docs.map((d) => d.id)
  for (const id of ['guide', 'billing', 'sources']) assert.ok(ids.includes(id), id)
})
check('引导排在快速上手之后、阶段之前', () => {
  const ids = docs.map((d) => d.id)
  assert.ok(ids.indexOf('guide') < ids.indexOf('stages'))
})
check('每篇都有标题与正文', () => {
  for (const d of docs) {
    assert.ok(d.title.length > 2, d.id)
    assert.ok(d.bytes > 500, d.id)
  }
})
check('取不存在的文档给 null', () => assert.equal(content.getDoc('../../etc/passwd'), null))

/* ── 3. 客户端注册（桩加载） ────────────────────────────────────────────── */

section('客户端模块注册')
const clientSrc = readFileSync(join(pkgDir, 'client', 'index.js'), 'utf8')
check('客户端用 ModuleLoader 协议', () => assert.match(clientSrc, /window\.__ModuleLoader__\.load\(/))
check('模块 id 与包名一致', () => assert.match(clientSrc, /id:\s*'@local\/deepscient'/))
check('不 require 基线之外的模块', () => {
  const reqs = [...clientSrc.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(reqs)], ['react'])
})

/** 把浏览器里的加载器与 React 最小化地摆出来，跑一遍 apply()，看它到底注册了什么。 */
const registrations = []
const nodeEl = (type, props, ...children) => ({ type, props: props ?? {}, children })
const ReactMock = {
  createElement: nodeEl,
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
}
let mod = null
globalThis.window = {
  __ModuleLoader__: {
    load(def) {
      mod = def.factory((id) => {
        if (id === 'react') return ReactMock
        throw new Error(`未声明的外部模块：${id}`)
      })
      mod.__id = def.id
    },
  },
}
await import(pathToFileURL(join(pkgDir, 'client', 'index.js')).href)
check('模块被加载器接住', () => assert.ok(mod))
check('模块注入 slots 与 locale', () => assert.deepEqual(mod.inject, ['slots', 'locale']))

const ctx = {
  locale: { bind: () => (key) => ({ panel: '科研工作台', settings: '科研' })[key] ?? key },
  slots: {
    inject(name, fn) {
      fn()
      return () => {}
    },
    register(options, component) {
      registrations.push({ ...options, component })
      return () => {}
    },
  },
}
mod.apply(ctx)
const byName = (name) => registrations.filter((r) => r.name === name)

check('一共注册 7 个槽', () => assert.equal(registrations.length, 7, registrations.map((r) => r.name).join(',')))
check('品牌图标槽', () => assert.equal(byName('sidebar.brand.mark').length, 1))
check('品牌名槽', () => assert.equal(byName('sidebar.brand.name').length, 1))
check('侧栏面板列表槽', () => assert.equal(byName('sidebar.panellist').length, 1))
check('主区域面板槽', () => assert.equal(byName('main').length, 1))
check('设置分区槽', () => assert.equal(byName('settings.section').length, 1))
check('输入区底部胶囊槽（token 计费）', () => assert.equal(byName('conversation.composer.dock').length, 1))
check('胶囊 id 不与出厂那颗撞名', () => assert.equal(byName('conversation.composer.dock')[0].id, 'deepscient-usage'))
check('浮层槽（使用引导）', () => assert.equal(byName('shell.overlay').length, 1))
check('引导浮层 id', () => assert.equal(byName('shell.overlay')[0].id, 'deepscient-onboarding'))
check('panellist 的 id 是 science', () => assert.equal(byName('sidebar.panellist')[0].id, 'science'))
check('main 的 key 与 panellist 的 id 相同', () => {
  assert.equal(byName('main')[0].key, byName('sidebar.panellist')[0].id)
})
check('panellist 有排序号', () => assert.equal(typeof byName('sidebar.panellist')[0].order, 'number'))
check('settings.section 的 id 是 science', () => assert.equal(byName('settings.section')[0].id, 'science'))
check('label 是函数且能取到中文', () => {
  assert.equal(typeof byName('sidebar.panellist')[0].label, 'function')
  assert.equal(byName('sidebar.panellist')[0].label(), '科研工作台')
})
check('每个注册都带 component', () => {
  for (const r of registrations) assert.equal(typeof r.component, 'function')
})

const brandName = byName('sidebar.brand.name')[0].component({})
const brandText = JSON.stringify(brandName)
check('品牌名渲染出 DeepScient', () => assert.match(brandText, /DeepScient/))
const mark = byName('sidebar.brand.mark')[0].component({ size: 24 })
check('品牌图标是 svg 且尺寸可传', () => {
  assert.equal(mark.type, 'svg')
  assert.equal(mark.props.width, 24)
})
const icon = byName('sidebar.panellist')[0].component({})
check('面板图标是 svg', () => assert.equal(icon.type, 'svg'))
const panel = byName('main')[0].component({})
const panelText = JSON.stringify(panel)
check('面板根节点渲染出标题', () => assert.match(panelText, /DeepScient 科研工作台/))
check('面板有计费页签', () => assert.match(panelText, /计费/))
check('面板有接入页签', () => assert.match(panelText, /接入/))
const settingsSection = byName('settings.section')[0].component({})
check('设置页会先进入读取态', () => assert.equal(settingsSection.type?.name, 'Loading'))

const pill = byName('conversation.composer.dock')[0].component({})
const pillText = JSON.stringify(pill)
check('胶囊是个按钮（点了跳计费页）', () => assert.equal(pill.type, 'button'))
check('胶囊说 token 量', () => assert.match(pillText, /tokens/))
check('胶囊不说缓存命中率', () => assert.ok(!/缓存/.test(pillText), `胶囊文本：${pillText}`))
check('胶囊不放金额（只报消耗量）', () => assert.ok(!/≈|CNY|USD/.test(pillText), `胶囊文本：${pillText}`))
check('引导在设置还没读到时什么都不渲染', () => assert.equal(byName('shell.overlay')[0].component({}), null))
check('引导层自带 pointer-events（浮层默认是 click-through）', () =>
  assert.match(clientSrc, /pointerEvents:\s*'auto'/))
check('胶囊自带取数（dock 槽不给 props）', () => assert.match(clientSrc, /\/usage\?range=today/))
check('胶囊只轮询本机用量，不请求模型', () => assert.ok(!/api\/chat|completions/.test(clientSrc)))

/* ── 4. 实例数据根与隔离 ────────────────────────────────────────────────── */

section('实例隔离')
const home = process.env.USERPROFILE ? join(process.env.USERPROFILE, '.deepscient') : ''
check('本实例数据根是 ~/.deepscient', () => assert.ok(existsSync(home)))
check('物理上不是 ~/.dsh', () => assert.notEqual(resolve(home), resolve(join(process.env.USERPROFILE, '.dsh'))))
check('profile 目录独立', () => assert.ok(existsSync(join(home, 'profiles', 'deepscient', 'package.json'))))
const profilePkg = JSON.parse(readFileSync(join(home, 'profiles', 'deepscient', 'package.json'), 'utf8'))
check('profile 选了两个 bundle', () => {
  const bundles = profilePkg.dsh.profile.bundles
  assert.ok(bundles.includes('@local/deepscient'), bundles.join())
  assert.ok(bundles.includes('@local/dsh-science'), bundles.join())
})
check('模型层文件存在且不含密钥明文', () => {
  const text = readFileSync(join(pkgDir, 'local.patch.yml'), 'utf8')
  assert.match(text, /apiKeyEnv/)
  assert.ok(!/sk-[A-Za-z0-9]{10,}/.test(text))
})

// 组合到底有没有把科研插件挂上：让 CLI 自己吐一遍合成后的配置，别靠猜。
const dshCli =
  process.env.DSH_CLI ||
  join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd')
if (existsSync(dshCli)) {
  let dump = ''
  try {
    dump = execFileSync(process.env.ComSpec || 'cmd.exe', ['/c', dshCli, '--profile', 'deepscient', '--dump-config'], {
      env: { ...process.env, DSH_HOME: profileHome },
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 180000,
    })
  } catch (error) {
    dump = ''
  }
  check('能 dump 出本实例的合成配置', () => assert.ok(dump.length > 1000, `${dump.length} 字节`))
  const scienceEntries = [...new Set([...dump.matchAll(/@local\/dsh-science\/[a-z-]+/g)].map((m) => m[0]))]
  check('科研插件挂了 9 个', () => assert.equal(scienceEntries.length, 9, scienceEntries.join(',')))
  check('9 个插件就是 dsh-science 导出的那 9 个入口', () => {
    for (const name of ['tools', 'science-tools', 'method-tools', 'discipline-tools', 'lab-tools', 'analysis-tools', 'manuscript-tools', 'coach-tools', 'frontier-tools']) {
      assert.ok(scienceEntries.includes(`@local/dsh-science/${name}`), name)
    }
  })
  check('配置里挂着 deepscient 自己', () => assert.match(dump, /@local\/deepscient/))
  check('官方品牌行确实被本包的 patch 关掉', () =>
    assert.match(dump, /patched by @local\/deepscient[\s\S]{0,200}?ui-brand-official[\s\S]{0,200}?disabled:\s*true/))
  check('deepscient 自己那一行是启用的', () => {
    const lines = dump.split(/\r?\n/)
    const start = lines.findIndex((l) => l.includes('# == @local/deepscient'))
    assert.ok(start >= 0, '没找到本包的配置段')
    const rest = lines.slice(start + 1)
    const end = rest.findIndex((l) => /^\s*# ==/.test(l))
    const block = (end === -1 ? rest : rest.slice(0, end)).join('\n')
    assert.match(block, /name: '@local\/deepscient'/)
    assert.ok(!/disabled:\s*true/.test(block), '本包被禁用了')
  })
  check('科研插件段也在配置里', () => assert.match(dump, /# == @local\/dsh-science/))

  check('合成配置里「科研模式」占着 standard 这个 id', () => {
    const block = rowBlock(dump, 'preset-science')
    assert.ok(block, '没找到 preset-science 行')
    assert.match(block, /id:\s*standard\b/)
    assert.match(block, /name:\s*科研模式/)
  })
  check('原版四条预设声明都被关掉', () => {
    for (const id of ['preset-standard', 'preset-ptc', 'preset-minimal', 'preset-cordis']) {
      const block = rowBlock(dump, id)
      assert.ok(block, `没找到 ${id}`)
      assert.match(block, /disabled:\s*true/, `${id} 没被关掉`)
    }
  })
} else {
  process.stdout.write('（跳过合成配置检查：找不到 dsh CLI，可用 DSH_CLI 指定）\n')
}

/* ── 5. HTTP 面 ─────────────────────────────────────────────────────────── */

section('HTTP 接口')
async function get(path) {
  const res = await fetch(`${base}${path}`, { headers: { accept: 'application/json' } })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { __raw: text }
  }
  return { status: res.status, body, text }
}

await checkAsync('未带 token 的首页是 401', async () => {
  const res = await fetch(`${base}/`)
  assert.equal(res.status, 401)
})

const health = await get('/deepscient/api/health')
check('health 200', () => assert.equal(health.status, 200))
check('health 报的是 DeepScient', () => assert.equal(health.body.product, 'DeepScient'))
check('health 的版本就是 package.json 的版本', () => assert.equal(health.body.version, manifest.version))
check('health 报出科研库可用', () => assert.equal(health.body.science.available, true))
check('health 的数据根指向本实例', () => assert.match(health.body.dataRoot, /\.deepscient[\\/]science$/))
check('health 报出当前预设', () => {
  assert.equal(health.body.preset?.id, 'standard', JSON.stringify(health.body.preset))
  assert.equal(health.body.preset.broken, null, `broken=${health.body.preset.broken}`)
})
check('health 报出默认模型', () => {
  assert.equal(health.body.model?.provider, 'ccagent', JSON.stringify(health.body.model))
  assert.equal(health.body.model.model, 'deepseek-v4.1-flash')
})
check('health 的 keyPresent 只是布尔（不泄漏值）', () => {
  assert.ok([true, false, null].includes(health.body.model.keyPresent), String(health.body.model.keyPresent))
  assert.ok(!/sk-[A-Za-z0-9]{10,}/.test(health.text))
})

const tools = await get('/deepscient/api/tools')
check('tools 200', () => assert.equal(tools.status, 200))
check('工具数 ≥ 30', () => assert.ok(tools.body.total >= 30, String(tools.body.total)))
check('工具带阶段归属', () => {
  const staged = tools.body.items.filter((t) => t.stageId)
  assert.ok(staged.length >= 20, String(staged.length))
})
check('跨阶段工具有标注', () => {
  const global = tools.body.items.filter((t) => !t.stageId)
  assert.ok(global.every((t) => t.stageLabel === '全程'))
})

const workflow = await get('/deepscient/api/workflow')
check('workflow 有 12 个阶段', () => assert.equal(workflow.body.stages.length, 12))
check('阶段覆盖 S0–S11', () => {
  const codes = workflow.body.stages.map((s) => s.id)
  for (let i = 0; i <= 11; i += 1) assert.ok(codes.includes(`S${i}`), `S${i}`)
})

const projects = await get('/deepscient/api/projects')
check('projects 200', () => assert.equal(projects.status, 200))
check('至少有一个课题（演示数据已装）', () => assert.ok(projects.body.total >= 1))
// 断言认的是「演示课题」（有方案设计、有运行记录那一份）。
// 端到端脚本会真的新建课题，最新一条未必是演示数据，所以按题目挑，别拿下标 0。
const demo = projects.body.items.find((item) => /睡眠剥夺/.test(item.title)) ?? projects.body.items[0]
const projectId = demo?.id
check('课题带进度', () => assert.equal(typeof demo.progress.done, 'number'))
check('课题带课题目录（引导要靠它建工作区）', () => {
  assert.match(demo.dir, /\.deepscient[\\/]science[\\/]projects[\\/]/)
})
check('每条课题都有 dir（列表不再只有标题）', () => {
  for (const item of projects.body.items) assert.match(item.dir, /projects[\\/]/, item.title)
})

const enc = encodeURIComponent(projectId)
const stages = await get(`/deepscient/api/projects/${enc}/stages`)
check('stages 200', () => assert.equal(stages.status, 200))
check('12 个阶段都在', () => assert.equal(stages.body.stages.length, 12))
check('门总数是 55', () => {
  const total = stages.body.stages.reduce((n, s) => n + s.gates.length, 0)
  assert.equal(total, 55)
})
check('每个门都有状态与等级', () => {
  for (const s of stages.body.stages) {
    for (const g of s.gates) {
      assert.ok(['pass', 'fail', 'skip', 'manual'].includes(g.status), g.id)
      assert.ok(['blocking', 'warning', 'manual'].includes(g.severity), g.id)
    }
  }
})
check('演示数据里 S0 已完成', () => assert.equal(stages.body.stages.find((s) => s.id === 'S0').complete, true))
check('演示数据里 S1 未完成（设计如此）', () => assert.equal(stages.body.stages.find((s) => s.id === 'S1').complete, false))

const next = await get(`/deepscient/api/projects/${enc}/next`)
check('next 200', () => assert.equal(next.status, 200))
check('下一步是 S1', () => assert.equal(next.body.stage.id, 'S1'))
check('下一步带可执行动作', () => assert.ok(next.body.nextActions.length >= 1))
check('动作带门 id 与说明', () => {
  const a = next.body.nextActions[0]
  assert.ok(a.gate)
  assert.ok(a.label)
})
check('未完成时 done=false', () => assert.equal(next.body.done, false))

const detail = await get(`/deepscient/api/projects/${enc}`)
check('课题详情 200', () => assert.equal(detail.status, 200))
check('详情带方案设计', () => assert.ok(detail.body.plan))
check('详情带运行/分析计数', () => assert.ok(detail.body.counts.analysis >= 1))
check('溯源链完整', () => assert.equal(detail.body.provenance.ok, true))

const missing = await get('/deepscient/api/projects/不存在的课题')
check('不存在的课题 404', () => assert.equal(missing.status, 404))
check('404 带错误码', () => assert.equal(missing.body.error, 'project-not-found'))
const unknown = await get('/deepscient/api/nope')
check('未知端点 404', () => assert.equal(unknown.status, 404))

const docsApi = await get('/deepscient/api/docs')
check('docs 200 且 9 篇', () => assert.equal(docsApi.body.items.length, 9))
const docApi = await get('/deepscient/api/docs/quickstart')
check('单篇文档带 markdown', () => assert.match(docApi.body.markdown, /^# 快速上手/))
const billingDoc = await get('/deepscient/api/docs/billing')
check('计费页文档能取到', () => assert.match(billingDoc.body.markdown, /New API 中转站/))
const sourcesDoc = await get('/deepscient/api/docs/sources')
check('接入页文档能取到', () => assert.match(sourcesDoc.body.markdown, /retrieval\.mailto/))
const guideDoc = await get('/deepscient/api/docs/guide')
check('引导文档能取到', () => assert.match(guideDoc.body.markdown, /六步|第一步|新手上路/))
const doc404 = await get('/deepscient/api/docs/zzz')
check('不存在的文档 404', () => assert.equal(doc404.status, 404))

const skills = await get('/deepscient/api/skills')
check('skills 200', () => assert.equal(skills.status, 200))
check('随包技能 17 个', () => assert.equal(skills.body.counts?.bundled, 17, `实际 ${skills.body.counts?.bundled}`))
check('items = 随包 + vendor + 用户', () => {
  const counts = skills.body.counts ?? {}
  assert.equal(skills.body.items.length, (counts.bundled ?? 0) + (counts.vendor ?? 0) + (counts.user ?? 0))
})
check('技能名与磁盘目录一致', () => {
  const bundledDir = join(repoRoot, 'dsh-science', 'skills', 'science')
  const vendorDir = join(process.env.USERPROFILE ?? homedir(), '.deepscient', 'science', 'skills-vendor')
  const list = (dir) => (existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'SKILL.md')))
        .map((e) => e.name)
    : [])
  const onDisk = [...list(bundledDir), ...list(vendorDir)].sort()
  assert.deepEqual(skills.body.items.map((s) => s.name).sort(), onDisk)
})
check('每个技能都有标题', () => {
  for (const s of skills.body.items) assert.ok(s.title && s.title.length > 2, s.name)
})

const settingsBefore = await get('/deepscient/api/settings')
check('settings 200', () => assert.equal(settingsBefore.status, 200))
check('settings 有默认值', () => assert.equal(settingsBefore.body.values.alpha, 0.05))

const putRes = await fetch(`${base}/deepscient/api/settings`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ alpha: 0.01, nonsense: 1 }),
})
const putBody = await putRes.json()
check('PUT settings 200', () => assert.equal(putRes.status, 200))
check('合法项写入', () => assert.equal(putBody.values.alpha, 0.01))
check('非法项被拒并回报', () => assert.deepEqual(putBody.rejected, ['nonsense']))
const settingsAfter = await get('/deepscient/api/settings')
check('落盘后读回是新值', () => assert.equal(settingsAfter.body.values.alpha, 0.01))
// 复原，别把验收痕迹留在用户配置里
await fetch(`${base}/deepscient/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ alpha: 0.05 }) })
const restored = await get('/deepscient/api/settings')
check('α 已复原', () => assert.equal(restored.body.values.alpha, 0.05))

const methodNotAllowed = await fetch(`${base}/deepscient/api/tools`, { method: 'DELETE' })
check('不支持的方法 405', () => assert.equal(methodNotAllowed.status, 405))

/* ── 5b. 计费 / 预设 / 接入 的 HTTP 面 ──────────────────────────────────── */

section('计费接口')
const usageApi = await get('/deepscient/api/usage?range=today')
check('usage 200', () => assert.equal(usageApi.status, 200))
check('usage 说清数据来源', () => assert.ok(['local-session-log', 'unavailable'].includes(usageApi.body.source), usageApi.body.source))
check('usage 带区间回显', () => assert.equal(usageApi.body.range, 'today'))
check('usage 有 totals 桶', () => {
  for (const key of ['inputTokens', 'cacheReadTokens', 'outputTokens', 'totalTokens', 'messages']) {
    assert.equal(typeof usageApi.body.totals[key], 'number', key)
  }
})
check('计费来源写的是 New API 中转站', () => assert.match(usageApi.body.billing.sourceName, /New API/))
check('中转站链接还是占位（之后才填）', () => {
  assert.equal(usageApi.body.billing.configured, false)
  assert.ok(usageApi.body.billing.linkPlaceholder.length > 8)
})
check('用量里带扣费主体列表', () => assert.ok(Array.isArray(usageApi.body.keys)))
check('扣费主体不泄漏明文', () => assert.ok(!/sk-[A-Za-z0-9]{10,}/.test(usageApi.text)))

const usageAll = await get('/deepscient/api/usage?range=all')
check('range=all 也认', () => assert.equal(usageAll.body.range, 'all'))
const usageBad = await get('/deepscient/api/usage?range=someday')
check('乱写的区间回落到 today', () => assert.equal(usageBad.body.range, 'today'))

section('预设')
const presetsApi = await get('/deepscient/api/presets')
check('presets 200', () => assert.equal(presetsApi.status, 200))
check('预设清单里有科研模式', () => {
  const row = presetsApi.body.items.find((p) => p.id === 'standard' || p.name === '科研模式')
  assert.ok(row, JSON.stringify(presetsApi.body.items.map((p) => p.id)))
})
check('科研模式占着 standard 这个 id', () => {
  const row = presetsApi.body.items.find((p) => p.id === 'standard')
  assert.equal(row.name, '科研模式')
})
check('预设只剩一个（其余关了）', () => assert.equal(presetsApi.body.items.length, 1, JSON.stringify(presetsApi.body.items.map((p) => p.id))))
// 「新建会话失败」只有一个可查的原因：预设还在 roster 上、但 broken 不为空，或者 id 解析不到。
check('预设清单透出 broken（否则前端只能看到一句失败）', () => {
  for (const p of presetsApi.body.items) assert.ok('broken' in p, JSON.stringify(p))
})
check('预设清单透出 isDefault', () => {
  for (const p of presetsApi.body.items) assert.equal(typeof p.isDefault, 'boolean')
})
check('当前预设不是激活失败状态', () => {
  const row = presetsApi.body.items[0]
  assert.equal(row.broken, null, `broken=${row.broken}`)
})

const inspectApi = await get('/deepscient/api/presets/inspect')
check('presets/inspect 200', () => assert.equal(inspectApi.status, 200))
check('inspect 报出每一行插件', () => {
  assert.equal(inspectApi.body.available, true, JSON.stringify(inspectApi.body))
  const rows = inspectApi.body.presets[0]?.rows ?? []
  assert.ok(rows.length >= 20, String(rows.length))
})
check('inspect 的 fiberState 是名字不是数字', () => {
  const states = inspectApi.body.presets[0].rows.map((r) => r.fiberState).filter((s) => s !== null)
  assert.ok(states.length > 0)
  for (const s of states) assert.match(s, /^(pending|loading|active|failed|disposed|unloading)$/)
})
check('inspect 的行没有 failed', () => {
  const failed = inspectApi.body.presets[0].rows.filter((r) => r.fiberState === 'failed')
  assert.equal(failed.length, 0, JSON.stringify(failed))
})
check('inspect 带 resolve 结果', () => assert.equal(inspectApi.body.resolved?.id, 'standard'))

section('科研系统便携性（换台干净机器也能跑）')
const scienceDir = join(repoRoot, 'dsh-science')
const sciencePreset = readFileSync(join(scienceDir, 'presets', 'science.patch.yml'), 'utf8')
check('科研预设里没有提示词变量', () => assert.ok(!/\{\{[a-z][a-z0-9_]*\}\}/.test(sciencePreset)))
check('persona 只用官方 key', () => {
  const block = sciencePreset.slice(sciencePreset.indexOf('- id: persona'), sciencePreset.indexOf('- id: agent-instructions'))
  const keys = [...block.matchAll(/^\s{14}([A-Za-z][A-Za-z0-9_]*):/gm)].map((m) => m[1])
  assert.ok(keys.length >= 1, '没找到 persona 配置行')
  for (const key of keys) assert.ok(['prefix', 'suffix', 'complete', 'includeRuntimeContext'].includes(key), key)
})
check('科研包没有引用本机第三方应用', () => {
  const scanned = []
  for (const dir of ['lib', 'presets']) {
    const full = join(scienceDir, dir)
    for (const name of readdirSync(full)) {
      const file = join(full, name)
      if (statSync(file).isFile() && /\.(js|mjs|yml|yaml)$/.test(name)) scanned.push({ file, text: readFileSync(file, 'utf8') })
    }
  }
  assert.ok(scanned.length > 5, String(scanned.length))
  for (const { file, text } of scanned) {
    assert.ok(!/dsh-purge|cwd-variable/.test(text), file)
  }
})
check('科研包没有写死绝对路径', () => {
  const files = ['lib/tools.js', 'presets/science.patch.yml', 'cordis.patch.yml']
  for (const rel of files) {
    const text = readFileSync(join(scienceDir, rel), 'utf8')
    assert.ok(!/[A-Za-z]:\\\\?Users|\/home\/[a-z]/.test(text), rel)
  }
})
check('便携性自查脚本能跑且通过', () => {
  execFileSync(process.execPath, [join(scienceDir, 'scripts', 'verify-portability.mjs')], { stdio: 'pipe' })
})
check('DeepScient 自己也不引用本机第三方应用', () => {
  for (const rel of ['client/index.js', 'host/index.js', 'host/api.js', 'cordis.patch.yml', 'local.patch.yml']) {
    const file = join(pkgDir, rel)
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    assert.ok(!/dsh-purge|cwd-variable/.test(text), rel)
  }
})

section('引导直连会话')
const clientSrcForGuide = readFileSync(join(pkgDir, 'client', 'index.js'), 'utf8')
check('引导不再让用户复制粘贴', () => assert.match(clientSrcForGuide, /用这条开会话/))
check('引导没有「打开一个新会话」这个只会失败的按钮', () => assert.ok(!/打开一个新会话/.test(clientSrcForGuide)))
check('startSession 带真实工作区与提示词', () => {
  assert.match(clientSrcForGuide, /startSession\(workspaceId,\s*\{/)
  assert.match(clientSrcForGuide, /prompt:\s*text/)
  assert.match(clientSrcForGuide, /clearPreviousDraft:\s*true/)
})
check('不再把 agentPreset 写死成 standard', () => assert.ok(!/agentPreset:\s*'standard'/.test(clientSrcForGuide)))
check('预设 id 从注册表取', () => assert.match(clientSrcForGuide, /useApi\('\/presets'\)/))
check('预设 broken 时按钮禁用并说原因', () => {
  assert.match(clientSrcForGuide, /presetBroken/)
  assert.match(clientSrcForGuide, /激活失败/)
})
check('开会话失败会说清是哪一类原因', () => {
  assert.match(clientSrcForGuide, /模型 key 未配置/)
  assert.match(clientSrcForGuide, /presets\/inspect/)
})
check('工作区从 useWorkspaces 快照取，缺了才建', () => {
  assert.match(clientSrcForGuide, /useWorkspacesHook\s*=\s*typeof props\?\.useWorkspaces/)
  assert.match(clientSrcForGuide, /workspaces'\)/)
})
check('自检页有预设与模型两行', () => {
  assert.match(clientSrcForGuide, /预设：\$\{preset/)
  assert.match(clientSrcForGuide, /key \$\{keyText\}/)
})
check('设置页有预设体检入口', () => assert.match(clientSrcForGuide, /预设体检/))
check('端到端脚本在位且能 dry-run', () => {
  const script = join(pkgDir, 'scripts', 'e2e-science-run.mjs')
  assert.ok(existsSync(script), 'scripts/e2e-science-run.mjs 不在')
  const out = execFileSync(process.execPath, [script, '--dry'], { encoding: 'utf8' })
  assert.match(out, /--run/)
})
check('端到端脚本分区说清楚了 headless 不组合预设', () => {
  const src = readFileSync(join(pkgDir, 'scripts', 'e2e-science-run.mjs'), 'utf8')
  assert.match(src, /不组合 agent preset/)
  assert.match(src, /presets\/inspect/)
  assert.match(src, /api\/projects/, '建课题走活实例的写端点')
})
check('key 同步脚本在位且 dry-run 不写文件', () => {
  const script = join(pkgDir, 'scripts', 'sync-model-key.mjs')
  assert.ok(existsSync(script), 'scripts/sync-model-key.mjs 不在')
  const out = execFileSync(process.execPath, [script], { encoding: 'utf8' })
  assert.match(out, /dry-run|PASS/)
  assert.ok(!/=[A-Za-z0-9_-]{40,}/.test(out), '不允许把 key 值打印出来')
})
check('两个新脚本都随包发', () => {
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  assert.ok(pkg.files.some((f) => f.includes('scripts')))
})

section('接入接口')
const sourcesApi = await get('/deepscient/api/sources')
check('sources 200', () => assert.equal(sourcesApi.status, 200))
check('八个内置源', () => assert.equal(sourcesApi.body.items.length, 8))
check('接入清单带凭据文件路径', () => assert.match(sourcesApi.body.path, /science[\\/]config\.json$/))
check('清单里没有明文 key', () => assert.ok(!/sk-[A-Za-z0-9]{10,}/.test(sourcesApi.text)))
const verifyDry = await fetch(`${base}/deepscient/api/sources/verify`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: 'arxiv', dry: true }),
})
const verifyDryBody = await verifyDry.json()
check('dry 验源 200 且是 ready', () => {
  assert.equal(verifyDry.status, 200)
  assert.equal(verifyDryBody.status, 'ready')
})
const verifyUnknown = await fetch(`${base}/deepscient/api/sources/verify`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: 'nope', dry: true }),
})
await checkAsync('未知源 200 + unknown-source（不是 500）', async () => {
  assert.equal(verifyUnknown.status, 200)
  assert.equal((await verifyUnknown.json()).status, 'unknown-source')
})
const sourceMethod = await fetch(`${base}/deepscient/api/sources/verify`, { method: 'PUT' })
check('sources/verify 只收 POST', () => assert.equal(sourceMethod.status, 405))

/* ── 第三方技能与 MCP ───────────────────────────────────────────────────── */

section('第三方技能与 MCP')
{
  const manifestPath = join(repoRoot, 'dsh-science', 'skills-vendor', 'manifest.json')
  check('技能清单存在', () => assert.ok(existsSync(manifestPath), manifestPath))
  const skillManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const rows = Array.isArray(skillManifest.skills) ? skillManifest.skills : []
  check('清单条数 ≥ 60', () => assert.ok(rows.length >= 60, `实际 ${rows.length}`))
  check('每条都有 id / repo / path / license', () => {
    for (const row of rows) {
      assert.ok(row.id && row.repo && row.path && row.license, `缺字段：${JSON.stringify(row).slice(0, 120)}`)
    }
  })
  check('ref 全是 40 位 commit（禁分支名）', () => {
    const bad = rows.filter((row) => !/^[0-9a-f]{40}$/.test(String(row.ref ?? '')))
    assert.equal(bad.length, 0, `不是 commit：${bad.slice(0, 3).map((r) => r.id).join('、')}`)
  })
  check('每条都 lock 了内容哈希', () => {
    const bad = rows.filter((row) => !/^[0-9a-f]{64}$/.test(String(row.sha256 ?? '')))
    assert.equal(bad.length, 0, `没 lock：${bad.slice(0, 3).map((r) => r.id).join('、')}`)
  })
  check('id 不重复', () => assert.equal(new Set(rows.map((r) => r.id)).size, rows.length))
  check('没有把无许可仓库放进来', () => {
    const ok = new Set(['MIT', 'Apache-2.0'])
    const bad = rows.filter((row) => !ok.has(row.license) && !/MIT/.test(row.license))
    assert.equal(bad.length, 0, `许可不明：${bad.slice(0, 3).map((r) => r.repo).join('、')}`)
  })

  const installer = join(pkgDir, 'scripts', 'install-skills.mjs')
  check('安装脚本在', () => assert.ok(existsSync(installer), installer))
  check('安装脚本语法通过', () =>
    execFileSync(process.execPath, ['--check', installer], { stdio: 'pipe' }))
  const selfTest = spawnSync(process.execPath, [installer, '--self-test'], { encoding: 'utf8' })
  check('安装脚本自测全过（tar 解析 + frontmatter 归一化）', () => {
    assert.equal(selfTest.status, 0, (selfTest.stdout ?? '') + (selfTest.stderr ?? ''))
    assert.match(selfTest.stdout, /10\/10 通过/)
  })
  const listOut = spawnSync(process.execPath, [installer, '--list'], { encoding: 'utf8' })
  check('--list 离线可跑', () => {
    assert.equal(listOut.status, 0, listOut.stderr)
    assert.match(listOut.stdout, /共 \d+ 条/)
  })
  const dryOut = spawnSync(process.execPath, [installer, '--plan'], { encoding: 'utf8' })
  check('--apply 默认 dry-run，不写盘', () => {
    assert.equal(dryOut.status, 0, dryOut.stderr)
    assert.match(dryOut.stdout, /dry-run：什么都没写/)
  })

  // 随包的东西里不能有第三方正文：清单和说明可以有，SKILL.md 不行。
  const vendored = readdirSync(join(repoRoot, 'dsh-science', 'skills-vendor'))
  check('仓库里的 skills-vendor 只有清单与说明', () =>
    assert.deepEqual(vendored.filter((n) => !n.startsWith('.')).sort(), ['README.md', 'manifest.json']))
  // 清单只有一份，在 dsh-science 包里；deepscient 包里不该出现任何 skills-vendor 正文
  check('发布包的 files 不含第三方技能正文', () => {
    const files = manifest.files ?? []
    assert.ok(!files.some((pattern) => pattern.startsWith('skills-vendor/')), files.join(','))
    assert.ok(files.includes('mcp.patch.yml'), 'mcp.patch.yml 没进 files')
    assert.ok(files.includes('scripts/*.mjs'), 'scripts 没进 files')
  })
  check('安装器能定位到 dsh-science 的清单', () => {
    const installerText = readFileSync(join(repoRoot, 'deepscient', 'scripts', 'install-skills.mjs'), 'utf8')
    assert.match(installerText, /dsh-science['"],\s*'skills-vendor'/)
  })

  const skillsApi = await get('/deepscient/api/skills')
  check('skills 200', () => assert.equal(skillsApi.status, 200))
  check('报名了三个技能根', () => {
    const roots = skillsApi.body.roots ?? {}
    assert.ok(String(roots.vendor).includes('skills-vendor'), roots.vendor)
    assert.ok(String(roots.bundled).includes('science'), roots.bundled)
    assert.ok(String(roots.user).includes('skills'), roots.user)
  })
  check('预设的技能根里含 vendor（会话真的会扫它）', () => {
    const preset = skillsApi.body.preset ?? {}
    assert.ok(preset.available, preset.error ?? 'preset 不可读')
    const dirs = (preset.roots ?? []).map((row) => row.dir)
    assert.ok(dirs.some((dir) => dir.includes('skills-vendor')), dirs.join('、'))
    assert.ok(dirs.some((dir) => dir.includes('science') && !dir.includes('vendor')), dirs.join('、'))
  })
  check('预设技能根里的目录都存在（用户空根除外）', () => {
    const missing = (skillsApi.body.preset?.roots ?? [])
      .filter((row) => !row.exists && String(row.dir).includes('science'))
      .map((row) => row.dir)
    assert.equal(missing.length, 0, missing.join('、'))
  })
  check('vendor 技能数 ≥ 60', () => assert.ok((skillsApi.body.counts?.vendor ?? 0) >= 60, `实际 ${skillsApi.body.counts?.vendor}`))
  check('会话里应有 = 随包 + vendor + 用户', () => {
    const counts = skillsApi.body.counts ?? {}
    assert.equal(counts.sessionExpect, (counts.bundled ?? 0) + (counts.vendor ?? 0) + (counts.user ?? 0))
  })
  check('目录 token 估算有上限（< 12000）', () => {
    const tokens = skillsApi.body.catalog?.session?.approxTokens ?? 0
    assert.ok(tokens > 0 && tokens < 12000, `估算 ${tokens}`)
  })

  const skillsCheck = await fetch(`${base}/deepscient/api/skills/check`, { method: 'POST' })
  const checkBody = await skillsCheck.json()
  check('skills/check 200', () => assert.equal(skillsCheck.status, 200))
  check('已装技能全部通过', () => assert.equal(checkBody.ok, true, JSON.stringify(checkBody).slice(0, 300)))
  check('manifest 全部 pin 住', () => assert.equal(checkBody.manifest?.pinned, checkBody.manifest?.rows))
  check('skills 不收 POST', () =>
    fetch(`${base}/deepscient/api/skills`, { method: 'POST' }).then((res) => assert.equal(res.status, 405)))

  // MCP：默认关，声明行只认非注释内容（注释里写着 Python 版示例）
  const mcpPatch = join(pkgDir, 'mcp.patch.yml')
  check('mcp.patch.yml 在包里', () => assert.ok(existsSync(mcpPatch)))
  const mcpText = readFileSync(mcpPatch, 'utf8')
  check('两行 MCP 服务器都声明了 serverName', () => {
    const live = mcpText.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join('\n')
    const names = [...live.matchAll(/serverName:\s*([A-Za-z0-9_-]+)/g)].map((m) => m[1])
    assert.deepEqual(names, ['papers', 'pubmed'])
  })
  check('两行都 failOnStartupError: false（连不上不拖死启动）', () => {
    const live = mcpText.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join('\n')
    assert.equal((live.match(/failOnStartupError:\s*false/g) ?? []).length, 2)
  })
  check('health 说 MCP 默认关且声明了 papers/pubmed', () => {
    assert.equal(health.body.mcp?.enabled, false, JSON.stringify(health.body.mcp))
    const names = (health.body.mcp?.declared ?? []).map((row) => row.serverName)
    assert.deepEqual(names, ['papers', 'pubmed'], names.join('、'))
  })
  check('health 报运行时 MCP 工具数（默认关就该是 0）', () => {
    const tools = health.body.mcp?.tools
    assert.ok(tools && typeof tools === 'object', JSON.stringify(health.body.mcp))
    assert.equal(tools.count, 0)
    assert.deepEqual(tools.servers, [])
  })
  check('两行都给子进程指定了独立 npmrc（死代理机器上 npx 会瞬间失败）', () => {
    const live = mcpText.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join('\n')
    assert.equal((live.match(/npm_config_userconfig: !!js dshHomePath\('science\/mcp-npmrc'\)/g) ?? []).length, 2)
  })
  check('没有把 !!js process.env.X 塞进 env（undefined 会让整行装不上）', () => {
    const live = mcpText.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join('\n')
    assert.ok(!/env:\s*\n(\s+\S+:.*\n)*?\s+\S+: !!js process\.env\./.test(live), 'env 里还有 !!js process.env')
  })
  check('启动器会生成 mcp-npmrc（已存在不覆盖）', () => {
    const launch = readFileSync(join(pkgDir, 'bin', 'launch.ps1'), 'utf8')
    assert.match(launch, /mcp-npmrc/)
    assert.match(launch, /Test-Path \$mcpNpmrc/)
    assert.match(launch, /proxy=/)
  })
  check('MCP 自检脚本在位且能说明用法', () => {
    const probe = readFileSync(join(pkgDir, 'scripts', 'probe-mcp.mjs'), 'utf8')
    assert.match(probe, /paper-search-mcp-nodejs/)
    assert.match(probe, /pubmed-mcp-server/)
    assert.match(probe, /tools\/list/)
  })
  check('health 报出技能计数', () => {
    const skills = health.body.skills ?? {}
    assert.ok(skills.vendor >= 0 && skills.bundled >= 17, JSON.stringify(skills))
    assert.equal(skills.sessionExpect, (skills.bundled ?? 0) + (skills.vendor ?? 0) + (skills.user ?? 0))
  })
  check('启动器只在 DSH_ENABLE_MCP=1 时叠加 MCP 层', () => {
    const launch = readFileSync(join(pkgDir, 'bin', 'launch.ps1'), 'utf8')
    assert.match(launch, /DSH_ENABLE_MCP/)
    assert.match(launch, /mcp\.patch\.yml/)
  })
}

section('建课题接口')
const emptyTitle = await fetch(`${base}/deepscient/api/projects`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: '   ' }),
})
const emptyTitleBody = await emptyTitle.json()
check('空标题 400', () => assert.equal(emptyTitle.status, 400))
check('空标题带错误码', () => assert.equal(emptyTitleBody.error, 'title-required'))
const badProjectMethod = await fetch(`${base}/deepscient/api/projects`, { method: 'DELETE' })
check('projects 不收 DELETE', () => assert.equal(badProjectMethod.status, 405))

const manifestRes = await fetch(`${base}/manifest.webmanifest`)
const manifestBody = await manifestRes.json()
check('manifest 被接管', () => assert.equal(manifestBody.short_name, 'DeepScient'))

if (token) {
  section('首页品牌（需要 token）')
  // dsh 的 token 走一次 302 + set-cookie，fetch 不会自己带上 cookie，这里手动接一次。
  const auth = await fetch(`${base}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
  const cookie = (auth.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  check('token 换来一份会话 cookie', () => assert.ok(cookie.length > 0, `status=${auth.status} location=${auth.headers.get('location')}`))

  const page = await fetch(`${base}/`, { headers: cookie ? { cookie } : {}, redirect: 'manual' })
  const html = await page.text()
  check('带 token 的首页 200', () => assert.equal(page.status, 200))
  check('标题是 DeepScient', () => assert.match(html, /<title>DeepScient · 科研工作台<\/title>/))
  check('页面里没有旧标题', () => assert.ok(!/DeepSeek Harness/.test(html)))
  check('启动图里有我们的客户端模块', () => assert.match(html, /@local\/deepscient\/client\.js/))

  // 不猜插件文件的 URL 形状：直接用页面自己 preload 的那一条 combo 地址去取。
  const hrefMatch = html.match(/href="(plugins\/\?\?[^"]*@local\/deepscient\/client\.js[^"]*)"/)
  check('启动图里有一条含我们模块的 preload 地址', () => assert.ok(hrefMatch, '没找到 preload href'))
  const comboUrl = `${base}/${hrefMatch[1].replace(/&amp;/g, '&')}`
  const combo = await fetch(comboUrl, { headers: cookie ? { cookie } : {}, redirect: 'manual' })
  const src = await combo.text()
  check('combo 端点把模块服务出来', () => assert.equal(combo.status, 200, `status=${combo.status}`))
  check('服务出来的内容含我们的模块头', () => assert.match(src, /window\.__ModuleLoader__\.load\(\{/))
  check('服务出来的内容声明了我们的 id', () => assert.match(src, /id:\s*'@local\/deepscient'/))
} else {
  process.stdout.write('\n（跳过首页品牌与启动图检查：没给 --token）\n')
}

/* ── 汇总 ───────────────────────────────────────────────────────────────── */

process.stdout.write(`\n通过 ${passed} 项`)
if (failures.length) {
  process.stdout.write(`，失败 ${failures.length} 项\n`)
  for (const f of failures) process.stdout.write(`  ✗ ${f}\n`)
  process.exit(1)
}
process.stdout.write('，全部通过\n')
process.stdout.write(`仓库根：${repoRoot}\n`)
