import PouchDB from 'pouchdb'
// Default import: 'events' resolves to Node's builtin in tests and to the npm
// package in the browser; both export EventEmitter as the default.
import EventEmitter from 'events'
import { put, post, patch, clear, getEntity, getAll, deleteStatements, query } from './crud.js'
import { legacyContext } from './rdf.js'
import { discoverStorageRoot, withSlash } from './storage.js'
import { createPodClient } from './podClient.js'
import { createProjector } from './projector.js'
import { importContainer, recheckOutside } from './importer.js'
import { migrateLegacy } from './migrate.js'
import { isInternal } from './internal.js'
import { createReplication, remoteFor } from './replication.js'
import { createPuller } from './pull.js'
import { untargetedContainer } from './projections.js'
import { conflicts, resolve, hasConflicts } from './conflicts.js'

export const VERSION = '0.5.0'

// config:
//   graph      PouchDB name; also the 0.2 resource path (relative to the WebID origin)
//   session    { info: { webId }, fetch }; omit for local-only
//   context    JSON-LD context used to write and read pod RDF (default: the 0.2 context)
//   container  pod path for this graph's node resources, relative to the storage root
//              (default: `solidstate/<graph>/`)
//   storage    storage root URL to project into and import from, e.g. a site
//              owner's when they aren't the signed-in person (default: the
//              session WebID's, from its profile's pim:storage). The session
//              still signs every request. Only used with a session.
//              `legacy` still reads from the session WebID's origin, so never combine them.
//   legacy     { path?, archivePath }: migrate a 0.2 graph at `<WebID origin>/<path ?? graph>`,
//              archiving it to `<storage root>/<archivePath>`
//   pouch      extra PouchDB constructor options (e.g. { adapter: 'memory' } in tests)
//   sync       { url, fetch } (a CouchDB database through the sync server,
//              fetch signs requests) or { remote: PouchDB } (tests). Devices
//              replicate through it; only used with a session.
//   compactOnStart  false to skip compacting the local database after start-up
//
// Events (store.on): ready, projected, pulled ({ id, how }), conflicted, outside-change, migrated,
// migration-incomplete, replication ({ state: 'active' | 'idle' | 'offline' }),
// compacted, sync-error. ('sync-error', not 'error': an 'error'
// event with no listener throws in Node's EventEmitter.) A listener that
// throws is swallowed so it can't break sync.
//
// outside-change is reported once a pod copy differs in content from this
// device's winning revision. With a sync server, start-up waits until live
// replication has caught up before reporting, since the difference may be
// another device's edit on its way. Without one, start-up pulls instead
// (pull.js), which merges the difference.
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
  let puller = null
  let replication = null
  let remote = null
  let compaction = Promise.resolve()
  let rechecking = Promise.resolve()
  // Runs once, the first time live replication goes idle (see suspects).
  let afterIdle = null
  let disposed = false
  let started = false

  const startPodSync = async () => {
    const { fetch, info } = config.session
    // In standard form, as discoverStorageRoot returns it: ensurePath cuts
    // the container's URL at the root's length. Not resolved against
    // anything, so a relative or invalid root fails start-up here.
    const rootUrl = config.storage ? withSlash(new URL(config.storage).href) : await discoverStorageRoot(info.webId, fetch)
    const containerUrl = new URL(config.container ?? `solidstate/${config.graph}/`, rootUrl).href
    const context = config.context ?? legacyContext
    const pod = createPodClient(fetch)
    await pod.ensurePath(rootUrl, containerUrl)
    if (disposed) return { ok: false, disposed: true }
    // Projection records from before 0.6 name no container. They went where
    // this device's store projected when it first ran 0.6, which it
    // remembers (projections.js). Until the store moves, that's here.
    const untargeted = await untargetedContainer(db, containerUrl)
    remote = config.sync ? remoteFor(config.sync) : null
    // Without a sync server, devices share the pod directly and pull each
    // other's edits from it (pull.js).
    const podOnly = !config.sync
    const gate = { pausedUntil: 0 }
    projector = createProjector({
      db, pod, containerUrl, context, emit, podOnly, gate, untargeted,
      pullNode: (id) => puller.pullNode(id),
    })
    if (podOnly) {
      puller = createPuller({ db, pod, containerUrl, context, emit, gate, untargeted, enqueue: (id) => projector.enqueue(id) })
    }
    // With a sync server, catch up from it first: a fresh device gets every
    // doc and every projection record in one pull. The pod import below then
    // only fills in what the server lacked (a new server, a migration).
    let caughtUp = true
    if (config.sync) {
      const onIdle = () => {
        const run = afterIdle
        afterIdle = null
        run?.()
      }
      replication = createReplication({ db, remote, emit, onIdle })
      caughtUp = await replication.catchUp()
      if (disposed) return { ok: false, disposed: true }
    }
    // With a sync server, a pod copy that looks changed at import may be
    // another device's edit, its revision and record still on their way. The
    // projector holds those nodes until they're looked at again, once
    // replication has caught up.
    const suspects = []
    // If the server didn't answer, skip the import and the migration until a
    // start that reaches it. Both give every node they add a revision of its
    // own, which would collide with the server's copy once replication
    // resumes, and the pod round trip isn't exact (a one-item array comes back
    // as a plain value), so those would be real conflicts. The cost: a
    // brand-new device stays empty until the server answers; live replication
    // below brings everything then.
    if (caughtUp) {
      // Import first: a device upgrading after another device migrated adopts
      // the pod copies instead of fighting them. Without a sync server, a
      // full pull, which also brings in other devices' edits and deletes.
      if (puller) {
        const pulled = await puller.pull()
        if (pulled.error) throw pulled.error
      } else {
        await importContainer({ db, pod, containerUrl, context, emit, untargeted, outside: (id) => suspects.push(id) })
      }
      if (disposed) return { ok: false, disposed: true }
    }
    projector.hold(suspects)
    if (caughtUp && config.legacy) {
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
    if (suspects.length) {
      // Set before replication starts, so its first idle isn't missed.
      afterIdle = () => {
        if (disposed) return
        rechecking = recheckOutside({ db, pod, containerUrl, context, ids: suspects, emit, untargeted })
          .then(() => projector.release(suspects))
      }
    }
    replication?.start()
    // Old revisions add up; compact when nothing needs them for a merge.
    if (config.compactOnStart !== false) {
      compaction = hasConflicts(db)
        .then((conflicted) => (conflicted ? null : db.compact().then(() => emit('compacted', {}))))
        .catch((error) => emit('sync-error', { stage: 'compact', error }))
    }
    emit('ready', { containerUrl })
    return { ok: true, containerUrl }
  }

  const ready = config.session
    ? startPodSync().catch((error) => {
      // A failure inside projector.start() must not leave its live feed running.
      projector?.stop()
      replication?.stop()
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
    replication?.stop()
    for (const feed of feeds) feed.cancel()
    feeds.clear()
    // Start-up may be mid-flight; wait for it to notice `disposed`, then make
    // sure a projector it created or started in the meantime is stopped.
    await ready
    projector?.stop()
    replication?.stop()
    await projector?.idle()
    // close() must not close the database under a running compaction, or
    // under the look again at suspected outside changes.
    await compaction
    await rechecking
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
    conflicts: (id) => conflicts(db, id, { remote }),
    // `based` is the conflicts(id) result the merge was made from; a 409
    // means a branch moved since, so read the conflicts again.
    resolve: (id, merged, based) => resolve(db, id, merged, based),
    // Without a sync server: bring other devices' edits in from the pod.
    // { budget } caps per-node checks for a timed pull; omit it to check
    // everything. Resolves to counts ({ added, updated, merged, conflicted,
    // deleted, recreated, checked }, plus `skipped` when the container hadn't
    // changed, `paused` while a server's Retry-After lasts). With a sync
    // server, before start-up, or after dispose: all zeros.
    pull: async (options = {}) => {
      if (!puller || !started || disposed) return { added: 0, updated: 0, merged: 0, conflicted: 0, deleted: 0, recreated: 0, checked: 0 }
      return projector.run(() => puller.pull(options))
    },
    // Restart live replication, e.g. after signing in again (a 401 ends it).
    // Not before start-up has finished, nor after dispose.
    resync: () => { if (started && !disposed) replication?.start() },
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
