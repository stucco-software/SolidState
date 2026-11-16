import { nquadsToNode, nodeToNQuads, sameGraph } from './rdf.js'
import { idFromUrl, nodeUrl } from './layout.js'
import { isProjectable } from './internal.js'
import { docState } from './pouch.js'
import { readProjection, writeProjection, forAnotherTarget, droppedElsewhere, behind } from './projections.js'

// A pod copy whose ETag isn't the recorded one is an outside change only if
// its content differs too. Another device may have written exactly what this
// device would project for the node's winning revision, with its record
// still on its way (or a crash came between a PUT and its record). That copy
// is adopted, quietly. Not when the record names a deeper revision this
// device hasn't seen: adopting would roll the record back. Returns
// 'adopted', 'behind', 'gone' or 'changed'.
const adoptIfSame = async ({ db, pod, containerUrl, context, id, url, local, record }) => {
  if (await behind(db, id, record, local._rev)) return 'behind'
  const remote = await pod.get(url)
  if (!remote) return 'gone'
  if (!(await sameGraph(remote.body, await nodeToNQuads(local, context)))) return 'changed'
  await writeProjection(db, id, { rev: local._rev, etag: remote.etag, target: containerUrl })
  return 'adopted'
}

// Pull a graph's pod copy into PouchDB.
// - Nodes this device has never seen are added, with a projection record so
//   the projector doesn't write them straight back.
// - Nodes this device has are kept. If the pod copy changed since we last
//   wrote it, and holds something other than this device's winning revision,
//   that's an outside change: reported (or handed to `outside`), never
//   overwritten. If it holds that revision, its ETag is adopted.
// - Nodes whose record is for another container (the store moved) are left
//   to the projector, which writes them here again. No outside change.
// - A copy of a node that was deleted, whose record was dropped in another
//   container, is left over and deleted. The projector does the same for
//   deletions that arrive live; this catches those that came in with the
//   catch-up from the sync server, before the projector was watching.
// - Nodes this device has but never projected (a device upgrading from 0.2
//   after another device migrated) are adopted when the pod copy has the same
//   triples, and reported as an outside change when it doesn't.
// - Nodes this device deleted (or has a pending projection for) are never
//   imported back, so deletes aren't undone. Their pod copy stays, except
//   for the leftover copies above.
// - A doc deleted locally before it was ever projected leaves its pod copy in
//   place: the importer won't resurrect it, and with no projection the
//   projector has nothing to delete. Remove it in the pod by hand.
// - One bad resource doesn't stop the import: it is reported as a sync-error
//   (stage 'import') and the rest carry on.
// Run it while the projector is stopped.
export const importContainer = async ({ db, pod, containerUrl, context, emit = () => {}, outside, untargeted = containerUrl }) => {
  // A throwing listener must not break the import.
  const safeEmit = (name, detail) => {
    try {
      emit(name, detail)
    } catch {}
  }
  // With a sync server, a suspected outside change goes to `outside`, to be
  // looked at again once replication has caught up (recheckOutside).
  const report = outside ?? ((id, url) => safeEmit('outside-change', { id, url }))
  let added = 0
  let warnedNoEtag = false
  const noteEtag = (etag) => {
    if (etag || warnedNoEtag) return
    warnedNoEtag = true
    safeEmit('sync-error', {
      stage: 'import',
      error: new Error('The pod returned no ETag; changes made to these resources outside solidstate cannot be detected'),
    })
  }

  for (const url of await pod.list(containerUrl)) {
    const id = idFromUrl(containerUrl, url)
    if (!isProjectable(id)) continue
    try {
      const { state, doc: local } = await docState(db, id)
      const record = await readProjection(db, id)

      if (state === 'present') {
        if (forAnotherTarget(record, containerUrl, untargeted)) continue
        if (record) {
          const etag = await pod.etag(url)
          if (etag && etag !== record.etag) {
            const found = await adoptIfSame({ db, pod, containerUrl, context, id, url, local, record })
            if (found === 'changed' || found === 'behind') report(id, url)
          }
          continue
        }
        const remote = await pod.get(url)
        if (!remote) continue
        if (await sameGraph(remote.body, await nodeToNQuads(local, context))) {
          noteEtag(remote.etag)
          await writeProjection(db, id, { rev: local._rev, etag: remote.etag, target: containerUrl })
        } else {
          report(id, url)
        }
        continue
      }
      if (state === 'deleted') {
        if (await droppedElsewhere(db, id, containerUrl, untargeted)) await pod.remove(url)
        continue
      }
      if (record) continue

      const remote = await pod.get(url)
      if (!remote) continue
      const node = await nquadsToNode(remote.body, context, id)
      if (!node) throw new Error(`${url} has no node ${id}`)
      noteEtag(remote.etag)
      const { rev } = await db.put({ ...node, _id: id })
      await writeProjection(db, id, { rev, etag: remote.etag, target: containerUrl })
      added += 1
    } catch (error) {
      safeEmit('sync-error', { id, url, stage: 'import', error })
    }
  }
  return { added }
}

// Looks again at nodes the import suspected of changing outside solidstate,
// once live replication has caught up: another device's newer revision or
// its record may have arrived since. Reports only what still differs.
// Deleted and conflicted nodes are left to the projector, as are nodes
// still behind another device's record. The projector holds these nodes
// while this runs, so no write of theirs can race it.
export const recheckOutside = async ({ db, pod, containerUrl, context, ids, emit = () => {}, untargeted = containerUrl }) => {
  const safeEmit = (name, detail) => {
    try {
      emit(name, detail)
    } catch {}
  }
  for (const id of ids) {
    const url = nodeUrl(containerUrl, id)
    try {
      const { state, doc: local } = await docState(db, id, { conflicts: true })
      if (state !== 'present' || local._conflicts?.length) continue
      const record = await readProjection(db, id)
      if (forAnotherTarget(record, containerUrl, untargeted)) continue
      if (record) {
        const etag = await pod.etag(url)
        if (!etag || etag === record.etag) continue
      }
      // No record (never projected here), or the pod's ETag isn't the
      // recorded one: compare content.
      if ((await adoptIfSame({ db, pod, containerUrl, context, id, url, local, record })) === 'changed') {
        safeEmit('outside-change', { id, url })
      }
    } catch (error) {
      safeEmit('sync-error', { id, url, stage: 'recheck', error })
    }
  }
}
