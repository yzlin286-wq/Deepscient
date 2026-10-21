/**
 * /deepscient/api/* —— 界面读数据的地方。
 *
 * 三条纪律：
 *   1. **只读**，除了 settings 一个写端点。
 *   2. **不编造**：科研库没装、表没建、阶段不存在，都返回 available:false 或 404，
 *      让界面显示「未就绪」，而不是给一张空表格冒充「暂无课题」。
 *   3. **不算第二遍**：阶段与门的判定一律调 dsh-science 的 stageStatus/advise，
 *      界面上看到的绿灯和教练说的是同一件事。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { currentUser, isPublicApi } from './auth.js'
import { getDoc, listDocs } from './content.js'
import { readSettings, writeSettings } from './settings.js'
import { dshHome, pkgDir, science, scienceRoot } from './science.js'
import { checkInstalled, readIndex as readVendorIndex, VENDOR_ROOT, MANIFEST as VENDOR_MANIFEST } from '../scripts/install-skills.mjs'
import { clearSource, listSources, updateSources, verifySource, mask } from './sources.js'
import { usageRange } from './usage.js'

const API = '/deepscient/api'

/* ── 英文覆盖 ───────────────────────────────────────────────────────────────
   中文写在数据里（workflow.json / sources.js），翻译另存 <name>.en.json，按 id 索引。
   缺项回退中文并把 key 记进 fallbacks——静默回退会让人以为已经翻完。 */

const OVERLAY_CACHE = new Map()

/**
 * 覆盖文件跟着 dsh-science 包走，不是跟着 DSH_HOME 走：
 * scienceRoot() 是「这个实例的研究库」，而 workflow.json 在包目录里。
 * 按候选顺序找到真正装着 workflow.json 的那份，避免读到不存在的路径后静默回退。
 */
function scienceDataDir() {
  const candidates = [
    process.env.DEEPSCIENT_SCIENCE_DIR ? join(process.env.DEEPSCIENT_SCIENCE_DIR, 'data') : null,
    join(pkgDir, '..', 'dsh-science', 'data'),
    ...['deepscient', 'web', 'desktop'].map((profile) =>
      join(dshHome(), 'profiles', profile, 'node_modules', '@local', 'dsh-science', 'data')),
  ].filter(Boolean)
  for (const dir of candidates) {
    if (existsSync(join(dir, 'workflow.json'))) return dir
  }
  return candidates[1]
}

function loadOverlay(file) {
  if (OVERLAY_CACHE.has(file)) return OVERLAY_CACHE.get(file)
  let data = null
  try {
    data = JSON.parse(readFileSync(join(scienceDataDir(), file), 'utf8'))
  } catch {
    data = null
  }
  OVERLAY_CACHE.set(file, data)
  return data
}

function wantEnglish(url) {
  return String(url?.searchParams?.get('locale') ?? '').toLowerCase().startsWith('en')
}

/** workflow 的英文覆盖；没翻到的阶段或门记进 fallbacks。 */
function localizeWorkflow(wf, fallbacks) {
  const en = loadOverlay('workflow.en.json')
  if (!en) return wf
  const stages = (wf.stages ?? []).map((stage) => {
    const s = en.stages?.[stage.id]
    if (!s) fallbacks.push(`workflow.${stage.id}`)
    const gates = (stage.gates ?? []).map((gate) => {
      const g = en.gates?.[`${stage.id}.${gate.id}`]
      if (!g) {
        fallbacks.push(`workflow.${stage.id}.${gate.id}`)
        return gate
      }
      return { ...gate, label: g.label ?? gate.label, fix: g.fix ?? gate.fix }
    })
    return {
      ...stage,
      label: s?.label ?? stage.label,
      goal: s?.goal ?? stage.goal,
      artifacts: s?.artifacts ?? stage.artifacts,
      gates,
    }
  })
  return { ...wf, stages, globalRules: en.globalRules ?? wf.globalRules }
}


/** 每条路由允许的方法；不在表里的一律 405，明确告诉对方可用方法。 */
const METHODS = {
  health: ['GET'],
  settings: ['GET', 'PUT'],
  workflow: ['GET'],
  tools: ['GET'],
  skills: ['GET'],
  'skills/check': ['POST'],
  docs: ['GET'],
  projects: ['GET', 'POST'],
  usage: ['GET'],
  presets: ['GET'],
  sources: ['GET', 'PUT'],
  'sources/verify': ['POST'],
}

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function round(value, digits = 3) {
  return typeof value === 'number' ? Number(value.toFixed(digits)) : value
}

