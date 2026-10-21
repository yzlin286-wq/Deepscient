#!/usr/bin/env node
/**
 * 科研版端到端实测：用**现有 key** 跑一个真课题，证明「模型 → 记账 → 建课题 → 落库」这条链真的通。
 *
 *   node deepscient/scripts/e2e-science-run.mjs          # dry-run：只打印将要执行的命令
 *   node deepscient/scripts/e2e-science-run.mjs --run    # 真跑（会消耗 token）
 *   node deepscient/scripts/e2e-science-run.mjs --run --token <3081 的 token>
 *
 * 分工（这点很重要，别指望一条命令全包）：
 *   - 模型那一段走 headless：同一个 dsh、同一份 $DSH_HOME、同一个模型层，
 *     一次成型、退出码即结论，适合当验收闸门。但 headless 是一次性 runner，
 *     **按设计不组合 agent preset**，所以 science_* 那些预设平面的工具在那儿不存在。
 *   - 预设平面这一段打 3081 那个活实例：/presets/inspect 看每一行插件的状态，
 *     POST /projects 建课题（引导里「建课题」按的就是这条路），再去库里按题目读回。
 *
 * 失败一律非 0 退出，并打印是哪一条断言没过。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = resolve(here, '..')
const repoRoot = resolve(pkgDir, '..')
const argv = process.argv.slice(2)
const RUN = argv.includes('--run')
const TIMEOUT_MS = Number(argv[argv.indexOf('--timeout') + 1]) > 0 ? Number(argv[argv.indexOf('--timeout') + 1]) : 600_000
const BASE = (argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.DEEPSCIENT_URL || 'http://127.0.0.1:3081').replace(/\/$/, '')
const TOKEN = argv.includes('--token') ? argv[argv.indexOf('--token') + 1] : process.env.DEEPSCIENT_TOKEN || ''

const HOME = process.env.DEEPSCIENT_HOME || join(homedir(), '.deepscient')
const PROFILE = process.env.E2E_PROFILE || 'science-run'
const PROFILE_DIR = join(HOME, 'profiles', PROFILE)
const PATCH = join(pkgDir, 'local.patch.yml')
const SCIENCE_PKG = join(repoRoot, 'dsh-science')
const WORKDIR = join(HOME, 'science', 'e2e')

// headless 里没有预设，就别点 science_* 的名字了 —— 点不到，模型只会回一句「没有这些工具」。
// 这里要验的是：这套模型层在这个 home 下能正常回话、能被记账。
const TASK = [
  '这是上线前的一次链路自检，只做两件事：',
  '1) 用一句话说明你是哪个模型、此刻的工作目录是什么；',
  '2) 把「睡眠剥夺是否缩短工作记忆容量」这个研究问题改写成一个更严谨的表述。',
  '不要写文件、不要跑命令、不要联网。',
].join(' ') // 拼成一行：cmd.exe 传参时换行会被截断

function log(line) {
  process.stdout.write(`${line}\n`)
}
function fail(line) {
  process.stderr.write(`FAIL  ${line}\n`)
  process.exitCode = 1
}

/**
 * dsh 入口：优先直接跑 CLI 的 JS 入口。
 *
 * 不走 dsh.cmd —— 安装路径里有空格（"DeepSeek Harness"），cmd /c 会把路径截断成
 * 「用户目录下带空格的安装路径」，报一句与环境毫无关系的「不是内部或外部命令」。
 */
