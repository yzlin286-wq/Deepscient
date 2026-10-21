/**
 * @local/dsh-science —— 科研版 harness 的 Host 半侧。
 *
 * 职责（M0）：
 *   1. 解析数据根（默认 $DSH_HOME/science），建齐子目录
 *   2. 写 / 升级 config.json、schema_meta（后续 SQLite 迁移按此版本号推进）
 *   3. 把随包技能同步到 $DSH_HOME/science/skills（同名覆盖，用户目录不动）
 *   4. 发布进程级只读服务 ctx.scienceKit，供 tools / ui 软取
 *
 * 这里刻意不写任何模型可见内容：人设、工具行都在 preset 平面，
 * 这样非科研模式的会话零污染。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ScienceStore } from './science/store.js'
import { HttpCache } from './science/http/cache.js'
import { createClient } from './science/http/client.js'
import { RateLimiter, Budget, CircuitBreaker } from './science/http/limits.js'
import { createRegistry } from './science/registry.js'
import { createPipeline } from './science/pipeline.js'
import { SOURCES } from './science/sources/free.js'
import { loadSeed } from './science/intel/index.js'
import { loadSeed as loadFrontierSeed, importSeed as importFrontierSeed, DEFAULT_DOMAIN } from './science/frontier/index.js'

/** Cordis 插件名。 */
export const name = 'dsh-science'

/** 不硬依赖任何服务：registry 未就绪时也要先把目录和数据准备好。 */
export const inject = []

/** 数据根下的子目录，顺序即创建顺序。 */
export const SUBDIRS = [
  'projects',
  'library',
  'experiments',
  'manuscripts',
  'roles',
  'skills',
  'logs',
]

/** schema 版本：M1 引入 paper / query_log / source_state 表后为 2。 */
export const SCHEMA_VERSION = 2

/** 随包技能目录（本包 skills/science）。 */
function bundledSkillsDir() {
  return fileURLToPath(new URL('../skills/science', import.meta.url))
}

/**
 * 数据根解析：显式 config.root 优先（!!js 求值后的绝对路径），否则 $DSH_HOME/science。
 * @param config - 插件配置。
 * @returns `{ root, source }`。
 */
export function resolveRoot(config = {}) {
  if (typeof config.root === 'string' && config.root.trim() !== '') {
    return { root: config.root, source: 'config' }
  }
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return { root: join(home, 'science'), source: 'dsh-home' }
}

/** 递归建目录，返回是否新建。 */
function ensureDir(dir) {
  if (existsSync(dir)) return false
  mkdirSync(dir, { recursive: true })
  return true
}

/** config.json 的默认内容（只放路径与开关，不放任何密钥明文）。 */
function defaultConfig() {
  return {
    version: 1,
    layout: 'dsh-science',
    tools: { python: '', R: '', pandoc: '', latex: '', git: '' },
    retrieval: {
      // 只记环境变量名；值放 $DSH_HOME/.env，由 science-setup.ps1 引导
      envNames: ['SEMANTIC_SCHOLAR_KEY', 'ZOTERO_API_KEY', 'EXA_API_KEY'],
      mcpServers: ['paper', 'arxiv', 'zotero'],
      // 免费渠道的身份与开关
      mailto: '',
      unpaywallEmail: '',
      openalexKey: '',
      s2Key: '',
      coreKey: '',
      enableSciHub: false,
      enableScholar: false,
      proxyFile: 'proxies.txt',
      budgetFloorUsd: 0.005,
      cacheDir: 'cache',
    },
    export: { citationStyle: 'gb-t-7714', requireEvidenceOnExport: true },
    updatedAt: new Date().toISOString(),
  }
}

/**
 * 读或建 config.json。已有文件只补缺失的顶层键，不覆盖用户改过的值。
 * @param root - 数据根。
 * @returns `{ path, created, config }`。
 */
export function ensureConfig(root) {
  const path = join(root, 'config.json')
  const wanted = defaultConfig()
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(wanted, null, 2), 'utf8')
    return { path, created: true, config: wanted }
  }
  let current = {}
  try {
    current = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    /* 损坏时保留原件，写一份新档，避免用户配置被静默丢弃 */
    const backup = path + '.bak-' + Date.now()
    try { copyFileSync(path, backup) } catch { /* ignore */ }
    writeFileSync(path, JSON.stringify(wanted, null, 2), 'utf8')
    return { path, created: true, config: wanted, backup }
  }
  let changed = false
  for (const [key, value] of Object.entries(wanted)) {
    if (!(key in current)) {
      current[key] = value
      changed = true
    }
  }
  /* retrieval 是嵌套对象：顶层键存在不代表子键齐（老配置升级时补齐新开关） */
  if (current.retrieval && typeof current.retrieval === 'object') {
    for (const [key, value] of Object.entries(wanted.retrieval)) {
      if (!(key in current.retrieval)) {
        current.retrieval[key] = value
        changed = true
      }
    }
  }
  if (changed) writeFileSync(path, JSON.stringify(current, null, 2), 'utf8')
  return { path, created: false, config: current, changed }
}

