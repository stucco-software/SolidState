import { threeWayMerge } from './merge.js'

// Conflicts arise when two devices edit the same doc before replicating:
// PouchDB keeps both revisions, picks a deterministic winner, and lists the
// others in _conflicts. Nothing is lost; the app shows them and the user
// merges (see merge.js).

const revList = (doc) => doc._revisions.ids.map((hash, i) => `${doc._revisions.start - i}-${hash}`)

const getOrNull = async (db, id, options) => {
  try {
    return await db.get(id, options)
  } catch (e) {
    if (e.status === 404) return null
    throw e
  }
}

const strip = ({ _revisions, _conflicts, ...doc }) => doc

// The winner and each competing revision, each with its common ancestor with
// the winner. Replication carries only each branch's latest revision, never
// the ancestor, so a device that received a branch by replication asks the
// sync server (`remote`) for it. null once compaction removed it everywhere.
// Returns null when the doc isn't conflicted.
export const conflicts = async (db, id, { remote } = {}) => {
  const winner = await getOrNull(db, id, { conflicts: true, revs: true })
  if (!winner?._conflicts?.length) return null
  const winnerRevs = revList(winner)
  const ancestor = async (rev) =>
    (await getOrNull(db, id, { rev })) ?? (remote ? await getOrNull(remote, id, { rev }).catch(() => null) : null)
  const others = []
  for (const rev of winner._conflicts) {
    const other = await db.get(id, { rev, revs: true })
    const ancestorRev = revList(other).find((r) => winnerRevs.includes(r))
    const base = ancestorRev ? await ancestor(ancestorRev) : null
    others.push({ doc: strip(other), base: base ? strip(base) : null })
  }
  return { winner: strip(winner), others }
}

// Branches with the same content aren't a real conflict. That happens when
// the same doc reached two devices by different routes (one edited it, the
// other imported the result), so they share no history; common when devices
// upgrade from 0.3 onto a sync server. Resolves such a doc and returns true.
export const resolveIfIdentical = async (db, id, options) => {
  const c = await conflicts(db, id, options)
  if (!c) return false
  if (!c.others.every((other) => threeWayMerge(null, c.winner, other.doc).clashes.length === 0)) return false
  await resolve(db, id, c.winner)
  return true
}

// Saves `merged` as the doc's new revision on the winning branch and deletes
// the losing branches, so the doc is no longer conflicted. Metadata in
// `merged` is ignored.
export const resolve = async (db, id, merged) => {
  const winner = await db.get(id, { conflicts: true })
  const { _id, _rev, _conflicts, _revisions, ...body } = merged
  const saved = await db.put({ ...body, _id: id, _rev: winner._rev })
  const losers = winner._conflicts ?? []
  if (losers.length) await db.bulkDocs(losers.map((rev) => ({ _id: id, _rev: rev, _deleted: true })))
  return saved
}

export const hasConflicts = async (db) => {
  const { rows } = await db.allDocs({ include_docs: true, conflicts: true })
  return rows.some((row) => row.doc?._conflicts?.length)
}
