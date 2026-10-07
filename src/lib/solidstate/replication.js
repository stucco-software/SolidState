import PouchDB from 'pouchdb'

// PouchDB passes a Headers instance; signing fetches (like thoughtloom's
// authFetch) often spread `options.headers` into an object, which loses a
// Headers instance's entries (Content-Type among them). Hand them a plain
// object.
const plainHeaders = (fetch) => (url, options = {}) =>
  fetch(url, {
    ...options,
    headers: typeof options.headers?.entries === 'function' ? Object.fromEntries(options.headers.entries()) : options.headers,
  })

// The sync server: a CouchDB database (P2b), reached with a fetch that signs
// requests (the app's DPoP authFetch), or any PouchDB (tests). skip_setup:
// the server creates databases, never the client.
export const remoteFor = (sync) =>
  sync.remote ?? new PouchDB(sync.url, { fetch: plainHeaders(sync.fetch ?? globalThis.fetch), skip_setup: true })

const withTimeout = (replication, ms) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      replication.cancel?.()
      reject(new Error(`catching up from the sync server timed out after ${ms / 1000}s`))
    }, ms)
    Promise.resolve(replication).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })

// Device ⇄ server. catchUp() pulls once: a fresh device gets everything in
// one go, far faster than importing the pod resource by resource. start()
// then keeps both directions live; PouchDB retries on its own while offline.
// Problems are reported as events, never thrown.
export const createReplication = ({ db, remote, emit, catchUpTimeoutMs = 30_000 }) => {
  let live = null
  const pulling = new Set()

  const catchUp = async () => {
    let pull = null
    try {
      pull = db.replicate.from(remote)
      pulling.add(pull)
      const result = await withTimeout(pull, catchUpTimeoutMs)
      return result?.status !== 'cancelled'
    } catch (error) {
      emit('sync-error', { stage: 'replication', error })
      return false
    } finally {
      pulling.delete(pull)
    }
  }

  const start = () => {
    stop()
    live = db.sync(remote, { live: true, retry: true })
    // The combined feed's 'paused' carries no error; the directions' do.
    // Each direction's last 'paused' says whether it's down: after a retry
    // that finds nothing to transfer there's no 'active', only a clean pause.
    // (Registered before the combined listener, so they run first.)
    const down = { push: false, pull: false }
    live.push.on('paused', (error) => {
      down.push = Boolean(error)
    })
    live.pull.on('paused', (error) => {
      down.pull = Boolean(error)
    })
    live.on('active', () => emit('replication', { state: 'active' }))
    live.on('paused', () => emit('replication', { state: down.push || down.pull ? 'offline' : 'idle' }))
    // 'denied' passes { direction, doc }, not an Error.
    live.on('denied', (detail) => emit('sync-error', { stage: 'replication', error: new Error(`denied: ${detail?.doc?.id ?? 'a doc'}`) }))
    // An 'error' ends live sync (e.g. a 401 once the session expired); the
    // store's resync() starts it again.
    live.on('error', (error) => emit('sync-error', { stage: 'replication', error }))
  }

  // Also cancels a catch-up in progress, so dispose never waits on it.
  const stop = () => {
    for (const pull of pulling) pull.cancel?.()
    live?.cancel()
    live = null
  }

  return { catchUp, start, stop }
}
