import { nquadsToNode, nodeToNQuads, sameGraph, stripPouch } from './rdf.js'
import { idFromUrl, nodeUrl } from './layout.js'
import { isProjectable, generation, revList, INTERNAL_PREFIX } from './internal.js'
import { docState } from './pouch.js'
import { readProjection, writeProjection, dropProjection, listProjections } from './projections.js'
import { threeWayMerge } from './merge.js'

// Pull: bring other devices' edits from the pod into this PouchDB, for
// devices sharing a pod without a sync server. The projection record says
// what this device last wrote or read for a node; comparing it with the local
// doc and the pod copy decides what to do:
//
//   local unchanged, pod changed  → fast-forward to the pod's version
//   both changed                  → three-way merge against the record's base;
//                                   clashing fields become a PouchDB conflict
//   pod resource gone             → delete locally, unless edited here (then
//                                   the edit wins and the resource comes back)
//   never seen here               → add it
//
// It doesn't matter whether the pod change came from another device or
// another Solid app: the pod is the owned copy.
//
// Finding what changed as cheaply as the server allows (spec section 7):
//   1. the container's ETag, once learnt to move with every child write;
//   2. the listing's modification times, against each record's `listed`;
//   3. a HEAD per node, in rolling slices on budgeted (timed) pulls.
// What a server does is learnt per container, kept in an internal doc, and
// rechecked; never trusted over what the server returns.

const STATE_ID = `${INTERNAL_PREFIX}pull`
// A trusted container ETag still gets a full listing every this many pulls,
// so a server that changes its behaviour is noticed.
const RECHECK_EVERY = 10
// Whole-second times this close to the server's clock may still move.
const SETTLE_MS = 2000

const NONE = '0-none'

// fetch rejects with a TypeError when the network is down, and our timeout
// with a TimeoutError. Anything else (a 4xx or 5xx, a resource that won't
// parse) is about one resource.
const isNetworkFailure = (error) =>
  error instanceof TypeError || error?.name === 'TimeoutError' || error?.name === 'AbortError'

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

