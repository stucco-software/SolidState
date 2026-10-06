import { nquadsToNodes, legacyContext, stripPouch } from './rdf.js'
import { isProjectable } from './internal.js'
import { docState } from './pouch.js'
import { readProjection } from './projections.js'

const containerOf = (url) => url.slice(0, url.lastIndexOf('/') + 1)
const CREATED_BY = 'https://solidstate.rdf.systems/createdBy'

// Move a 0.2 graph (one resource holding every node, written with the legacy
// context) to one resource per node. Nodes this device lacks are imported and
// every node is projected. Only when all of them are in the pod is the old
// resource archived (same triples, private) and deleted.
export const migrateLegacy = async ({ db, pod, rootUrl, legacyUrl, archiveUrl, projector, emit = () => {} }) => {
  const legacy = await pod.get(legacyUrl)
  if (!legacy) return { migrated: false, reason: 'no-legacy-graph' }

  // 0.2 seeded every new graph with `<#> <…/createdBy> <SolidState> .`. Drop
  // it: it isn't a node, and a literal `<#>` doesn't even parse as n-quads.
  const body = legacy.body.split('\n').filter((line) => !line.includes(CREATED_BY)).join('\n')
  const nodes = (await nquadsToNodes(body, legacyContext))
    .map(stripPouch)
    .filter((node) => isProjectable(node['@id']))

  for (const node of nodes) {
    const id = node['@id']
    if ((await docState(db, id)).state !== 'missing') continue
    await db.put({ ...node, _id: id })
  }

  await projector.projectAll()
  await projector.idle()

  const pending = []
  for (const node of nodes) {
    const id = node['@id']
    const { state, doc } = await docState(db, id)
    if (state !== 'present') continue
    if ((await readProjection(db, id))?.rev !== doc._rev) pending.push(id)
  }
  if (pending.length) {
    emit('migration-incomplete', { reason: 'pending', pending })
    return { migrated: false, reason: 'pending', pending }
  }

  await pod.ensurePath(rootUrl, containerOf(archiveUrl))
  await pod.put(archiveUrl, legacy.body, { overwrite: true })
  const removed = await pod.remove(legacyUrl, { etag: legacy.etag })
  if (removed.conflict) {
    emit('migration-incomplete', { reason: 'legacy-changed' })
    return { migrated: false, reason: 'legacy-changed' }
  }
  emit('migrated', { count: nodes.length, archiveUrl })
  return { migrated: true, count: nodes.length }
}
