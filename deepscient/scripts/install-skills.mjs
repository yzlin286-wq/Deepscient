#!/usr/bin/env node
/**
 * 把 GitHub 上成熟的科研 agent skill 装进本实例（DeepScient）。
 *
 *   node deepscient/scripts/install-skills.mjs --list                  # 清单 + 安装状态（离线可用）
 *   node deepscient/scripts/install-skills.mjs --scan                  # 每仓现有哪些 SKILL.md（走 tarball，不占 API 额度）
 *   node deepscient/scripts/install-skills.mjs --lock-refs             # 把 manifest 的 ref 钉到各仓当前 HEAD
 *   node deepscient/scripts/install-skills.mjs --apply                  # 真装（默认 dry-run，加 --apply 才写盘）
 *   node deepscient/scripts/install-skills.mjs --check                 # 校验已装：frontmatter / 名字 / 目录 / 体积
 *   node deepscient/scripts/install-skills.mjs --diff                  # 已装的 SKILL.md 与 manifest 的 sha256 漂移
 *   node deepscient/scripts/install-skills.mjs --remove [--only <id>]
 *   node deepscient/scripts/install-skills.mjs --self-test             # tar 解析 + frontmatter 归一化单测（不联网）
 *
 * 为什么不用 GitHub API：未登录 60 次/小时，跑两轮清单就 403。
 * 这里走 `git ls-remote` 取 commit SHA、codeload 取 tar.gz —— 都属于普通 git/HTTP，不吃 API 额度。
 *
 * 落盘位置：<DSH_HOME>/science/skills-vendor/<name>/SKILL.md
 *   - 与随包技能（<DSH_HOME>/science/skills）分开，避免和 dsh-science 的启动同步逻辑打架；
 *   - 科学预设按「用户 > 随包 > vendor」的顺序读这三个根，同名时前面的赢。
 *
 * 三条硬规则：
 *   1. 不覆盖任何非 vendor 技能；撞名就加 `vendor-` 前缀，并在报告里写明谁赢了。
 *   2. frontmatter 只做语法归一（旧键改名、长描述压成单行、BOM 剥掉），不改正文一个字。
 *   3. 任一技能失败都不留半成品：先在临时目录装好、校验通过，再原子改名。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = resolve(here, '..')
const repoRoot = resolve(pkgDir, '..')
export const MANIFEST = join(repoRoot, 'dsh-science', 'skills-vendor', 'manifest.json')
export const HOME = process.env.DEEPSCIENT_HOME || join(homedir(), '.deepscient')
export const VENDOR_ROOT = join(HOME, 'science', 'skills-vendor')
const BUNDLED_ROOT = join(HOME, 'science', 'skills')
const USER_ROOT = join(HOME, 'skills')
export const INDEX_FILE = join(VENDOR_ROOT, '.vendor-index.json')

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const opt = (name, fallback = undefined) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}

const MAX_SKILL_FILE_BYTES = 256 * 1024
const MAX_SKILL_TOTAL_BYTES = 2 * 1024 * 1024
const MAX_DESCRIPTION = 480

// ── 基础工具 ────────────────────────────────────────────────────────────
const log = (line = '') => process.stdout.write(`${line}\n`)
const warn = (line) => process.stderr.write(`WARN  ${line}\n`)
let failures = 0
function bad(line) {
  failures += 1
  process.stderr.write(`FAIL  ${line}\n`)
}
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function readManifest() {
  if (!existsSync(MANIFEST)) throw new Error(`manifest 不在：${MANIFEST}`)
  return JSON.parse(readFileSync(MANIFEST, 'utf8'))
}

export function readIndex() {
  if (!existsSync(INDEX_FILE)) return { version: 1, skills: {} }
  try {
    const parsed = JSON.parse(readFileSync(INDEX_FILE, 'utf8'))
    return { version: 1, skills: parsed.skills ?? {} }
  } catch {
    return { version: 1, skills: {} }
  }
}

function writeIndex(index) {
  mkdirSync(dirname(INDEX_FILE), { recursive: true })
  const tmp = `${INDEX_FILE}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), skills: index.skills }, null, 1)}\n`)
  renameSync(tmp, INDEX_FILE)
}

// ── 极简 tar 解析（GitHub tarball 是 ustar，可能带 pax 全局头与长名）──────
/**
 * 解析 tar 为 [{path, body(Buffer), size}]。
 * 只支持 ustar 常规文件；pax 全局头跳过，`L`/`K` 长名与 `x` 局部 pax 记录都按需处理。
 */
