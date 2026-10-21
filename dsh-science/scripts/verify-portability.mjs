#!/usr/bin/env node
/**
 * 便携性自查：这个包能不能原样装到一台**干净**的 dsh 上。
 *
 * 检查的不是风格，是三类会让「换台机器就炸」的硬依赖：
 *   1. 提示词变量 —— `{{cwd}}` 这类占位必须由某个插件先注册，
 *      缺一个就让整段系统提示词渲染抛 `unknown prompt variable "…"`，
 *      用户看到的是「新建会话失败」，而不是一句可读的原因。
 *   2. 本机第三方应用 —— 代码/配置里出现某个只在开发机装过的插件名，
 *      等于把「那台机器」变成了隐含依赖。
 *   3. 绝对路径 —— `C:\Users\...` / `/home/...` 只在这台机器存在。
 *
 * docs/ 与 README 属于历史记录，按文件名逐个豁免并在输出里说明；
 * 运行时面（lib/、presets/、scripts/、*.yml、package.json）一律不允许命中。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME_DIRS = ['lib', 'presets', 'scripts']
const RUNTIME_FILES = ['cordis.patch.yml', 'package.json']
const TEXT_EXT = /\.(js|mjs|cjs|json|yml|yaml|md)$/i

/** 文档类文件：只记录历史，不参与运行时；命中只提示不失败。 */
const DOC_ONLY = [/^docs[\\/]/, /^README\.md$/i]

/** 检查器自己：规则原文里必然出现被禁的写法，跳过。 */
const SELF = 'scripts/verify-portability.mjs'

const RULES = [
  {
    id: 'prompt-variable',
    re: /\{\{[a-z][a-z0-9_]*\}\}/g,
    why: '提示词变量必须由插件先注册；缺一个就让系统提示词渲染抛 unknown prompt variable',
  },
  {
    id: 'local-app',
    re: /\bdsh-purge\b|\bcwd-variable\b/g,
    why: '把开发机上的第三方应用写成了隐含依赖',
  },
  {
    id: 'absolute-path',
    re: /[A-Za-z]:\\\\?Users\\\\?|\/home\/[a-z0-9_-]+\/|\/Users\/[a-z0-9_-]+\//gi,
    why: '绝对路径只在这台机器存在',
  },
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (TEXT_EXT.test(name)) out.push(full)
  }
  return out
}

function targets() {
  const files = []
  for (const dir of RUNTIME_DIRS) {
    const full = join(ROOT, dir)
    try {
      if (statSync(full).isDirectory()) files.push(...walk(full))
    } catch {
      /* 目录不存在就跳过：包结构由 verify-deepscient 管 */
    }
  }
  for (const name of RUNTIME_FILES) {
    const full = join(ROOT, name)
    try {
      if (statSync(full).isFile()) files.push(full)
    } catch {
      /* 同上 */
    }
  }
  return files
}

const hits = []
const docs = []
const scanned = targets()

for (const file of scanned) {
  const rel = relative(ROOT, file).split(sep).join('/')
  if (rel === SELF) continue
  const text = readFileSync(file, 'utf8')
  const isDoc = DOC_ONLY.some((re) => re.test(rel))
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      const line = text.slice(0, m.index).split('\n').length
      const entry = { rel, line, rule: rule.id, text: m[0], why: rule.why }
      if (isDoc) docs.push(entry)
      else hits.push(entry)
    }
  }
}

const persona = readFileSync(join(ROOT, 'presets', 'science.patch.yml'), 'utf8')
const ALLOWED_PERSONA_KEYS = new Set(['prefix', 'suffix', 'complete', 'includeRuntimeContext'])
const personaBlock = persona.slice(persona.indexOf('- id: persona'), persona.indexOf('- id: agent-instructions'))
const personaKeys = [...personaBlock.matchAll(/^\s{14}([A-Za-z][A-Za-z0-9_]*):/gm)].map((m) => m[1])
const badKeys = personaKeys.filter((key) => !ALLOWED_PERSONA_KEYS.has(key))
if (badKeys.length > 0) {
  hits.push({
    rel: 'presets/science.patch.yml',
    line: persona.slice(0, persona.indexOf(badKeys[0])).split('\n').length,
    rule: 'persona-key',
    text: badKeys.join(', '),
    why: `persona 只接受官方四个 key：${[...ALLOWED_PERSONA_KEYS].join(' / ')}（本地打过补丁的安装树可能接受别的）`,
  })
}

const label = { 'prompt-variable': '提示词变量', 'local-app': '本地第三方应用', 'absolute-path': '绝对路径', 'persona-key': 'persona key' }
console.log(`扫描 ${scanned.length} 个文件（lib/ presets/ scripts/ cordis.patch.yml package.json）`)
if (docs.length > 0) {
  console.log(`文档豁免 ${docs.length} 处（历史记录，不进运行时）：`)
  for (const d of docs.slice(0, 8)) console.log(`  · ${d.rel}:${d.line} ${label[d.rule]} ${JSON.stringify(d.text)}`)
  if (docs.length > 8) console.log(`  · …还有 ${docs.length - 8} 处`)
}

if (hits.length === 0) {
  console.log('PASS  运行时面没有提示词变量、没有本机第三方应用、没有绝对路径')
  console.log(`PASS  persona 只用了官方 key（${personaKeys.join(', ') || '未声明'}）`)
  process.exit(0)
}

console.log(`FAIL  ${hits.length} 处不可携带的依赖：`)
for (const h of hits) console.log(`  · ${h.rel}:${h.line} [${label[h.rule]}] ${JSON.stringify(h.text)} —— ${h.why}`)
process.exit(1)
