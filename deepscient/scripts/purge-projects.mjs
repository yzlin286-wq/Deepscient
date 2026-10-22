#!/usr/bin/env node
/**
 * 清理残留课题（默认只清 id 以「e2e-链路自检」开头的自检课题）。
 *
 * 为什么是脚本而不是加接口：课题删除是破坏性动作，不该变成 App 里一个可误触的按钮；
 * 但手工改 SQLite 又容易漏掉关联表。这里统一做：先按 `project_id` 把所有关联表里的行
 * 导出成 JSON，再在一个事务里删干净，最后删掉课题目录。
 *
 * 用法：
 *   node deepscient/scripts/purge-projects.mjs --dry-run
 *   node deepscient/scripts/purge-projects.mjs --apply
 *   node deepscient/scripts/purge-projects.mjs --apply --pattern e2e- --keep <id>
 *
 * 数据根：$DSH_HOME（缺省 ~/.deepscient）。不联网，不碰 ~/.dsh。
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const has = (name) => argv.includes(`--${name}`)

const home = process.env.DSH_HOME || join(homedir(), '.deepscient')
const scienceRoot = join(home, 'science')
const dbPath = join(scienceRoot, 'science.db')
const pattern = flag('pattern', 'e2e-链路自检')
const keep = flag('keep', '')
const apply = has('apply')

if (!existsSync(dbPath)) {
  console.error(`找不到数据库：${dbPath}`)
  process.exit(1)
}

const db = new DatabaseSync(dbPath)
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
  .map((row) => row.name)

const columnsOf = (table) => db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name)
const scoped = tables.filter((t) => columnsOf(t).includes('project_id'))

const projects = db.prepare('SELECT id, title, status, created_at FROM project ORDER BY created_at').all()
const targets = projects.filter((p) => String(p.id).startsWith(pattern) && p.id !== keep)
const kept = projects.filter((p) => !targets.includes(p))

console.log(`数据根：${home}`)
console.log(`课题共 ${projects.length} 个；将删除 ${targets.length} 个，保留 ${kept.length} 个`)
for (const p of targets) console.log(`  - 删除 ${p.id}  ${p.title}`)
for (const p of kept) console.log(`  + 保留 ${p.id}  ${p.title}`)

if (targets.length === 0) {
  console.log('没有需要删除的课题。')
  process.exit(0)
}

const ids = targets.map((p) => p.id)
const placeholders = ids.map(() => '?').join(', ')
const backup = { exportedAt: new Date().toISOString(), dbPath, pattern, projects: [], rows: {} }
for (const table of ['project', ...scoped]) {
  const where = table === 'project' ? `id IN (${placeholders})` : `project_id IN (${placeholders})`
  const rows = db.prepare(`SELECT * FROM "${table}" WHERE ${where}`).all(...ids)
  if (table === 'project') backup.projects = rows
  else if (rows.length > 0) backup.rows[table] = rows
}
const backupDir = join(home, 'backup')
const backupPath = join(backupDir, `purge-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)

const affected = Object.fromEntries(Object.entries(backup.rows).map(([t, rows]) => [t, rows.length]))

if (!apply) {
  console.log('\n[dry-run] 关联行统计：', affected)
  console.log('[dry-run] 未写库、未删目录。加 --apply 执行。')
  process.exit(0)
}

mkdirSync(backupDir, { recursive: true })
writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8')
console.log(`\n已导出备份：${backupPath}`)

db.exec('BEGIN')
try {
  for (const table of scoped) {
    db.prepare(`DELETE FROM "${table}" WHERE project_id IN (${placeholders})`).run(...ids)
  }
  db.prepare(`DELETE FROM project WHERE id IN (${placeholders})`).run(...ids)
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  console.error('删除失败，已回滚：', error && error.message ? error.message : error)
  process.exit(1)
}

const removedDirs = []
for (const id of ids) {
  for (const dir of [join(scienceRoot, 'projects', id), join(scienceRoot, 'experiments', id)]) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
      removedDirs.push(dir)
    }
  }
}

console.log(`已删除课题 ${ids.length} 个；关联表：`, affected)
console.log(`已删除目录 ${removedDirs.length} 个`)
for (const dir of removedDirs) console.log(`  - ${dir}`)
const left = db.prepare('SELECT COUNT(*) AS n FROM project').get().n
console.log(`剩余课题：${left} 个`)