export function parseTar(buffer) {
  const out = []
  let offset = 0
  let pendingLongName = null
  let pendingPaxPath = null
  const readString = (buf, start, len) => {
    let end = start
    while (end < start + len && buf[end] !== 0) end += 1
    return buf.toString('utf8', start, end)
  }
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = readString(header, 0, 100)
    const sizeText = readString(header, 124, 12).trim()
    const size = sizeText ? parseInt(sizeText, 8) : 0
    const typeflag = String.fromCharCode(header[156] || 48)
    const prefix = readString(header, 345, 155)
    const bodyStart = offset + 512
    const body = buffer.subarray(bodyStart, bodyStart + size)
    const padded = Math.ceil(size / 512) * 512
    offset = bodyStart + padded

    if (typeflag === 'L') {
      pendingLongName = body.toString('utf8').replace(/\0+$/, '')
      continue
    }
    if (typeflag === 'x') {
      const match = /(?:^|\n)\d+ path=([^\n]+)\n/.exec(body.toString('utf8'))
      if (match) pendingPaxPath = match[1]
      continue
    }
    if (typeflag === 'g' || typeflag === 'K') continue
    if (typeflag !== '0' && typeflag !== '\0') continue

    const full = pendingLongName ?? pendingPaxPath ?? (prefix ? `${prefix}/${name}` : name)
    pendingLongName = null
    pendingPaxPath = null
    out.push({ path: full.replace(/^\.\//, ''), body })
  }
  return out
}

// ── frontmatter 归一化 ─────────────────────────────────────────────────
/**
 * 第三方技能用的是 Claude 的 frontmatter 约定，dsh 的有两条硬要求：
 *   1. 必须有 name + description；
 *   2. 三个旧键（disableModelInvocation / modelInvocable / userInvocable）直接抛错 —— 得改名。
 * 其余未知字段（license、allowed-tools…）dsh 会忽略，原样留着，方便回溯来源。
 */
export function normalizeFrontmatter(raw, { fallbackName }) {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (!match) return { ok: false, reason: '没有 YAML frontmatter' }
  const body = text.slice(match[0].length)
  const fields = []
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (kv) fields.push({ key: kv[1], value: kv[2], indent: false })
    else fields.push({ key: null, value: line, indent: true })
  }
  const top = (key) => fields.find((f) => f.key === key)

  const rename = { disableModelInvocation: 'disable-model-invocation', modelInvocable: 'disable-model-invocation', userInvocable: 'user-invocable' }
  const notes = []
  const kept = []
  let sawDescription = false
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i]
    if (!field.key) {
      kept.push(field.value)
      continue
    }
    if (rename[field.key]) {
      const canonical = rename[field.key]
      const value = field.value
      // modelInvocable: true 等价于 disable-model-invocation: false，语义要保住
      const flipped = field.key === 'modelInvocable' ? String(value).toLowerCase() === 'false' : String(value).toLowerCase() === 'true'
      kept.push(`${canonical}: ${flipped ? 'true' : 'false'}`)
      notes.push(`${field.key} → ${canonical}`)
      continue
    }
    if (field.key === 'name') {
      kept.push(`name: ${fallbackName ?? field.value.trim()}`)
      continue
    }
    if (field.key === 'description') {
      sawDescription = true
      // 多行描述（`>-` / `|`）后续缩进行一并吃掉，压成单行
      let value = field.value.trim()
      if (/^[>|][+-]?$/.test(value) || value === '') {
        const parts = []
        let j = i + 1
        while (j < fields.length && !fields[j].key) {
          parts.push(fields[j].value.trim())
          j += 1
        }
        value = parts.join(' ').trim()
        i = j - 1
      }
      const oneLine = value.replace(/\s+/g, ' ').trim()
      if (!oneLine) {
        sawDescription = false
        continue
      }
      if (oneLine.length > MAX_DESCRIPTION) {
        notes.push(`description 由 ${oneLine.length} 字压到 ${MAX_DESCRIPTION} 字`)
        kept.push(`description: ${oneLine.slice(0, MAX_DESCRIPTION - 1)}…`)
      } else {
        kept.push(`description: ${oneLine.includes(': ') || oneLine.includes('#') ? JSON.stringify(oneLine) : oneLine}`)
      }
      continue
    }
    kept.push(`${field.key}: ${field.value}`.trimEnd())
  }
  const name = fallbackName ?? top('name')?.value?.trim()
  if (!name) return { ok: false, reason: 'frontmatter 缺 name' }
  if (!sawDescription) return { ok: false, reason: 'frontmatter 缺 description' }
  return { ok: true, content: `---\n${kept.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`, notes }
}

