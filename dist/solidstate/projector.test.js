import { describe, it, expect, vi } from 'vitest'
import { memoryDb, events } from './test/helpers.js'
import { createFakePod } from './test/fake-pod.js'
import { createPodClient } from './podClient.js'
import { createProjector } from './projector.js'
import { readProjection, writeProjection } from './projections.js'
import { nodeUrl } from './layout.js'
import { projectionId } from './internal.js'
import { nodeToNQuads } from './rdf.js'

const ctx = { '@base': 'https://e.x/v/', '@vocab': '#' }

const setup = () => {
  const pod = createFakePod()
  const db = memoryDb()
  const ev = events()
  const containerUrl = `${pod.storage}data/site/`
  const projector = createProjector({
    db, pod: createPodClient(pod.fetch), containerUrl, context: ctx, emit: ev.emit, retryBaseMs: 5,
  })
  const url = (id) => nodeUrl(containerUrl, id)
  return { pod, db, ev, projector, url }
}

describe('projector', () => {
  it('projects a new doc with If-None-Match and records rev and etag', async () => {
    const { pod, db, projector, url } = setup()
    const { rev } = await db.put({ _id: 'n1', '@id': 'n1', title: 'Hello' })
    await projector.projectAll()
    expect(pod.files.get(url('n1')).body).toContain('"Hello"')
    expect(pod.requests('PUT', 'n1')[0].headers['if-none-match']).toBe('*')
    expect(await readProjection(db, 'n1')).toMatchObject({ rev, etag: pod.files.get(url('n1')).etag })
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
})
