/**
 * 为 data/journals.json 的每一刊解析 ISSN 与 OpenAlex source id。
 *
 *   node scripts/build-issn.mjs            # 解析并写回（不覆盖已解析的）
 *   node scripts/build-issn.mjs --force    # 全部重解析
 *
 * 匹配策略（从严到宽，命中即止，绝不猜）：
 *   1. display_name 归一后完全相等
 *   2. 候选是唯一一个 display_name 以刊名开头的
 *   3. 刊名归一后包含候选名（用于 "BMJ" 这类缩写刊名）
 *   排除项：刊名不含 reviews/communications 等词时，排除含这些词的候选（避免 Nature → Nature Reviews X）
 *
 * 歧义或未命中一律写入 data/issn-unresolved.json 待人工确认。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const JOURNALS = new URL('../data/journals.json', import.meta.url)
const UNRESOLVED = new URL('../data/issn-unresolved.json', import.meta.url)
const MAILTO = 'science-kit@example.com'
const force = process.argv.includes('--force')

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '').replace(/^the/, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const DISQUALIFY = ['reviews', 'communications', 'letters', 'advances', 'reports', 'protocols', 'methods', 'case']

/** 会议论文集在 OpenAlex 里不是 journal source，没有 ISSN 可聚合；按 id 显式标注。 */
const CONFERENCES = new Set(['neurips', 'icml'])

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': `dsh-science (${MAILTO})` } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** 在候选里挑最可信的一个；不满足从严条件返回 null。 */
function pick(journal, candidates) {
  const target = norm(journal.name)
  const nameHas = (word) => journal.name.toLowerCase().includes(word)
  const filtered = candidates.filter((c) => {
    const n = norm(c.display_name)
    for (const d of DISQUALIFY) {
      if (n.includes(d) && !nameHas(d) && !nameHas(d.slice(0, -1))) return false
    }
    return true
  })

  const exact = filtered.filter((c) => norm(c.display_name) === target)
  if (exact.length === 1) return { source: exact[0], reason: 'exact' }
  /* 同名多条目（BMJ 有印刷版/网络版/子刊都叫 BMJ）：取载文量最大的主刊 */
  if (exact.length > 1) {
    const main = [...exact].sort((a, b) => (b.works_count || 0) - (a.works_count || 0))[0]
    return { source: main, reason: `exact-of-${exact.length}` }
  }

  const prefix = filtered.filter((c) => norm(c.display_name).startsWith(target))
  if (prefix.length === 1) return { source: prefix[0], reason: 'prefix' }

  const contains = filtered.filter((c) => target.startsWith(norm(c.display_name)) && norm(c.display_name).length >= 4)
  if (contains.length === 1) return { source: contains[0], reason: 'journal-name-contains-source' }

  return null
}

const data = JSON.parse(readFileSync(JOURNALS, 'utf8'))
const unresolved = existsSync(UNRESOLVED) ? JSON.parse(readFileSync(UNRESOLVED, 'utf8')) : { $meta: { note: '待人工确认 ISSN 的期刊' }, entries: [] }
const resolved = []
const failed = []

let i = 0
for (const journal of data.journals) {
  i += 1
  if (CONFERENCES.has(journal.id)) {
    journal.issn = null
    journal.openalexId = null
    journal.intelPolicy = 'conference-no-issn'
    resolved.push({ id: journal.id, issn: null, source: 'conference' })
    process.stdout.write(`– ${journal.id} 会议论文集：无 ISSN，不做产出分布聚合\n`)
    continue
  }
  if (journal.issn && journal.openalexId && !force) {
    resolved.push({ id: journal.id, issn: journal.issn, source: 'cached' })
    continue
  }
  try {
    const url = `https://api.openalex.org/sources?search=${encodeURIComponent(journal.name)}&per-page=10&select=id,display_name,issn_l,issn,works_count,type`
    const res = await getJson(url)
    const hit = pick(journal, res.results || [])
    if (!hit) {
      failed.push({ id: journal.id, name: journal.name, reason: 'no-confident-match', candidates: (res.results || []).slice(0, 4).map((c) => c.display_name) })
      process.stdout.write(`✗ ${journal.id} (${journal.name}) 无自信匹配\n`)
    } else {
      journal.issn = hit.source.issn_l || (hit.source.issn || [])[0] || null
      journal.openalexId = hit.source.id.replace('https://openalex.org/', '')
      journal.openalexName = hit.source.display_name
      resolved.push({ id: journal.id, issn: journal.issn, openalexId: journal.openalexId, name: hit.source.display_name, reason: hit.reason, works: hit.source.works_count })
      process.stdout.write(`✓ ${journal.id} → ${hit.source.display_name} (${journal.issn}) [${hit.reason}]\n`)
    }
  } catch (error) {
    failed.push({ id: journal.id, name: journal.name, reason: `fetch-error: ${error.message}` })
    process.stdout.write(`! ${journal.id} 抓取失败 ${error.message}\n`)
  }
  await sleep(250)
}

writeFileSync(JOURNALS, `${JSON.stringify(data, null, 2)}\n`)
if (failed.length > 0) {
  unresolved.entries = failed
  writeFileSync(UNRESOLVED, `${JSON.stringify(unresolved, null, 2)}\n`)
}

console.log(`\n${resolved.length}/${data.journals.length} 已解析，${failed.length} 待人工确认`)
if (failed.length > 0) {
  console.log('待确认：')
  for (const f of failed) console.log(`  ${f.id} (${f.name}) — ${f.reason}${f.candidates ? ` 候选: ${f.candidates.join(' / ')}` : ''}`)
}