// ── 网络：HEAD 解析 + codeload tarball（都不吃 API 额度）──────────────
/**
 * 取仓库 HEAD 的 commit SHA。
 *
 * 先试 `git ls-remote`；本机 git 若被配了不通的代理（企业网络常见），
 * 退回 GitHub 的 commits.atom（普通 HTTP，不吃 API 额度，也不需要 git）。
 */
function resolveHead(repo) {
  try {
    const out = execFileSync('git', ['ls-remote', `https://github.com/${repo}.git`, 'HEAD'], { encoding: 'utf8', timeout: 20_000 })
    const sha = out.trim().split(/\s+/)[0]
    if (/^[0-9a-f]{40}$/.test(sha)) return { sha, via: 'git ls-remote' }
  } catch {
    /* 退回 atom */
  }
  const res = fetchSync(`https://github.com/${repo}/commits.atom`)
  const match = /Grit::Commit\/([0-9a-f]{40})/.exec(res)
  if (!match) throw new Error(`拿不到 ${repo} 的 HEAD（git 与 atom 都失败）`)
  return { sha: match[1], via: 'commits.atom' }
}

/** 同步 HTTP GET 文本：只在 CLI 的短路径上用，避免把整条命令改成 async。 */
function fetchSync(url) {
  const out = execFileSync(process.execPath, ['-e', `
    const res = await fetch(${JSON.stringify(url)}, { headers: { 'user-agent': 'dsh-install-skills' } })
    if (!res.ok) { console.error('HTTP ' + res.status); process.exit(3) }
    process.stdout.write(await res.text())
  `], { encoding: 'utf8', timeout: 40_000, maxBuffer: 8 * 1024 * 1024 })
  return out
}

async function fetchTarball(repo, ref, cacheDir) {
  mkdirSync(cacheDir, { recursive: true })
  const file = join(cacheDir, `${repo.replace(/\//g, '__')}@${ref}.tar.gz`)
  if (existsSync(file) && statSync(file).size > 0) return file
  const url = `https://codeload.github.com/${repo}/tar.gz/${ref}`
  const res = await fetch(url, { headers: { 'user-agent': 'dsh-install-skills' } })
  if (!res.ok) throw new Error(`下载失败 ${url} → HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(file, buf)
  return file
}

function extractEntries(file) {
  const raw = gunzipSync(readFileSync(file))
  return parseTar(raw).map((entry) => ({ ...entry, path: entry.path.replace(/^[^/]+\//, '') }))
}

// ── 安装状态 ────────────────────────────────────────────────────────────
function installedNames() {
  if (!existsSync(VENDOR_ROOT)) return []
  return readdirSync(VENDOR_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
}

function otherRootNames() {
  const names = new Set()
  for (const root of [USER_ROOT, BUNDLED_ROOT]) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) names.add(entry.name)
      else if (entry.name.endsWith('.md')) names.add(entry.name.slice(0, -3))
    }
  }
  return names
}

/** 装到磁盘上时用的最终名字：撞上非 vendor 技能就加前缀，绝不覆盖。 */
export function resolveInstallName(entry, taken) {
  if (!taken.has(entry.name)) return entry.name
  const prefixed = `vendor-${entry.name}`
  return taken.has(prefixed) ? null : prefixed
}

async function cmdList() {
  const manifest = readManifest()
  const index = readIndex()
  const installed = new Set(installedNames())
  log(`清单：${MANIFEST}`)
  log(`本地：${VENDOR_ROOT}`)
  log('')
  let done = 0
  for (const entry of manifest.skills) {
    const name = index.skills[entry.id]?.name ?? entry.name
    const state = installed.has(name) ? '已装' : '未装'
    if (installed.has(name)) done += 1
    log(`${state}  ${entry.id.padEnd(34)} ${entry.repo.split('/').pop()}  ref=${entry.ref.slice(0, 8)}`)
  }
  log('')
  log(`共 ${manifest.skills.length} 条，已装 ${done} 条`)
  return 0
}

async function cmdScan() {
  const manifest = readManifest()
  const cacheDir = join(HOME, 'science', '.cache', 'skills-vendor')
  const wanted = opt('only') ? new Set(opt('only').split(',')) : null
  const repos = new Map()
  for (const entry of manifest.skills) {
    if (wanted && !wanted.has(entry.id) && !wanted.has(entry.repo)) continue
    if (!repos.has(entry.repo)) repos.set(entry.repo, entry.ref)
  }
  for (const [repo, ref] of repos) {
    try {
      const file = await fetchTarball(repo, ref, cacheDir)
      const entries = extractEntries(file)
      const skills = entries.filter((e) => /(^|\/)SKILL\.md$/.test(e.path)).map((e) => e.path.replace(/\/SKILL\.md$/, ''))
      log(`\n### ${repo} @ ${String(ref).slice(0, 8)}（${skills.length} 条）`)
      log(skills.join('  '))
    } catch (error) {
      bad(`${repo} 扫描失败：${error.message}`)
    }
  }
  return failures ? 1 : 0
}

