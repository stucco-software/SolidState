import { describe, it, expect } from 'vitest'
import { memoryDb, events } from './test/helpers.js'
import { createFakePod } from './test/fake-pod.js'
import { createPodClient } from './podClient.js'
import { createProjector } from './projector.js'
import { importContainer } from './importer.js'
import { readProjection } from './projections.js'
import { nodeToNQuads } from './rdf.js'
import { nodeUrl } from './layout.js'

const ctx = { '@base': 'https://e.x/v/', '@vocab': '#' }

const setup = async (nodes = []) => {
  const pod = createFakePod()
  const client = createPodClient(pod.fetch)
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
    expect(await readProjection(db, 'uuid:b')).toMatchObject({ etag: pod.files.get(nodeUrl(containerUrl, 'uuid:b')).etag })
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
    const { db, run, ev } = await setup([{ '@id': 'a', title: 'A' }, { '@id': 'b', title: 'B' }])
    const { rev } = await db.put({ _id: 'a', '@id': 'a', title: 'A' })
    await db.put({ _id: 'b', '@id': 'b', title: 'Different' })
    await run()
    expect(await readProjection(db, 'a')).toMatchObject({ rev })
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
})
