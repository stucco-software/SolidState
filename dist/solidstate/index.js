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
// event with no listener throws in Node's EventEmitter.) A listener that
// throws is swallowed so it can't break sync.
//
// store.ready never rejects. It resolves to:
//   { ok: true, containerUrl }   pod sync is running
//   { ok: true, local: true }    no session: local-only
//   { ok: false, error }         start-up failed (also emitted as sync-error { stage: 'start' });
//                                local reads and writes still work
//   { ok: false, disposed: true } the store was disposed before start-up finished
//
// store.dispose() stops sync and cancels change feeds; the local database stays usable.
// store.close() does dispose() and then releases the PouchDB handle; use it when
// discarding the store (e.g. recreating it on a session change). store.clear() destroys
// the local database (after dispose()).
//
// store.info() is PouchDB's info(): its doc_count includes solidstate's internal
// bookkeeping docs (projection records), so it isn't a node count; use getAll().
const SolidState = (config) => {
  const db = new PouchDB({ name: config.graph, ...(config.pouch ?? {}) })
  const emitter = new EventEmitter()
  // A throwing listener must not abort start-up or projection.
  const emit = (name, detail = {}) => {
    try { emitter.emit(name, detail) } catch {}
  }
  const feeds = new Set()
  let projector = null
  let disposed = false
  let started = false

  const startPodSync = async () => {
    const { fetch, info } = config.session
    const rootUrl = await discoverStorageRoot(info.webId, fetch)
    const containerUrl = new URL(config.container ?? `solidstate/${config.graph}/`, rootUrl).href
    const context = config.context ?? legacyContext
    const pod = createPodClient(fetch)
    await pod.ensurePath(rootUrl, containerUrl)
    if (disposed) return { ok: false, disposed: true }
    projector = createProjector({ db, pod, containerUrl, context, emit })
    // Import first: a device upgrading after another device migrated adopts
    // the pod copies instead of fighting them.
    await importContainer({ db, pod, containerUrl, context, emit })
    if (disposed) return { ok: false, disposed: true }
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
    if (disposed) return { ok: false, disposed: true }
    await projector.start()
    // dispose() may have landed while start() was running.
    if (disposed) {
      projector.stop()
      return { ok: false, disposed: true }
    }
    started = true
    emit('ready', { containerUrl })
    return { ok: true, containerUrl }
  }

  const ready = config.session
    ? startPodSync().catch((error) => {
      // A failure inside projector.start() must not leave its live feed running.
      projector?.stop()
      emit('sync-error', { stage: 'start', error })
      return { ok: false, error }
    })
    : Promise.resolve({ ok: true, local: true })

  // Bound to this PouchDB (0.2 exposed an unbound method that crashed in the
  // browser), and filtered so callers never see solidstate's internal docs.
  // A caller's filter function is combined with ours; a named (design doc)
  // filter isn't supported.
  const changes = (options = {}) => {
    if (typeof options.filter === 'string') {
      throw new TypeError('solidstate changes() supports filter functions only')
    }
    const own = typeof options.filter === 'function' ? options.filter : null
    const feed = db.changes({ ...options, filter: (doc) => !isInternal(doc._id) && (!own || own(doc)) })
    feeds.add(feed)
    feed.on('complete', () => feeds.delete(feed))
    feed.on('error', () => feeds.delete(feed))
    return feed
  }

  const dispose = async () => {
    disposed = true
    projector?.stop()
    for (const feed of feeds) feed.cancel()
    feeds.clear()
    // Start-up may be mid-flight; wait for it to notice `disposed`, then make
    // sure a projector it created or started in the meantime is stopped.
    await ready
    projector?.stop()
    await projector?.idle()
  }

  const close = async () => {
    await dispose()
    await db.close()
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
      if (!started || disposed) return
      await projector.projectAll()
      await projector.idle()
    },
    dispose,
    close,
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
