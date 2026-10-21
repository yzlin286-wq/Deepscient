/**
 * 找到科研数据层，并把它包成一组「问就答」的只读查询。
 *
 * 三种来源，优先级从高到低：
 *   1. `scienceRuntime` 服务 —— dsh-science 在本实例里装了就一定有，最准；
 *   2. 磁盘上的 `@local/dsh-science` 包 —— 用它自己的 lib 与 data，不复制一份逻辑；
 *   3. 都没有 —— 明确报告不可用，面板显示「未就绪」，不编造数据。
 *
 * 为什么自己去定位包而不是写死 import：DeepScient 是独立实例，dsh-science 可能装在这里、
 * 也可能装在别处、也可能没装。写死就会变成「一个没装的实例整个界面起不来」。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const pkgDir = resolve(here, '..')

/**
 * DeepScient 的数据根。$DSH_HOME 优先，否则默认 `~/.deepscient`。
 *
 * 默认值刻意不是 `~/.dsh`：这个包属于 DeepScient，脱离启动器直接跑时也该落在自己的
 * 数据根里。跟着 `~/.dsh` 走会变成「两个应用共用一个研究库」，那是要出事的。
 */
export function dshHome() {
  const raw = (process.env.DSH_HOME || '').trim()
  return raw ? resolve(raw) : join(homedir(), '.deepscient')
}

export function scienceRoot() {
  return join(dshHome(), 'science')
}

/** 候选包目录：环境变量 > 仓库同级 > 各 profile 的链接目录。 */
function packageCandidates() {
  const out = []
  if (process.env.DEEPSCIENT_SCIENCE_DIR) out.push(process.env.DEEPSCIENT_SCIENCE_DIR)
  out.push(join(pkgDir, '..', 'dsh-science'))
  for (const profile of ['deepscient', 'web', 'desktop']) {
    out.push(join(dshHome(), 'profiles', profile, 'node_modules', '@local', 'dsh-science'))
  }
  return [...new Set(out.map((p) => resolve(p)))]
}

function isSciencePackage(dir) {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return manifest.name === '@local/dsh-science' && existsSync(join(dir, 'lib', 'science', 'store.js'))
  } catch {
    return false
  }
}

export function locateSciencePackage() {
  for (const dir of packageCandidates()) {
    if (isSciencePackage(dir)) return dir
  }
  return null
}

let cache = null

/**
 * 解析一次，缓存到进程里。
 * @param ctx Cordis 上下文（可为空：设置页只读数据时不需要服务）
 */
export async function science(ctx = null) {
  if (cache) return cache

  const dir = locateSciencePackage()
  if (!dir) {
    cache = {
      available: false,
      reason: '找不到 @local/dsh-science 包。把它装进 deepscient profile，或设 DEEPSCIENT_SCIENCE_DIR。',
      probed: packageCandidates(),
    }
    return cache
  }

  const lib = (rel) => import(pathToFileURL(join(dir, 'lib', 'science', rel)).href)
  const [storeMod, coachMod, projectMod, chainMod] = await Promise.all([
    lib(join('store.js')),
    lib(join('discipline', 'coach.js')),
    lib(join('lab', 'project.js')),
    lib(join('lab', 'provenance.js')),
  ])

  // 有服务就用服务的 store：同一个 SQLite 文件被两个连接写不是好主意。
  const runtime = ctx?.get?.('scienceRuntime') ?? null
  const store = runtime?.store ?? new storeMod.ScienceStore({ dbPath: join(scienceRoot(), 'science.db') })

  const readJson = (rel) => {
    try {
      return JSON.parse(readFileSync(join(dir, rel), 'utf8'))
    } catch {
      return null
    }
  }

  cache = {
    available: true,
    source: runtime ? 'runtime' : 'package',
    dir,
    root: scienceRoot(),
    schemaVersion: storeMod.SCHEMA_VERSION,
    store,
    coach: coachMod,
    projects: projectMod,
    verifyChain: chainMod.verifyChain,
    refs: {
      workflow: readJson(join('data', 'workflow.json')),
      statistics: readJson(join('data', 'statistics.json')),
      registry: readJson(join('data', 'tools', 'registry.json')),
      disciplines: readJson(join('data', 'disciplines', '_index.json')),
    },
  }
  return cache
}

/** 供测试重置缓存。 */
export function resetScienceCache() {
  cache = null
}
