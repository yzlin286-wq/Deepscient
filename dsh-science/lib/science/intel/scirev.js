/**
 * SciRev锛氱湡瀹炲绋垮懆鏈熺殑浼楀寘鏁版嵁锛堥潤鎬?HTML锛屽瓧娈靛彲鐩存帴姝ｅ垯锛夈€? *
 * 瀹炴祴鍙В鏋愬瓧娈碉紙Nature锛?026-10锛夛細
 *   Duration first review round 2.0 months / Tot. handling time 4.0 months /
 *   Decision time immediate rejection 13 days / review rounds 1.6 /
 *   Difficulty of reviewer comments 3.4 / 5.0 / reports 2.8 / quality 3.1 / 90 reviews
 *
 * 璇氬疄鏉℃锛氳繖鏄紬鍖呫€侼ature 鏈?90 鏉℃牱鏈紝灏忎紬鍒婂彲鑳?0鈥? 鏉°€? * sampleSize < 10 鏃?confidence=low锛屼笖涓嶅弬涓庢帓搴忓井璋冦€? */

export const source = 'scirev'
const BASE = 'https://scirev.org/journal/'

const round1 = (x) => Math.round(x * 10) / 10

export function supports() {
  return true
}

/** SciRev 鐢ㄥ垔鍚?slug锛涜嫳寮?缇庡紡鎷煎啓涓嶅悓锛屽悇璇曚竴涓彉浣撱€?*/
export function slugCandidates(name) {
  const base = String(name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const out = [base]
  if (base.includes('behaviour')) out.push(base.replace(/behaviour/g, 'behavior'))
  if (base.includes('behavior')) out.push(base.replace(/behavior/g, 'behaviour'))
  return [...new Set(out)]
}

function toLines(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;|&gt;/g, ' ')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** label 涔嬪悗绗竴涓?鍊兼牱"琛岋紱`n/a` 涓庣┖鍊奸兘杩斿洖 null锛岀粷涓嶅綋 0銆?*/
function valueAfter(lines, label) {
  const i = lines.findIndex((l) => l.toLowerCase().startsWith(label.toLowerCase()))
  if (i < 0) return null
  for (let k = i + 1; k < Math.min(i + 4, lines.length); k += 1) {
    const line = lines[k]
    if (/^n\/a$/i.test(line)) return null
    /* 璧板埌涓嬩竴涓?label 璇存槑璇ュ瓧娈典负绌?*/
    if (/^(Duration|Tot\.|Decision|Average|Difficulty|Quality|Overall|Manuscripts|Articles|%|Immediately|Open access|Two-year)/i.test(line)) return null
    if (line.length <= 60) return line
  }
  return null
}

function num(text, pattern) {
  const m = String(text || '').match(pattern)
  if (!m) return null
  const v = Number(m[1])
  return Number.isFinite(v) ? v : null
}

export function parse(html) {
  const lines = toLines(html)
  const firstReview = valueAfter(lines, 'Duration first review round')
  const handling = valueAfter(lines, 'Tot. handling time')
  const immediate = valueAfter(lines, 'Decision time immediate rejection')
  const rounds = valueAfter(lines, 'Average number of review rounds')
  const difficulty = valueAfter(lines, 'Difficulty of reviewer comments')
  const reports = valueAfter(lines, 'Average number of review reports')
  const quality = valueAfter(lines, 'Quality of review reports')
  const overall = valueAfter(lines, 'Overall rating')
  const reviewLine = lines.find((l) => /^\d+\s+reviews?$/i.test(l))

  const payload = {
    firstReviewMonths: num(firstReview, /([\d.]+)\s*months?/i),
    handlingMonths: num(handling, /([\d.]+)\s*months?/i),
    immediateRejectDays: num(immediate, /([\d.]+)\s*days?/i),
    reviewRounds: num(rounds, /([\d.]+)/),
    commentDifficulty: num(difficulty, /([\d.]+)\s*\/\s*5/),
    difficultyLabel: (difficulty || '').match(/\(([a-z\- ]+)\)/i)?.[1] || null,
    reportsPerRound: num(reports, /([\d.]+)/),
    reportQuality: num(quality, /([\d.]+)\s*\/\s*5/),
    overallRating: num(overall, /([\d.]+)\s*\/\s*5/),
    reviewCount: reviewLine ? Number(reviewLine.match(/^(\d+)/)[1]) : 0,
    raw: { firstReview, handling, immediate, rounds, difficulty, reports, quality, overall },
  }
  return payload
}

export function confidenceFor(reviewCount) {
  if (!Number.isFinite(reviewCount) || reviewCount <= 0) return 'low'
  if (reviewCount >= 30) return 'high'
  if (reviewCount >= 10) return 'medium'
  return 'low'
}

/** 娌℃湁浠讳綍鏁板€煎瓧娈?鈫?璇ュ垔鍦?SciRev 鏃犳暟鎹紝鏁存簮缃?unavailable銆?*/
export function hasData(payload) {
  return Boolean(payload && (payload.reviewCount > 0
    || payload.firstReviewMonths !== null
    || payload.handlingMonths !== null
    || payload.immediateRejectDays !== null))
}

export async function fetchOne(journal, { client } = {}) {
  if (!client) return { ok: false, error: 'client-missing' }
  let lastError = 'not-found'
  for (const slug of slugCandidates(journal.name)) {
    const url = `${BASE}${slug}/`
    try {
      const res = await client.text(url, { accept: 'text/html' })
      if (!res.ok && res.status !== 200) { lastError = `HTTP ${res.status}`; continue }
      const payload = parse(res.text)
      if (!hasData(payload)) { lastError = 'no-crowdsourced-data'; continue }
      return {
        ok: true,
        sampleSize: payload.reviewCount,
        confidence: confidenceFor(payload.reviewCount),
        payload: { ...payload, url },
      }
    } catch (error) {
      lastError = error.message
    }
  }
  return { ok: false, error: lastError }
}

/** 连通性探针：打一本必定有页面的刊，确认能拿到可解析的评审表。 */
export async function probe(client, { timeoutMs = 15000 } = {}) {
  const started = Date.now()
  try {
    const res = await client.text('https://scirev.org/journal/nature/', { timeoutMs })
    const text = res.text || ''
    const parsed = /first review|review outcome|review speed/i.test(text) ? 1 : 0
    return { ok: res.ok && parsed === 1, ...(Number.isFinite(res.status) ? { status: res.status } : {}), ms: Date.now() - started, parsed }
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: error.message }
  }
}
export default { source, supports, fetchOne, parse, confidenceFor, slugCandidates, hasData, probe }
