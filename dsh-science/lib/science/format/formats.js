/**
 * 排版族解析：把「投哪本刊」变成「用哪个 LaTeX 类、哪套 Word 版式、哪种引文风格」。
 *
 * 三个数据源合并：
 *   data/journal-formats.json  → 版式（字体页边距行号、LaTeX 类、引文风格）
 *   data/journals.json         → 限制（字数、图表数、参考文献数）
 *   data/citation-styles.json  → 引文细则
 *
 * 找不到期刊时回退到 generic 族而不是报错：投稿前先排版、后选刊是常态，
 * 不该因为还没定刊就出不了 PDF。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getJournal, loadJournals } from '../method/journals.js'
import { styleById } from './cite.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, '..', '..', '..', 'data', 'journal-formats.json')

let CACHE = null

export function loadFormats() {
  if (CACHE) return CACHE
  const raw = JSON.parse(readFileSync(DATA, 'utf8'))
  CACHE = {
    meta: raw.$meta ?? {},
    families: raw.families ?? {},
    publisherToFamily: raw.publisherToFamily ?? {},
    journalToFamily: raw.journalToFamily ?? {},
    defaultFamily: raw.defaultFamily ?? 'generic',
    genericFamily: raw.genericFamily,
  }
  return CACHE
}

export function familyById(id) {
  const formats = loadFormats()
  const family = formats.families[id]
  if (family) return { id, ...family, generic: false }
  if (id === formats.defaultFamily || !id) {
    return { id: formats.defaultFamily, ...formats.genericFamily, generic: true }
  }
  return { id: formats.defaultFamily, ...formats.genericFamily, generic: true }
}

/**
 * @param {{journal?: string, publisher?: string}} input
 * @returns {{journalId, journal, publisher, family, familyId, latex, docx, citation, limits, warning}}
 */
export function resolveFormat({ journal, publisher } = {}) {
  const formats = loadFormats()
  const journalId = journal ? String(journal).trim() : null

  let record = null
  let lookupWarning = null

  if (journalId) {
    record = getJournal(journalId)
    if (!record) {
      try {
        const { journals } = loadJournals()
        record = journals.find(
          (j) => j.id === journalId || String(j.name).toLowerCase() === journalId.toLowerCase(),
        ) || null
      } catch { /* journals.json 缺失时继续走 publisher 回退 */ }
    }
    if (!record) lookupWarning = `journals.json 里没有 ${journalId}，版式回退到通用族（字数等硬限制将无法检查）`
  }

  const effectivePublisher = publisher || record?.publisher || null
  const familyId =
    (journalId && formats.journalToFamily[journalId]) ||
    (effectivePublisher && formats.publisherToFamily[effectivePublisher]) ||
    formats.defaultFamily

  const family = familyById(familyId)
  const citation = family.citation || 'apa-7'

  return {
    journalId: record?.id ?? journalId,
    journal: record ?? null,
    publisher: effectivePublisher,
    family,
    familyId: family.id,
    latex: family.latex,
    docx: family.docx,
    citation,
    citationLabel: (() => {
      try { return styleById(citation).label } catch { return citation }
    })(),
    limits: record?.limits ?? null,
    warning: lookupWarning,
  }
}

/** 所有已知族的简报，用于 preflight 与文档。 */
export function listFamilies() {
  const formats = loadFormats()
  const rows = Object.entries(formats.families).map(([id, family]) => ({
    id,
    label: family.label,
    latexClass: family.latex.class,
    fallbackClass: family.latex.fallbackClass,
    pageSize: family.docx.pageSize,
    bodyPt: family.docx.bodyPt,
    lineSpacing: family.docx.lineSpacing,
    lineNumbers: family.docx.lineNumbers,
    citation: family.citation,
    publishers: Object.entries(formats.publisherToFamily)
      .filter(([, value]) => value === id)
      .map(([key]) => key),
  }))
  rows.push({
    id: formats.defaultFamily,
    label: formats.genericFamily.label,
    latexClass: formats.genericFamily.latex.class,
    fallbackClass: formats.genericFamily.latex.fallbackClass,
    pageSize: formats.genericFamily.docx.pageSize,
    bodyPt: formats.genericFamily.docx.bodyPt,
    lineSpacing: formats.genericFamily.docx.lineSpacing,
    lineNumbers: formats.genericFamily.docx.lineNumbers,
    citation: formats.genericFamily.citation,
    publishers: ['（兜底）'],
  })
  return rows
}
