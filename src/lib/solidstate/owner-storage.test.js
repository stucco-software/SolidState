import { describe, it, expect } from 'vitest'
import SolidState from './index.js'
import PouchDB from 'pouchdb'
import { twoPods, memoryDb } from './test/helpers.js'
import { nodeUrl } from './layout.js'

const ctx = { '@base': 'https://e.x/v/', '@vocab': '#' }

const open = (session, extra = {}) =>
  SolidState({
    graph: `site-${crypto.randomUUID()}`,
    session,
    context: ctx,
    container: 'thoughtloom-data/hello/',
    pouch: { adapter: 'memory' },
    ...extra,
  })

// Shared sites always run with a sync server. Without one, start-up pulls (0.5.0).
const MODES = [
  ['with a sync server', () => ({ remote: memoryDb() })],
  ['without a sync server', () => undefined],
]

// What 0.5 left on a device: records that name no container, and no memory
// of where they went. Never closed: memory databases share one connection
// per name.
const asIf05 = async (graph) => {
  const db = new PouchDB(graph, { adapter: 'memory' })
  const { rows } = await db.allDocs({
    startkey: 'solidstate:projection:', endkey: 'solidstate:projection:￰', include_docs: true,
  })
  await db.bulkDocs(rows.map(({ doc: { target, ...record } }) => record))
  await db.get('_local/solidstate-untargeted').then((doc) => db.remove(doc), () => {})
}

describe('the storage option', () => {
  it('projects into the given storage root without reading the profile', async () => {
    const { nk, ruth, session } = twoPods()
    const containerUrl = `${ruth.storage}thoughtloom-data/hello/`
    const store = open(session, { storage: ruth.storage })
    expect(await store.ready).toEqual({ ok: true, containerUrl })
    await store.post({ '@id': 'n1', title: 'In Ruth’s pod' })
    await store.idle()
    expect(ruth.files.get(nodeUrl(containerUrl, 'n1')).body).toContain('In Ruth')
    // Not even the profile: nk's pod is never asked anything.
    expect(nk.log).toEqual([])
    await store.close()
  })

  it('takes a root without its trailing slash', async () => {
    const { ruth, session } = twoPods()
    const store = open(session, { storage: ruth.origin })
    expect(await store.ready).toEqual({ ok: true, containerUrl: `${ruth.storage}thoughtloom-data/hello/` })
    await store.close()
  })

  it('starts for an editor who may reach only the site’s container', async () => {
    const { ruth, session } = twoPods()
    const containerUrl = `${ruth.storage}thoughtloom-data/hello/`
    // Ruth made the container, then granted nk access to it alone.
    await ruth.fetch(containerUrl, { method: 'PUT', body: '' })
    ruth.forbid(`${ruth.storage}thoughtloom-data/`)
    const store = open(session, { storage: ruth.storage })
    expect(await store.ready).toEqual({ ok: true, containerUrl })
    await store.post({ '@id': 'n1', title: 'x' })
    await store.idle()
    expect(ruth.files.has(nodeUrl(containerUrl, 'n1'))).toBe(true)
    await store.close()
  })

  it('fails start-up when the container itself is out of reach', async () => {
    const { ruth, session } = twoPods()
    const containerUrl = `${ruth.storage}thoughtloom-data/hello/`
    await ruth.fetch(containerUrl, { method: 'PUT', body: '' })
    ruth.forbid(containerUrl)
    const store = open(session, { storage: ruth.storage })
    const result = await store.ready
    expect(result.ok).toBe(false)
    expect(result.error.status).toBe(403)
    await store.close()
  })
})

describe('a store from before 0.6', () => {
  for (const [mode, sync] of MODES) {
    it(`upgrades in place without writing, then projects every node into a new pod (${mode})`, async () => {
      const { nk, ruth, session } = twoPods()
      const graph = `site-${crypto.randomUUID()}`
      const remote = sync()
      const first = open(session, { graph, sync: remote })
      await first.ready
      await first.post({ '@id': 'n1', title: 'One' })
      await first.post({ '@id': 'n2', title: 'Two' })
      await first.idle()
      await first.close()
      await asIf05(graph)

      // The device's first start on 0.6, still in nk's pod: nothing is written again.
      const puts = nk.requests('PUT').length
      const upgraded = open(session, { graph, sync: remote })
      expect((await upgraded.ready).ok).toBe(true)
      await upgraded.idle()
      expect(nk.requests('PUT')).toHaveLength(puts)
      await upgraded.close()

      // Then the site is transferred to Ruth, and the store moves.
      const to = `${ruth.storage}thoughtloom-data/hello/`
      const moved = open(session, { graph, sync: remote, storage: ruth.storage })
      const outside = []
      moved.on('outside-change', (e) => outside.push(e))
      expect(await moved.ready).toEqual({ ok: true, containerUrl: to })
      await moved.idle()
      expect(ruth.files.get(nodeUrl(to, 'n1'))?.body).toContain('"One"')
      expect(ruth.files.get(nodeUrl(to, 'n2'))?.body).toContain('"Two"')
      expect((await moved.get('n1'))?.title).toBe('One')
      expect(outside).toEqual([])
      await moved.close()
    })
  }

  // The other side of the memory: a device whose first 0.6 start is already in
  // the new pod takes the records to be the new pod's, and leaves those nodes
  // to the devices that remember where they went. (Shared sites always run
  // with a sync server. Without one, start-up pulls, and the pull takes these
  // nodes as deleted from the new pod.)
  it('leaves those nodes alone when its first start on 0.6 is already in the new pod (with a sync server)', async () => {
    const { ruth, session } = twoPods()
    const graph = `site-${crypto.randomUUID()}`
    const remote = { remote: memoryDb() }
    const first = open(session, { graph, sync: remote })
    await first.ready
    await first.post({ '@id': 'n1', title: 'One' })
    await first.post({ '@id': 'n2', title: 'Two' })
    await first.idle()
    await first.close()
    await asIf05(graph)

    const to = `${ruth.storage}thoughtloom-data/hello/`
    for (let start = 0; start < 2; start += 1) {
      const moved = open(session, { graph, sync: remote, storage: ruth.storage })
      const outside = []
      moved.on('outside-change', (e) => outside.push(e))
      expect(await moved.ready).toEqual({ ok: true, containerUrl: to })
      await moved.idle()
      expect(ruth.requests('PUT', nodeUrl(to, 'n1'))).toEqual([])
      expect(ruth.requests('PUT', nodeUrl(to, 'n2'))).toEqual([])
      expect((await moved.get('n1'))?.title).toBe('One')
      expect((await moved.get('n2'))?.title).toBe('Two')
      expect(outside).toEqual([])
      await moved.close()
    }
  })
})
