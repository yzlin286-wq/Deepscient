/**
 * @local/dsh-science —— 科研工具集（preset 平面）。
 *
 * 这些行只往 `tools` 注册模型可见工具，自身不发布服务，因此不需要 isolate realm；
 * 它们软取 host 平面发布的 `ctx.scienceKit`。
 *
 * `@deepseek-ai/dsh-tools` 必须从**运行时 dsh 安装位置**解析，不能静态 import：
 * profile 的 node_modules 里通常没有 dsh 自身依赖，静态 import 失败会让 preset 行的
 * fiber 停在 never-started，整个「科研模式」被下拉过滤掉。
 */
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** 安全地列举目录名；不存在返回空数组。 */
function listDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
  } catch { return [] }
}

/** pnpm 把依赖放在 .pnpm/<name>@<version>/node_modules/<name>，扫描一层即可。 */
function pnpmCandidates(nodeModules, packageName) {
  const out = []
  const flat = packageName.replace('/', '+')
  for (const entry of listDirs(join(nodeModules, '.pnpm'))) {
    if (!entry.startsWith(flat + '@')) continue
    out.push(join(nodeModules, '.pnpm', entry, 'node_modules', packageName, 'package.json'))
  }
  return out
}

/**
 * 收集可能的「dsh 安装根」，逐个尝试 require。
 *
 * 真实 host 进程里 `process.argv[1]` 指向 dsh 的 bin，第一条就能命中；
 * 独立脚本 / 桌面端 / 换过安装方式的情况下靠 profile 的 node_modules、
 * pnpm store 与 npx 缓存兜底。
 */
