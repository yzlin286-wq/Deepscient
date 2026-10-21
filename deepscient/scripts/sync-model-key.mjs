#!/usr/bin/env node
/**
 * 把本机已有的模型 key 复制到 DeepScient 自己的凭据库，让 3081 这条实例也能调模型。
 *
 *   node deepscient/scripts/sync-model-key.mjs            # 看要做什么，不动文件
 *   node deepscient/scripts/sync-model-key.mjs --apply     # 真写
 *
 * 为什么要这一步：`~/.dsh/.credentials.yaml`（生产实例）和 `~/.deepscient/.credentials.yaml`
 * （科研实例）是两本账。key 只在生产那本里，科研实例的 /health 就会报 keyPresent=false，
 * 引导里点「开会话」也必然失败 —— 那不是 bug，是没配。
 *
 * 只搬 `refs` 段里的键值，不动 `records`；写之前先备份，值永远不打印。
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const APPLY = process.argv.includes('--apply')
const SOURCE = process.env.DEEPSCIENT_KEY_SOURCE || join(homedir(), '.dsh', '.credentials.yaml')
const TARGET = process.env.DEEPSCIENT_KEY_TARGET || join(homedir(), '.deepscient', '.credentials.yaml')
const WANTED = ['CCAGENT_API_KEY', 'TREE_API_KEY', 'TREEAPI_API_KEY']

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

/** 在 `refs:` 段里补键；已有就覆盖，没有就追加在段尾。 */
function upsertRefs(text, entries) {
  const lines = text.split(/\r?\n/)
  let start = lines.findIndex((line) => /^refs:/.test(line))
  if (start < 0) {
    const block = ['refs:', ...Object.entries(entries).map(([key, value]) => `  ${key}: ${value}`)]
    const body = text.endsWith('\n') || text === '' ? text : `${text}\n`
    return `${body}${block.join('\n')}\n`
  }
  let end = start + 1
  while (end < lines.length && !/^\S/.test(lines[end])) end += 1
  const section = lines.slice(start + 1, end)
  for (const [key, value] of Object.entries(entries)) {
    const index = section.findIndex((line) => new RegExp(`^\\s{2}${key}:`).test(line))
    const line = `  ${key}: ${value}`
    if (index >= 0) section[index] = line
    else section.push(line)
  }
  return [...lines.slice(0, start + 1), ...section, ...lines.slice(end)].join('\n')
}

const sourceRefs = readRefs(SOURCE)
const targetRefs = readRefs(TARGET)
const todo = {}
for (const name of WANTED) {
  if (!sourceRefs[name]) continue
  if (targetRefs[name] === sourceRefs[name]) continue
  todo[name] = sourceRefs[name]
}

console.log(`源       : ${SOURCE}`)
console.log(`目标     : ${TARGET}`)
console.log(`已有键   : ${Object.keys(targetRefs).join('、') || '（空）'}`)
if (Object.keys(todo).length === 0) {
  console.log('PASS  没有要补的键：科研实例已经能读到同一把 key')
  process.exit(0)
}
console.log(`将补入   : ${Object.keys(todo).join('、')}（值不打印）`)

if (!APPLY) {
  console.log('\ndry-run：什么都没写。真写请加 --apply。')
  process.exit(0)
}

const targetText = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : 'version: 1\n'
if (existsSync(TARGET)) {
  const backup = `${TARGET}.bak-${Date.now()}`
  copyFileSync(TARGET, backup)
  console.log(`已备份   : ${backup}`)
}
const next = upsertRefs(targetText, todo)
writeFileSync(TARGET, next)
const check = readRefs(TARGET)
for (const name of Object.keys(todo)) {
  if (check[name] !== todo[name]) {
    console.error(`FAIL  ${name} 没写进去`)
    process.exit(1)
  }
}
console.log(`PASS  已补入 ${Object.keys(todo).length} 个键；重启 3081 后 /health 的 keyPresent 会变 true`)