async function cmdLockRefs() {
  const manifest = readManifest()
  const repos = new Set(manifest.skills.map((e) => e.repo))
  const heads = new Map()
  for (const repo of repos) {
    try {
      const head = await resolveHead(repo)
      heads.set(repo, head.sha)
      log(`${repo} → ${head.sha}（${head.via}）`)
    } catch (error) {
      bad(`${repo} 取 HEAD 失败：${error.message}`)
    }
  }
  if (failures) return 1
  for (const entry of manifest.skills) entry.ref = heads.get(entry.repo)
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 1)}\n`)
  log(`\n已把 ${manifest.skills.length} 条的 ref 钉到 ${repos.size} 个仓库的当前 HEAD`)
  return 0
}

async function cmdApply() {
  const manifest = readManifest()
  const only = opt('only') ? new Set(opt('only').split(',')) : null
  const max = Number(opt('max')) > 0 ? Number(opt('max')) : Infinity
  const cacheDir = join(HOME, 'science', '.cache', 'skills-vendor')
  const target = opt('root') ? resolve(opt('root')) : VENDOR_ROOT
  const taken = otherRootNames()
  const index = readIndex()
  const plan = []

  for (const entry of manifest.skills) {
    if (only && !only.has(entry.id) && !only.has(entry.name)) continue
    if (plan.length >= max) break
    plan.push(entry)
  }
  log(`目标根：${target}`)
  log(`计划装 ${plan.length} 条（清单共 ${manifest.skills.length} 条）`)
  if (!flag('apply')) log('\ndry-run：什么都没写。真装请加 --apply。')

  const byRepo = new Map()
  for (const entry of plan) {
    if (!byRepo.has(entry.repo)) byRepo.set(entry.repo, entry.ref)
  }

  let installed = 0
  let skipped = 0
  for (const [repo, ref] of byRepo) {
    let entries
    try {
      const file = await fetchTarball(repo, ref, cacheDir)
      entries = extractEntries(file)
    } catch (error) {
      bad(`${repo} 取包失败：${error.message}`)
      continue
    }
    const repoLicense = entries.find((e) => /^LICENSE(\.[A-Za-z]+)?$/i.test(e.path))
    for (const entry of plan.filter((e) => e.repo === repo)) {
      const prefix = entry.path.replace(/\/?[Ss][Kk][Ii][Ll][Ll]\.md$/, '')
      const relativeSkill = prefix ? `${prefix.toLowerCase()}/skill.md` : 'skill.md'
      const skillMd = entries.find((e) => e.path.toLowerCase() === relativeSkill)
      if (!skillMd) {
        bad(`${entry.id}：仓库里找不到 ${entry.path}`)
        continue
      }
      const name = entry.name ?? entry.id
      const finalName = resolveInstallName({ ...entry, name }, taken)
      if (!finalName) {
        bad(`${entry.id}：${name} 与已有技能撞名，且 vendor- 前缀也被占用`)
        continue
      }
      const normalized = normalizeFrontmatter(skillMd.body.toString('utf8'), { fallbackName: finalName })
      if (!normalized.ok) {
        bad(`${entry.id}：${normalized.reason}`)
        continue
      }
      // 同目录的 references/** 一并带走（体积有上限），其余仓库文件不要
      // 根目录技能没有「同目录附带文件」的概念，别把整仓都搬进来
      const extras = prefix
        ? entries.filter((e) => e.path.startsWith(`${prefix}/`) && e.path.toLowerCase() !== relativeSkill && !/\/skill\.md$/i.test(e.path))
        : []
      let totalBytes = Buffer.byteLength(normalized.content)
      const files = [{ path: 'SKILL.md', body: Buffer.from(normalized.content) }]
      for (const extra of extras) {
        if (extra.body.length > MAX_SKILL_FILE_BYTES) {
          warn(`${entry.id}：${extra.path} 超过 256 KB，跳过`)
          continue
        }
        if (totalBytes + extra.body.length > MAX_SKILL_TOTAL_BYTES) {
          warn(`${entry.id}：附带文件超过 2 MB 上限，后续跳过`)
          break
        }
        totalBytes += extra.body.length
        files.push({ path: prefix ? extra.path.slice(prefix.length + 1) : extra.path, body: extra.body })
      }
      if (repoLicense && !files.some((f) => /^LICENSE/i.test(f.path))) {
        files.push({ path: 'LICENSE.txt', body: repoLicense.body })
      }
      const hash = sha256(Buffer.concat(files.map((f) => f.body)))

      const dir = join(target, finalName)
      const already = existsSync(join(dir, 'SKILL.md')) ? sha256(readFileSync(join(dir, 'SKILL.md'))) : null
      const sameAsIndex = index.skills[entry.id]?.sha256 === hash
      if (!flag('apply')) {
        log(`  [dry] ${finalName.padEnd(36)} ${files.length} 个文件 ${totalBytes} 字节${sameAsIndex ? '（内容未变）' : ''}`)
        continue
      }
      if (sameAsIndex && already) {
        skipped += 1
        continue
      }
      const staging = `${dir}.staging-${process.pid}`
      rmSync(staging, { recursive: true, force: true })
      mkdirSync(staging, { recursive: true })
      for (const file of files) {
        const dest = join(staging, file.path)
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, file.body)
      }
      rmSync(dir, { recursive: true, force: true })
      renameSync(staging, dir)
      index.skills[entry.id] = {
        name: finalName,
        repo: entry.repo,
        ref: entry.ref,
        path: entry.path,
        license: entry.license ?? null,
        sha256: hash,
        files: files.length,
        bytes: totalBytes,
        notes: normalized.notes,
        installedAt: new Date().toISOString(),
      }
      installed += 1
      log(`  装好 ${finalName}（${files.length} 个文件，${totalBytes} 字节）`)
    }
  }
  if (flag('apply')) {
    writeIndex(index)
    log(`\n本次新装/更新 ${installed} 条，内容未变跳过 ${skipped} 条；索引：${INDEX_FILE}`)
  }
  return failures ? 1 : 0
}

/**
 * 把每个条目 upstream SKILL.md 的 sha256 写回 manifest。
 *
 * 这是「pin」的另一半：ref 钉住 commit，sha256 钉住内容。
 * 上游悄悄换了内容却没换 commit 时，--diff / --lock 立刻就能发现。
 */
async function cmdLock() {
  const manifest = readManifest()
  const cacheDir = join(HOME, 'science', '.cache', 'skills-vendor')
  const byRepo = new Map()
  for (const entry of manifest.skills) if (!byRepo.has(entry.repo)) byRepo.set(entry.repo, entry.ref)
  let locked = 0
  for (const [repo, ref] of byRepo) {
    let entries
    try {
      entries = extractEntries(await fetchTarball(repo, ref, cacheDir))
    } catch (error) {
      bad(`${repo} 取包失败：${error.message}`)
      continue
    }
    for (const entry of manifest.skills.filter((e) => e.repo === repo)) {
      const prefix = entry.path.replace(/\/?[Ss][Kk][Ii][Ll][Ll]\.md$/, '')
      const file = entries.find((e) => e.path.toLowerCase() === (prefix ? `${prefix.toLowerCase()}/skill.md` : 'skill.md'))
      if (!file) {
        bad(`${entry.id}：仓库里找不到 ${entry.path}`)
        continue
      }
      entry.sha256 = sha256(file.body)
      locked += 1
    }
  }
  if (failures) return 1
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 1)}\n`)
  log(`已 lock ${locked} 条技能的内容哈希`)
  return 0
}