function resolveCli() {
  const custom = process.env.DSH_CLI
  if (custom && existsSync(custom)) {
    return /\.(cmd|bat)$/i.test(custom)
      ? { command: 'cmd', argv: ['/c', custom], label: custom }
      : { command: custom, argv: [], label: custom }
  }
  const roots = []
  if (process.env.LOCALAPPDATA) {
    roots.push(join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources'))
  }
  for (const root of roots) {
    for (const rel of [
      join('app', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'),
      join('app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'),
    ]) {
      const entry = join(root, rel)
      if (existsSync(entry)) return { command: process.execPath, argv: [entry], label: entry }
    }
  }
  return { command: 'dsh', argv: [], label: 'dsh' }
}

/**
 * 从本机已有的那份凭据里取 key：只读、只在内存里、不打印。
 * 参考顺序：环境变量 → ~/.dsh/.credentials.yaml 的 refs → ~/.deepscient 自己的 refs。
 */
function readRefs(file) {
  if (!existsSync(file)) return {}
  const out = {}
  let inRefs = false
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\S/.test(raw)) {
      inRefs = /^refs:/.test(raw)
      continue
    }
    if (!inRefs) continue
    const m = /^\s{2}([A-Za-z0-9_]+):\s*(.+?)\s*$/.exec(raw)
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return out
}

function resolveKey() {
  const names = ['CCAGENT_API_KEY']
  for (const name of names) {
    if (process.env[name]) return { name, value: process.env[name], source: 'env' }
  }
  for (const file of [join(homedir(), '.dsh', '.credentials.yaml'), join(HOME, '.credentials.yaml')]) {
    const refs = readRefs(file)
    for (const name of names) {
      if (refs[name]) return { name, value: refs[name], source: file }
    }
  }
  return null
}

/**
 * headless 档：base + headless + 科研包。
 * 不跑 pnpm：profile 目录里放一个指向仓库的 junction 就够了，loader 按名字解析得到。
 */
function ensureProfile() {
  mkdirSync(PROFILE_DIR, { recursive: true })
  const pkg = {
    name: `dsh-profile-${PROFILE}`,
    private: true,
    dependencies: { '@local/dsh-science': `link:${SCIENCE_PKG.replace(/\\/g, '/')}` },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@local/dsh-science'] } },
  }
  const pkgPath = join(PROFILE_DIR, 'package.json')
  const text = JSON.stringify(pkg, null, 2)
  if (!existsSync(pkgPath) || readFileSync(pkgPath, 'utf8') !== text) writeFileSync(pkgPath, `${text}\n`)

  // headless 档没有 agent-preset 注册表，科研预设会一直 pending（启动时报
  // "1 entry did not activate"）。补一行注册表，让 host 平面干净地装起来；
  // 预设平面的工具本来就由 web 实例的 /presets/inspect 验证（headless 不组合预设）。
  //
  // 技能根没法在这里补：host 平面已经有 filesystem provider，再加一个就是
  // "a skill provider named filesystem is already registered"。技能可见性
  // 走 web 实例那条路验（见第五步之后的 skills 段）。
  const registryPatch = [
    '# headless 档缺 agent-preset 注册表：没有它科研预设一直 pending。',
    '- insert:',
    '    - id: agent-preset-registry',
    "      name: '@deepseek-ai/dsh-agent-preset-registry'",
    '      config:',
    '        default: standard',
    '',
  ].join('\n')
  const registryPath = join(PROFILE_DIR, 'headless.patch.yml')
  if (!existsSync(registryPath) || readFileSync(registryPath, 'utf8') !== registryPatch) {
    writeFileSync(registryPath, registryPatch)
  }

  const link = join(PROFILE_DIR, 'node_modules', '@local', 'dsh-science')
  if (existsSync(link)) return
  mkdirSync(dirname(link), { recursive: true })
  const made =
    process.platform === 'win32'
      ? spawnSync('cmd', ['/c', 'mklink', '/J', link, SCIENCE_PKG], { stdio: 'ignore' }).status === 0
      : spawnSync('ln', ['-s', SCIENCE_PKG, link], { stdio: 'ignore' }).status === 0
  if (!made) throw new Error(`建不了 profile 依赖链接：${link}`)
}

function listSessionFiles() {
  const root = join(HOME, 'sessions')
  const out = []
  const walk = (dir, depth = 0) => {
    if (depth > 4 || !existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const st = statSync(full)
      // dsh 落盘的是 session.v4.jsonl.zstd，按扩展名白名单会一个都数不到。
      if (st.isDirectory()) walk(full, depth + 1)
      else if (/^session\..*\.jsonl(\.zstd)?$/.test(name)) out.push(full)
    }
  }
  walk(root)
  return out
}

/** 直接问本包的用量模块：它读的就是会话日志，和界面上那颗胶囊同口径。 */
async function usageToday() {
  process.env.DSH_HOME = HOME
  const { usageRange } = await import('../host/usage.js')
  return usageRange({ range: 'today', refresh: true })
}

async function main() {
  const cli = resolveCli()
  const dshArgs = [
    '--profile', PROFILE,
    ...(existsSync(join(PROFILE_DIR, 'headless.patch.yml')) ? ['--patch', join(PROFILE_DIR, 'headless.patch.yml')] : []),
    ...(existsSync(PATCH) ? ['--patch', PATCH] : []),
    TASK,
  ]

  const key = resolveKey()

  log('== 科研版端到端实测')
  log(`dsh        : ${cli.label}`)
  log(`DSH_HOME   : ${HOME}`)
  log(`profile    : ${PROFILE}（${PROFILE_DIR}）`)
  log(`模型层     : ${existsSync(PATCH) ? PATCH : '（没有 local.patch.yml，将用默认模型）'}`)
  log(`key        : ${key ? `${key.name}（来自 ${key.source}，不打印值）` : '没找到（CCAGENT_API_KEY）'}`)
  log(`活实例     : ${BASE}${TOKEN ? '（带 token）' : '（不带 token，只读端点够用）'}`)
  log(`工作目录   : ${WORKDIR}`)

  if (!RUN) {
    log('')
    log('dry-run：什么都没执行。真跑请加 --run（会消耗 token）。')
    log(`将执行：${cli.command} ${[...cli.argv, ...dshArgs.slice(0, -1)].join(' ')} "<五步任务>"`)
    return
  }

  if (!key) {
    fail('没找到 CCAGENT_API_KEY：先 export，或让 ~/.dsh/.credentials.yaml 的 refs 里有它')
    return
  }
  ensureProfile()
  mkdirSync(WORKDIR, { recursive: true })

  const before = listSessionFiles().length
  const started = Date.now()
  log('')
  log('跑起来了……')
  // 不走 cmd.exe：参数里带空格和中文，交给它只会多一层转义麻烦。
  const out = spawnSync(cli.command, [...cli.argv, ...dshArgs], {
    cwd: WORKDIR,
    timeout: TIMEOUT_MS,
    encoding: 'utf8',
    env: {
      ...process.env,
      DSH_HOME: HOME,
      [key.name]: key.value,
    },
  })
  const stdout = out.stdout ?? ''
  const stderr = out.stderr ?? ''
  log(`退出码 ${out.status}（${Math.round((Date.now() - started) / 1000)}s，stdout ${stdout.length} 字，stderr ${stderr.length} 字）`)
  if (out.error) fail(`进程起不来：${out.error.message}`)
  // 模型的回答与工具轨迹是判断依据，失败时要看得到；截尾免得刷屏。
  if (stdout.trim()) log(`--- stdout（末 1200 字）---\n${stdout.trim().slice(-1200)}`)
  if (out.status !== 0) fail(`dsh 非 0 退出：${(stderr || stdout).slice(-800)}`)

  // 一、模型真的回了话：会话日志里出现新文件。
  const after = listSessionFiles()
  if (after.length <= before) fail(`没有新会话日志（${before} → ${after.length}）`)
  const fresh = after.filter((f) => { try { return Date.now() - statSync(f).mtimeMs < TIMEOUT_MS } catch { return false } })

  // 二、科研 host 层真的装上了：知识转化层的行在启动时自报注册数量。
  //     注意 headless 是「一次性 runner」，按设计不组合 agent preset，
  //     所以 science_* 这些**预设平面**的工具在这里必然看不到 —— 它们由 web 实例的
  //     预设体检（/deepscient/api/presets/inspect）证明，这一段只证明 host 平面。
  const hostLayer = /science: 知识转化层工具注册完成（(\d+) 个）/.exec(stderr) ?? /science: 知识转化层工具注册完成（(\d+) 个）/.exec(stdout)
  if (!hostLayer) fail('科研 host 层没有自报注册（说明 @local/dsh-science 没被装载）')
  else log(`科研 host 层：知识转化层注册 ${hostLayer[1]} 个工具`)
  const presetNote = /does not compose|不组合/.test(stderr)
  if (presetNote) log('（headless 不组合 agent preset：预设平面的工具由 /presets/inspect 验证）')

  // 三、token 计费真的记上了：这是「复用现有 key」能被验证的唯一硬证据。
  const usage = await usageToday()
  const totals = usage.totals ?? {}
  if (!(totals.totalTokens > 0)) fail(`今日 tokens 仍是 ${totals.totalTokens ?? 0}：这次调用没有被记账`)
  else log(`今日 tokens：${totals.totalTokens}（输入 ${totals.inputTokens ?? 0} / 缓存 ${totals.cacheReadTokens ?? 0} / 输出 ${totals.outputTokens ?? 0}）`)

  const byModel = (usage.byModel ?? []).map((row) => `${row.provider}/${row.model}`)
  if (byModel.length === 0) fail('用量里没有按模型归因（byModel 为空）')
  else log(`归因：${byModel.join('、')}`)

  // 四、建课题 + 读回：走的是 3081 那个活实例自己的写端点 —— 也就是引导里「建课题」
  //     按的那条路（createProjectRoute → dsh-science 的 createProject → SQLite）。
  //     headless 不组合预设，science_project_open 在那边根本不存在，所以这一步必须在
  //     web 实例上验；验完再去库里按题目找一次，确认 HTTP 200 不是嘴上说说。
  const title = `E2E 链路自检 ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`
  let created = null
  try {
    const res = await fetch(`${BASE}/deepscient/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(TOKEN ? { 'x-dsh-token': TOKEN } : {}) },
      body: JSON.stringify({ title, domain: 'psychology', question: '端到端链路是否可用：自检题，跑完即可删除。' }),
    })
    const body = await res.json().catch(() => null)
    if (res.status !== 200 || !body?.ok) fail(`建课题失败（HTTP ${res.status}）：${body?.message ?? '没有响应体'}`)
    created = body.project ?? null
  } catch (error) {
    fail(`连不上 ${BASE}：先起来 3081 再跑（${error.message}）`)
  }
  if (created) log(`建课题：${created.id} — ${created.title}`)

  process.env.DSH_HOME = HOME
  try {
    const { science, resetScienceCache } = await import('../host/science.js')
    resetScienceCache()
    const sci = await science()
    if (!sci.available) fail(`科研库读不到：${sci.reason}`)
    else {
      const row = sci.store.db.prepare('SELECT id, title, created_at FROM project WHERE title = ?').get(title)
      if (!row) {
        const latest = sci.store.db.prepare('SELECT title FROM project ORDER BY created_at DESC LIMIT 1').get()
        fail(`库里没有刚建的课题（最新是：${latest?.title ?? '空'}）`)
      } else if (created && row.id !== created.id) {
        fail(`HTTP 返回的课题 id（${created.id}）和库里的（${row.id}）对不上`)
      } else log(`课题已落库：${row.id} — ${row.title}`)
    }
  } catch (error) {
    fail(`读科研库失败：${error.message}`)
  }

  // 五、预设体检：这是「开会话为什么失败」的真正探照灯。
  try {
    const res = await fetch(`${BASE}/deepscient/api/presets/inspect`)
    const body = await res.json()
    const resolved = body.resolved
    if (!resolved) fail('预设体检没有 resolved')
    else if (resolved.broken) fail(`预设是坏的：${resolved.broken}`)
    else {
      const rows = (body.presets ?? []).find((p) => p.id === resolved.id)?.rows ?? []
      const bad = rows.filter((r) => r.fiberState === 'failed' || r.fiberState === 'pending')
      if (bad.length) fail(`预设里有 ${bad.length} 行没起来：${bad.map((r) => `${r.moduleName}(${r.fiberState})`).join('、')}`)
      else {
        const active = rows.filter((r) => r.fiberState === 'active').length
        const off = rows.length - active
        log(`预设体检：${resolved.id} 共 ${rows.length} 行，没有 failed/pending（active ${active} 行${off ? `，另 ${off} 行按条件关闭` : ''}）`)
      }

    }
  } catch (error) {
    fail(`预设体检失败：${error.message}`)
  }

  log(`新会话日志 ${fresh.length} 个；工作目录 ${WORKDIR}`)

  // 六、技能这条链路：这是本版新增的一整块，必须能在活实例上验，不能靠「文件躺着」。
  //     三件事分开验：
  //       a) 预设在**会话里**扫哪些根（读预设自己的 readDocument，不是猜）；
  //       b) 磁盘上那些 vendor 技能符不符合 dsh 的 frontmatter 规则（与 --check 同一套）；
  //       c) MCP 默认必须是关的，不能悄悄把外部进程带起来。
  try {
    const skills = await (await fetch(`${BASE}/deepscient/api/skills`)).json()
    const presetRoots = (skills.preset?.roots ?? []).map((row) => row.dir)
    // 用户自己的 skills 根允许不存在（空根），随包与 vendor 必须真实存在
    const missingRoot = presetRoots.filter((dir) => !existsSync(dir) && dir.includes('science'))
    if (!skills.preset?.available) fail(`读不到预设的技能根（${skills.preset?.error ?? '未知'}）`)
    else if (!presetRoots.some((dir) => dir.includes('skills-vendor'))) fail(`会话的技能根里没有 vendor 目录：${presetRoots.join('、')}`)
    else if (missingRoot.length) fail(`技能根里有不存在的目录：${missingRoot.join('、')}`)
    else log(`会话技能根 ${presetRoots.length} 个（含 vendor）：${presetRoots.map((d) => d.split(/[\\/]/).slice(-1)[0]).join(' → ')}`)

    if ((skills.counts?.vendor ?? 0) < 80) fail(`vendor 技能只有 ${skills.counts?.vendor ?? 0} 条，少于预期的 80+`)
    else if ((skills.counts?.sessionExpect ?? 0) < 90) fail(`会话里应有 ${skills.counts?.sessionExpect ?? 0} 条技能，少于 90`)
    else log(`技能数：vendor ${skills.counts.vendor} / 随包 ${skills.counts.bundled} / 会话里应有 ${skills.counts.sessionExpect}（目录约 ${skills.catalog?.session?.approxTokens} tokens）`)

    const check = await (await fetch(`${BASE}/deepscient/api/skills/check`, { method: 'POST' })).json()
    if (!check.ok) fail(`技能校验没过：${[...(check.failed ?? []).map((r) => `${r.name}(${r.reason})`), ...(check.problems ?? [])].slice(0, 3).join('；')}`)
    else log(`技能校验：${check.passed}/${check.checked} 通过，manifest ${check.manifest?.pinned}/${check.manifest?.rows} 条已 pin`)

    const health = await (await fetch(`${BASE}/deepscient/api/health`)).json()
    const declared = (health.mcp?.declared ?? []).map((row) => row.serverName)
    if (health.mcp?.enabled) fail('MCP 默认应该是关的，但 /health 说开着')
    else if (declared.length !== 2 || !declared.includes('papers') || !declared.includes('pubmed')) fail(`MCP 声明行不对：${declared.join('、') || '空'}`)
    else log(`MCP 默认关，声明了 ${declared.join('、')}（DSH_ENABLE_MCP=1 才起进程）`)
  } catch (error) {
    fail(`技能链路验不过：${error.message}`)
  }

  if (process.exitCode) log('（有断言没过，见上）')
  else log('\nPASS 端到端链路通：真 key 真模型真回答、host 层装上了、课题建好并落库、预设全绿、token 记账非零、技能与 MCP 配置都对得上。')
}

await main()
