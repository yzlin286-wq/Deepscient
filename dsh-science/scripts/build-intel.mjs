/**
 * 抓取期刊情报并生成种子文件。
 *
 *   node scripts/build-intel.mjs --journals nature,elife,jacs   # 试抓几刊
 *   node scripts/build-intel.mjs                                # 全部 51 刊（约 6–9 分钟）
 *   node scripts/build-intel.mjs --export-only                  # 只从现有库导出种子
 *   node scripts/build-intel.mjs --sources openalex             # 只刷某源
 *
 * 种子写 data/journal-intel-cache.json，让插件首次使用不必等 200+ 请求。
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { loadJournals } from '../lib/science/method/journals.js'
import { ScienceStore, SCHEMA_VERSION } from '../lib/science/store.js'
import { HttpCache } from '../lib/science/http/cache.js'
import { createClient } from '../lib/science/http/client.js'
import { RateLimiter, Budget, CircuitBreaker } from '../lib/science/http/limits.js'
import { refresh, exportSeed, SOURCE_IDS } from '../lib/science/intel/index.js'

const argOf = (flag) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : null
}

const SEED = new URL('../data/journal-intel-cache.json', import.meta.url)
const DB = join(tmpdir(), 'dsh-science-intel.db')
const CACHE_DIR = join(tmpdir(), 'dsh-science-intel-cache')
const mailto = argOf('--mailto') || 'science-kit@example.com'

const { journals } = loadJournals()
const only = argOf('--journals')
const sources = (argOf('--sources') || 'all').split(',').filter(Boolean)
const wanted = only ? journals.filter((j) => only.split(',').includes(j.id)) : journals
const targetSources = sources[0] === 'all' ? SOURCE_IDS : sources

if (process.argv.includes('--export-only')) {
  const store = new ScienceStore({ dbPath: DB })
  const seed = exportSeed(store, journals)
  writeFileSync(SEED, `${JSON.stringify(seed)}\n`)
  console.log(`导出 ${seed.$meta.covered}/${journals.length} 刊 → data/journal-intel-cache.json`)
  store.close()
  process.exit(0)
}

mkdirSync(CACHE_DIR, { recursive: true })
if (existsSync(DB)) { /* 复用已有库，增量抓取 */ }

const store = new ScienceStore({ dbPath: DB })
const cache = new HttpCache({ db: store.db, dir: CACHE_DIR })
const limiter = new RateLimiter()
const budget = new Budget()
const breaker = new CircuitBreaker()
const client = createClient({ cache, limiter, budget, proxies: [], logger: null })

console.log(`schema v${store.version()} (期望 ${SCHEMA_VERSION})｜目标 ${wanted.length} 刊｜源 ${targetSources.join(',')}`)
console.log(`预计请求数 ≈ ${wanted.length * (targetSources.includes('openalex') ? 2 : 0) + wanted.length * targetSources.filter((s) => s !== 'openalex').length}`)

const started = Date.now()
let done = 0
const result = await refresh({
  journals: wanted,
  client,
  store,
  mailto,
  sources: targetSources,
  onProgress(report) {
    done += 1
    const parts = Object.entries(report.sources).map(([id, s]) => `${id}:${s.ok ? '✓' : (s.skipped ? '–' : '✗')}`)
    process.stdout.write(`[${String(done).padStart(2)}/${wanted.length}] ${report.journalId.padEnd(26)} ${parts.join(' ')}\n`)
    if (done % 10 === 0) {
      const seed = exportSeed(store, journals)
      writeFileSync(SEED, `${JSON.stringify(seed)}\n`)
    }
  },
})

const seed = exportSeed(store, journals)
writeFileSync(SEED, `${JSON.stringify(seed)}\n`)

const secs = ((Date.now() - started) / 1000).toFixed(0)
console.log(`\n完成：${result.journals} 刊，成功 ${result.sourcesOk} 条源记录，失败 ${result.sourcesFailed} 条，用时 ${secs}s`)
console.log(`种子：${seed.$meta.covered}/${journals.length} 刊 → data/journal-intel-cache.json`)

const failed = result.reports.flatMap((r) => Object.entries(r.sources).filter(([, s]) => !s.ok && !s.skipped).map(([id, s]) => `${r.journalId}/${id}: ${s.error}`))
if (failed.length > 0) {
  console.log('\n失败明细：')
  for (const f of failed) console.log(`  ${f}`)
}
store.close()
