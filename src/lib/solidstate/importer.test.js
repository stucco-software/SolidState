import { describe, it, expect } from 'vitest'
import { memoryDb, events } from './test/helpers.js'
import { createFakePod } from './test/fake-pod.js'
import { createPodClient } from './podClient.js'
import { createProjector } from './projector.js'
import { importContainer } from './importer.js'
import { readProjection, writeProjection, dropProjection } from './projections.js'
import { nodeToNQuads } from './rdf.js'
import { nodeUrl } from './layout.js'

const ctx = { '@base': 'https://e.x/v/', '@vocab': '#' }

const setup = async (nodes = [], { fetch } = {}) => {
  const pod = createFakePod()
  const client = createPodClient(fetch ? fetch(pod) : pod.fetch)
  const containerUrl = `${pod.storage}data/site/`
  for (const node of nodes) await client.put(nodeUrl(containerUrl, node['@id']), await nodeToNQuads(node, ctx))
  const db = memoryDb()
  const ev = events()
  const run = () => importContainer({ db, pod: client, containerUrl, context: ctx, emit: ev.emit })
  return { pod, client, db, ev, containerUrl, run }
}

describe('importContainer', () => {
  it('adds nodes this device lacks, with projection records', async () => {
    const { db, run, pod, client, containerUrl } = await setup([{ '@id': 'a', title: 'A' }, { '@id': 'uuid:b', title: 'B' }])
    expect(await run()).toEqual({ added: 2 })
    expect((await db.get('a')).title).toBe('A')
    expect(await readProjection(db, 'uuid:b')).toMatchObject({
      etag: pod.files.get(nodeUrl(containerUrl, 'uuid:b')).etag,
      target: containerUrl,
    })
    // Nothing is written straight back.
    const projector = createProjector({ db, pod: client, containerUrl, context: ctx })
    const putsBefore = pod.requests('PUT').length
    await projector.projectAll()
    expect(pod.requests('PUT').length).toBe(putsBefore)
  })

  it('keeps local docs and reports pod copies changed outside solidstate', async () => {
    const { db, run, ev, pod, containerUrl } = await setup([{ '@id': 'a', title: 'A' }])
    await run()
    pod.touch(nodeUrl(containerUrl, 'a'), '<https://e.x/v/a> <https://e.x/v/#title> "Z" .')
    expect(await run()).toEqual({ added: 0 })
    expect((await db.get('a')).title).toBe('A')
    expect(ev.named('outside-change')[0]).toMatchObject({ id: 'a' })
  })

  it('adopts a local doc that was never projected when the pod copy matches', async () => {
    const { db, run, ev, containerUrl } = await setup([{ '@id': 'a', title: 'A' }, { '@id': 'b', title: 'B' }])
    const { rev } = await db.put({ _id: 'a', '@id': 'a', title: 'A' })
    await db.put({ _id: 'b', '@id': 'b', title: 'Different' })
    await run()
    expect(await readProjection(db, 'a')).toMatchObject({ rev, target: containerUrl })
    expect(await readProjection(db, 'b')).toBeNull()
    expect(ev.named('outside-change').map((e) => e.id)).toEqual(['b'])
  })

  it('does not resurrect a doc deleted on this device', async () => {
    const { db, run } = await setup([{ '@id': 'a', title: 'A' }])
    await run()
    const doc = await db.get('a')
    await db.remove(doc)
    await run()
    await expect(db.get('a')).rejects.toMatchObject({ status: 404 })
  })

  it('ignores sub-containers and an empty or missing container', async () => {
    const { run, client, containerUrl } = await setup()
    await client.put(`${containerUrl}nested/x`, '')
    expect(await run()).toEqual({ added: 0 })
  })

  it('isolates a malformed member so the rest still import', async () => {
    const { db, run, ev, pod, containerUrl } = await setup([{ '@id': 'good', title: 'G' }])
    pod.files.set(nodeUrl(containerUrl, 'bad'), { body: '@prefix x: <y> .\n x:a x:b "c" .', type: 'text/turtle', etag: '"z"' })
    expect(await run()).toEqual({ added: 1 })
    expect((await db.get('good')).title).toBe('G')
    const errors = ev.named('sync-error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ id: 'bad', stage: 'import', url: nodeUrl(containerUrl, 'bad') })
  })

  it('isolates a failing fetch so the rest still import', async () => {
    const { db, run, ev, pod } = await setup([{ '@id': 'flaky', title: 'X' }, { '@id': 'fine', title: 'F' }])
    pod.failNext('GET', 500, 1, 'flaky')
    expect(await run()).toEqual({ added: 1 })
    expect((await db.get('fine')).title).toBe('F')
    expect(ev.named('sync-error').map((e) => e.id)).toEqual(['flaky'])
  })

  it('survives a throwing emit listener', async () => {
    const { pod, client, db, containerUrl } = await setup([{ '@id': 'a', title: 'A' }])
    pod.touch(nodeUrl(containerUrl, 'b'), 'garbage')
    const emit = () => {
      throw new Error('listener')
    }
    expect(await importContainer({ db, pod: client, containerUrl, context: ctx, emit })).toEqual({ added: 1 })
  })

  it('warns once when the pod returns no ETags', async () => {
    const stripEtag = (pod) => async (u, i) => {
      const res = await pod.fetch(u, i)
      const h = new Headers(res.headers)
      h.delete('etag')
      return new Response(res.body, { status: res.status, headers: h })
    }
    const { db, run, ev } = await setup([{ '@id': 'a', title: 'A' }, { '@id': 'b', title: 'B' }], { fetch: stripEtag })
    expect(await run()).toEqual({ added: 2 })
    expect((await db.get('b')).title).toBe('B')
    const warnings = ev.named('sync-error').filter((e) => /no ETag/.test(e.error.message))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].stage).toBe('import')
  })

  it('leaves a node whose record is for another container to the projector, with no outside change', async () => {
    const OLD = 'https://old.test/data/site/'
    const { db, client, run, ev, containerUrl } = await setup([{ '@id': 'moved', title: 'Pod' }, { '@id': 'from05', title: 'Pod' }])
    for (const [id, target] of [['moved', OLD], ['from05', undefined]]) {
      const { rev } = await db.put({ _id: id, '@id': id, title: 'Local' })
      await writeProjection(db, id, { rev, etag: '"stale"', target })
    }
    expect(await run()).toEqual({ added: 0 })
    // A record from before 0.6 is this container's: its stale ETag is an outside change.
    expect(ev.named('outside-change').map((e) => e.id)).toEqual(['from05'])
    expect((await db.get('moved')).title).toBe('Local')
    expect(await readProjection(db, 'moved')).toMatchObject({ target: OLD })
    // Once the store has moved from where it went, it's left to the projector too.
    await importContainer({ db, pod: client, containerUrl, context: ctx, emit: ev.emit, untargeted: OLD })
    expect(ev.named('outside-change').map((e) => e.id)).toEqual(['from05'])
  })

  it('deletes a leftover copy of a node deleted in another container', async () => {
    const OLD = 'https://old.test/data/site/'
    const { db, run, pod, containerUrl } = await setup([{ '@id': 'gone', title: 'G' }, { '@id': 'kept', title: 'K' }])
    // Both were deleted on another device, which dropped their records. A
    // tombstone from before 0.6 counts as this container's, so 'kept' stays,
    // as the importer always did.
    for (const [id, target] of [['gone', OLD], ['kept', undefined]]) {
      const { rev } = await db.put({ _id: id, '@id': id, title: id })
      await writeProjection(db, id, { rev, etag: '"e"', target })
      await dropProjection(db, id, { target })
      await db.remove(id, rev)
    }
    expect(await run()).toEqual({ added: 0 })
    expect(pod.files.has(nodeUrl(containerUrl, 'gone'))).toBe(false)
    expect(pod.files.has(nodeUrl(containerUrl, 'kept'))).toBe(true)
  })
})