/** 校验已装的每一条：dsh 的解析规则 + 我们自己的体积/命名规则。 */
export function checkInstalled(root = VENDOR_ROOT) {
  const results = []
  if (!existsSync(root)) return results
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const file = join(root, entry.name, 'SKILL.md')
    if (!existsSync(file)) {
      results.push({ name: entry.name, ok: false, reason: '缺 SKILL.md' })
      continue
    }
    const size = statSync(file).size
    if (size > MAX_SKILL_FILE_BYTES) {
      results.push({ name: entry.name, ok: false, reason: `SKILL.md ${size} 字节，超过 256 KB` })
      continue
    }
    const raw = readFileSync(file, 'utf8')
    const normalized = normalizeFrontmatter(raw, { fallbackName: entry.name })
    if (!normalized.ok) {
      results.push({ name: entry.name, ok: false, reason: normalized.reason })
      continue
    }
    const legacy = ['disableModelInvocation', 'modelInvocable', 'userInvocable'].filter((key) => new RegExp(`^${key}:`, 'm').test(raw))
    if (legacy.length) {
      results.push({ name: entry.name, ok: false, reason: `残留旧键：${legacy.join('、')}` })
      continue
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.name)) {
      results.push({ name: entry.name, ok: false, reason: '目录名不是 kebab-case' })
      continue
    }
    results.push({ name: entry.name, ok: true })
  }
  return results
}