/**
 * 写 / 升级 schema_meta（JSON 侧，M1 起与 science.db 的 schema_meta 表对齐）。
 * @param root - 数据根。
 * @returns `{ path, version, applied }`。
 */
export function ensureSchemaMeta(root) {
  const path = join(root, 'schema_meta.json')
  let version = 0
  if (existsSync(path)) {
    try { version = Number(JSON.parse(readFileSync(path, 'utf8')).version) || 0 } catch { version = 0 }
  }
  if (version < SCHEMA_VERSION) {
    writeFileSync(path, JSON.stringify({
      version: SCHEMA_VERSION,
      appliedAt: new Date().toISOString(),
      note: 'JSON 侧元数据；SQLite 侧见 science.db 的 schema_meta 表',
    }, null, 2), 'utf8')
  }
  return { path, version: Math.max(version, SCHEMA_VERSION), applied: version < SCHEMA_VERSION }
}

/**
 * 把包内 skills/science/* 同步到 $DSH_HOME/science/skills。
 *
 * 语义：目标不存在 → 写；内容不同 → 覆盖（随包技能没有用户可改状态，用户自己的技能放
 * $DSH_HOME/skills）；内容相同 → 不动，避免每次启动写盘。
 * @param root - 数据根。
 * @returns `{ dir, copied, kept, total }`。
 */
export function syncBundledSkills(root) {
  const src = bundledSkillsDir()
  const dir = join(root, 'skills')
  ensureDir(dir)
  if (!existsSync(src)) return { dir, copied: 0, kept: 0, total: 0, missing: true }
  const walk = (from, to) => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const source = join(from, entry.name)
      const dest = join(to, entry.name)
      if (entry.isDirectory()) {
        ensureDir(dest)
        walk(source, dest)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        let same = false
        try { same = readFileSync(dest).equals(readFileSync(source)) } catch { same = false }
        if (same) { kept.push(dest); continue }
        writeFileSync(dest, readFileSync(source))
        copied.push(dest)
      }
    }
  }
  const copied = []
  const kept = []
  walk(src, dir)
  return { dir, copied: copied.length, kept: kept.length, total: copied.length + kept.length }
}

/**
 * 建 / 迁移整套布局。幂等，可在每次启动跑。
 * @param root - 数据根。
 * @param options - `{ syncBundledSkills?: boolean }`。
 * @returns 布局描述（供 ctx.scienceKit 发布）。
 */
export function ensureLayout(root, options = {}) {
  const created = []
  if (ensureDir(root)) created.push(root)
  for (const sub of SUBDIRS) {
    const dir = join(root, sub)
    if (ensureDir(dir)) created.push(dir)
  }
  const config = ensureConfig(root)
  const meta = ensureSchemaMeta(root)
  const skills = options.syncBundledSkills === false
    ? { dir: join(root, 'skills'), copied: 0, kept: 0, total: 0, skipped: true }
    : syncBundledSkills(root)
  return {
    root,
    created,
    configPath: config.path,
    configCreated: config.created,
    schema: meta,
    skills,
    paths: Object.fromEntries(SUBDIRS.map((sub) => [sub, join(root, sub)])),
  }
}

/** 读代理池文件：每行一个 `http://user:pass@host:port`，`#` 开头为注释。 */
export function readProxies(root, proxyFile = 'proxies.txt') {
  const path = join(root, proxyFile || 'proxies.txt')
  if (!existsSync(path)) return []
  try {
    return readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .slice(0, 100)
  } catch { return [] }
}

/**
 * 建检索运行时（进程级单例）。
 *
 * 所有源共享一套：SQLite（缓存+论文库）、令牌桶、预算、熔断、Cookie/代理。
 * 这样跨会话复用缓存与冷却状态，不会因为新开会话就重新烧一遍配额。
 */
