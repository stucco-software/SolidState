import { projectionId, PROJECTION_PREFIX, generation, revList } from './internal.js'
import { docState } from './pouch.js'

// What the projector last wrote to the pod for a node: the node revision it
// wrote, the ETag the pod gave back, and the container it wrote to (`target`;
// records from before 0.6 have none). Two devices can each record a
// projection; once replicated, the records conflict. The one naming the
// newest node revision describes the last write, so it's kept whole (PouchDB's
// own winner only breaks ties) and the rest are dropped. Except one thing:
// when another record names the same revision and container with a different
// ETag, both devices wrote that revision there, and only the write that
// landed last has the pod's ETag. Which one that was can't be told (PouchDB
// picks its winner by hash), so the kept record has no ETag: the next write
// goes without a precondition, and the import adopts the pod's ETag at start-up
// if the content matches.
export const readProjection = async (db, id) => {
  const record = (await docState(db, projectionId(id), { conflicts: true })).doc
  if (!record?._conflicts?.length) return record
  const { _conflicts, ...winner } = record
  const others = await Promise.all(_conflicts.map((rev) => db.get(record._id, { rev })))
  const newest = others.reduce((a, b) => (generation(b.rev) > generation(a.rev) ? b : a), winner)
  const unsure = [winner, ...others].some(
    (other) => other.rev === newest.rev && other.target === newest.target && other.etag !== newest.etag,
  )
  let kept = winner
  if (newest !== winner || unsure) {
    const { _id, _rev, ...fields } = newest
    if (unsure) delete fields.etag
    const saved = await db.put({ ...fields, _id: winner._id, _rev: winner._rev })
    kept = { ...fields, _id: winner._id, _rev: saved.rev }
  }
  await db.bulkDocs(_conflicts.map((rev) => ({ _id: record._id, _rev: rev, _deleted: true })))
  return kept
}

// `rev` is the node doc's revision, not this record's own PouchDB `_rev`.
// `target` is the container the node was written to. Without a sync server
// the record also keeps (pull.js):
//   base          the node as it last went to or came from the pod, in pod
//                 shape: the ancestor for a three-way merge with a pod change
//   listed        the container listing's modification time (ms) for it at
//                 the last pull
//   listedSettled whether that time can't hide a later write (sub-second, or
//                 whole seconds at least two seconds old)
// Fields not given keep their previous value; pass null to clear one.
const FIELDS = ['rev', 'etag', 'target', 'base', 'listed', 'listedSettled']
export const writeProjection = async (db, id, fields) => {
  const previous = await readProjection(db, id)
  const record = { _id: projectionId(id), ...(previous ? { _rev: previous._rev } : {}) }
  for (const field of FIELDS) {
    const value = field in fields ? fields[field] : previous?.[field]
    if (value !== undefined && value !== null) record[field] = value
  }
  await db.put(record)
}

// A record is for another container when the one it names isn't
// `containerUrl`. Records from before 0.6 name none: they were written where
// this device's store projected before it first ran 0.6 (`untargeted`, see
// untargetedContainer). Until the store moves, that's `containerUrl`, so
// upgrading re-projects nothing.
export const forAnotherTarget = (record, containerUrl, untargeted = containerUrl) =>
  Boolean(record) && (record.target ?? untargeted) !== containerUrl

// Drops a node's record. The tombstone names the container whose copy was
// deleted (`target`): devices projecting into another container still have
// a copy to delete (see droppedElsewhere). Tombstone bodies replicate.
export const dropProjection = async (db, id, { target } = {}) => {
  const previous = await readProjection(db, id)
  if (previous) await db.put({ _id: previous._id, _rev: previous._rev, _deleted: true, ...(target ? { target } : {}) })
}

// Whether a device projecting into another container than `containerUrl`
// dropped this node's record: it deleted its own copy, and a copy in
// `containerUrl` is left over. False while the record is live, and for a
// tombstone naming `containerUrl`. A tombstone from before 0.6 names none and
// counts as `untargeted`'s, like a record.
export const droppedElsewhere = async (db, id, containerUrl, untargeted = containerUrl) => {
  let leaves
  try {
    leaves = (await db.get(projectionId(id), { open_revs: 'all' })).map((leaf) => leaf.ok).filter(Boolean)
  } catch (e) {
    if (e.status === 404) return false
    throw e
  }
  if (!leaves.length || leaves.some((leaf) => !leaf._deleted)) return false
  const last = leaves.reduce((a, b) => (generation(b._rev) > generation(a._rev) ? b : a))
  return forAnotherTarget(last, containerUrl, untargeted)
}

// Where this device's records from before 0.6 (which name no container) were
// written: the container its store projected into when it first ran 0.6.
// Before then every record went to the owner's pod (there was no `storage`
// option, and only the owner synced a site). Kept in a _local doc, which
// never replicates: each device remembers its own.
const UNTARGETED = '_local/solidstate-untargeted'
export const untargetedContainer = async (db, containerUrl) => {
  try {
    return (await db.get(UNTARGETED)).container
  } catch (e) {
    if (e.status !== 404) throw e
  }
  try {
    await db.put({ _id: UNTARGETED, container: containerUrl })
    return containerUrl
  } catch (e) {
    // Another store on this database got there first; its answer stands.
    if (e.status !== 409) throw e
    return (await db.get(UNTARGETED)).container
  }
}

export const listProjections = async (db) => {
  const { rows } = await db.allDocs({
    startkey: PROJECTION_PREFIX,
    endkey: `${PROJECTION_PREFIX}\uFFF0`,
    include_docs: true,
  })
  return rows.map((row) => ({ ...row.doc, id: row.id.slice(PROJECTION_PREFIX.length) }))
}

// Whether `record` puts this device behind: another device recorded a
// revision at least as deep as `rev` that this device has never seen. Depth
// alone doesn't decide it: a deeper branch that ended in a delete loses to
// any live one, so a revision this device has on some branch (live or
// deleted) is out of date, not ahead.
export const behind = async (db, id, record, rev) => {
  if (!record || record.rev === rev || generation(record.rev) < generation(rev)) return false
  const leaves = await db.get(id, { open_revs: 'all', revs: true })
  return !leaves.some(({ ok }) => ok && revList(ok).includes(record.rev))
}
