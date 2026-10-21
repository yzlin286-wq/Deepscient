/**
 * 情报卡组装（工具层用）：把 store 里的三源快照 + 稿件映射变成一个可读结论。
 * 纯读，不抓取 —— 抓取归 intel/index.js.
 */
import { readIntel } from './index.js'
import { mapManuscript } from './openalex-profile.js'

/**
 * @param store    ScienceStore
 * @param journal  journals.json 的一刊
 * @param doc      {title, keywords} | null —— 给了就算实证命中
 * @param client   HTTP client（仅当需要把稿件映射到 subfield 时用；结果进程内缓存）
 */
export async function buildIntelCard(store, journal, { doc = null, client = null, mailto = null } = {}) {
  let manuscriptMap = null
  if (doc && client && (doc.title || (doc.keywords || []).length > 0)) {
    try {
      manuscriptMap = await mapManuscript(doc, { client, mailto })
    } catch {
      manuscriptMap = null
    }
  }
  const card = readIntel(store, journal, { manuscriptMap })
  return { ...card, manuscriptMap }
}

/** 跨刊比较：给定稿件的子领域，哪几本刊最常发这类工作。 */
export function rankJournalsByFootprint(store, journals, manuscriptMap) {
  if (!manuscriptMap || manuscriptMap.subfields.length === 0) return []
  const ids = manuscriptMap.subfields.map((s) => s.id)
  const rows = store.topJournalsForTopics(ids, 30)
  const byId = new Map(journals.map((j) => [j.id, j]))
  return rows
    .map((r) => {
      const j = byId.get(r.journal_id)
      if (!j) return null
      return { id: j.id, name: j.name, band: j.band, share: Math.round(r.share * 10000) / 10000 }
    })
    .filter(Boolean)
    .sort((a, b) => b.share - a.share)
}

export default { buildIntelCard, rankJournalsByFootprint }