export function createRuntime({ root, config = {}, logger = null }) {
  const retrieval = config.retrieval || {}
  const store = new ScienceStore({ dbPath: join(root, 'science.db'), logger })
  const cache = new HttpCache({ db: store.db, dir: join(root, retrieval.cacheDir || 'cache') })
  const limiter = new RateLimiter()
  const budget = new Budget({ floorUsd: Number(retrieval.budgetFloorUsd ?? 0.005) })
  const breaker = new CircuitBreaker()
  const proxies = readProxies(root, retrieval.proxyFile)
  const client = createClient({ cache, limiter, budget, proxies, logger })
  const registry = createRegistry({
    client,
    limiter,
    breaker,
    budget,
    mailto: retrieval.mailto || retrieval.unpaywallEmail || '',
    openalexKey: retrieval.openalexKey || process.env.OPENALEX_KEY || '',
    logger,
  })
  const pipeline = createPipeline({ registry, store, budget, breaker, limiter, cache, logger })

  /* 期刊情报种子：随包分发，启动时幂等导入。
     fresh 安装没有网络也能立刻用实证层打分，之后再跑 science_journal_refresh 更新。 */
  let intelSeed = null
  try {
    const seedPath = fileURLToPath(new URL('../data/journal-intel-cache.json', import.meta.url))
    if (existsSync(seedPath)) {
      const seed = JSON.parse(readFileSync(seedPath, 'utf8'))
      intelSeed = loadSeed(store, seed)
      if (intelSeed.loaded > 0) logger?.info?.(`science: 期刊情报种子导入 ${intelSeed.loaded} 条源记录`)
    }
  } catch (error) {
    logger?.warn?.(`science: 情报种子导入失败 ${error && error.message ? error.message : String(error)}`)
  }

  /* 前沿种子：GitHub 锚点，同样随包分发。只是起点，不作事实断言——每条都带 observedAt，过期自动衰减。 */
  let frontierSeed = null
  try {
    const seed = loadFrontierSeed(DEFAULT_DOMAIN)
    if (seed.anchors.length > 0) {
      frontierSeed = importFrontierSeed(store, seed)
      if (frontierSeed.loaded > 0) logger?.info?.(`science: 前沿种子导入 ${frontierSeed.loaded} 个锚点（${DEFAULT_DOMAIN}）`)
    }
  } catch (error) {
    logger?.warn?.(`science: 前沿种子导入失败 ${error && error.message ? error.message : String(error)}`)
  }

  return {
    root,
    store,
    cache,
    client,
    limiter,
    budget,
    breaker,
    registry,
    pipeline,
    sources: SOURCES,
    proxies,
    config: retrieval,
    ...(intelSeed ? { intelSeed } : {}),
    ...(frontierSeed ? { frontierSeed } : {}),
    schemaVersion: store.version(),
  }
}

/**
 * @param ctx - 插件上下文。
 * @param config - Loader 下发的配置（`root` 已由 !!js 求值）。
 */
export function apply(ctx, config = {}) {
  const { root, source } = resolveRoot(config)
  let layout
  try {
    layout = ensureLayout(root, { syncBundledSkills: config.syncBundledSkills !== false })
  } catch (error) {
    ctx.logger?.error?.('science: 数据根初始化失败：%s', error && error.message ? error.message : String(error))
    layout = { root, error: error && error.message ? error.message : String(error), paths: {} }
  }

  ctx.provide('scienceKit', Object.freeze({
    root,
    source,
    schemaVersion: SCHEMA_VERSION,
    layout,
    paths: layout.paths || {},
  }))

  if (layout.error) return

  /* 检索运行时：建不起来也不能拖垮整个数据根，工具层会自己再试一次 */
  let runtime = null
  try {
    runtime = createRuntime({ root, config: layout.config || {}, logger: ctx.logger })
    ctx.provide('scienceRuntime', Object.freeze(runtime))
  } catch (error) {
    ctx.logger?.error?.('science: 检索运行时初始化失败：%s', error && error.message ? error.message : String(error))
  }

  const stats = runtime ? runtime.store.stats() : null
  ctx.logger?.info?.(
    'science: 数据根就绪 %s（来源 %s；技能 %d 个；schema v%d%s%s）',
    root,
    source,
    layout.skills.total,
    layout.schema.version,
    layout.created.length > 0 ? '；新建 ' + layout.created.length + ' 个目录' : '',
    stats ? `；论文 ${stats.papers} 篇；${runtime.sources.length} 个检索源` : '；检索运行时未就绪',
  )
}

export default { name, inject, apply }