// A revision hash for a pod copy: the same copy always gets the same hash, so
// pulling it twice adds one branch, not two.
const revHash = async (etag, body) =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${etag ?? ''}\n${body}`))).slice(0, 32)

const zero = () => ({ added: 0, updated: 0, merged: 0, conflicted: 0, deleted: 0, recreated: 0, checked: 0 })

export const createPuller = ({ db, pod, containerUrl, context, emit = () => {}, enqueue = () => {}, gate = { pausedUntil: 0 } }) => {
  const safeEmit = (name, detail) => {
    try {
      emit(name, detail)
    } catch {}
  }

  // The node in pod shape: written to RDF and read back, so a comparison with
  // a pod copy only sees real differences (a one-item array comes back as a
  // plain value, and so on).
  const podShape = async (doc) => {
    const node = stripPouch(doc)
    return (await nquadsToNode(await nodeToNQuads(node, context), context, node['@id'])) ?? node
  }

  const readState = async () => {
    try {
      return await db.get(STATE_ID)
    } catch (e) {
      if (e.status !== 404) throw e
      return { _id: STATE_ID, containerEtag: null, trust: 'unknown', confirmations: 0, pulls: 0, cursor: null }
    }
  }
  const saveState = async (state) => {
    try {
      const { rev } = await db.put(state)
      state._rev = rev
    } catch (e) {
      // Two pulls racing on the state doc: the other one's view is as good.
      if (e.status !== 409) throw e
    }
  }

  const settled = (modified, serverNow) =>
    modified.precise || (serverNow != null && serverNow - modified.ms >= SETTLE_MS)

  // Put `node` (pod shape) over the local doc, retrying if a local edit lands
  // in between. Returns the new revision, or null if the doc moved on.
  const putOver = async (id, node, rev) => {
    try {
      return (await db.put({ ...node, _id: id, ...(rev ? { _rev: rev } : {}) })).rev
    } catch (e) {
      if (e.status === 409) return null
      throw e
    }
  }

  // The pod copy as a node, or null (and a sync-error) if it won't convert.
  const parse = async (id, url, body) => {
    const node = await nquadsToNode(body, context, id)
    if (!node) safeEmit('sync-error', { id, url, stage: 'pull', error: new Error(`${url} has no node ${id}`) })
    return node
  }

  // The pod copy differs from the record: fast-forward, merge, or conflict.
  const changed = async (id, url, record, remote, listed, counts) => {
    const theirs = await parse(id, url, remote.body)
    if (!theirs) return
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { state, doc } = await docState(db, id, { conflicts: true, revs: true })

      // Deleted here: an edit elsewhere beats the delete.
      if (state !== 'present') {
        const rev = await putOver(id, theirs)
        if (!rev) continue
        await writeProjection(db, id, { rev, etag: remote.etag, base: theirs, ...listed })
        counts.updated += 1
        safeEmit('pulled', { id, how: 'fast-forward' })
        return
      }

      // Unchanged here since the record: take the pod's version.
      if (record && doc._rev === record.rev && !doc._conflicts?.length) {
        const rev = await putOver(id, theirs, doc._rev)
        if (!rev) continue
        await writeProjection(db, id, { rev, etag: remote.etag, base: theirs, ...listed })
        counts.updated += 1
        safeEmit('pulled', { id, how: 'fast-forward' })
        return
      }

      const base = record?.base ?? null
      const mine = await podShape(doc)
      const { merged, clashes } = threeWayMerge(base, mine, theirs)

      if (!clashes.length && !doc._conflicts?.length) {
        const rev = await putOver(id, merged, doc._rev)
        if (!rev) continue
        // The pod already holds the merge when nothing of ours survived it:
        // record that, so the projector doesn't write it again. Otherwise the
        // record keeps its old revision, and the projector writes the merge
        // over the pod copy (If-Match: its ETag).
        const podHasIt = threeWayMerge(null, merged, theirs).clashes.length === 0
        await writeProjection(db, id, {
          rev: podHasIt ? rev : record?.rev ?? NONE,
          etag: remote.etag,
          base: theirs,
          ...listed,
        })
        counts.merged += 1
        safeEmit('pulled', { id, how: 'merged' })
        return
      }

      // Clashing fields: add the pod copy as a conflicting branch, a child of
      // the recorded revision. The app's conflict UI takes it from there; the
      // projector holds the node back until it's resolved. The record keeps
      // its base (the ancestor the resolver merges against) and takes the pod
      // copy's ETag, so the resolved doc goes over it.
      const hash = await revHash(remote.etag, remote.body)
      const history = revList(doc)
      const from = record?.rev && record.rev !== NONE ? history.indexOf(record.rev) : -1
      const ancestry = from >= 0 ? history.slice(from).map((r) => r.slice(r.indexOf('-') + 1)) : []
      const start = (from >= 0 ? generation(record.rev) : 0) + 1
      await db.bulkDocs(
        [{ ...theirs, _id: id, _rev: `${start}-${hash}`, _revisions: { start, ids: [hash, ...ancestry] } }],
        { new_edits: false },
      )
      await writeProjection(db, id, { rev: record?.rev ?? NONE, etag: remote.etag, ...listed })
      counts.conflicted += 1
      safeEmit('pulled', { id, how: 'conflicted' })
      enqueue(id)
      return
    }
    // Kept moving under us: the next pull tries again.
  }

  // The pod resource is gone and this device has a record for it.
  const gone = async (id, record, counts) => {
    const { state, doc } = await docState(db, id)
    if (state === 'present' && doc._rev === record.rev) {
      try {
        await db.remove(doc)
      } catch (e) {
        if (e.status !== 409) throw e
        return gone(id, await readProjection(db, id), counts)
      }
      await dropProjection(db, id)
      counts.deleted += 1
      safeEmit('pulled', { id, how: 'deleted' })
      return
    }
    await dropProjection(db, id)
    if (state === 'present') {
      // Edited here since: the edit wins, and the projector creates it again.
      counts.recreated += 1
      safeEmit('pulled', { id, how: 'recreated' })
      enqueue(id)
    }
  }

  // A node this device has never seen.
  const added = async (id, url, counts) => {
    const remote = await pod.get(url)
    if (!remote) return
    const node = await parse(id, url, remote.body)
    if (!node) return
    const rev = await putOver(id, node)
    if (!rev) return
    await writeProjection(db, id, { rev, etag: remote.etag, base: node })
    counts.added += 1
    safeEmit('pulled', { id, how: 'added' })
  }

  // Present here with no record: a device upgrading after another migrated,
  // or a crash between a PUT and its record. Adopt an identical copy;
  // anything else is reported, as the importer does.
  const unrecorded = async (id, url, doc) => {
    const remote = await pod.get(url)
    if (!remote) return
    if (await sameGraph(remote.body, await nodeToNQuads(doc, context))) {
      await writeProjection(db, id, { rev: doc._rev, etag: remote.etag, base: await podShape(doc) })
    } else {
      safeEmit('outside-change', { id, url })
    }
  }

  // Look at one node whose record exists and whose pod copy may have changed.
  // Returns true if the pod copy differed.
  const check = async (id, url, record, listed, counts) => {
    counts.checked += 1
    const { exists, etag } = await pod.stat(url)
    if (!exists) {
      await gone(id, record, counts)
      return true
    }
    if (etag && record.etag && etag === record.etag) {
      if (Object.keys(listed).length) await writeProjection(db, id, listed)
      return false
    }
    const remote = await pod.get(url)
    if (!remote) {
      await gone(id, record, counts)
      return true
    }
    // Same content under a new ETag (or no ETag to go by): nothing to pull,
    // just remember the new ETag.
    const ours = record.base ? await nodeToNQuads(record.base, context) : null
    if (ours && (await sameGraph(remote.body, ours))) {
      await writeProjection(db, id, { etag: remote.etag, ...listed })
      return false
    }
    await changed(id, url, record, remote, listed, counts)
    return true
  }

  // One node, now: the projector calls this on a 412, or when a write was
  // overtaken by another before it could be read back.
  const pullNode = async (id) => {
    const counts = zero()
    const url = nodeUrl(containerUrl, id)
    const record = await readProjection(db, id)
    const remote = await pod.get(url)
    if (!remote) {
      if (record) await gone(id, record, counts)
      return counts
    }
    if (!record) {
      const { state } = await docState(db, id)
      // Ours, never recorded, and someone else's copy is there: merge with
      // no ancestor.
      if (state === 'present') await changed(id, url, { rev: NONE, etag: null, base: null }, remote, {}, counts)
      else await added(id, url, counts)
      return counts
    }
    await changed(id, url, record, remote, {}, counts)
    return counts
  }

  // budget: at most this many HEADs for nodes the listing can't vouch for (a
  // timed pull); Infinity checks everything (start-up, foreground).
  const pull = async ({ budget = Infinity } = {}) => {
    const counts = zero()
    if (Date.now() < gate.pausedUntil) return { ...counts, paused: true }
    try {
      const state = await readState()
      state.pulls += 1
      const { etag: containerEtag } = await pod.stat(containerUrl)
      const recheck = budget === Infinity && state.pulls % RECHECK_EVERY === 0
      if (state.trust === 'trusted' && containerEtag && containerEtag === state.containerEtag && !recheck) {
        await saveState(state)
        return { ...counts, skipped: true }
      }

      const { members, date } = await pod.listing(containerUrl)
      let sawChange = false
      // Every node looked at, without errors: only then is the container's
      // ETag recorded as seen. Otherwise a trusted ETag would skip the rest.
      let complete = true
      const listedIds = new Map()
      for (const member of members) {
        const id = idFromUrl(containerUrl, member.url)
        if (id && isProjectable(id)) listedIds.set(id, member)
      }
      const records = new Map((await listProjections(db)).map((r) => [r.id, r]))

      // Records whose resource the listing doesn't show: gone, if a HEAD
      // agrees (a truncated listing must not delete anything).
      for (const [id, record] of records) {
        if (listedIds.has(id)) continue
        const url = nodeUrl(containerUrl, id)
        try {
          if ((await pod.stat(url)).exists) continue
          sawChange = true
          await gone(id, record, counts)
        } catch (error) {
          // Rate limits and network failures end the pull (one report, not
          // one per node); a bad resource is reported and skipped.
          if (error?.retryAfterMs != null || isNetworkFailure(error)) throw error
          complete = false
          safeEmit('sync-error', { id, url, stage: 'pull', error })
        }
      }

      // Members, in a stable order so budgeted pulls can walk in slices.
      const ids = [...listedIds.keys()].sort()
      let spent = 0
      let cursor = state.cursor
      const after = cursor ? ids.findIndex((id) => id > cursor) : 0
      const ordered = after > 0 ? [...ids.slice(after), ...ids.slice(0, after)] : ids
      for (const id of ordered) {
        const member = listedIds.get(id)
        const url = member.url
        const record = records.get(id)
        try {
          if (!record) {
            // Deleted here with no record: our delete reached the pod (that
            // dropped the record), so another device has made it again. A
            // pending delete still has its record.
            const { state: local, doc } = await docState(db, id)
            if (local === 'present') await unrecorded(id, url, doc)
            else {
              sawChange = true
              await added(id, url, counts)
            }
            continue
          }
          const modified = member.modified
          const listed = modified ? { listed: modified.ms, listedSettled: settled(modified, date) } : {}
          if (modified && record.listed != null && record.listedSettled && modified.ms === record.listed) continue
          if (modified && record.listed != null && modified.ms !== record.listed) sawChange = true
          if (!modified || record.listed == null) {
            if (spent >= budget) {
              complete = false
              continue
            }
            spent += 1
            cursor = id
          }
          if (await check(id, url, record, listed, counts)) sawChange = true
        } catch (error) {
          // Rate limits and network failures end the pull (one report, not
          // one per node); a bad resource is reported and skipped.
          if (error?.retryAfterMs != null || isNetworkFailure(error)) throw error
          complete = false
          safeEmit('sync-error', { id, url, stage: 'pull', error })
        }
      }
      state.cursor = spent >= budget ? cursor : null

      // Learn whether the container ETag moves with its children. Our own
      // writes count: they show up as changed listing times.
      if (state.containerEtag && containerEtag) {
        if (containerEtag === state.containerEtag && sawChange) {
          state.trust = 'untrusted'
        } else if (containerEtag !== state.containerEtag && sawChange && state.trust !== 'untrusted') {
          state.confirmations += 1
          if (state.confirmations >= 2) state.trust = 'trusted'
        }
      }
      // The ETag from before the listing: a change during this pull shows up
      // as a different ETag next time.
      if (complete) state.containerEtag = containerEtag
      await saveState(state)
      return counts
    } catch (error) {
      if (error?.retryAfterMs != null) {
        gate.pausedUntil = Date.now() + error.retryAfterMs
        return { ...counts, paused: true }
      }
      safeEmit('sync-error', { stage: 'pull', error })
      return { ...counts, error }
    }
  }

  return { pull, pullNode, podShape }
}
