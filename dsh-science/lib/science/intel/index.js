/**
 * 期刊情报调度：三源抓取 → 归一化 → 落库 → 组装情报卡。
 *
 * 设计原则：
 *   - 每源独立成败。一个源挂了不阻断另外两个，情报卡明示缺哪源（degraded）。
 *   - 落库与组装分离：组装只读库，所以离线也能出卡。
 *   - 种子文件让首次使用不必等 230 个请求。
 */
import openalex from './openalex-profile.js'
import scirev from './scirev.js'
import letpub from './letpub.js'

export const SOURCES = [openalex, scirev, letpub]
export const SOURCE_IDS = SOURCES.map((s) => s.source)

/** 数据新鲜度：超过这个天数就降 confidence 并提示刷新。 */
export const MAX_AGE_DAYS = 90

export function sourceById(id) {
  return SOURCES.find((s) => s.source === id) || null
}

function downgrade(confidence, ageDays) {
  if (ageDays <= MAX_AGE_DAYS) return confidence
  if (confidence === 'high') return 'medium'
  return 'low'
}

/**
 * 抓一刊的三源数据并落库。
 * @returns {journalId, sources: {[id]: {ok, error?, sampleSize, confidence}}}
 */
export async function fetchJournal(journal, { client, store, mailto = null, sources = SOURCE_IDS } = {}) {
  if (!client || !store) throw new Error('intel: 需要 client 与 store')
  const report = { journalId: journal.id, sources: {} }

  for (const id of sources) {
    const mod = sourceById(id)
    if (!mod) { report.sources[id] = { ok: false, error: 'unknown-source' }; continue }
    if (mod.supports && !mod.supports(journal)) {
      report.sources[id] = { ok: false, error: 'unsupported-for-this-journal', skipped: true }
      continue
    }
    let out
    try {
      out = await mod.fetchOne(journal, { client, mailto })
    } catch (error) {
      out = { ok: false, error: error.message }
    }
    if (!out.ok) {
      report.sources[id] = { ok: false, error: out.error || 'failed' }
      continue
    }
    try {
      store.saveJournalIntel({
        journalId: journal.id,
        source: id,
        sampleSize: out.sampleSize ?? null,
        confidence: out.confidence ?? null,
        windowFrom: out.windowFrom ?? null,
        windowTo: out.windowTo ?? null,
        payload: out.payload,
      })
      /* OpenAlex 的产出分布另外摊平进 journal_topic，便于跨刊 SQL 比较 */
      if (id === 'openalex' && Array.isArray(out.payload?.bySubfield)) {
        store.saveJournalTopics({
          journalId: journal.id,
          windowFrom: out.windowFrom,
          windowTo: out.windowTo,
          topics: out.payload.bySubfield.map((s) => ({
            id: openalex.normSubfieldId(s.id), name: s.name, count: s.count, share: s.share,
            field: null, subfield: s.name, domain: null,
          })),
        })
      }
      report.sources[id] = { ok: true, sampleSize: out.sampleSize ?? null, confidence: out.confidence ?? null }
    } catch (error) {
      report.sources[id] = { ok: false, error: `persist: ${error.message}` }
    }
  }
  return report
}

/**
 * 批量刷新。onProgress 每刊回调一次，便于工具输出进度。
 */
export async function refresh({ journals = [], client, store, mailto = null, sources = SOURCE_IDS, onProgress = null } = {}) {
  const reports = []
  for (const journal of journals) {
    const report = await fetchJournal(journal, { client, store, mailto, sources })
    reports.push(report)
    if (onProgress) onProgress(report)
  }
  const ok = reports.reduce((n, r) => n + Object.values(r.sources).filter((s) => s.ok).length, 0)
  const failed = reports.reduce((n, r) => n + Object.values(r.sources).filter((s) => !s.ok && !s.skipped).length, 0)
  return { journals: reports.length, sourcesOk: ok, sourcesFailed: failed, reports }
}

/**
 * 组装一刊情报卡（只读库/种子）。给了稿件则附实证命中。
 *
 * 铁律：不给接受概率。topicHitShare 是"该刊近两年论文落在你子领域的占比"——统计事实，不是录用概率。
 */