function cmdCheck() {
  const results = checkInstalled()
  if (results.length === 0) {
    log(`PASS  还没装任何 vendor 技能（${VENDOR_ROOT} 为空或不存在）`)
    return 0
  }
  for (const row of results) {
    if (row.ok) log(`PASS  ${row.name}`)
    else bad(`${row.name}：${row.reason}`)
  }
  log('')
  log(`${results.filter((r) => r.ok).length}/${results.length} 通过`)
  return failures ? 1 : 0
}

function cmdDiff() {
  const index = readIndex()
  const installed = new Set(installedNames())
  let drift = 0
  for (const [id, row] of Object.entries(index.skills)) {
    if (!installed.has(row.name)) {
      warn(`${id}：索引里有，磁盘上没了（${row.name}）`)
      drift += 1
      continue
    }
    const file = join(VENDOR_ROOT, row.name, 'SKILL.md')
    const now = sha256(readFileSync(file))
    if (index.skills[id]?.fileSha256 && index.skills[id].fileSha256 !== now) {
      warn(`${id}：SKILL.md 与索引不一致`)
      drift += 1
    }
  }
  log(`索引 ${Object.keys(index.skills).length} 条，磁盘 ${installed.size} 条，漂移 ${drift} 处`)
  return drift ? 1 : 0
}

function cmdRemove() {
  const only = opt('only') ? new Set(opt('only').split(',')) : null
  const index = readIndex()
  const manifest = readManifest()
  const rows = manifest.skills.filter((entry) => !only || only.has(entry.id) || only.has(entry.name))
  if (rows.length === 0) {
    log('没有匹配的条目')
    return 0
  }
  let removed = 0
  for (const entry of rows) {
    const name = index.skills[entry.id]?.name ?? entry.name
    const dir = join(VENDOR_ROOT, name)
    if (!existsSync(dir)) continue
    if (!flag('apply')) {
      log(`[dry] 将删除 ${name}`)
      continue
    }
    rmSync(dir, { recursive: true, force: true })
    delete index.skills[entry.id]
    removed += 1
    log(`删掉 ${name}`)
  }
  if (flag('apply')) writeIndex(index)
  else log('\ndry-run：什么都没删。真删请加 --apply。')
  return 0
}

