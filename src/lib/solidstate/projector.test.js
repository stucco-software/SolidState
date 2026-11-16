import { describe, it, expect, vi } from 'vitest'
import { memoryDb, events } from './test/helpers.js'
import { createFakePod } from './test/fake-pod.js'
import { createPodClient } from './podClient.js'
import { createProjector } from './projector.js'
import { readProjection, writeProjection, dropProjection, droppedElsewhere } from './projections.js'
import { conflicts, resolve } from './conflicts.js'
import { nodeUrl } from './layout.js'
import { projectionId } from './internal.js'
import { nodeToNQuads } from './rdf.js'

const ctx = { '@base': 'https://e.x/v/', '@vocab': '#' }

const setup = (options = {}) => {
  const pod = createFakePod()
  const db = memoryDb()
  const ev = events()
  const containerUrl = `${pod.storage}data/site/`
  const projector = createProjector({
    db, pod: createPodClient(pod.fetch), containerUrl, context: ctx, emit: ev.emit, retryBaseMs: 5, ...options,
  })
  const url = (id) => nodeUrl(containerUrl, id)
  return { pod, db, ev, projector, url, containerUrl }
}

// The container the store projected into before it moved.
const OLD = 'https://old.test/data/site/'

describe('projector', () => {
  it('projects a new doc with If-None-Match and records rev and etag', async () => {
    const { pod, db, projector, url, containerUrl } = setup()
    const { rev } = await db.put({ _id: 'n1', '@id': 'n1', title: 'Hello' })
    await projector.projectAll()
    expect(pod.files.get(url('n1')).body).toContain('"Hello"')
    expect(pod.requests('PUT', 'n1')[0].headers['if-none-match']).toBe('*')
    expect(await readProjection(db, 'n1')).toMatchObject({ rev, etag: pod.files.get(url('n1')).etag, target: containerUrl })
  })

  it('does nothing when the revision was already projected', async () => {
    const { pod, db, projector } = setup()
    await db.put({ _id: 'n1', title: 'Hello' })
    await projector.projectAll()
    await projector.projectAll()
    expect(pod.requests('PUT', 'n1')).toHaveLength(1)
  })

  it('updates with If-Match on the recorded etag', async () => {
    const { pod, db, projector, url } = setup()
    const first = await db.put({ _id: 'n1', title: 'A' })
    await projector.projectAll()
    const etag = pod.files.get(url('n1')).etag
    await db.put({ _id: 'n1', _rev: first.rev, title: 'B' })
    await projector.projectAll()
    expect(pod.requests('PUT', 'n1').at(-1).headers['if-match']).toBe(etag)
    expect(pod.files.get(url('n1')).body).toContain('"B"')
  })

  it('deletes the resource and the projection record when a doc is deleted', async () => {
    const { pod, db, projector, url } = setup()
    const { rev } = await db.put({ _id: 'n1', title: 'A' })
    await projector.projectAll()
    await db.remove('n1', rev)
    await projector.projectAll()
    expect(pod.files.has(url('n1'))).toBe(false)
    expect(await readProjection(db, 'n1')).toBeNull()
  })

  it('skips conflicted docs and says so', async () => {
    const { pod, db, ev, projector } = setup()
    await db.put({ _id: 'n1', title: 'A' })
    await db.bulkDocs([{ _id: 'n1', _rev: '1-zzzz', title: 'B' }], { new_edits: false })
    await projector.projectAll()
    expect(pod.requests('PUT', 'n1')).toHaveLength(0)
    expect(ev.named('conflicted')).toEqual([{ name: 'conflicted', id: 'n1' }])
  })

  it('reports an outside change instead of overwriting it', async () => {
    const { pod, db, ev, projector, url } = setup()
    const first = await db.put({ _id: 'n1', title: 'A' })
    await projector.projectAll()
    pod.touch(url('n1'), 'edited elsewhere')
    const before = await readProjection(db, 'n1')
    await db.put({ _id: 'n1', _rev: first.rev, title: 'B' })
    await projector.projectAll()
    expect(pod.files.get(url('n1')).body).toBe('edited elsewhere')
    expect(ev.named('outside-change')[0]).toMatchObject({ id: 'n1' })
    expect((await readProjection(db, 'n1')).rev).toBe(before.rev)
  })

  it('never projects internal docs', async () => {
    const { pod, db, projector } = setup()
    await db.put({ _id: projectionId('ghost'), rev: '1-a', etag: '"x"' })
    await projector.projectAll()
    expect(pod.requests('PUT')).toHaveLength(0)
  })

  it('adopts a pod copy that already matches (a crash or a race after a PUT)', async () => {
    const { pod, db, ev, projector, url } = setup()
    const { rev } = await db.put({ _id: 'n1', '@id': 'n1', title: 'Same' })
    await pod.fetch(url('n1'), { method: 'PUT', body: await nodeToNQuads({ '@id': 'n1', title: 'Same' }, ctx) })
    await projector.projectAll()
    expect(ev.named('outside-change')).toHaveLength(0)
    expect(await readProjection(db, 'n1')).toMatchObject({ rev, etag: pod.files.get(url('n1')).etag })
  })

  it('refuses to PUT an empty body when the id is not a valid IRI', async () => {
    const { pod, db, ev, projector } = setup()
    await db.put({ _id: 'a b', title: 'x' })
    await projector.projectAll()
    expect(pod.requests('PUT')).toHaveLength(0)
    expect(ev.named('sync-error')[0]).toMatchObject({ id: 'a b' })
  })

  it('deletes pod resources whose doc is gone (orphan projections)', async () => {
    const { pod, db, projector, url } = setup()
    await pod.fetch(url('old'), { method: 'PUT', body: 'x' })
    await writeProjection(db, 'old', { rev: '1-a', etag: pod.files.get(url('old')).etag })
    await projector.projectAll()
    expect(pod.files.has(url('old'))).toBe(false)
  })

  it('follows live changes after start, and stops', async () => {
    const { pod, db, projector, url } = setup()
    await projector.start()
    await db.put({ _id: 'live', title: 'L' })
    await vi.waitFor(() => expect(pod.files.has(url('live'))).toBe(true))
    projector.stop()
    await db.put({ _id: 'after', title: 'X' })
    await new Promise((r) => setTimeout(r, 30))
    expect(pod.files.has(url('after'))).toBe(false)
  })

  it('retries 5xx with backoff and gives up on 4xx', async () => {
    const { pod, db, ev, projector, url } = setup()
    pod.failNext('PUT', 503, 2, 'retry')
    await db.put({ _id: 'retry', title: 'R' })
    await projector.projectAll()
    await vi.waitFor(() => expect(pod.files.has(url('retry'))).toBe(true))
    expect(ev.named('sync-error')).toHaveLength(2)

    pod.failNext('PUT', 403, 1, 'denied')
    await db.put({ _id: 'denied', title: 'D' })
    await projector.projectAll()
    await new Promise((r) => setTimeout(r, 30))
    expect(pod.requests('PUT', 'denied')).toHaveLength(1)
  })

  it('keeps one pending retry per id however often it fails', async () => {
    const pod = createFakePod()
    const db = memoryDb()
    const containerUrl = `${pod.storage}data/site/`
    const projector = createProjector({
      db, pod: createPodClient(pod.fetch), containerUrl, context: ctx, retryBaseMs: 1000,
    })
    pod.failNext('PUT', 503, 100, 'storm')
    await db.put({ _id: 'storm', title: 'S' })
    for (let i = 0; i < 5; i++) await projector.projectAll()
    await projector.idle()
    expect(projector.pendingRetries()).toBe(1)
    projector.stop()
    expect(projector.pendingRetries()).toBe(0)
  })

  it('a throwing listener does not stop projection', async () => {
    const pod = createFakePod()
    const db = memoryDb()
    const containerUrl = `${pod.storage}data/site/`
    const emit = (name) => {
      if (name === 'projected') throw new Error('listener bug')
    }
    const projector = createProjector({ db, pod: createPodClient(pod.fetch), containerUrl, context: ctx, emit })
    await db.put({ _id: 'a', title: 'A' })
    await db.put({ _id: 'b', title: 'B' })
    await projector.projectAll()
    expect(pod.files.has(nodeUrl(containerUrl, 'a'))).toBe(true)
    expect(pod.files.has(nodeUrl(containerUrl, 'b'))).toBe(true)
    expect(projector.pendingRetries()).toBe(0)
  })

  it('start() twice cancels the first feed', async () => {
    const { db, projector } = setup()
    const real = db.changes.bind(db)
    let cancelled = 0
    db.changes = (opts) => {
      const feed = real(opts)
      const cancel = feed.cancel.bind(feed)
      feed.cancel = () => {
        cancelled++
        return cancel()
      }
      return feed
    }
    await projector.start()
    await projector.start()
    expect(cancelled).toBe(1)
    projector.stop()
    expect(cancelled).toBe(2)
  })

  it('resolves a conflict between identical branches, then projects', async () => {
    const { pod, db, ev, projector, url } = setup()
    await db.put({ _id: 'twin', '@id': 'twin', title: 'Same' })
    await db.bulkDocs([{ _id: 'twin', _rev: '1-zzzz', '@id': 'twin', title: 'Same' }], { new_edits: false })
    await projector.projectAll()
    await projector.projectAll()
    expect(ev.named('conflicted')).toEqual([])
    expect((await db.get('twin', { conflicts: true }))._conflicts).toBeUndefined()
    expect(pod.files.get(url('twin')).body).toContain('"Same"')
  })

  // Without the change feed running (as during the migration), nothing else
  // would bring the resolved doc back to be projected.
  it('projects identical branches in the same run that resolves them', async () => {
    const { pod, db, projector, url } = setup()
    await db.put({ _id: 'twin', '@id': 'twin', title: 'Same' })
    await db.bulkDocs([{ _id: 'twin', _rev: '1-zzzz', '@id': 'twin', title: 'Same' }], { new_edits: false })
    expect(await projector.projectDoc(await db.get('twin', { conflicts: true }))).toBe('projected')
    expect(pod.files.get(url('twin')).body).toContain('"Same"')
    expect((await readProjection(db, 'twin')).rev).toBe((await db.get('twin'))._rev)
  })

  // Device A deleted n1 and removed its resource; this device (B) edited n1.
  // A's dropped projection record arrives by replication while B's PUT is in
  // flight, so the PUT 412s on a resource that's gone. Only solidstate
  // devices touched it: B projects again with the fresh record instead.
  it('re-projects instead of reporting an outside change when another device deleted the resource', async () => {
    const pod = createFakePod()
    const db = memoryDb()
    const ev = events()
    const containerUrl = `${pod.storage}data/site/`
    const url = nodeUrl(containerUrl, 'n1')
    let replicated = false
    const fetch = async (u, init) => {
      if (u === url && init?.method === 'PUT' && !replicated) {
        replicated = true
        await pod.fetch(url, { method: 'DELETE' })
        await dropProjection(db, 'n1')
      }
      return pod.fetch(u, init)
    }
    const projector = createProjector({ db, pod: createPodClient(fetch), containerUrl, context: ctx, emit: ev.emit })
    const first = await db.put({ _id: 'n1', '@id': 'n1', title: 'Before' })
    await projector.projectAll()
    replicated = false
    await db.put({ _id: 'n1', _rev: first.rev, '@id': 'n1', title: 'B edit' })
    await projector.projectAll()
    await projector.idle()
    expect(ev.named('outside-change')).toEqual([])
    expect(pod.files.get(url).body).toContain('"B edit"')
    expect((await readProjection(db, 'n1')).rev).toBe((await db.get('n1'))._rev)
  })

  it('still reports an outside change when the resource is gone but the record is as it was', async () => {
    const { pod, db, ev, projector, url } = setup()
    const first = await db.put({ _id: 'n1', '@id': 'n1', title: 'Before' })
    await projector.projectAll()
    await pod.fetch(url('n1'), { method: 'DELETE' })
    await db.put({ _id: 'n1', _rev: first.rev, '@id': 'n1', title: 'After' })
    await projector.projectAll()
    await projector.idle()
    expect(ev.named('outside-change')).toEqual([{ name: 'outside-change', id: 'n1', url: url('n1') }])
    expect(pod.files.has(url('n1'))).toBe(false)
  })

  it('does not roll the pod back when another device already projected a newer revision', async () => {
    const { pod, db, projector, url } = setup()
    await db.put({ _id: 'n1', '@id': 'n1', title: 'Old' })
    await pod.fetch(url('n1'), { method: 'PUT', body: 'newer content from another device' })
    await writeProjection(db, 'n1', { rev: '2-other', etag: pod.files.get(url('n1')).etag })
    await projector.projectAll()
    expect(pod.files.get(url('n1')).body).toBe('newer content from another device')
    expect(await readProjection(db, 'n1')).toMatchObject({ rev: '2-other' })
  })

  it('does not overwrite a parallel edit of the same depth projected by another device', async () => {
    const { pod, db, projector, url } = setup()
    await db.bulkDocs(
      [{ _id: 'n1', _rev: '2-bbbb', _revisions: { start: 2, ids: ['bbbb', 'xxxx'] }, '@id': 'n1', title: 'Ours' }],
      { new_edits: false },
    )
    await pod.fetch(url('n1'), { method: 'PUT', body: 'parallel edit from another device' })
    await writeProjection(db, 'n1', { rev: '2-aaaa', etag: pod.files.get(url('n1')).etag })
    await projector.projectAll()
    expect(pod.files.get(url('n1')).body).toBe('parallel edit from another device')
  })

  // A edited n1 to 2-aaaa and projected it, then deleted it (3-dddd) without
  // the delete reaching the pod; B edited n1 to 2-bbbb. PouchDB prefers a live
  // leaf over a deleted one, so 2-bbbb wins, unconflicted, though the record
  // names the deeper-or-equal 2-aaaa. This device has seen 2-aaaa, so it isn't
  // behind.
  it('projects a winner that beat a deeper deleted branch it already knows', async () => {
    const { pod, db, projector, url } = setup()
    await db.bulkDocs(
      [
        { _id: 'n1', _rev: '2-aaaa', _revisions: { start: 2, ids: ['aaaa', 'base'] }, '@id': 'n1', title: 'A edit' },
        { _id: 'n1', _rev: '3-dddd', _revisions: { start: 3, ids: ['dddd', 'aaaa', 'base'] }, _deleted: true },
        { _id: 'n1', _rev: '2-bbbb', _revisions: { start: 2, ids: ['bbbb', 'base'] }, '@id': 'n1', title: 'B edit' },
      ],
      { new_edits: false },
    )
    const winner = await db.get('n1', { conflicts: true })
    expect(winner).toMatchObject({ _rev: '2-bbbb', title: 'B edit' })
    expect(winner._conflicts).toBeUndefined()
    await pod.fetch(url('n1'), { method: 'PUT', body: await nodeToNQuads({ '@id': 'n1', title: 'A edit' }, ctx) })
    await writeProjection(db, 'n1', { rev: '2-aaaa', etag: pod.files.get(url('n1')).etag })
    await projector.projectAll()
    expect(pod.files.get(url('n1')).body).toContain('"B edit"')
    expect(await readProjection(db, 'n1')).toMatchObject({ rev: '2-bbbb' })
  })

  it('holds nodes until they are released, then projects them', async () => {
    const { pod, db, projector, url } = setup()
    await db.put({ _id: 'n1', '@id': 'n1', title: 'Held' })
    projector.hold(['n1'])
    await projector.projectAll()
    expect(await projector.projectDoc(await db.get('n1', { conflicts: true }))).toBe('held')
    expect(pod.requests('PUT')).toHaveLength(0)
    projector.release(['n1'])
    await projector.idle()
    expect(pod.files.get(url('n1')).body).toContain('"Held"')
  })
})

