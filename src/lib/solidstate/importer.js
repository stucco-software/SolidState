import { nquadsToNode, nodeToNQuads, sameGraph } from './rdf.js'
import { idFromUrl } from './layout.js'
import { isProjectable } from './internal.js'
import { docState } from './pouch.js'
import { readProjection, writeProjection } from './projections.js'

// Pull a graph's pod copy into PouchDB.
// - Nodes this device has never seen are added, with a projection record so
//   the projector doesn't write them straight back.
// - Nodes this device has are kept. If the pod copy changed since we last
//   wrote it, that's reported as an outside change, not overwritten.
// - Nodes this device has but never projected (a device upgrading from 0.2
//   after another device migrated) are adopted when the pod copy has the same
//   triples, and reported as an outside change when it doesn't.
// - Nodes this device deleted (or has a pending projection for) are left
//   alone, so deletes aren't undone.
// Run it while the projector is stopped.
export const importContainer = async ({ db, pod, containerUrl, context, emit = () => {} }) => {
  let added = 0
  for (const url of await pod.list(containerUrl)) {
    const id = idFromUrl(containerUrl, url)
    if (!isProjectable(id)) continue
    const { state } = await docState(db, id)
    const projection = await readProjection(db, id)

    if (state === 'present') {
      if (projection) {
        const etag = await pod.etag(url)
        if (etag && etag !== projection.etag) emit('outside-change', { id, url })
        continue
      }
      const remote = await pod.get(url)
      if (!remote) continue
      const local = (await docState(db, id)).doc
      if (await sameGraph(remote.body, await nodeToNQuads(local, context))) {
        await writeProjection(db, id, { rev: local._rev, etag: remote.etag })
      } else {
        emit('outside-change', { id, url })
      }
      continue
    }
    if (state === 'deleted' || projection) continue

    const remote = await pod.get(url)
    if (!remote) continue
    const node = await nquadsToNode(remote.body, context, id)
    if (!node) {
      emit('sync-error', { id, error: new Error(`${url} has no node ${id}`) })
      continue
    }
    const { rev } = await db.put({ ...node, _id: id })
    await writeProjection(db, id, { rev, etag: remote.etag })
    added += 1
  }
  return { added }
}