// ── 单测：tar 解析 + frontmatter 归一化（不联网，verify 会调）────────────
function buildTarHeader({ name, size }) {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write('0000644\0', 100, 8)
  header.write('0000000\0', 108, 8)
  header.write('0000000\0', 116, 8)
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12)
  header.write('00000000000\0', 136, 12)
  header.write('        ', 148, 8)
  header.write('0', 156, 1)
  header.write('ustar\0', 257, 6)
  header.write('00', 263, 2)
  return header
}
function buildTar(files) {
  const chunks = []
  for (const file of files) {
    const body = Buffer.from(file.body, 'utf8')
    chunks.push(buildTarHeader({ name: file.name, size: body.length }), body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  chunks.push(Buffer.alloc(1024))
  return Buffer.concat(chunks)
}

function cmdSelfTest() {
  const cases = []
  const tarball = buildTar([
    { name: 'repo-1.2.3/skills/demo/SKILL.md', body: '---\nname: demo\ndescription: hi\n---\n\nbody\n' },
    { name: 'repo-1.2.3/skills/demo/references/note.md', body: '# note\n' },
  ])
  const parsed = parseTar(tarball)
  cases.push(['tar 解析出两个文件', parsed.length === 2, `实际 ${parsed.length}`])
  cases.push(['tar 路径带仓库前缀', parsed[0].path === 'repo-1.2.3/skills/demo/SKILL.md', parsed[0]?.path])
  cases.push(['tar 正文无损', parsed[1].body.toString() === '# note\n', JSON.stringify(parsed[1]?.body.toString())])

  const legacy = normalizeFrontmatter('---\nname: a\ndescription: d\nuserInvocable: false\nmodelInvocable: false\n---\n\nx\n', { fallbackName: 'a' })
  cases.push(['旧键 userInvocable 映射', legacy.ok && /user-invocable: false/.test(legacy.content), legacy.content ?? legacy.reason])
  cases.push(['旧键 modelInvocable=false → disable-model-invocation=true', /disable-model-invocation: true/.test(legacy.content), legacy.content ?? ''])

  const long = 'x'.repeat(900)
  const trimmed = normalizeFrontmatter(`---\nname: b\ndescription: ${long}\n---\n\nb\n`, { fallbackName: 'b' })
  const line = /^description: (.*)$/m.exec(trimmed.content ?? '')?.[1] ?? ''
  cases.push(['超长 description 被压到 480 字以内', line.length <= MAX_DESCRIPTION, `实际 ${line.length}`])

  const multiline = normalizeFrontmatter('---\nname: c\ndescription: >-\n  第一行\n  第二行\n---\n\nc\n', { fallbackName: 'c' })
  cases.push(['多行 description 压成单行', /description: 第一行 第二行/.test(multiline.content ?? ''), multiline.content ?? multiline.reason])

  const missing = normalizeFrontmatter('---\nname: d\n---\n\nd\n', { fallbackName: 'd' })
  cases.push(['缺 description 要拒绝', missing.ok === false, JSON.stringify(missing)])

  const renamed = resolveInstallName({ name: 'dup' }, new Set(['dup']))
  cases.push(['撞名加 vendor- 前缀', renamed === 'vendor-dup', String(renamed)])
  const twice = resolveInstallName({ name: 'dup' }, new Set(['dup', 'vendor-dup']))
  cases.push(['两次撞名就放弃，不猜', twice === null, String(twice)])

  for (const [label, ok, detail] of cases) {
    if (ok) log(`PASS  ${label}`)
    else bad(`${label}（${detail}）`)
  }
  log('')
  log(`${cases.filter((c) => c[1]).length}/${cases.length} 通过`)
  return failures ? 1 : 0
}

// ── 入口 ────────────────────────────────────────────────────────────────
async function main() {
  if (flag('self-test')) return cmdSelfTest()
  if (flag('list')) return cmdList()
  if (flag('scan')) return cmdScan()
  if (flag('lock-refs')) return cmdLockRefs()
  if (flag('lock')) return cmdLock()
  if (flag('check')) return cmdCheck()
  if (flag('diff')) return cmdDiff()
  if (flag('remove')) return cmdRemove()
  if (flag('apply') || flag('plan') || flag('dry')) return cmdApply()
  log(`用法：
  --list                  清单 + 安装状态
  --scan                  列出各仓库现有 SKILL.md
  --lock-refs             把 ref 钉到各仓当前 HEAD
  --lock                  把每条 SKILL.md 的 sha256 写回 manifest
  --plan                  只打印安装计划（dry-run，不写盘）
  --apply                 真装
  --check                 校验已装技能
  --diff                  比对索引与磁盘
  --remove --apply [--only id]  卸载
  --self-test             tar 解析 + frontmatter 归一化单测

当前 manifest：${MANIFEST}
当前 vendor 根：${VENDOR_ROOT}`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const run = main()
  if (run && typeof run.then === 'function') run.then((code) => { process.exitCode = code ?? (failures ? 1 : 0) })
}
