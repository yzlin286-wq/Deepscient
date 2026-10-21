/**
 * 界面上的「说明」从 Markdown 来，不从代码里来。
 *
 * 理由和 dsh-science 一样：说明是内容，改一句话不该改代码，也不该重启实例。三个页面
 * 各自一个文件，目录按文件名排序，标题取第一行 `# `。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import { pkgDir } from './science.js'

const DOCS_DIR = join(pkgDir, 'docs')
const CACHE_MS = 30_000
let cache = { at: 0, docs: null }

const ORDER = ['quickstart', 'guide', 'stages', 'tools', 'billing', 'sources', 'pitfalls', 'panels']

function titleOf(markdown, fallback) {
  const line = markdown.split(/\r?\n/).find((l) => /^#\s+/.test(l))
  return line ? line.replace(/^#\s+/, '').trim() : fallback
}

export function listDocs() {
  const now = Date.now()
  if (cache.docs && now - cache.at < CACHE_MS) return cache.docs

  let names = []
  try {
    names = readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md')).map((f) => basename(f, '.md'))
  } catch {
    names = []
  }
  const rank = (id) => {
    const i = ORDER.indexOf(id)
    return i === -1 ? ORDER.length : i
  }
  names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))

  const docs = names.map((id) => {
    const path = join(DOCS_DIR, `${id}.md`)
    const markdown = readFileSync(path, 'utf8')
    const bytes = statSync(path).size
    return { id, title: titleOf(markdown, id), bytes, markdown }
  })
  cache = { at: now, docs }
  return docs
}

export function getDoc(id) {
  const safe = String(id || '').replace(/[^a-z0-9_-]/gi, '')
  const path = join(DOCS_DIR, `${safe}.md`)
  if (!safe || !existsSync(path)) return null
  const markdown = readFileSync(path, 'utf8')
  return { id: safe, title: titleOf(markdown, safe), markdown }
}