export function candidateDshPackages() {
  const list = []
  const add = (pkg) => {
    if (!pkg) return
    const normalized = String(pkg).replace(/\\/g, '/')
    if (!list.includes(normalized)) list.push(normalized)
  }
  const addNodeModules = (nodeModules) => {
    if (!nodeModules) return
    add(join(nodeModules, '@deepseek-ai', 'dsh', 'package.json'))
    add(join(nodeModules, '@deepseek-ai', 'dsh-tools', 'package.json'))
    for (const pkg of pnpmCandidates(nodeModules, '@deepseek-ai/dsh-tools')) add(pkg)
  }
  const fromHome = (home) => {
    if (!home) return
    add(join(home, 'package.json'))
    for (const profile of listDirs(join(home, 'profiles'))) {
      add(join(home, 'profiles', profile, 'package.json'))
      addNodeModules(join(home, 'profiles', profile, 'node_modules'))
    }
    /* dsh 的副本偶尔直接装在 $DSH_HOME/node_modules */
    addNodeModules(join(home, 'node_modules'))
  }
  fromHome(process.env.DSH_HOME)
  fromHome(join(homedir(), '.dsh'))

  try {
    const bin = process.argv[1]
    if (bin) {
      const dir = dirname(bin)
      add(join(dir, '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
      add(join(dir, '..', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
      add(join(dir, '..', 'node_modules', '@deepseek-ai', 'dsh-tools', 'package.json'))
      /* Windows 全局安装：<prefix>/node_modules/@deepseek-ai/dsh */
      add(join(dir, '..', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
    }
  } catch { /* ignore */ }

  /* npx 缓存：%LOCALAPPDATA%\npm-cache\_npx\<hash>\node_modules */
  const cacheRoots = [
    process.env.npm_config_cache,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'npm-cache') : '',
    join(homedir(), '.npm', '_npx'),
  ].filter(Boolean)
  for (const cache of cacheRoots) {
    const npx = cache.endsWith('_npx') ? cache : join(cache, '_npx')
    for (const entry of listDirs(npx)) {
      addNodeModules(join(npx, entry, 'node_modules'))
    }
  }

  add(join(process.cwd(), 'package.json'))
  return list
}

/** 从候选位置解析 `@deepseek-ai/dsh-tools` 包。 */
export function resolveDshToolsPackage() {
  const failures = []
  for (const pkg of candidateDshPackages()) {
    try {
      if (!pkg || !existsSync(pkg)) continue
      return createRequire(pkg)('@deepseek-ai/dsh-tools')
    } catch (error) {
      failures.push(`${pkg}: ${error && error.message ? error.message : String(error)}`)
    }
  }
  const detail = failures.slice(0, 3).join(' | ')
  throw new Error('dsh-science/tools: cannot resolve @deepseek-ai/dsh-tools from the running dsh installation'
    + (detail ? ` (tried: ${detail})` : ''))
}

/** 从包内取 defineTool。 */
function loadDefineTool() {
  const mod = resolveDshToolsPackage()
  const fn = mod && (mod.defineTool || (mod.default && mod.default.defineTool))
  if (typeof fn !== 'function') {
    throw new Error('dsh-science/tools: @deepseek-ai/dsh-tools has no defineTool export')
  }
  return fn
}

const defineTool = loadDefineTool()

/** Cordis 插件名。 */
export const name = 'dsh-science-tools'

/** 只依赖工具注册表。 */
export const inject = ['tools']

/** 便于测试：探测单个可执行文件。 */
export async function probeBinary(command, versionArgs = ['--version']) {
  try {
    const { stdout, stderr } = await execFileAsync(command, versionArgs, {
      timeout: 4000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    })
    const text = String(stdout || stderr || '').trim().split(/\r?\n/)[0] || ''
    return { command, ok: true, version: text.slice(0, 160) }
  } catch (error) {
    const message = error && error.message ? String(error.message).split('\n')[0] : 'unavailable'
    return { command, ok: false, error: message.slice(0, 160) }
  }
}

/** 统计技能目录（支持一层多目录 + 平铺文件两种形态）。 */
export function countSkills(dir) {
  if (!existsSync(dir)) return { dir, count: 0, names: [] }
  const names = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (existsSync(join(dir, entry.name, 'SKILL.md'))) names.push(entry.name)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      names.push(entry.name.replace(/\.md$/i, ''))
    }
  }
  return { dir, count: names.length, names: names.sort() }
}

/** 读取 kit 服务；没有就走同样的解析规则自己算一份。 */
function kitOf(ctx) {
  try {
    const kit = ctx.get('scienceKit')
    if (kit && kit.root) return kit
  } catch { /* not mounted yet */ }
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return { root: join(home, 'science'), paths: {}, source: 'fallback' }
}

/**
 * @param ctx - 插件上下文（含 tools 注册表）。
 */
export function apply(ctx) {
  const kit = () => kitOf(ctx)

  ctx.tools.register(defineTool({
    name: 'science_preflight',
    description:
      'Check the research workspace before any literature or experiment work: data root, '
      + 'schema version, bundled skills, and whether python/git/pandoc/latex exist. '
      + 'Run this once at the start of a research session and report missing items in one batch.',
    parameters: {
      deep: {
        type: 'boolean',
        description: 'Also probe the local toolchain binaries (python, git, pandoc, latex). Defaults to true.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          ok: { type: 'boolean', required: true },
          schemaVersion: { type: 'integer', required: true },
          skills: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              dir: { type: 'string', required: true },
              count: { type: 'integer', required: true },
              names: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
          binaries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                command: { type: 'string', required: true },
                ok: { type: 'boolean', required: true },
                version: { type: 'string' },
                error: { type: 'string' },
              },
            },
          },
          missing: { type: 'array', required: true, items: { type: 'string' } },
          notes: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        const lines = [
          `科研工作台：${value.root}`,
          `状态：${value.ok ? '就绪' : '有缺项'}；schema v${value.schemaVersion}；随包技能 ${value.skills.count} 个`,
        ]
        if (value.binaries.length > 0) {
          lines.push('工具链：' + value.binaries
            .map((b) => `${b.command}=${b.ok ? (b.version || 'ok') : '缺失'}`)
            .join(' | '))
        }
        if (value.missing.length > 0) {
          lines.push('缺项：' + value.missing.join('、'))
          lines.push('补齐方式：运行 scripts/science-setup.ps1（--check 只体检）')
        }
        if (value.notes.length > 0) lines.push('备注：' + value.notes.join('；'))
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const kitInfo = kit()
      const skillsDir = (kitInfo.paths && kitInfo.paths.skills) || join(kitInfo.root, 'skills')
      const skills = countSkills(skillsDir)
      const configPath = join(kitInfo.root, 'config.json')
      let schemaVersion = kitInfo.schemaVersion || 0
      if (!schemaVersion) {
        try {
          schemaVersion = Number(JSON.parse(readFileSync(join(kitInfo.root, 'schema_meta.json'), 'utf8')).version) || 0
        } catch { schemaVersion = 0 }
      }

      const binaries = []
      const notes = []
      if (args.deep !== false) {
        binaries.push(await probeBinary('python', ['--version']))
        binaries.push(await probeBinary('git', ['--version']))
        binaries.push(await probeBinary('pandoc', ['--version']))
        binaries.push(await probeBinary('xelatex', ['--version']))
      }
      const missing = binaries.filter((b) => !b.ok).map((b) => b.command)
      if (!existsSync(kitInfo.root)) {
        notes.push('数据根不存在，绑定的 host 行可能尚未挂载')
      } else if (!existsSync(configPath)) {
        notes.push('config.json 缺失（host 行未跑过）')
      }
      if (skills.count === 0) notes.push('随包技能为空：检查 skills/science 是否随包分发')

      return {
        root: kitInfo.root,
        ok: missing.length === 0 && existsSync(kitInfo.root),
        schemaVersion,
        skills: { dir: skills.dir, count: skills.count, names: skills.names },
        binaries,
        missing,
        notes,
      }
    },
  }))

  ctx.logger?.info?.('science: 工具已注册（science_preflight）')
}

export default { name, inject, apply }
