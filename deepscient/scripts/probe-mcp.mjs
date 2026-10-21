/**
 * MCP 服务器自检：绕开 dsh，直接用 stdio 跟一个 MCP 服务器对话。
 *
 * 为什么要有这个脚本：MCP 层开着但一个工具都没注册时，`/health` 只会告诉你「0 个」，
 * 看不出是 npx 拉不到包、代理拦截、还是服务器自己起不来。这个脚本把子进程的 stderr 与
 * 握手过程直接打出来，一眼定位。
 *
 * 用法：
 *   node deepscient/scripts/probe-mcp.mjs papers
 *   node deepscient/scripts/probe-mcp.mjs pubmed
 *   node deepscient/scripts/probe-mcp.mjs -- npm_config_userconfig=... npx -y <pkg>   # 自定义命令
 *
 * 退出码：0 有工具；3 连上了但没工具；2 起不来；1 握手失败。
 */
import { spawn as nodeSpawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SERVERS = {
  papers: { command: 'npx', args: ['-y', 'paper-search-mcp-nodejs'] },
  pubmed: { command: 'npx', args: ['-y', '@cyanheads/pubmed-mcp-server'] },
}

/** dsh 的 stdio transport 用 cross-spawn（它能解析 Windows 上的 npx.cmd）；探针走同一个库。 */
function resolveSpawn() {
  const candidates = [
    join(
      process.env.LOCALAPPDATA ?? '',
      'Programs',
      'DeepSeek Harness',
      'resources',
      'app',
      'dsh',
      'node_modules',
      'cross-spawn',
      'index.js',
    ),
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      const loaded = createRequire(candidate)(candidate)
      const spawn = typeof loaded === 'function' ? loaded : loaded.spawn
      if (typeof spawn === 'function') return { spawn, source: 'cross-spawn' }
    } catch {
      /* 换下一个 */
    }
  }
  return { spawn: nodeSpawn, source: 'node:child_process（npx 在 Windows 上可能 ENOENT）' }
}

/** 启动器生成的 npmrc：机器上留着死代理时，npx 会瞬间失败。 */
function defaultEnv() {
  const npmrc = join(process.env.DEEPSCIENT_HOME ?? join(homedir(), '.deepscient'), 'science', 'mcp-npmrc')
  if (!existsSync(npmrc)) return { env: { ...process.env }, npmrc: null }
  return { env: { ...process.env, npm_config_userconfig: npmrc }, npmrc }
}

const argv = process.argv.slice(2)
const sep = argv.indexOf('--')
const preset = sep >= 0 ? null : SERVERS[argv[0] ?? 'papers']
const command = sep >= 0 ? argv[sep + 1] : preset?.command
const args = sep >= 0 ? argv.slice(sep + 2) : (preset?.args ?? [])

if (!command) {
  console.log(`用法：node ${process.argv[1]} <${Object.keys(SERVERS).join('|')}>\n      node ${process.argv[1]} -- <command> [args...]`)
  process.exit(1)
}

const { spawn, source } = resolveSpawn()
const { env, npmrc } = defaultEnv()
console.log(`命令      : ${command} ${args.join(' ')}`)
console.log(`spawn 实现: ${source}`)
console.log(`npmrc     : ${npmrc ?? '（没找到，沿用系统 npm 配置）'}`)

const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, env })

let buffer = ''
let stderr = ''
const pending = new Map()

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    try {
      const message = JSON.parse(line)
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message)
        pending.delete(message.id)
      }
    } catch {
      console.log('非 JSON 输出:', line.slice(0, 160))
    }
  }
})
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString('utf8')
})
child.on('error', (error) => {
  console.log(`spawn 失败: ${error.code ?? ''} ${error.message}`)
  process.exit(2)
})
child.on('close', (code, signal) => {
  if (stderr.trim()) {
    console.log(`子进程退出 code=${code} signal=${signal}；stderr 尾部：`)
    console.log(stderr.trim().split('\n').slice(-8).join('\n'))
  }
})

const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
const request = (message, timeoutMs = 120000) =>
  new Promise((resolve, reject) => {
    pending.set(message.id, resolve)
    send(message)
    const timer = setTimeout(() => reject(new Error(`超时：${message.method}（${timeoutMs}ms）`)), timeoutMs)
    timer.unref()
  })

const run = async () => {
  const started = Date.now()
  const init = await request({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'deepscient-probe', version: '0.0.0' } },
  })
  if (init.error) throw new Error(`initialize 返回错误：${JSON.stringify(init.error)}`)
  console.log(`initialize ok（${Date.now() - started}ms）：`, JSON.stringify(init.result?.serverInfo ?? {}))
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const list = await request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  const tools = list.result?.tools ?? []
  console.log(`tools/list: ${tools.length} 个`)
  for (const tool of tools.slice(0, 12)) console.log('  -', tool.name, '—', String(tool.description ?? '').slice(0, 70))
  if (tools.length > 12) console.log(`  … 还有 ${tools.length - 12} 个`)
  child.kill()
  process.exit(tools.length ? 0 : 3)
}

run().catch((error) => {
  console.log('失败:', error.message)
  if (stderr.trim()) console.log('stderr:\n' + stderr.trim().split('\n').slice(-10).join('\n'))
  child.kill()
  process.exit(1)
})