/** 课题行的投影：库里有什么给什么，但不把 plan_json 这类大字段塞进列表。 */
function projectRow(row) {
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    domain: row.domain ?? null,
    question: row.question ?? null,
    designId: row.design_id ?? null,
    targetJournal: row.target_journal ?? null,
    status: row.status ?? null,
    preregRef: row.prereg_ref ?? null,
    ethics: row.ethics_json ? safeParse(row.ethics_json) : null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function listProjects(sci) {
  const rows = sci.store.db.prepare('SELECT * FROM project ORDER BY updated_at DESC, created_at DESC').all()
  return rows.map((row) => withDir(sci, projectRow(row)))
}

/** 课题目录：前端要靠它建工作区，猜路径比多返回一个字段危险。 */
function withDir(sci, item) {
  if (!item) return item
  try {
    const dir = sci.projects?.projectDir?.(item.id)
    return dir ? { ...item, dir } : item
  } catch {
    return item
  }
}

function progressOf(sci, projectId) {
  let stages = []
  try {
    stages = sci.coach.loadWorkflow().stages.map((s) => sci.coach.stageStatus(sci.store, projectId, s.id))
  } catch {
    return { done: 0, total: 0, current: null, error: '阶段判定失败' }
  }
  const done = stages.filter((s) => s.complete).length
  const current = stages.find((s) => !s.complete) ?? null
  return {
    done,
    total: stages.length,
    current: current ? current.id : null,
    currentLabel: current ? current.label : null,
    blockedNow: current ? current.blocking : 0,
  }
}

const TOOL_STAGE_CACHE = { at: 0, items: null, key: '' }

/**
 * 工具清单 = workflow 里挂了阶段的（有阶段与产物）∪ 包里注册了但没挂阶段的（标「全程」）。
 *
 * 为什么两处都要扫：workflow.json 只列了「属于某一步」的工具，另外十来个（教练、检索历史、
 * 溯源、前沿扫描）不属于任何一步，但对使用者一样重要。包里的 `name: 'science_xxx'` 是
 * 定义处，扫它就不会跟代码脱节——不另存一份目录。
 */
function scanToolNames(dir) {
  const names = new Set()
  const libDir = join(dir, 'lib')
  if (!existsSync(libDir)) return names
  for (const entry of readdirSync(libDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue
    const text = readFileSync(join(libDir, entry.name), 'utf8')
    for (const m of text.matchAll(/name:\s*'(science_[a-z0-9_]+)'/g)) names.add(m[1])
  }
  return names
}

function toolRows(sci) {
  const cacheKey = sci.dir ?? ''
  if (TOOL_STAGE_CACHE.items && TOOL_STAGE_CACHE.key === cacheKey && Date.now() - TOOL_STAGE_CACHE.at < 60_000) {
    return TOOL_STAGE_CACHE.items
  }
  const wf = sci.coach.loadWorkflow()
  const seen = new Map()
  for (const stage of wf.stages) {
    for (const name of stage.tools ?? []) {
      if (!seen.has(name)) {
        seen.set(name, {
          name,
          stageId: stage.id,
          stageLabel: stage.label,
          stageGoal: stage.goal,
          artifacts: stage.artifacts ?? [],
        })
      }
    }
  }
  for (const name of scanToolNames(sci.dir)) {
    if (!seen.has(name)) {
      seen.set(name, { name, stageId: null, stageLabel: '全程', stageGoal: '跨阶段使用：查、判、校。', artifacts: [] })
    }
  }
  const items = [...seen.values()].sort((a, b) => (a.stageId ?? 'ZZ').localeCompare(b.stageId ?? 'ZZ') || a.name.localeCompare(b.name))
  TOOL_STAGE_CACHE.at = Date.now()
  TOOL_STAGE_CACHE.key = cacheKey
  TOOL_STAGE_CACHE.items = items
  return items
}

/**
 * 随包技能：目录名 + SKILL.md 的一级标题。读不到就给空数组，不报错。
 *
 * dsh-science 把技能放在 `skills/<命名空间>/<技能名>/SKILL.md`（一层命名空间），
 * 所以这里按两层扫，但只用最内层目录名当 id。
 */
function skillRows(sci) {
  const out = []
  if (!sci.available) return out
  const root = join(sci.dir, 'skills')
  if (!existsSync(root)) return out

  const collect = (dir, depth) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const full = join(dir, entry.name)
      const file = join(full, 'SKILL.md')
      if (existsSync(file)) {
        const text = readFileSync(file, 'utf8')
        const title = text.split(/\r?\n/).find((l) => /^#\s+/.test(l))
        out.push({
          name: entry.name,
          title: title ? title.replace(/^#\s+/, '').trim() : entry.name,
          description: frontmatterField(text, 'description'),
          source: 'bundled',
        })
      } else if (depth < 2) {
        collect(full, depth + 1)
      }
    }
  }
  collect(root, 0)
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/** 从 SKILL.md 的 frontmatter 里取一行字段；取不到就返回空串。 */
function frontmatterField(text, key) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!front) return ''
  const line = front[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`))
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') : ''
}

/**
 * 第三方 vendor 技能：读磁盘 + 索引，把「谁装的、什么许可、钉的哪个 commit」一并给出。
 * 索引缺失（用户手拷进来）也照报，只是溯源字段为空。
 */
function vendorRows() {
  const out = []
  if (!existsSync(VENDOR_ROOT)) return out
  let index = { skills: {} }
  try {
    index = readVendorIndex()
  } catch {
    index = { skills: {} }
  }
  const byName = new Map()
  for (const [id, row] of Object.entries(index.skills ?? {})) {
    if (row?.name) byName.set(row.name, { id, ...row })
  }
  for (const entry of readdirSync(VENDOR_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const file = join(VENDOR_ROOT, entry.name, 'SKILL.md')
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    const meta = byName.get(entry.name) ?? null
    out.push({
      name: entry.name,
      title: frontmatterField(text, 'description') || entry.name,
      description: frontmatterField(text, 'description'),
      source: 'vendor',
      vendor: meta
        ? { repo: meta.repo ?? null, ref: meta.ref ?? null, license: meta.license ?? null, files: meta.files ?? null, bytes: meta.bytes ?? null }
        : null,
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/**
 * 技能总览：磁盘上有哪些、host 平面的技能视图里有哪些。
 *
 * 关键区别（踩过）：`ctx.skills` 在 host 平面只看得见 host 层挂的技能，
 * 会话跑在科研预设里、用的是预设那份 skill-filesystem（三个根）。
 * 所以 `sessionExpect` 才是「会话里应该看到几条」，`hostCatalog` 只是参考值。
 */
async function routeSkills(sci, ctx = null) {
  const bundled = skillRows(sci)
  const vendor = vendorRows()
  const user = userSkillRows()
  let catalog = null
  let liveError = null

  const skills = safeService(ctx, 'skills')
  if (skills) {
    try {
      const snapshot = typeof skills.snapshot === 'function'
        ? await skills.snapshot({ cwd: undefined, scope: undefined })
        : { skills: await skills.list({ cwd: undefined, scope: undefined }), complete: true }
      const rows = Array.isArray(snapshot?.skills) ? snapshot.skills : []
      catalog = rows.map((row) => ({
        name: String(row?.name ?? ''),
        description: String(row?.description ?? ''),
        provider: typeof row?.provider === 'string' ? row.provider : null,
        modelInvocable: row?.modelInvocable !== false,
      })).filter((row) => row.name)
    } catch (error) {
      liveError = error.message
    }
  }

  const manifestPath = VENDOR_MANIFEST
  let manifestCount = 0
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifestCount = Array.isArray(manifest.skills) ? manifest.skills.length : 0
  } catch {
    manifestCount = 0
  }

  // 目录进系统提示的成本：按 tool-skill 的 catalogDescriptionMaxLength=260 估算
  const estimate = (rows) => rows.reduce((sum, row) => sum + Math.min(row.description.length, 260) + row.name.length + 4, 0)
  const sessionRows = [
    ...user.map((row) => ({ name: row.name, description: row.description ?? '' })),
    ...bundled.map((row) => ({ name: row.name, description: row.description ?? '' })),
    ...vendor.map((row) => ({ name: row.name, description: row.description ?? '' })),
  ]

  return {
    ok: true,
    roots: {
      user: join(dshHome(), 'skills'),
      bundled: join(scienceRoot(), 'skills'),
      vendor: VENDOR_ROOT,
    },
    // 会话内的技能根不在这里猜：直接读科研预设自己声明的 customSkillDirs
    preset: await presetSkillRoots(ctx),
    counts: {
      user: user.length,
      bundled: bundled.length,
      vendor: vendor.length,
      manifest: manifestCount,
      sessionExpect: sessionRows.length,
      hostCatalog: catalog ? catalog.filter((row) => row.modelInvocable).length : null,
    },
    // 预期成本用「会话里那三个根」算；host 视图单独报，别混着看
    catalog: {
      session: { chars: estimate(sessionRows), approxTokens: Math.round(estimate(sessionRows) / 3.2) },
      host: catalog ? { rows: catalog.filter((row) => row.modelInvocable).length, source: 'live' } : { error: liveError },
      note: '会话里看到的是预设那份 skill-filesystem（user → bundled → vendor）；host 平面只说 host 层挂了什么。',
    },
    items: [
      ...user.map((row) => ({ ...row })),
      ...bundled.map((row) => ({ ...row })),
      ...vendor.map((row) => ({ ...row })),
    ],
    live: catalog ?? [],
  }
}

/**
 * 科研预设自己声明的技能根。
 *
 * 这是「会话里到底扫哪些目录」的唯一可信来源：读预设注册表的 readDocument
 * （它把该预设的插件清单 dump 成 YAML），从 skill-filesystem 那行抠 customSkillDirs。
 * 不去猜、也不复用 host 平面的 /health —— 那层只看得见 host 自己挂的东西。
 */
async function presetSkillRoots(ctx) {
  const registry = safeService(ctx, 'agentPresets')
  if (!registry || typeof registry.readDocument !== 'function') return { available: false, roots: [] }
  try {
    const resolved = typeof registry.resolve === 'function' ? await registry.resolve() : null
    const id = resolved?.id ?? null
    const doc = await registry.readDocument(id)
    // readDocument 给的是**声明原文**，`!!js dshHomePath('…')` 这种表达式还没求值。
    // 这里按 dshHomePath 的语义就地求值，别把表达式字符串当目录报出去。
    const roots = parseCustomSkillDirs(doc?.content ?? '').map((raw) => resolveSkillRoot(raw))
    return {
      available: true,
      id,
      name: doc?.name ?? null,
      roots: roots.map((dir) => ({ dir, exists: existsSync(dir) })),
      note: '顺序即优先级：同名技能前面的胜出。',
    }
  } catch (error) {
    return { available: false, roots: [], error: error.message }
  }
}

/** 把声明里的 `!!js dshHomePath('…')` 按 dshHomePath 的语义求值；已经是路径就原样返回。 */
function resolveSkillRoot(raw) {
  const value = String(raw).trim()
  const call = /^!!js\s+dshHomePath\(\s*['"](.+?)['"]\s*\)$/.exec(value)
  if (call) return join(dshHome(), call[1])
  const literal = /^!!js\s+['"](.+?)['"]$/.exec(value)
  if (literal) return literal[1]
  return value
}

/** 从 dump 出来的 YAML 里取 customSkillDirs 列表（只看缩进，不做完整 YAML 解析）。 */
function parseCustomSkillDirs(text) {
  const lines = text.split(/\r?\n/)
  const out = []
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^(\s*)customSkillDirs:\s*$/.test(lines[i])) continue
    const baseIndent = lines[i].length - lines[i].trimStart().length
    for (let j = i + 1; j < lines.length; j += 1) {
      const match = /^(\s*)-\s*(.+?)\s*$/.exec(lines[j])
      if (!match) break
      if (match[1].length <= baseIndent) break
      out.push(match[2].replace(/^['"]|['"]$/g, ''))
    }
  }
  return out
}

/** 用户自己的技能根（$DSH_HOME/skills）：只数个数、报个名字，不动内容。 */
function userSkillRows() {
  const root = join(dshHome(), 'skills')
  const out = []
  if (!existsSync(root)) return out
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      const file = join(root, entry.name, 'SKILL.md')
      if (!existsSync(file)) continue
      const text = readFileSync(file, 'utf8')
      out.push({ name: entry.name, description: frontmatterField(text, 'description'), source: 'user' })
    } else if (entry.name.endsWith('.md')) {
      const text = readFileSync(join(root, entry.name), 'utf8')
      out.push({ name: entry.name.slice(0, -3), description: frontmatterField(text, 'description'), source: 'user' })
    }
  }
  return out
}

/**
 * 校验：manifest 的 pin 完不完整 + 已装的每一条符不符合 dsh 的 frontmatter 规则。
 * 规则本体在 scripts/install-skills.mjs（安装时用的同一套），这里只负责汇总。
 */
function routeSkillsCheck() {
  const results = checkInstalled()
  const failed = results.filter((row) => !row.ok)
  const problems = []
  let manifestRows = 0
  let pinned = 0
  try {
    const manifest = JSON.parse(readFileSync(VENDOR_MANIFEST, 'utf8'))
    const list = Array.isArray(manifest.skills) ? manifest.skills : []
    manifestRows = list.length
    for (const entry of list) {
      if (!/^[0-9a-f]{40}$/.test(String(entry.ref ?? ''))) problems.push(`${entry.id}：ref 不是 40 位 commit`)
      else if (!/^[0-9a-f]{64}$/.test(String(entry.sha256 ?? ''))) problems.push(`${entry.id}：缺内容哈希（先跑 --lock）`)
      else pinned += 1
      if (!entry.license) problems.push(`${entry.id}：没记许可`)
    }
  } catch (error) {
    problems.push(`manifest 读不了：${error.message}`)
  }
  return {
    ok: failed.length === 0 && problems.length === 0,
    checked: results.length,
    passed: results.length - failed.length,
    manifest: { rows: manifestRows, pinned },
    failed,
    problems,
  }
}

/** MCP 配置事实：有没有开、声明了哪些服务器、运行时到底注册了几个工具。 */
function mcpSummary(ctx = null) {
  const enabled = (process.env.DSH_ENABLE_MCP ?? '').trim() === '1'
  const candidates = [fileURLToPath(new URL('../mcp.patch.yml', import.meta.url))]
  let file = null
  let text = ''
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        file = candidate
        text = readFileSync(candidate, 'utf8')
        break
      }
    } catch {
      /* 换下一个候选 */
    }
  }
  const live = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
  const servers = [...live.matchAll(/serverName:\s*([A-Za-z0-9_-]+)/g)].map((match) => match[1])
  const transports = [...live.matchAll(/transport:\s*([a-z-]+)/g)].map((match) => match[1])
  return {
    enabled,
    patch: file,
    declared: servers.map((serverName, i) => ({ serverName, transport: transports[i] ?? null })),
    // 运行时事实：MCP 工具真注册进来才会出现在这里（mcp__<server>__<tool>）。
    // 读的是 tools 服务的全局视图，失败就给个错误串 —— 不抛，别把 /health 拖成 500。
    ...liveMcpTools(ctx),
    note: enabled ? '已按 DSH_ENABLE_MCP=1 叠加 MCP 层' : '默认关；要开就设 DSH_ENABLE_MCP=1 再启动',
  }
}

/** 从 tools 服务读出当前真实注册的 MCP 工具名。 */
function liveMcpTools(ctx) {
  if (!ctx) return { tools: null }
  try {
    const registry = typeof ctx.get === 'function' ? ctx.get('tools') : null
    if (!registry || typeof registry.schemas !== 'function') return { tools: null }
    const names = registry
      .schemas()
      .map((schema) => schema?.name)
      .filter((name) => typeof name === 'string' && name.startsWith('mcp__'))
      .sort()
    const servers = [...new Set(names.map((name) => name.split('__')[1]).filter(Boolean))]
    return { tools: { count: names.length, servers, names } }
  } catch (error) {
    return { tools: { count: 0, servers: [], names: [], error: error.message } }
  }
}

/** 版本从包自己的 package.json 读，别在代码里再写一遍（写两遍必然对不上）。 */
let cachedVersion = null
function packageVersion() {
  if (cachedVersion) return cachedVersion
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    cachedVersion = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    cachedVersion = '0.0.0'
  }
  return cachedVersion
}

async function routeHealth(sci, ctx = null) {
  const settings = readSettings()
  let skillsSummary
  try {
    const full = await routeSkills(sci, ctx)
    skillsSummary = { ...full.counts, catalogTokens: full.catalog?.session?.approxTokens ?? null }
  } catch (error) {
    skillsSummary = { error: error.message }
  }
  return {
    ok: true,
    product: 'DeepScient',
    version: packageVersion(),
    home: '$DSH_HOME',
    dataRoot: scienceRoot(),
    settingsPath: settings.path,
    science: sci.available
      ? { available: true, source: sci.source, dir: sci.dir, schemaVersion: sci.schemaVersion }
      : { available: false, reason: sci.reason, probed: sci.probed ?? [] },
    // 「能不能开工」的三件事实：预设解析得开、默认模型在、那把 key 有值。只报事实，不报值。
    preset: await presetSummary(ctx),
    model: await modelSummary(ctx),
    skills: skillsSummary,
    mcp: mcpSummary(ctx),
    time: new Date().toISOString(),
  }
}

/** 当前默认预设：id / 名字 / 激活失败原因（broken 为空才可用）。 */
async function presetSummary(ctx) {
  const registry = serviceOf(ctx, 'agentPresets')
  if (!registry || typeof registry.list !== 'function') return { available: false, id: null, name: null, broken: null }
  try {
    const listed = await registry.list()
    const rows = Array.isArray(listed) ? listed : []
    const row = rows.find((r) => r?.isDefault) ?? rows[0] ?? null
    if (!row) return { available: true, id: null, name: null, broken: null }
    return { available: true, id: row.id ?? null, name: row.name ?? null, broken: row.broken ?? null }
  } catch (error) {
    return { available: false, id: null, name: null, broken: error.message }
  }
}

/**
 * 默认模型 + 那把 key 到底配没配。
 *
 * keyPresent 只可能是 true / false / null（读不到配置时）：先按 agentDefaultModel 选中
 * 的 provider 名去组合配置里找它的 apiKeyEnv，再问 credentials.describe —— 值永远不出这一层。
 */
async function modelSummary(ctx) {
  const out = { provider: null, model: null, apiKeyEnv: null, keyPresent: null }
  const dm = safeService(ctx, 'agentDefaultModel')
  try {
    const sel = dm?.currentSelection?.()
    if (sel) {
      out.provider = sel.provider ?? null
      out.model = sel.model ?? null
    }
  } catch {
    /* 读不到就留空，不猜 */
  }
  // configEditor 的 getter 在 compose 阶段就可能抛（缺 inject），
  // 这层是「顺手多报一条事实」，绝不能让它把整条 /health 拖成 500。
  let conf = []
  try {
    conf = safeService(ctx, 'configEditor')?.configuration?.() ?? []
  } catch {
    conf = []
  }
  const env = out.provider ? findApiKeyEnv(conf, out.provider) : null
  out.apiKeyEnv = env
  if (env) {
    try {
      const info = await safeService(ctx, 'credentials')?.describe?.(env)
      out.keyPresent = info ? Boolean(info.configured) : null
    } catch {
      out.keyPresent = null
    }
  }
  return out
}

/**
 * 在组合配置里递归找 providers[providerId].apiKeyEnv —— 结构在别处改了我们也不写死路径。
 *
 * 只走**自有可枚举键**：`configEditor.configuration()` 的条目里混着 Loader/Context 实例，
 * 它们的服务 getter 挂在原型上，读一下就是 "cannot get property … without inject"。
 * `Object.keys` + 逐键 try 只碰数据字段，顺手多报一条事实，也不该把 /health 拖成 500。
 */
function findApiKeyEnv(node, providerId, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findApiKeyEnv(item, providerId, depth + 1)
      if (hit) return hit
    }
    return null
  }
  let keys
  try {
    keys = Object.keys(node)
  } catch {
    return null
  }
  for (const key of keys) {
    let value
    try {
      value = node[key]
    } catch {
      continue
    }
    if (key === 'providers' && value && typeof value === 'object') {
      let row
      try {
        row = value[providerId]
      } catch {
        row = null
      }
      if (row && typeof row.apiKeyEnv === 'string' && row.apiKeyEnv) return row.apiKeyEnv
    }
    const hit = findApiKeyEnv(value, providerId, depth + 1)
    if (hit) return hit
  }
  return null
}

function routeStages(sci, projectId, url = null) {
  const fallbacks = []
  const raw = sci.coach.loadWorkflow()
  const wf = wantEnglish(url) ? localizeWorkflow(raw, fallbacks) : raw
  const stages = wf.stages.map((s) => {
    const st = sci.coach.stageStatus(sci.store, projectId, s.id)
    return {
      id: st.id,
      // label / goal / artifacts / gate 的文案取本地化后的 workflow；
      // complete / blocking / status 这些判定仍来自 stageStatus，不在这里重算。
      label: s.label,
      goal: s.goal,
      complete: st.complete,
      blocking: st.blocking,
      warnings: st.warnings,
      skipped: st.skipped,
      manual: st.manual,
      tools: st.tools,
      artifacts: s.artifacts,
      gates: (s.gates ?? []).map((g) => {
        const live = (st.gates ?? []).find((x) => x.id === g.id) ?? {}
        return {
          id: g.id,
          label: g.label,
          severity: g.severity,
          status: live.status ?? null,
          detail: live.detail ?? null,
          fix: g.fix ?? live.fix ?? null,
        }
      }),
    }
  })
  const payload = {
    projectId,
    severityOrder: wf.severityOrder ?? [],
    stages,
    summary: {
      total: stages.length,
      complete: stages.filter((s) => s.complete).length,
      blocking: stages.reduce((n, s) => n + s.blocking, 0),
      warnings: stages.reduce((n, s) => n + s.warnings, 0),
      skipped: stages.reduce((n, s) => n + s.skipped, 0),
      manual: stages.reduce((n, s) => n + s.manual, 0),
    },
  }
  if (fallbacks.length) payload.fallbacks = [...new Set(fallbacks)]
  return payload
}

function routeNext(sci, projectId, url = null) {
  const fallbacks = []
  const raw = sci.coach.loadWorkflow()
  const wf = wantEnglish(url) ? localizeWorkflow(raw, fallbacks) : raw
  const stageById = new Map(wf.stages.map((s) => [s.id, s]))
  const gateText = (stageId, gateId) => {
    const stage = stageById.get(stageId)
    const gate = (stage?.gates ?? []).find((g) => g.id === gateId)
    return gate ?? null
  }
  const advice = sci.coach.advise(sci.store, projectId)
  // advise() 的字段名是 current / nextActions / done —— 直接透出，不在这里改语义。
  const stage = advice.current ?? null
  // 四个计数以前写死 0：界面上「当前阶段阻塞几个门」永远是 0，等于把最关键的信息丢了。
  // advise 只给阶段身份，计数回 stageStatus 取真实值。
  const live = stage ? sci.coach.stageStatus(sci.store, projectId, stage.id) : null
  return {
    projectId,
    stage: stage
      ? {
          id: stage.id,
          label: stageById.get(stage.id)?.label ?? stage.label,
          goal: stageById.get(stage.id)?.goal ?? stage.goal,
          blocking: live?.blocking ?? 0,
          warnings: live?.warnings ?? 0,
          skipped: live?.skipped ?? 0,
          manual: live?.manual ?? 0,
        }
      : null,
    reason: advice.reason ?? null,
    nextActions: (advice.nextActions ?? []).map((a) => {
      const localized = gateText(stage?.id ?? '', a.gate ?? '')
      return {
      // advise 的条目是 {gate, label, fix, detail, reason}：没有 severity/status，
      // 取法本身就说明了严重度（blocking > warning > unrecorded > self-check）。
      gate: a.gate ?? null,
      id: a.gate ?? null,
      label: localized?.label ?? a.label ?? null,
      detail: a.detail ?? null,
      fix: localized?.fix ?? a.fix ?? null,
      reason: a.reason ?? null,
      }
    }),
    stages: advice.stages ?? [],
    tools: advice.tools ?? [],
    failureModes: advice.failureModes ?? [],
    done: Boolean(advice.done),
  }
}

/**
 * 总览：一次给全「走到哪、卡在哪、下一步、产出什么」。
 *
 * 分开取要打四个接口（projects/:id、stages、next、各自计数），首屏等四轮；
 * 而且计数散在四处，界面自己加容易加错。这里合成一次，计数一律回 stageStatus 取。
 *
 * artifacts 的 present 用「所在阶段是否完成」判定：一个阶段的门全过了才算产物齐，
 * 没过就标待产出。这是能力边界内的诚实近似——产物是否真的落盘由门自己查。
 */
/* ── 需求书：只读 ───────────────────────────────────────────────────────────
   写由 science_requirement_brief 工具负责（它才算缺口）。面板读文件，
   看见的是同一份真源，不存在两份数据打架的可能。 */

function briefDirPath() {
  return join(dshHome(), 'science', 'briefs')
}

function routeBriefs() {
  const dir = briefDirPath()
  if (!existsSync(dir)) return { items: [], total: 0 }
  const items = []
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('brief-') || !name.endsWith('.json')) continue
    try {
      const brief = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      const gaps = Array.isArray(brief.gaps) ? brief.gaps : []
      const blocking = gaps.filter((g) => g.severity === 'blocking')
      items.push({
        id: brief.id,
        question: brief.question ?? '',
        domain: brief.domain ?? '',
        deliverables: brief.deliverables ?? '',
        updatedAt: brief.updatedAt ?? brief.createdAt ?? null,
        committed: Boolean(brief.projectId),
        projectId: brief.projectId ?? null,
        ready: blocking.length === 0,
        gaps,
        summary: {
          blocking: blocking.length,
          warnings: gaps.filter((g) => g.severity === 'warning').length,
        },
      })
    } catch {
      // 手工改坏的 JSON 只跳过这一份，不拖垮整页
    }
  }
  items.sort((a, b) => String(b.updatedAt ?? b.id).localeCompare(String(a.updatedAt ?? a.id)))
  return { items, total: items.length }
}

function routeOverview(sci, projectId, url = null) {
  const row = sci.store.db.prepare('SELECT * FROM project WHERE id = ?').get(projectId)
  const stagesRoute = routeStages(sci, projectId, url)
  const nextRoute = routeNext(sci, projectId, url)

  const completed = stagesRoute.stages.filter((s) => s.complete)
  const current = stagesRoute.stages.find((s) => !s.complete) ?? null
  const total = stagesRoute.stages.length

  const counts = {}
  const countOf = (key, table) => {
    try {
      counts[key] = sci.store.db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE project_id = ?`).get(projectId).c
    } catch {
      counts[key] = null
    }
  }
  countOf('papers', 'paper')
  countOf('analyses', 'analysis')
  countOf('figures', 'figure_spec')
  countOf('experiments', 'experiment')
  countOf('runs', 'experiment_run')
  countOf('provenance', 'provenance')

  const artifacts = stagesRoute.stages.flatMap((s) =>
    (s.artifacts ?? []).map((name) => ({
      stageId: s.id,
      stageLabel: s.label,
      name,
      present: Boolean(s.complete),
    })))

  return {
    project: row ? projectRow(row) : null,
    progress: {
      done: completed.length,
      total,
      percent: total === 0 ? 0 : Math.round((completed.length / total) * 100),
      current: current
        ? {
            id: current.id,
            label: current.label,
            goal: current.goal,
            blocking: current.blocking,
            warnings: current.warnings,
            skipped: current.skipped,
            manual: current.manual,
          }
        : null,
      blockedNow: current?.blocking ?? 0,
    },
    counts,
    artifacts,
    next: { stage: nextRoute.stage, reason: nextRoute.reason, actions: nextRoute.nextActions },
    stages: stagesRoute.stages.map((s) => ({
      id: s.id,
      label: s.label,
      complete: s.complete,
      blocking: s.blocking,
      warnings: s.warnings,
      skipped: s.skipped,
      manual: s.manual,
    })),
    summary: stagesRoute.summary,
    ...(stagesRoute.fallbacks ? { fallbacks: stagesRoute.fallbacks } : {}),
  }
}

