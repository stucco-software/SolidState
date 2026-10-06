import PouchDB from 'pouchdb'
// Default import: 'events' resolves to Node's builtin in tests and to the npm
// package in the browser; both export EventEmitter as the default.
import EventEmitter from 'events'
import { put, post, patch, clear, getEntity, getAll, deleteStatements, query } from './crud.js'
import { legacyContext } from './rdf.js'
import { discoverStorageRoot } from './storage.js'
import { createPodClient } from './podClient.js'
import { createProjector } from './projector.js'
import { importContainer } from './importer.js'
import { migrateLegacy } from './migrate.js'
import { isInternal } from './internal.js'

export const VERSION = '0.3.0'

// config:
//   graph      PouchDB name; also the 0.2 resource path (relative to the WebID origin)
//   session    { info: { webId }, fetch }; omit for local-only
//   context    JSON-LD context used to write and read pod RDF (default: the 0.2 context)
//   container  pod path for this graph's node resources, relative to the storage root
//              (default: `solidstate/<graph>/`)
//   legacy     { path?, archivePath }: migrate a 0.2 graph at `<WebID origin>/<path ?? graph>`,
//              archiving it to `<storage root>/<archivePath>`
//   pouch      extra PouchDB constructor options (e.g. { adapter: 'memory' } in tests)
//
// Events (store.on): ready, projected, conflicted, outside-change, migrated,
// migration-incomplete, sync-error. ('sync-error', not 'error': an 'error'
// event with no listener throws in Node's EventEmitter.)
const SolidState = (config) => {
  const db = new PouchDB({ name: config.graph, ...(config.pouch ?? {}) })
  const emitter = new EventEmitter()
  const emit = (name, detail = {}) => emitter.emit(name, detail)
  const feeds = new Set()
  let projector = null
  let disposed = false

  const startPodSync = async () => {
    const { fetch, info } = config.session
    const rootUrl = await discoverStorageRoot(info.webId, fetch)
    const containerUrl = new URL(config.container ?? `solidstate/${config.graph}/`, rootUrl).href
    const context = config.context ?? legacyContext
    const pod = createPodClient(fetch)
    await pod.ensurePath(rootUrl, containerUrl)
    if (disposed) return
    projector = createProjector({ db, pod, containerUrl, context, emit })
    // Import first: a device upgrading after another device migrated adopts
    // the pod copies instead of fighting them.
    await importContainer({ db, pod, containerUrl, context, emit })
    if (disposed) return
    if (config.legacy) {
      // A failed migration must not switch pod sync off; it retries next start.
      try {
        const origin = `${new URL(info.webId).origin}/`
        await migrateLegacy({
          db, pod, rootUrl, projector, emit,
          legacyUrl: new URL(config.legacy.path ?? config.graph, origin).href,
          archiveUrl: new URL(config.legacy.archivePath, rootUrl).href,
        })
      } catch (error) {
        emit('sync-error', { stage: 'migrate', error })
      }
    }
    if (disposed) return
    await projector.start()
    emit('ready', { containerUrl })
  }

  const ready = config.session
    ? startPodSync().catch((error) => emit('sync-error', { stage: 'start', error }))
    : Promise.resolve()

  // Bound to this PouchDB (0.2 exposed an unbound method that crashed in the
  // browser), and filtered so callers never see solidstate's internal docs.
  // A caller's filter function is combined with ours; a named (design doc)
  // filter isn't supported.
  const changes = (options = {}) => {
    const own = typeof options.filter === 'function' ? options.filter : null
    const feed = db.changes({ ...options, filter: (doc) => !isInternal(doc._id) && (!own || own(doc)) })
    feeds.add(feed)
    feed.on('complete', () => feeds.delete(feed))
    return feed
  }

  const dispose = async () => {
    disposed = true
    projector?.stop()
    for (const feed of feeds) feed.cancel()
    feeds.clear()
    await projector?.idle()
  }

  return {
    version: VERSION,
    config,
    ready,
    on: (name, listener) => {
      emitter.on(name, listener)
      return () => emitter.off(name, listener)
    },
    changes,
    info: () => db.info(),
    // Everything written so far has reached the pod (or failed). Queues every
    // doc rather than trusting the live feed, which may not have delivered the
    // latest write yet.
    idle: async () => {
      if (!projector || disposed) return
      await projector.projectAll()
      await projector.idle()
    },
    dispose,
    post: post(db),
    put: put(db),
    patch: patch(db),
    get: getEntity(db),
    getAll: getAll(db),
    query: query(db),
    delete: deleteStatements(db),
    clear: async () => {
      await dispose()
      return clear(db)()
    },
  }
}

export default SolidState