export function readIntel(store, journal, { manuscriptMap = null } = {}) {
  const rows = store.getJournalIntel(journal.id)
  const missing = SOURCE_IDS.filter((id) => !rows[id] || rows[id].payload?.parseError)
  const degraded = [...missing]

  const perSource = {}
  for (const [id, row] of Object.entries(rows)) {
    perSource[id] = {
      sampleSize: row.sampleSize,
      confidence: downgrade(row.confidence, row.ageDays),
      ageDays: row.ageDays,
      stale: row.ageDays > MAX_AGE_DAYS,
    }
  }

  const oa = rows.openalex?.payload || null
  const sr = rows.scirev?.payload || null
  const lp = rows.letpub?.payload || null

  let topicFootprint = null
  if (oa && Array.isArray(oa.bySubfield)) {
    const hit = manuscriptMap ? openalex.hitShare(oa, manuscriptMap) : null
    topicFootprint = {
      window: oa.window,
      totalWorks: oa.totalWorks,
      coverage: oa.coverage,
      topSubfields: oa.bySubfield.slice(0, 8),
      topFields: (oa.byField || []).slice(0, 5),
      ...(hit ? { hitShare: hit.share, hitSubfields: hit.hits } : {}),
    }
  }

  let reviewReality = null
  if (sr) {
    reviewReality = {
      firstReviewMonths: sr.firstReviewMonths,
      handlingMonths: sr.handlingMonths,
      immediateRejectDays: sr.immediateRejectDays,
      reviewRounds: sr.reviewRounds,
      commentDifficulty: sr.commentDifficulty,
      difficultyLabel: sr.difficultyLabel,
      reportsPerRound: sr.reportsPerRound,
      reportQuality: sr.reportQuality,
      overallRating: sr.overallRating,
      reviewCount: sr.reviewCount,
      url: sr.url,
      confidence: perSource.scirev?.confidence || 'low',
    }
  }

  let chinaIntel = null
  if (lp) {
    chinaIntel = {
      reviewSpeed: lp.reviewSpeed,
      acceptRate: lp.acceptRate,
      impactFactor: lp.impactFactor,
      casZone: lp.casZone,
      sciIndexed: lp.sciIndexed,
      url: lp.url,
      confidence: perSource.letpub?.confidence || 'low',
      caveat: 'LetPub 为网友自由分享，样本量不公开，只作弱信号',
    }
  }

  const risks = []
  if (!oa) risks.push('缺 OpenAlex 产出分布：无法判断该刊是否实际发你这类工作')
  if (reviewReality?.firstReviewMonths && reviewReality.firstReviewMonths > 4) {
    risks.push(`首轮审稿约 ${reviewReality.firstReviewMonths} 个月，周期偏长`)
  }
  if (reviewReality?.handlingMonths && reviewReality.handlingMonths > 8) {
    risks.push(`录用稿总处理约 ${reviewReality.handlingMonths} 个月，排期要留够`)
  }
  if (chinaIntel?.acceptRate?.kind === 'invited-only') {
    risks.push('LetPub 反馈以约稿为主：自由投稿命中极低，除非受邀否则不建议作为首投')
  }
  if (chinaIntel?.reviewSpeed?.band === 'slow') {
    risks.push(`网友反馈审稿偏慢（${chinaIntel.reviewSpeed.raw}）`)
  }
  if (topicFootprint?.hitShare !== undefined && topicFootprint.hitShare < 0.02) {
    risks.push(`你的子领域在近两年该刊产出中仅占 ${(topicFootprint.hitShare * 100).toFixed(1)}%：务必在 cover letter 说明为何本刊读者会关心`)
  }

  const confidences = Object.values(perSource).map((s) => s.confidence)
  const confidence = confidences.includes('high') ? (missing.length === 0 ? 'high' : 'medium')
    : confidences.includes('medium') ? 'medium' : 'low'

  return {
    journal: { id: journal.id, name: journal.name, band: journal.band, issn: journal.issn || null },
    topicFootprint,
    reviewReality,
    chinaIntel,
    perSource,
    degraded,
    stale: Object.values(perSource).some((s) => s.stale),
    confidence,
    risks,
    fetchedAt: Math.max(0, ...Object.values(perSource).map((s) => Date.now() - s.ageDays * 86400000)) || null,
    note: 'topicHitShare 是统计事实（该刊近两年产出中落在你子领域的比例），不是录用概率。',
  }
}

/** 从种子文件灌库（只填缺失行，不覆盖已抓取的新数据）。 */
export function loadSeed(store, seed) {
  if (!seed || !seed.journals) return { loaded: 0, skipped: 0 }
  let loaded = 0
  let skipped = 0
  for (const [journalId, sources] of Object.entries(seed.journals)) {
    const existing = store.getJournalIntel(journalId)
    for (const [source, row] of Object.entries(sources)) {
      if (existing[source]) { skipped += 1; continue }
      store.saveJournalIntel({
        journalId, source,
        fetchedAt: row.fetchedAt || Date.now(),
        sampleSize: row.sampleSize ?? null,
        confidence: row.confidence ?? null,
        windowFrom: row.windowFrom ?? null,
        windowTo: row.windowTo ?? null,
        payload: row.payload || {},
      })
      if (source === 'openalex' && Array.isArray(row.payload?.bySubfield)) {
        store.saveJournalTopics({
          journalId,
          windowFrom: row.windowFrom,
          windowTo: row.windowTo,
          topics: row.payload.bySubfield.map((s) => ({
            id: openalex.normSubfieldId(s.id), name: s.name, count: s.count, share: s.share,
            field: null, subfield: s.name, domain: null,
          })),
        })
      }
      loaded += 1
    }
  }
  return { loaded, skipped }
}

/** 导出种子（从库里读）。 */
export function exportSeed(store, journals) {
  const out = { $meta: { seedVersion: 1, builtAt: new Date().toISOString(), sources: SOURCE_IDS, journalCount: journals.length }, journals: {} }
  for (const journal of journals) {
    const rows = store.getJournalIntel(journal.id)
    if (Object.keys(rows).length === 0) continue
    out.journals[journal.id] = {}
    for (const [source, row] of Object.entries(rows)) {
      out.journals[journal.id][source] = {
        fetchedAt: row.fetchedAt,
        sampleSize: row.sampleSize,
        confidence: row.confidence,
        windowFrom: row.windowFrom,
        windowTo: row.windowTo,
        payload: row.payload,
      }
    }
  }
  out.$meta.covered = Object.keys(out.journals).length
  return out
}

export default { SOURCES, SOURCE_IDS, fetchJournal, refresh, readIntel, loadSeed, exportSeed, sourceById, MAX_AGE_DAYS }
