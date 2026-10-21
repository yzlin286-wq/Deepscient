/**
 * 把 dsh-science 的端到端演示数据装进 DeepScient 自己的数据根，好让面板一打开就有东西看。
 *
 *   node deepscient/scripts/seed-demo.mjs            # 用最新的 student-* 临时目录
 *   node deepscient/scripts/seed-demo.mjs --source <dir>
 *
 * 两个坑，写在前面：
 *   1. 演示脚本自己 mkdtemp 并把 DSH_HOME 指向那里，所以它从不往真实数据根写；
 *   2. 演示结束时 WAL 里还有 680 KB 没落盘，直接复制 science.db 会拿到一个空壳，
 *      打开就是 disk I/O error。所以这里用 `VACUUM INTO` 让 SQLite 自己吐一个
 *      干净的单文件，再把文件树搬过去。
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

// 默认写到 DeepScient 自己的数据根。**故意不读 $DSH_HOME**：在开发 shell 里它通常指
// 向另一个实例（~/.dsh），照着它写就是在别人的活库上动刀。
const profileHome = join(process.env.USERPROFILE || process.env.HOME, '.deepscient')
const home = resolve(arg('home', profileHome))
if (home === resolve(join(process.env.USERPROFILE || process.env.HOME, '.dsh'))) {
  console.error('拒绝写入 ~/.dsh：那是现有实例的活数据根。用 --home 明确指定别的目录。')
  process.exit(2)
}
const dstRoot = join(home, 'science')
const dstDb = join(dstRoot, 'science.db')

function newestStudentDir() {
  const base = tmpdir()
  const dirs = readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('student-'))
    .map((e) => join(base, e.name))
    .filter((p) => existsSync(join(p, 'science.db')))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return dirs[0] ?? null
}

const src = resolve(arg('source', newestStudentDir() || ''))
if (!src || !existsSync(join(src, 'science.db'))) {
  console.error('找不到演示数据。先跑：node dsh-science/scripts/demo-student-flow.mjs')
  process.exit(2)
}

mkdirSync(dstRoot, { recursive: true })
for (const f of ['science.db-wal', 'science.db-shm']) {
  rmSync(join(dstRoot, f), { force: true })
}
rmSync(dstDb, { force: true })

// 源库由演示进程关掉后才读；VACUUM INTO 会带上 WAL 里的内容，产出单文件。
const db = new DatabaseSync(join(src, 'science.db'))
db.exec(`VACUUM INTO '${dstDb.replace(/'/g, "''")}'`)
db.close()

// 文件树：manuscripts / projects / library / experiments / roles / logs 等。
for (const entry of readdirSync(src, { withFileTypes: true })) {
  if (!entry.isDirectory() && entry.name.startsWith('science.db')) continue
  const from = join(src, entry.name)
  const to = join(dstRoot, entry.name)
  if (entry.isDirectory()) cpSync(from, to, { recursive: true, force: true })
  else copyFileSync(from, to)
}

// 复制完自己再核一遍：数出来是 0 就别假装成功。
const check = new DatabaseSync(dstDb)
const projects = check.prepare('SELECT id, title FROM project').all()
const runs = check.prepare('SELECT COUNT(*) AS c FROM experiment_run').get().c
const analyses = check.prepare('SELECT COUNT(*) AS c FROM analysis').get().c
check.close()

console.log(`数据根：${dstRoot}`)
console.log(`来源  ：${src}`)
for (const p of projects) console.log(`  课题 ${p.id}　${p.title}`)
console.log(`  运行 ${runs} 次，分析 ${analyses} 次`)
if (!projects.length) {
  console.error('装完是空的——这不正常，检查来源目录。')
  process.exit(1)
}
