import { nquadsToNode, nodeToNQuads, sameGraph } from './rdf.js'
import { idFromUrl } from './layout.js'
import { isProjectable } from './internal.js'
import { docState } from './pouch.js'
import { readProjection, writeProjection, forAnotherTarget, droppedElsewhere } from './projections.js'

// Pull a graph's pod copy into PouchDB.
// - Nodes this device has never seen are added, with a projection record so
//   the projector doesn't write them straight back.
// - Nodes this device has are kept. If the pod copy changed since we last
//   wrote it, that's reported as an outside change, not overwritten.
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
export const importContainer = async ({ db, pod, containerUrl, context, emit = () => {}, untargeted = containerUrl }) => {
  // A throwing listener must not break the import.
  const safeEmit = (name, detail) => {
    try {
      emit(name, detail)
    } catch {}
  }
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
          if (etag && etag !== record.etag) safeEmit('outside-change', { id, url })
          continue
        }
        const remote = await pod.get(url)
        if (!remote) continue
        if (await sameGraph(remote.body, await nodeToNQuads(local, context))) {
          noteEtag(remote.etag)
          await writeProjection(db, id, { rev: local._rev, etag: remote.etag, target: containerUrl })
        } else {
          safeEmit('outside-change', { id, url })
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
