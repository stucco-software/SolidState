import { projectionId, PROJECTION_PREFIX } from './internal.js'
import { docState } from './pouch.js'

// What the projector last wrote to the pod for a node: the node revision it
// wrote, and the ETag the pod gave back. Two devices can record the same
// projection; once replicated, the records conflict. They describe the same
// pod resource, so the winner is kept and the rest dropped.
export const readProjection = async (db, id) => {
  const record = (await docState(db, projectionId(id), { conflicts: true })).doc
  if (!record?._conflicts?.length) return record
  await db.bulkDocs(record._conflicts.map((rev) => ({ _id: record._id, _rev: rev, _deleted: true })))
  const { _conflicts, ...winner } = record
  return winner
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