/** 某条子路由允许的方法：先查表，再按前缀兜底（docs/:id、projects/:id、sources/:id）。 */
function allowedMethods(rest, parts) {
  if (rest in METHODS) return METHODS[rest]
  if (parts[0] === 'docs' && parts[1]) return ['GET']
  if (parts[0] === 'projects' && parts[1]) return ['GET']
  if (parts[0] === 'sources' && parts[1]) return ['DELETE']
  return ['GET']
}

/**
 * 路由一次请求。返回 true 表示已处理。
 * @param ctx 插件上下文：usage 要读凭据与默认模型，presets 要读注册表；缺省时降级成空数组。
 * @param req node:http IncomingMessage
 * @param res node:http ServerResponse
 */
export async function handleApi(req, res, ctx = null) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname
  if (!path.startsWith(API)) return false

  const rest = path.slice(API.length).replace(/^\/+/, '')
  const parts = rest ? rest.split('/') : []
  const method = (req.method ?? 'GET').toUpperCase()

  const allowed = allowedMethods(rest, parts)
  if (!allowed.includes(method)) {
    json(res, 405, { error: 'method-not-allowed', allow: allowed.join(', ') })
    return true
  }

  // ── 账号门 ───────────────────────────────────────────────────────────────
  // 认人是第一步：没有会话就不往下走。公开那几项是这台机器的能力清单，
  // 不含任何"某个人的"数据；课题、需求书、概览、设置一律要登录。
  // 放在 allowedMethods 之后：405 与 401 各自表达各自的问题，不互相遮掩。
  if (!isPublicApi(rest)) {
    const user = currentUser(req)
    if (!user) {
      json(res, 401, { error: 'auth-required', message: '先登录。' })
      return true
    }
    req.deepscientUser = user
  }

  let sci
  try {
    sci = await science()
  } catch (error) {
    json(res, 500, { error: 'science-load-failed', message: error.message })
    return true
  }

  const needScience = () => {
    if (sci.available) return true
    json(res, 200, { available: false, reason: sci.reason, probed: sci.probed ?? [] })
    return false
  }

  try {
    if (rest === 'health') {
      json(res, 200, await routeHealth(sci, ctx))
      return true
    }

    if (rest === 'settings') {
      if (method === 'PUT') {
        const body = await readJsonBody(req)
        if (body === null) {
          json(res, 400, { error: 'invalid-json' })
          return true
        }
        const result = writeSettings(body)
        json(res, 200, { ok: true, ...result })
        return true
      }
      const settings = readSettings()
      json(res, 200, { ok: true, values: settings.values, path: settings.path })
      return true
    }

    if (rest === 'usage') {
      const settings = readSettings().values
      const payload = usageRange({
        range: url.searchParams.get('range') ?? 'today',
        refresh: url.searchParams.get('refresh') === '1',
        priceTable: settings.billingPriceTable,
        currency: settings.billingCurrency,
      })
      json(res, 200, {
        ...payload,
        billing: {
          provider: settings.billingProvider,
          baseUrl: settings.billingBaseUrl,
          consoleUrl: settings.billingConsoleUrl,
          configured: Boolean(settings.billingBaseUrl),
          sourceName: 'New API 中转站',
          linkPlaceholder: 'https://<你的 New API 中转站地址>',
          note:
            settings.billingProvider === 'none'
              ? '已关闭计费口径：只显示本机 token 统计。'
              : '计费数据来源于 New API 中转站；本机数字是同口径的本地聚合与预估，实际扣费以中转站账单为准。',
        },
        keys: await routeKeys(ctx),
      })
      return true
    }

    if (rest === 'presets') {
      json(res, 200, await routePresets(ctx))
      return true
    }

    // 预设为什么用不了：roster 只说「坏了」，这里说到「哪一行插件、什么状态」。
    if (rest === 'presets/inspect') {
      json(res, 200, await routePresetInspect(ctx, url.searchParams.get('id')))
      return true
    }

    if (rest === 'sources') {
      if (method === 'PUT') {
        const body = await readJsonBody(req)
        if (body === null) {
          json(res, 400, { error: 'invalid-json' })
          return true
        }
        json(res, 200, updateSources(body))
        return true
      }
      json(res, 200, listSources())
      return true
    }

    if (rest === 'sources/verify') {
      const body = await readJsonBody(req)
      if (body === null || typeof body.id !== 'string') {
        json(res, 400, { error: 'invalid-json' })
        return true
      }
      json(res, 200, await verifySource(body.id, { dry: Boolean(body.dry) }))
      return true
    }

    if (parts[0] === 'sources' && parts[1]) {
      const id = decodeURIComponent(parts[1])
      const result = clearSource(id)
      json(res, result.ok ? 200 : 404, result)
      return true
    }

    if (rest === 'workflow') {
      if (!needScience()) return true
      const wf = sci.coach.loadWorkflow()
      json(res, 200, {
        stages: sci.coach.listStages(),
        severityOrder: wf.severityOrder ?? [],
        globalRules: wf.globalRules ?? [],
      })
      return true
    }

    if (rest === 'tools') {
      if (!needScience()) return true
      const stage = url.searchParams.get('stage')
      const items = toolRows(sci)
      json(res, 200, {
        total: items.length,
        items: stage ? items.filter((t) => t.stageId === stage) : items,
      })
      return true
    }

    if (rest === 'skills') {
      json(res, 200, await routeSkills(sci, ctx))
      return true
    }

    // 「装是装了，能不能用」：跑一遍和安装时同一套校验规则。
    if (rest === 'skills/check') {
      json(res, 200, routeSkillsCheck())
      return true
    }

    if (rest === 'docs') {
      json(res, 200, {
        items: listDocs().map((d) => ({ id: d.id, title: d.title, bytes: d.bytes })),
      })
      return true
    }

    if (parts[0] === 'docs' && parts[1]) {
      const doc = getDoc(parts[1])
      if (!doc) {
        json(res, 404, { error: 'doc-not-found', id: parts[1] })
        return true
      }
      json(res, 200, doc)
      return true
    }

    if (rest === 'projects') {
      if (!needScience()) return true
      if (method === 'POST') {
        const body = await readJsonBody(req)
        if (body === null) {
          json(res, 400, { error: 'invalid-json' })
          return true
        }
        const out = createProjectRoute(sci, body)
        json(res, out.status ?? 200, out.payload)
        return true
      }
      const items = listProjects(sci).map((p) => ({ ...p, progress: progressOf(sci, p.id) }))
      json(res, 200, { total: items.length, items })
      return true
    }

    if (parts[0] === 'briefs') return json(res, 200, routeBriefs())

  if (parts[0] === 'projects' && parts[1]) {
      if (!needScience()) return true
      const projectId = decodeURIComponent(parts[1])
      const row = sci.store.db.prepare('SELECT * FROM project WHERE id = ?').get(projectId)
      if (!row) {
        json(res, 404, { error: 'project-not-found', id: projectId })
        return true
      }

      if (parts[2] === 'stages') {
        json(res, 200, routeStages(sci, projectId, url))
        return true
      }
      if (parts[2] === 'next') {
        json(res, 200, routeNext(sci, projectId, url))
        return true
      }
      if (parts[2] === 'overview') {
        json(res, 200, routeOverview(sci, projectId, url))
        return true
      }
      if (parts[2]) {
        json(res, 404, { error: 'unknown-subresource', sub: parts[2] })
        return true
      }

      const counts = {}
      for (const table of ['experiment', 'experiment_run', 'analysis', 'figure_spec', 'provenance']) {
        try {
          counts[table] = sci.store.db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE project_id = ?`).get(projectId).c
        } catch {
          counts[table] = null
        }
      }
      let chain = null
      try {
        chain = sci.verifyChain ? sci.verifyChain(sci.store, projectId) : null
      } catch {
        chain = null
      }
      json(res, 200, {
        project: projectRow(row),
        plan: row.plan_json ? safeParse(row.plan_json) : null,
        match: row.match_json ? safeParse(row.match_json) : null,
        progress: progressOf(sci, projectId),
        counts,
        // verifyChain 的返回就是 {ok, entries, head, problems}；原样透出，界面只读 ok/entries。
        provenance: chain,
      })
      return true
    }

    json(res, 404, { error: 'unknown-endpoint', path: rest || '/' })
    return true
  } catch (error) {
    json(res, 500, { error: 'internal', message: error.message })
    return true
  }
}

const FAIL = (status, error, message) => ({ status, payload: { ok: false, error, message } })

/**
 * 建课题。用科学包自己的 createProject，不另写一套落盘逻辑。
 *
 * 先比一次课题根：dsh-science 的 projectsRoot() 在 $DSH_HOME 缺失时会退回 `~/.dsh`，
 * 而本实例的数据根是 `~/.deepscient`。根不一致时宁可明确拒绝，也不能把人的课题写进生产库。
 */
function createProjectRoute(sci, body) {
  if (!sci.projects?.createProject) return FAIL(501, 'science-missing-create', '当前 dsh-science 包没有导出 createProject')
  const expected = join(scienceRoot(), 'projects')
  let actual = expected
  try {
    actual = sci.projects.projectsRoot?.() ?? expected
  } catch {
    actual = expected
  }
  if (resolve(actual) !== resolve(expected)) {
    return FAIL(
      409,
      'root-mismatch',
      `科学包的课题根（${actual}）与本实例数据根（${expected}）不一致；请用启动器设置 DSH_HOME 后重启再建课题`,
    )
  }
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title) return FAIL(400, 'title-required', '课题需要一个题目')
  if (title.length > 200) return FAIL(400, 'title-too-long', '题目不超过 200 字')

  try {
    const card = sci.projects.createProject(sci.store, {
      title,
      domain: typeof body.domain === 'string' && body.domain.trim() ? body.domain.trim() : undefined,
      question: typeof body.question === 'string' ? body.question : undefined,
      targetJournal: typeof body.journal === 'string' ? body.journal : undefined,
    })
    const id = card?.id ?? null
    const row = id ? sci.store.db.prepare('SELECT * FROM project WHERE id = ?').get(id) : null
    return {
      status: 200,
      payload: {
        ok: true,
        project: row ? projectRow(row) : card ?? null,
        progress: id ? progressOf(sci, id) : null,
      },
    }
  } catch (error) {
    return FAIL(409, 'create-failed', error.message)
  }
}

/**
 * 取一个可选服务。`ctx.foo` 在未 inject 时会直接抛错（不是 undefined），
 * 所以先试 ctx.get()，再退回受保护的点取；两条路都不成就当它不存在。
 */
function serviceOf(ctx, name) {
  if (!ctx) return null
  try {
    const viaGet = typeof ctx.get === 'function' ? ctx.get(name) : null
    if (viaGet) return viaGet
  } catch {
    /* get 不可用就往下试 */
  }
  try {
    return ctx[name] ?? null
  } catch {
    return null
  }
}

/**
 * serviceOf 的静默版：某些服务的 getter 只在完整 compose 之后才可用，
 * 取不到就返回 null —— 别让「顺手多报一条事实」把整条路由拖成 500。
 */
function safeService(ctx, name) {
  try {
    return serviceOf(ctx, name)
  } catch {
    return null
  }
}

/**
 * 「这把 key 是谁、扣谁的钱」——只给掩码。
 * 三个来源：默认模型选择、本机凭据库、启动器注入的环境变量（中转站的 key 通常就在这儿）。
 */
async function routeKeys(ctx) {
  const out = []
  const seen = new Set()

  try {
    const selection = serviceOf(ctx, 'agentDefaultModel')?.currentSelection?.()
    if (selection) {
      out.push({
        kind: 'default-model',
        provider: selection.provider ?? null,
        model: selection.model ?? null,
        masked: '',
        source: 'agentDefaultModel',
        note: '默认模型；每个 provider 的 key 就是计费主体',
      })
    }
  } catch {
    /* 读不到就不显示，不猜 */
  }

  for (const envName of ['TREE_API_KEY', 'CCAGENT_API_KEY', 'DEEPSEEK_API_KEY']) {
    const value = (process.env[envName] ?? '').trim()
    if (!value) continue
    seen.add(envName)
    out.push({
      kind: 'env',
      provider: envName.replace(/_API_KEY$/, '').toLowerCase(),
      model: null,
      envName,
      masked: mask('key', value),
      source: 'env',
      note: '启动器注入的环境变量',
    })
  }

  try {
    const records = await serviceOf(ctx, 'credentials')?.listRecords?.()
    if (Array.isArray(records)) {
      for (const record of records) {
        const id = record?.key ?? record?.id ?? record?.recordKey ?? null
        if (!id || seen.has(String(id))) continue
        seen.add(String(id))
        out.push({
          kind: 'credential',
          provider: String(id),
          model: null,
          masked: typeof record?.masked === 'string' ? record.masked : '',
          source: 'credentials',
          note: '凭据库',
        })
      }
    }
  } catch {
    /* 凭据库不可用就只显示环境变量那条 */
  }

  return out
}

/**
 * 预设花色：只读注册表，字段缺失就留空，不替它编名字。
 *
 * `broken` 必须透出来：预设激活失败时它仍在 roster 上，但用不了；
 * 前端拿到空 broken 才敢让用户点「开会话」，否则就是在给一句没人看得懂的失败提示。
 */
async function routePresets(ctx) {
  const registry = serviceOf(ctx, 'agentPresets')
  if (!registry || typeof registry.list !== 'function') {
    return { available: false, reason: '当前实例没有 agentPresets 服务', total: 0, items: [] }
  }
  // compositionInventory 才带 isDefault / broken，list() 才带 order / description：两半都读，按 id 合。
  const inventory = new Map()
  try {
    const rows = await registry.compositionInventory?.()
    for (const row of Array.isArray(rows) ? rows : []) if (row?.id) inventory.set(row.id, row)
  } catch {
    /* 没有就不用；下面的 list() 仍然能给出 id */
  }
  try {
    const rows = await registry.list()
    const items = (Array.isArray(rows) ? rows : []).map((row) => {
      const id = row?.id ?? row?.agentPreset ?? null
      const extra = id ? inventory.get(id) ?? null : null
      return {
        id,
        name: row?.name ?? extra?.name ?? null,
        description: row?.description ?? null,
        order: typeof row?.order === 'number' ? row.order : null,
        isDefault: Boolean(row?.isDefault ?? extra?.isDefault),
        broken: row?.broken ?? extra?.broken ?? null,
      }
    })
    items.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    return { available: true, total: items.length, items }
  } catch (error) {
    return { available: false, reason: error.message, total: 0, items: [] }
  }
}

/** FiberState 是数字 const enum：换成名字，否则读日志的人要去翻定义。 */
const FIBER_STATE = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading']

/**
 * 预设体检：roster 只说「坏了」，这里说到「哪一行、什么状态」。
 * 新建会话失败时前端把这一段摊开，就不用再猜是不是 key 或工作区的问题。
 */
async function routePresetInspect(ctx, only) {
  const registry = serviceOf(ctx, 'agentPresets')
  if (!registry || typeof registry.compositionInventory !== 'function') {
    return { available: false, reason: '当前实例没有 agentPresets.compositionInventory' }
  }
  let rows
  try {
    rows = await registry.compositionInventory()
  } catch (error) {
    return { available: false, reason: error.message }
  }
  const wanted = only ? String(only) : null
  let resolved = null
  try {
    const one = wanted ? await registry.resolve?.(wanted) : await registry.resolve?.()
    resolved = one ? { id: one.id ?? null, name: one.name ?? null, broken: one.broken ?? null } : null
  } catch (error) {
    resolved = { error: error.message }
  }
  const presets = (Array.isArray(rows) ? rows : [])
    .filter((row) => !wanted || row?.id === wanted)
    .map((row) => ({
      id: row?.id ?? null,
      name: row?.name ?? null,
      isDefault: Boolean(row?.isDefault),
      broken: row?.broken ?? null,
      rows: (Array.isArray(row?.rows) ? row.rows : []).map((item) => ({
        entryId: item?.entryId ?? null,
        moduleName: item?.moduleName ?? null,
        enabled: item?.enabled ?? null,
        condition: item?.condition ?? null,
        fiberState: fiberStateName(item?.fiberState),
      })),
    }))
  return { available: true, resolved, total: presets.length, presets }
}

function fiberStateName(state) {
  if (typeof state === 'number') return FIBER_STATE[state] ?? String(state)
  if (typeof state === 'string') return state
  return null
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

export { round }
