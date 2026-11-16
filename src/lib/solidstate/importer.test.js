import { describe, it, expect } from 'vitest'
import { memoryDb, events } from './test/helpers.js'
import { createFakePod } from './test/fake-pod.js'
import { createPodClient } from './podClient.js'
import { createProjector } from './projector.js'
import { importContainer, recheckOutside } from './importer.js'
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

  it('adopts a changed pod copy that holds this device’s revision, and reports only a real change', async () => {
    const { db, run, ev, pod, containerUrl } = await setup([
      { '@id': 'mine', title: 'Second' },
      { '@id': 'mine05', title: 'Second' },
      { '@id': 'theirs', title: 'Edited elsewhere' },
    ])
    // Another device's edit to 'mine' and 'mine05' has arrived here, but its
    // projection record hasn't: the records still name the first revision.
    for (const [id, target] of [['mine', containerUrl], ['mine05', undefined]]) {
      const first = await db.put({ _id: id, '@id': id, title: 'First' })
      await writeProjection(db, id, { rev: first.rev, etag: '"before"', target })
      await db.put({ _id: id, _rev: first.rev, '@id': id, title: 'Second' })
    }
    const theirs = await db.put({ _id: 'theirs', '@id': 'theirs', title: 'First' })
    await writeProjection(db, 'theirs', { rev: theirs.rev, etag: '"before"', target: containerUrl })
    await run()
    expect(ev.named('outside-change').map((e) => e.id)).toEqual(['theirs'])
    for (const id of ['mine', 'mine05']) {
      expect(await readProjection(db, id)).toMatchObject({
        rev: (await db.get(id))._rev,
        etag: pod.files.get(nodeUrl(containerUrl, id)).etag,
        target: containerUrl,
      })
    }
    expect((await readProjection(db, 'theirs')).etag).toBe('"before"')
  })

  it('hands a suspected outside change to `outside` instead of reporting it, when given', async () => {
    const { db, client, ev, containerUrl } = await setup([{ '@id': 'a', title: 'Pod' }, { '@id': 'b', title: 'Pod' }])
    const { rev } = await db.put({ _id: 'a', '@id': 'a', title: 'Local' })
    await writeProjection(db, 'a', { rev, etag: '"before"', target: containerUrl })
    await db.put({ _id: 'b', '@id': 'b', title: 'Never projected' })
    const suspects = []
    await importContainer({ db, pod: client, containerUrl, context: ctx, emit: ev.emit, outside: (id) => suspects.push(id) })
    expect(suspects).toEqual(['a', 'b'])
    expect(ev.named('outside-change')).toEqual([])
  })

  it('doesn’t adopt over a record naming a deeper revision this device hasn’t seen', async () => {
    const { db, client, ev, containerUrl } = await setup([{ '@id': 'a', title: 'Same' }])
    await db.put({ _id: 'a', '@id': 'a', title: 'Same' })
    await writeProjection(db, 'a', { rev: '2-ffff', etag: '"before"', target: containerUrl })
    const suspects = []
    await importContainer({ db, pod: client, containerUrl, context: ctx, emit: ev.emit, outside: (id) => suspects.push(id) })
    expect(suspects).toEqual(['a'])
    expect(await readProjection(db, 'a')).toMatchObject({ rev: '2-ffff', etag: '"before"' })
  })
})

describe('recheckOutside', () => {
  it('reports only what still differs once replication has caught up', async () => {
    const { db, client, ev, pod, containerUrl } = await setup([
      { '@id': 'caught', title: 'New' },
      { '@id': 'same', title: 'New' },
      { '@id': 'fresh', title: 'New' },
      { '@id': 'real', title: 'Edited elsewhere' },
      { '@id': 'realFresh', title: 'Edited elsewhere' },
    ])
    const url = (id) => nodeUrl(containerUrl, id)
    // The other device's record arrived after the import.
    const caught = await db.put({ _id: 'caught', '@id': 'caught', title: 'New' })
    await writeProjection(db, 'caught', { rev: caught.rev, etag: pod.files.get(url('caught')).etag, target: containerUrl })
    // Its revision arrived; its record hasn't yet.
    const old = await db.put({ _id: 'same', '@id': 'same', title: 'Old' })
    await writeProjection(db, 'same', { rev: old.rev, etag: '"before"', target: containerUrl })
    const same = await db.put({ _id: 'same', _rev: old.rev, '@id': 'same', title: 'New' })
    // Never projected here, and the pod holds what this device has.
    const fresh = await db.put({ _id: 'fresh', '@id': 'fresh', title: 'New' })
    // Changed outside solidstate: recorded, and never projected here.
    const real = await db.put({ _id: 'real', '@id': 'real', title: 'Local' })
    await writeProjection(db, 'real', { rev: real.rev, etag: '"before"', target: containerUrl })
    await db.put({ _id: 'realFresh', '@id': 'realFresh', title: 'Local' })
    await recheckOutside({
      db, pod: client, containerUrl, context: ctx, ids: ['caught', 'same', 'fresh', 'real', 'realFresh'], emit: ev.emit,
    })
    expect(ev.named('outside-change').map((e) => e.id)).toEqual(['real', 'realFresh'])
    expect(await readProjection(db, 'same')).toMatchObject({ rev: same.rev, etag: pod.files.get(url('same')).etag })
    expect(await readProjection(db, 'fresh')).toMatchObject({ rev: fresh.rev, etag: pod.files.get(url('fresh')).etag, target: containerUrl })
  })

  it('leaves conflicted nodes, and nodes behind another device’s record, to the projector', async () => {
    const { db, client, ev, containerUrl } = await setup([{ '@id': 'split', title: 'Pod' }, { '@id': 'late', title: 'Pod' }])
    await db.put({ _id: 'split', '@id': 'split', title: 'A' })
    await db.bulkDocs([{ _id: 'split', _rev: '1-zzzz', '@id': 'split', title: 'B' }], { new_edits: false })
    const { rev } = await db.put({ _id: 'late', '@id': 'late', title: 'Local' })
    await writeProjection(db, 'late', { rev: '2-ffff', etag: '"before"', target: containerUrl })
    await recheckOutside({ db, pod: client, containerUrl, context: ctx, ids: ['split', 'late'], emit: ev.emit })
    expect(ev.named('outside-change')).toEqual([])
    expect(await readProjection(db, 'late')).toMatchObject({ rev: '2-ffff' })
    expect(rev.startsWith('1-')).toBe(true)
  })
})
