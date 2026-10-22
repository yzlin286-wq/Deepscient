/**
 * 编制解析：把 data/org 下的岗位清单与组织图读成可查询的权限视图。
 *
 * 为什么不把权限判断散到调度器里：编制是唯一事实源，工具能不能用、能不能一票否决、
 * 往上报给谁，都必须只有一个答案。换编制只改 JSON，不改代码。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROLES_FILE = new URL('../../../data/org/roles.json', import.meta.url)
const ORG_FILE = new URL('../../../data/org/org-chart.json', import.meta.url)

/** PI 的这四项权力不依赖 JSON 是否写全：终审权不该因为漏填字段而消失。 */
const PI_ALWAYS_ALLOWED = new Set(['decide', 'approve', 'review', 'veto'])

let rolesCache = null
let orgCache = null
let roleIndex = null

/** 读文件失败与 JSON 语法错误分开报，排障时不用猜是哪一类问题。 */
function readJson(file, label) {
  const path = fileURLToPath(file)
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`缺少${label}：${path}（${error.code || error.message}）`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON：${path}（${error.message}）`)
  }
}

/** 文件缺失时不让模块导入直接炸，留到 loadRoles() 给出中文错误。 */
function peekVersion(file) {
  try {
    return JSON.parse(readFileSync(fileURLToPath(file), 'utf8')).version ?? null
  } catch {
    return null
  }
}

export const ROLES_VERSION = peekVersion(ROLES_FILE)

export function loadRoles() {
  if (rolesCache) return rolesCache
  const data = readJson(ROLES_FILE, '岗位清单 roles.json')
  const roles = Array.isArray(data.roles) ? data.roles : []
  if (roles.length === 0) throw new Error(`岗位清单为空：${fileURLToPath(ROLES_FILE)}`)
  roleIndex = new Map(roles.map((role) => [role.id, role]))
  rolesCache = data
  return rolesCache
}

export function loadOrgChart() {
  if (orgCache) return orgCache
  orgCache = readJson(ORG_FILE, '组织图 org-chart.json')
  return orgCache
}

/** 返回副本：调用方改数组不该影响缓存里的编制。 */
export function listRoles() {
  return loadRoles().roles.slice()
}

export function getRole(roleId) {
  loadRoles()
  return roleIndex.get(String(roleId ?? '')) ?? null
}

export function getLayer(roleId) {
  const role = getRole(roleId)
  return role?.layer ?? null
}

export function can(roleId, action) {
  const role = getRole(roleId)
  if (!role) return false
  const name = String(action ?? '')
  if (!name) return false
  if (role.id === 'pi' && PI_ALWAYS_ALLOWED.has(name)) return true
  return Array.isArray(role.authority) && role.authority.includes(name)
}

/** 表面清单的匹配只有两种：完全相等，或 `前缀*` 这种前缀通配。 */
function surfaceMatches(surface, toolName) {
  const tool = String(toolName ?? '')
  if (!tool || !Array.isArray(surface)) return false
  for (const entry of surface) {
    const pattern = String(entry ?? '')
    if (!pattern) continue
    if (pattern === tool) return true
    if (pattern.endsWith('*') && tool.startsWith(pattern.slice(0, -1))) return true
  }
  return false
}

export function canUseTool(roleId, toolName) {
  const role = getRole(roleId)
  if (!role) return false
  return surfaceMatches(role.toolSurface, toolName)
}

/** 调度器在执行前调用它：拒绝理由要能直接写进分片 error，不能只是 false。 */
export function assertTool(roleId, toolName) {
  const role = getRole(roleId)
  if (!role) return { ok: false, reason: `岗位不存在：${roleId}` }
  if (!surfaceMatches(role.toolSurface, toolName)) {
    return { ok: false, reason: `岗位 ${role.id}（${role.name}）无权使用工具 ${toolName}` }
  }
  return { ok: true, reason: null }
}

/** 从该岗位逐级上报直到没有上级；带 seen 防御报告关系被写成环。 */
export function escalationPath(roleId) {
  const role = getRole(roleId)
  if (!role) return []
  const org = loadOrgChart()
  const path = []
  const seen = new Set()
  let current = role
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.push(current.id)
    const declared = org.reporting?.[current.id]
    const parentId = Array.isArray(declared) ? declared[0] : current.reportsTo
    current = parentId ? getRole(parentId) : null
  }
  return path
}

export function roleCapacity(roleId) {
  const capacity = Number(getRole(roleId)?.capacity)
  return Number.isFinite(capacity) ? Math.max(0, Math.floor(capacity)) : 0
}

export function batchPolicy() {
  return { ...(loadOrgChart().batchPolicy ?? {}) }
}

export function route(kind) {
  const table = loadOrgChart().routing ?? {}
  const key = String(kind ?? '')
  return Object.hasOwn(table, key) ? table[key] : 'lead'
}

export function orgSummary() {
  const roles = loadRoles()
  const org = loadOrgChart()
  const layers = {}
  for (const [code, meta] of Object.entries(roles.layers ?? {})) layers[code] = { ...meta }
  return {
    version: roles.version ?? ROLES_VERSION,
    layers,
    roles: listRoles().map((role) => ({
      id: role.id,
      name: role.name,
      layer: role.layer,
      reportsTo: role.reportsTo ?? null,
      duty: role.duty ?? null,
      authority: Array.isArray(role.authority) ? [...role.authority] : [],
      capacity: roleCapacity(role.id),
      costTier: role.costTier ?? null,
      toolSurface: Array.isArray(role.toolSurface) ? [...role.toolSurface] : [],
    })),
    vetoRoles: [...(org.vetoRoles ?? [])],
    escalation: [...(org.escalation ?? [])],
    batchPolicy: batchPolicy(),
    routing: { ...(org.routing ?? {}) },
  }
}

/** 测试用：改完 data/org 下的文件后能重新读盘。 */
export function __resetChartCache() {
  rolesCache = null
  orgCache = null
  roleIndex = null
}