describe('projector with records for another container', () => {
  it('takes a record without a target (from before 0.6) to be for this container', async () => {
    const { pod, db, projector, url, containerUrl } = setup()
    const first = await db.put({ _id: 'n1', '@id': 'n1', title: 'A' })
    await pod.fetch(url('n1'), { method: 'PUT', body: await nodeToNQuads({ '@id': 'n1', title: 'A' }, ctx) })
    const etag = pod.files.get(url('n1')).etag
    await writeProjection(db, 'n1', { rev: first.rev, etag })
    await projector.projectAll()
    // Only the PUT above: upgrading re-projects nothing.
    expect(pod.requests('PUT', 'n1')).toHaveLength(1)
    await db.put({ _id: 'n1', _rev: first.rev, '@id': 'n1', title: 'B' })
    await projector.projectAll()
    expect(pod.requests('PUT', 'n1').at(-1).headers['if-match']).toBe(etag)
    expect((await readProjection(db, 'n1')).target).toBe(containerUrl)
  })

  it('takes a record without a target to be for `untargeted`, once the store has moved from there', async () => {
    const { pod, db, ev, projector, url, containerUrl } = setup({ untargeted: OLD })
    const { rev } = await db.put({ _id: 'n1', '@id': 'n1', title: 'A' })
    await writeProjection(db, 'n1', { rev, etag: '"in-the-old-pod"' })
    await projector.projectAll()
    expect(pod.files.get(url('n1')).body).toContain('"A"')
    expect(pod.requests('PUT', 'n1').at(-1).headers['if-match']).toBeUndefined()
    expect(await readProjection(db, 'n1')).toMatchObject({ rev, target: containerUrl })
    expect(ev.named('outside-change')).toEqual([])
  })

  it('writes a node again, unconditionally, when its record is for another container', async () => {
    const { pod, db, ev, projector, url, containerUrl } = setup()
    for (const id of ['n1', 'n2']) {
      const { rev } = await db.put({ _id: id, '@id': id, title: id })
      await writeProjection(db, id, { rev, etag: '"in-the-old-pod"', target: OLD })
    }
    // An earlier, interrupted move left a different copy of n2 here.
    await pod.fetch(url('n2'), { method: 'PUT', body: 'an earlier copy' })
    await projector.projectAll()
    for (const id of ['n1', 'n2']) {
      expect(pod.files.get(url(id)).body).toContain(`"${id}"`)
      const { headers } = pod.requests('PUT', id).at(-1)
      expect(headers['if-match']).toBeUndefined()
      expect(headers['if-none-match']).toBeUndefined()
      expect(await readProjection(db, id)).toMatchObject({ target: containerUrl, etag: pod.files.get(url(id)).etag })
    }
    expect(ev.named('outside-change')).toEqual([])
  })

  it('updates conditionally again once the node is written here', async () => {
    const { pod, db, ev, projector, url } = setup()
    const first = await db.put({ _id: 'n1', '@id': 'n1', title: 'A' })
    await writeProjection(db, 'n1', { rev: first.rev, etag: '"in-the-old-pod"', target: OLD })
    await projector.projectAll()
    expect(pod.files.get(url('n1')).body).toContain('"A"')
    pod.touch(url('n1'), 'edited by another app')
    await db.put({ _id: 'n1', _rev: first.rev, '@id': 'n1', title: 'B' })
    await projector.projectAll()
    expect(pod.files.get(url('n1')).body).toBe('edited by another app')
    expect(ev.named('outside-change')).toEqual([{ name: 'outside-change', id: 'n1', url: url('n1') }])
  })

  it('deletes a node unconditionally when its record is for another container', async () => {
    const { pod, db, ev, projector, url } = setup()
    for (const id of ['here', 'absent']) {
      const { rev } = await db.put({ _id: id, '@id': id, title: id })
      await writeProjection(db, id, { rev, etag: '"in-the-old-pod"', target: OLD })
      await db.remove(id, rev)
    }
    await pod.fetch(url('here'), { method: 'PUT', body: 'a copy here' })
    await projector.projectAll()
    expect(pod.files.has(url('here'))).toBe(false)
    expect(pod.requests('DELETE', 'here')[0].headers['if-match']).toBeUndefined()
    // Nothing to delete is fine too (a 404).
    expect(pod.requests('DELETE', 'absent')).toHaveLength(1)
    for (const id of ['here', 'absent']) {
      expect(await readProjection(db, id)).toBeNull()
      // A device still projecting into the old container deletes its copy too.
      expect(await droppedElsewhere(db, id, OLD)).toBe(true)
    }
    expect(ev.named('outside-change')).toEqual([])
  })

  it('deletes its copy when a device on another container dropped the record', async () => {
    const { pod, db, projector, url, containerUrl } = setup()
    const dropped = async (id, target) => {
      await pod.fetch(url(id), { method: 'PUT', body: `a copy of ${id}` })
      await writeProjection(db, id, { rev: '1-a', etag: '"e"', target })
      await dropProjection(db, id, { target })
    }
    await dropped('theirs', OLD)
    await dropped('ours', containerUrl)
    await dropped('from05', undefined)
    expect(await projector.projectDoc({ _id: 'theirs', _deleted: true })).toBe('deleted')
    expect(pod.files.has(url('theirs'))).toBe(false)
    // Dropped here (or before 0.6, here too): the device that dropped it deleted this copy.
    expect(await projector.projectDoc({ _id: 'ours', _deleted: true })).toBe('unchanged')
    expect(await projector.projectDoc({ _id: 'from05', _deleted: true })).toBe('unchanged')
    expect(pod.requests('DELETE')).toHaveLength(1)
  })

  it('waits for a newer revision projected into another container, then writes it here', async () => {
    const { pod, db, projector, url } = setup()
    const first = await db.put({ _id: 'n1', '@id': 'n1', title: 'Old' })
    await writeProjection(db, 'n1', { rev: '2-ffff', etag: '"in-the-old-pod"', target: OLD })
    expect(await projector.projectDoc(await db.get('n1', { conflicts: true }))).toBe('behind')
    expect(pod.requests('PUT')).toHaveLength(0)
    // The newer revision arrives by replication.
    await db.bulkDocs(
      [{ _id: 'n1', _rev: '2-ffff', _revisions: { start: 2, ids: ['ffff', first.rev.split('-')[1]] }, '@id': 'n1', title: 'New' }],
      { new_edits: false },
    )
    expect(await projector.projectDoc(await db.get('n1', { conflicts: true }))).toBe('projected')
    expect(pod.files.get(url('n1')).body).toContain('"New"')
    expect(pod.requests('PUT', 'n1')[0].headers['if-none-match']).toBeUndefined()
  })

  it('holds a conflicted node back wherever its record points, then writes it once resolved', async () => {
    const { pod, db, ev, projector, url } = setup()
    const { rev } = await db.put({ _id: 'n1', '@id': 'n1', title: 'A' })
    await db.bulkDocs([{ _id: 'n1', _rev: '1-zzzz', '@id': 'n1', title: 'B' }], { new_edits: false })
    await writeProjection(db, 'n1', { rev, etag: '"in-the-old-pod"', target: OLD })
    await projector.projectAll()
    expect(pod.requests('PUT')).toHaveLength(0)
    expect(ev.named('conflicted')).toHaveLength(1)
    await resolve(db, 'n1', { '@id': 'n1', title: 'Merged' }, await conflicts(db, 'n1'))
    await projector.projectAll()
    expect(pod.files.get(url('n1')).body).toContain('"Merged"')
    expect(ev.named('outside-change')).toEqual([])
  })

  it('without a sync server, writes a record from elsewhere without pulling, and forgets the old pod', async () => {
    const pulls = []
    const { pod, db, ev, projector, url, containerUrl } = setup({ podOnly: true, pullNode: async (id) => { pulls.push(id) } })
    const { rev } = await db.put({ _id: 'n1', '@id': 'n1', title: 'A' })
    await writeProjection(db, 'n1', {
      rev, etag: '"in-the-old-pod"', target: OLD, base: { '@id': 'n1', title: 'Old' }, listed: 1000, listedSettled: true,
    })
    await pod.fetch(url('n1'), { method: 'PUT', body: await nodeToNQuads({ '@id': 'n1', title: 'An earlier copy' }, ctx) })
    await projector.projectAll()
    expect(pulls).toEqual([])
    expect(pod.files.get(url('n1')).body).toContain('"A"')
    expect(pod.requests('PUT', 'n1').at(-1).headers['if-match']).toBeUndefined()
    const record = await readProjection(db, 'n1')
    expect(record).toMatchObject({ rev, target: containerUrl, base: expect.objectContaining({ title: 'A' }) })
    expect(record).not.toHaveProperty('listed')
    expect(record).not.toHaveProperty('listedSettled')
    expect(ev.named('outside-change')).toEqual([])
  })
})
