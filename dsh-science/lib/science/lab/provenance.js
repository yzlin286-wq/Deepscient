/**
 * 溯源链：每一次 create / update / run / analyze 都记一行，行与行用 hash 串起来。
 *
 * 为什么不用简单的时间戳日志：时间戳挡不住「事后删掉一条记录」和「改一条记录的数字」。
 * 链式 hash 让这两种操作都可检出——删掉中间一行，后续 prev_hash 就对不上。
 *
 * 这条链不是防篡改的密码学证明（本地库，用的人有写权限），
 * 它的价值是让**无意的**改写与**有意的**挑选都留下痕迹，并且能被 science_provenance 一键验出来。
 */
import { createHash, randomUUID } from 'node:crypto'

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 稳定序列化：键排序，保证同样内容算出同样的 hash。 */
function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`
}

export { stableJson }

function hashOf({ seq, prevHash, projectId, subject, subjectId, action, actor, detailJson, createdAt }) {
  return sha256([seq, prevHash ?? '', projectId ?? '', subject, subjectId, action, actor ?? '', detailJson ?? '', createdAt].join('|'))
}

/**
 * 追加一条溯源记录，返回该记录。
 * seq 在项目内单调递增；prevHash 取同项目上一条的 hash（跨项目也允许，此时 prevHash 取全局最后一条）。
 */
export function append(store, { projectId = null, subject, subjectId, action, actor = 'agent', detail = null }) {
  const db = store.db
  const last = projectId
    ? db.prepare('SELECT seq, hash FROM provenance WHERE project_id = ? ORDER BY seq DESC LIMIT 1').get(projectId)
    : db.prepare('SELECT seq, hash FROM provenance ORDER BY created_at DESC, seq DESC LIMIT 1').get()
  const seq = (Number(last?.seq) || 0) + 1
  const prevHash = last?.hash ?? null
  const createdAt = Date.now()
  const detailJson = detail === null ? null : stableJson(detail)
  const hash = hashOf({ seq, prevHash, projectId, subject, subjectId, action, actor, detailJson, createdAt })
  const id = `pv_${randomUUID().slice(0, 8)}`
  db.prepare(`
    INSERT INTO provenance(id, project_id, subject, subject_id, action, actor, detail_json, seq, prev_hash, hash, created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, projectId, subject, String(subjectId), action, actor, detailJson, seq, prevHash, hash, createdAt)
  return { id, seq, prevHash, hash, createdAt }
}

/** 读一个项目的溯源链，按 seq 升序。 */
export function listByProject(store, projectId, { limit = 200 } = {}) {
  return store.db.prepare(`
    SELECT * FROM provenance WHERE project_id = ? ORDER BY seq ASC LIMIT ?
  `).all(projectId, limit).map(rowToEntry)
}

/** 读某个对象（表 + id）的溯源链。 */
export function listBySubject(store, subject, subjectId, { limit = 200 } = {}) {
  return store.db.prepare(`
    SELECT * FROM provenance WHERE subject = ? AND subject_id = ? ORDER BY seq ASC LIMIT ?
  `).all(subject, String(subjectId), limit).map(rowToEntry)
}

function rowToEntry(row) {
  return {
    id: row.id,
    seq: row.seq,
    projectId: row.project_id,
    subject: row.subject,
    subjectId: row.subject_id,
    action: row.action,
    actor: row.actor,
    detail: row.detail_json ? JSON.parse(row.detail_json) : null,
    prevHash: row.prev_hash,
    hash: row.hash,
    createdAt: row.created_at,
  }
}

/**
 * 验证一条链的完整性。
 *
 * 三件事一起查：
 *   1. seq 连续（缺号 = 有人删了）
 *   2. prevHash 指向上一条的 hash（错位 = 有人插了/改了）
 *   3. 重算 hash 与存储值一致（不一致 = 内容被改过）
 *
 * 时间戳参与 hash，所以用 Date.now() 重算必然失败——重算时用记录里存的 createdAt，
 * 这正是「原样重算」的意义：只要内容或时间被动过，hash 就对不上。
 */
export function verifyChain(store, projectId) {
  const entries = listByProject(store, projectId, { limit: 100000 })
  const problems = []
  let expectedSeq = 1
  let expectedPrev = null
  for (const entry of entries) {
    if (entry.seq !== expectedSeq) {
      problems.push({ kind: 'seq-gap', seq: entry.seq, expected: expectedSeq, id: entry.id })
    }
    if ((entry.prevHash ?? null) !== (expectedPrev ?? null)) {
      problems.push({ kind: 'prev-hash-mismatch', seq: entry.seq, id: entry.id, prevHash: entry.prevHash, expectedPrev })
    }
    const recomputed = hashOf({
      seq: entry.seq,
      prevHash: entry.prevHash,
      projectId: entry.projectId,
      subject: entry.subject,
      subjectId: entry.subjectId,
      action: entry.action,
      actor: entry.actor,
      detailJson: entry.detail === null ? null : stableJson(entry.detail),
      createdAt: entry.createdAt,
    })
    if (recomputed !== entry.hash) {
      problems.push({ kind: 'hash-mismatch', seq: entry.seq, id: entry.id, stored: entry.hash, recomputed })
    }
    expectedSeq = entry.seq + 1
    expectedPrev = entry.hash
  }
  return {
    ok: problems.length === 0,
    entries: entries.length,
    head: entries.length > 0 ? entries[entries.length - 1].hash : null,
    problems,
  }
}
