import { projectionId, PROJECTION_PREFIX, generation } from './internal.js'
import { docState } from './pouch.js'

// What the projector last wrote to the pod for a node: the node revision it
// wrote, and the ETag the pod gave back. Two devices can each record a
// projection; once replicated, the records conflict. The one naming the
// newest node revision describes what's on the pod now, so it's kept (PouchDB's
// own winner only breaks ties) and the rest are dropped.
export const readProjection = async (db, id) => {
  const record = (await docState(db, projectionId(id), { conflicts: true })).doc
  if (!record?._conflicts?.length) return record
  const { _conflicts, ...winner } = record
  const others = await Promise.all(_conflicts.map((rev) => db.get(record._id, { rev })))
  const newest = others.reduce((a, b) => (generation(b.rev) > generation(a.rev) ? b : a), winner)
  let kept = winner
  if (newest !== winner) {
    const saved = await db.put({ ...winner, rev: newest.rev, etag: newest.etag })
    kept = { ...winner, _rev: saved.rev, rev: newest.rev, etag: newest.etag }
  }
  await db.bulkDocs(_conflicts.map((rev) => ({ _id: record._id, _rev: rev, _deleted: true })))
  return kept
}

// `rev` is the node doc's revision, not this record's own PouchDB `_rev`.
export const writeProjection = async (db, id, { rev, etag }) => {
  const previous = await readProjection(db, id)
  await db.put({ _id: projectionId(id), ...(previous ? { _rev: previous._rev } : {}), rev, etag })
}

export const dropProjection = async (db, id) => {
  const previous = await readProjection(db, id)
  if (previous) await db.remove(previous)
}

export const listProjections = async (db) => {
  const { rows } = await db.allDocs({
    startkey: PROJECTION_PREFIX,
    endkey: `${PROJECTION_PREFIX}\uFFF0`,
    include_docs: true,
  })
  return rows.map((row) => ({ ...row.doc, id: row.id.slice(PROJECTION_PREFIX.length) }))
}
