import { nodeToNQuads, nquadsToNode, sameGraph } from './rdf.js'
import { nodeUrl } from './layout.js'
import { isInternal, isProjectable, generation, revList } from './internal.js'
import {
  readProjection, writeProjection, dropProjection, listProjections, forAnotherTarget, droppedElsewhere,
} from './projections.js'
import { resolveIfIdentical } from './conflicts.js'

const MAX_DELAY = 5 * 60 * 1000

// Writes each node's winning revision to the pod as its own resource and
// records what it wrote. `conflicted` and `outside-change` are re-emitted each
// time the node is looked at, so listeners must tolerate repeats. Runs one projection at a time, each against the
// doc's state when it runs, so a burst of edits ends in one PUT of the latest
// revision (later queued runs find it already current).
//
// Each projection record names the container it was written to. A record for
// another container (the store moved to another pod, or another device still
// projects into the old one) counts as none: the node is written here, or
// deleted here, without preconditions. Records from before 0.6 name none and
// count as `untargeted`'s (projections.js). A record dropped elsewhere means a
// copy here is left over, and it's deleted.
//
// 401/403 are permanent as far as the pod client is concerned (PodError marks
// only 5xx/429 retryable). P3 handles session refresh and calls projectAll()
// afterwards.
//
// Without a sync server (`podOnly`), other devices share the pod directly, so
// the projector records each write's `base` (for later merges), and a 412 or
// a write overtaken by another before it could be read back goes to
// `pullNode` (pull.js), which brings the other copy in, rather than being
// reported as an outside change. `gate` is shared with the pull: a server's
// Retry-After pauses both.
export const createProjector = ({
  db, pod, containerUrl, context, emit = () => {}, retryBaseMs = 1000,
  podOnly = false, pullNode = async () => {}, gate = { pausedUntil: 0 }, untargeted = containerUrl,
}) => {
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

  // Whether `rev` is anywhere in this device's history of the doc.
  const seen = async (id, rev) => {
    const leaves = await db.get(id, { open_revs: 'all', revs: true })
    return leaves.some(({ ok }) => ok && revList(ok).includes(rev))
  }

  const projectDoc = async (doc) => {
    const id = doc._id
    if (!isProjectable(id)) return 'skipped'
    if (doc._conflicts?.length) {
      // Identical branches aren't a conflict: resolve, then project the
      // resolved doc now. The change feed would bring it back here too, but it
      // isn't running yet during the migration.
      if (await resolveIfIdentical(db, id)) return projectDoc(await current(id))
      safeEmit('conflicted', { id })
      return 'conflicted'
    }
    const record = await readProjection(db, id)
    // A record for another container says nothing about this one: the node
    // counts as never projected here. Whatever this container holds under its
    // name is an earlier copy of it, not someone else's change, so it's
    // written (or deleted) without preconditions.
    const elsewhere = forAnotherTarget(record, containerUrl, untargeted)
    const projection = elsewhere ? null : record
    const url = nodeUrl(containerUrl, id)
    // Every record written here names this container. One that named another
    // forgets what it knew about that pod: its copy (`base`, which pod-only
    // writes set again) and its listing time.
    const here = elsewhere
      ? { target: containerUrl, base: null, listed: null, listedSettled: null }
      : { target: containerUrl }

    if (doc._deleted) {
      if (!record) {
        // A device projecting into another container deleted its copy and
        // dropped the record; the copy here is left over.
        if (!(await droppedElsewhere(db, id, containerUrl, untargeted))) return 'unchanged'
        await pod.remove(url)
        safeEmit('projected', { id, deleted: true })
        return 'deleted'
      }
      // With a record from elsewhere there's no ETag of ours, so this is
      // unconditional. A 404 is success.
      const result = await pod.remove(url, { etag: projection?.etag })
      if (result.conflict) {
        if (podOnly) {
          await pullNode(id)
          return 'pulled'
        }
        safeEmit('outside-change', { id, url })
        return 'outside-change'
      }
      await dropProjection(db, id, { target: containerUrl })
      safeEmit('projected', { id, deleted: true })
      return 'deleted'
    }

    // Another device projected a revision at least as deep as ours that we
    // have never seen: we're behind, and writing would roll the pod back. The
    // newer doc is on its way by replication. Depth alone doesn't decide it: a
    // deeper branch that ended in a delete loses to any live one, so a record
    // naming a revision this device already has on some branch (live or
    // deleted) is out of date, not ahead, and the winner is projected over it.
    // This holds whichever container the record names: waiting for the newer
    // doc never rolls this container back either.
    if (
      record &&
      record.rev !== doc._rev &&
      generation(record.rev) >= generation(doc._rev) &&
      !(await seen(id, record.rev))
    ) {
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
    // A record with no ETag (the server gives none, or a write of ours was
    // overtaken) can't guard the PUT: check the pod still holds what we last
    // wrote or read before writing over it.
    if (podOnly && projection && !projection.etag) {
      const remote = await pod.get(url)
      const ours = projection.base ? await nodeToNQuads(projection.base, context) : null
      if (remote && !(ours && (await sameGraph(remote.body, ours)))) {
        await pullNode(id)
        return 'pulled'
      }
    }
    // No record here means this device never wrote the node here: create it
    // (If-None-Match: *), or overwrite an earlier copy if the record is from
    // elsewhere. Otherwise update against the recorded ETag.
    let result = await pod.put(url, body, { etag: projection?.etag, create: !projection, overwrite: elsewhere })
    if (result.conflict && podOnly) {
      const remote = await pod.get(url)
      if (!remote || !(await sameGraph(remote.body, body))) {
        await pullNode(id)
        return 'pulled'
      }
      result = { etag: remote.etag }
    } else if (result.conflict) {
      // A 412 is an outside change unless the pod already holds exactly what
      // we'd write: a crash between PUT and writeProjection, or (P2) another
      // device projecting the same revision. Adopt that copy.
      const remote = await pod.get(url)
      // Gone, with the record changed or dropped since we read it: another
      // device deleted the resource (and replication just brought its record),
      // not an outside app. Project again with the fresh record.
      if (!remote && (await readProjection(db, id))?._rev !== record?._rev) {
        enqueue(id)
        return 'requeued'
      }
      if (!remote || !(await sameGraph(remote.body, body))) {
        safeEmit('outside-change', { id, url })
        return 'outside-change'
      }
      result = { etag: remote.etag }
    }
    // Read back after a write that carried no ETag: if it isn't what we
    // wrote, another write landed in between, and its ETag isn't ours to
    // record. Keep the record as it was (now this container's), minus the
    // ETag, and pull: that merges the other write with ours.
    if (result.body !== undefined && !(await sameGraph(result.body, body))) {
      if (podOnly) {
        await writeProjection(db, id, { rev: projection?.rev ?? '0-none', etag: null, ...here })
        await pullNode(id)
        return 'pulled'
      }
      safeEmit('outside-change', { id, url })
      return 'outside-change'
    }
    const base = podOnly ? await nquadsToNode(body, context, id) : undefined
    await writeProjection(db, id, { rev: doc._rev, etag: result.etag, ...here, ...(base ? { base } : {}) })
    safeEmit('projected', { id })
    return 'projected'
  }

  const retryLater = (id, error) => {
    if (stopped || retryTimers.has(id)) return
    const n = (attempts.get(id) ?? 0) + 1
    attempts.set(id, n)
    // A server's Retry-After pauses everything that talks to it.
    if (error?.retryAfterMs != null) gate.pausedUntil = Math.max(gate.pausedUntil, Date.now() + error.retryAfterMs)
    const delay = Math.max(Math.min(retryBaseMs * 2 ** (n - 1), MAX_DELAY), gate.pausedUntil - Date.now())
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
      if (Date.now() < gate.pausedUntil) return retryLater(id, null)
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

  // Run `fn` in the queue, between projections (a pull, so it never races
  // one). Resolves to its result.
  const run = (fn) => {
    const result = chain.then(fn)
    chain = result.then(() => {}, () => {})
    return result
  }

  return { projectDoc, projectAll, start, stop, idle, enqueue, pendingRetries, run }
}
