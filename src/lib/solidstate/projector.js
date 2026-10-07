import { nodeToNQuads, sameGraph } from './rdf.js'
import { nodeUrl } from './layout.js'
import { isInternal, isProjectable, generation } from './internal.js'
import { readProjection, writeProjection, dropProjection, listProjections } from './projections.js'
import { resolveIfIdentical } from './conflicts.js'

const MAX_DELAY = 5 * 60 * 1000

// Writes each node's winning revision to the pod as its own resource and
// records what it wrote. `conflicted` and `outside-change` are re-emitted each
// time the node is looked at, so listeners must tolerate repeats. Runs one projection at a time, each against the
// doc's state when it runs, so a burst of edits ends in one PUT of the latest
// revision (later queued runs find it already current).
//
// 401/403 are permanent as far as the pod client is concerned (PodError marks
// only 5xx/429 retryable). P3 handles session refresh and calls projectAll()
// afterwards.
export const createProjector = ({ db, pod, containerUrl, context, emit = () => {}, retryBaseMs = 1000 }) => {
  // A throwing listener must not break the projection chain.
  const safeEmit = (name, detail) => {
    try {
      emit(name, detail)
    } catch {}
  }
  let feed = null
  let stopped = false
  let chain = Promise.resolve()
  const attempts = new Map()
  const retryTimers = new Map()

  const current = async (id) => {
    try {
      return await db.get(id, { conflicts: true })
    } catch (e) {
      if (e.status === 404) return { _id: id, _deleted: true }
      throw e
    }
  }

  const projectDoc = async (doc) => {
    const id = doc._id
    if (!isProjectable(id)) return 'skipped'
    if (doc._conflicts?.length) {
      // Identical branches aren't a conflict: resolve, and the change feed
      // brings the resolved doc straight back here.
      if (await resolveIfIdentical(db, id)) return 'resolved'
      safeEmit('conflicted', { id })
      return 'conflicted'
    }
    const projection = await readProjection(db, id)
    const url = nodeUrl(containerUrl, id)

    if (doc._deleted) {
      if (!projection) return 'unchanged'
      const result = await pod.remove(url, { etag: projection.etag })
      if (result.conflict) {
        safeEmit('outside-change', { id, url })
        return 'outside-change'
      }
      await dropProjection(db, id)
      safeEmit('projected', { id, deleted: true })
      return 'deleted'
    }

    // Another device projected a revision at least as deep as ours that we
    // don't have yet: we're behind, and writing would roll the pod back. The
    // newer doc is on its way by replication. (If that branch were lost the doc
    // would wait here, but a deeper revision can't lose to a shallower one.)
    if (projection && projection.rev !== doc._rev && generation(projection.rev) >= generation(doc._rev)) {
      return 'behind'
    }

    if (projection?.rev === doc._rev) return 'unchanged'
    const body = await nodeToNQuads(doc, context)
    if (!body.trim()) {
      // jsonld drops nodes whose @id isn't a valid IRI. Never PUT nothing.
      const error = new Error(`${id} has no RDF; is its @id a valid IRI?`)
      error.retryable = false
      throw error
    }
    // No projection record means this device never wrote the node: create it
    // (If-None-Match: *). Otherwise update against the recorded ETag.
    let result = await pod.put(url, body, { etag: projection?.etag, create: !projection })
    if (result.conflict) {
      // A 412 is an outside change unless the pod already holds exactly what
      // we'd write: a crash between PUT and writeProjection, or (P2) another
      // device projecting the same revision. Adopt that copy.
      const remote = await pod.get(url)
      if (!remote || !(await sameGraph(remote.body, body))) {
        safeEmit('outside-change', { id, url })
        return 'outside-change'
      }
      result = { etag: remote.etag }
    }
    await writeProjection(db, id, { rev: doc._rev, etag: result.etag })
    safeEmit('projected', { id })
    return 'projected'
  }

  const retryLater = (id, error) => {
    if (stopped || retryTimers.has(id)) return
    const n = (attempts.get(id) ?? 0) + 1
    attempts.set(id, n)
    const delay = Math.min(retryBaseMs * 2 ** (n - 1), MAX_DELAY)
    safeEmit('sync-error', { id, error, retryIn: delay })
    const timer = setTimeout(() => {
      retryTimers.delete(id)
      enqueue(id)
    }, delay)
    retryTimers.set(id, timer)
  }

  const enqueue = (id) => {
    if (stopped || !isProjectable(id)) return chain
    chain = chain.then(async () => {
      if (stopped) return
      try {
        await projectDoc(await current(id))
        attempts.delete(id)
      } catch (error) {
        // PodError marks 4xx as not retryable; network errors and 5xx are.
        if (error?.retryable === false) {
          attempts.delete(id)
          safeEmit('sync-error', { id, error })
        } else retryLater(id, error)
      }
    })
    return chain
  }

  const projectAll = async () => {
    const { rows } = await db.allDocs()
    const present = new Set(rows.map((row) => row.id))
    for (const row of rows) if (isProjectable(row.id)) enqueue(row.id)
    // A projection whose doc is gone means the delete never reached the pod.
    for (const projection of await listProjections(db)) {
      if (!present.has(projection.id)) enqueue(projection.id)
    }
    return chain
  }

  const start = async () => {
    stopped = false
    feed?.cancel()
    feed = db.changes({ since: 'now', live: true })
    feed.on('change', (change) => {
      if (!isInternal(change.id)) enqueue(change.id)
    })
    feed.on('error', (error) => safeEmit('sync-error', { stage: 'changes', error }))
    await projectAll()
  }

  const stop = () => {
    stopped = true
    feed?.cancel()
    feed = null
    for (const timer of retryTimers.values()) clearTimeout(timer)
    retryTimers.clear()
    attempts.clear()
  }

  // Resolves once everything queued so far (and anything it queued) is done.
  // Scheduled retries are not waited for.
  const idle = async () => {
    let seen
    do {
      seen = chain
      await seen
    } while (seen !== chain)
  }

  const pendingRetries = () => retryTimers.size

  return { projectDoc, projectAll, start, stop, idle, enqueue, pendingRetries }
}
