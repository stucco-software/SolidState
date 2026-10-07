import { describe, it, expect, vi } from 'vitest'
import SolidState, { threeWayMerge } from '../index.js'
import { createFakePod } from './test/fake-pod.js'
import { memoryDb } from './test/helpers.js'
import { nodeUrl } from './layout.js'

const ctx = { '@base': 'https://e.x/v/', '@vocab': '#' }

const setup = () => {
  const pod = createFakePod()
  const server = memoryDb()
  const site = `s-${crypto.randomUUID()}`
  const containerUrl = `${pod.storage}thoughtloom-data/${site}/`
  const device = (name, extra = {}) =>
    SolidState({
      graph: `${site}-${name}`,
      session: { info: { webId: pod.webId }, fetch: pod.fetch },
      context: ctx,
      container: `thoughtloom-data/${site}/`,
      pouch: { adapter: 'memory' },
      sync: { remote: server },
      ...extra,
    })
  return { pod, server, containerUrl, device }
}

describe('several devices through a sync server', () => {
  it('an edit to a doc another device already has reaches it', async () => {
    const { device } = setup()
    const a = device('a')
    const b = device('b')
    await Promise.all([a.ready, b.ready])
    await a.post({ '@id': 'n1', title: 'First' })
    await vi.waitFor(async () => expect((await b.get('n1'))?.title).toBe('First'))
    await a.put('n1', { title: 'Second' })
    await vi.waitFor(async () => expect((await b.get('n1'))?.title).toBe('Second'))
    await a.dispose()
    await b.dispose()
  })

  it('the pod gets the doc once, with no outside-change on the second device', async () => {
    const { device, pod, containerUrl } = setup()
    const a = device('a')
    const b = device('b')
    const outside = []
    b.on('outside-change', (e) => outside.push(e))
    await Promise.all([a.ready, b.ready])
    await a.post({ '@id': 'n1', title: 'Once' })
    await a.idle()
    await vi.waitFor(async () => expect(await b.get('n1')).not.toBeNull())
    await b.idle()
    expect(pod.files.get(nodeUrl(containerUrl, 'n1')).body).toContain('"Once"')
    expect(outside).toEqual([])
    await a.dispose()
    await b.dispose()
  })

  it('a deletion reaches other devices and the pod', async () => {
    const { device, pod, containerUrl } = setup()
    const a = device('a')
    const b = device('b')
    await Promise.all([a.ready, b.ready])
    await a.post({ '@id': 'n1', title: 'Doomed' })
    await vi.waitFor(async () => expect(await b.get('n1')).not.toBeNull())
    await b.delete('n1')
    await vi.waitFor(async () => expect(await a.get('n1')).toBeNull())
    await a.idle()
    await b.idle()
    await vi.waitFor(() => expect(pod.files.has(nodeUrl(containerUrl, 'n1'))).toBe(false))
    await a.dispose()
    await b.dispose()
  })

  // It still sends one HEAD per node (checking for outside changes), but no GETs.
  it('a fresh device gets the content from the server, not by GETting each pod resource', async () => {
    const { device, pod, containerUrl, server } = setup()
    const a = device('a')
    await a.ready
    for (const n of ['n1', 'n2', 'n3']) await a.post({ '@id': n, title: n })
    await a.idle()
    // Three docs and three projection records have reached the server.
    await vi.waitFor(async () => expect((await server.allDocs()).rows.length).toBe(6))
    const before = pod.requests('GET').filter((r) => r.url.startsWith(containerUrl) && !r.url.endsWith('/')).length
    const c = device('c')
    await c.ready
    expect((await c.get('n2'))?.title).toBe('n2')
    const after = pod.requests('GET').filter((r) => r.url.startsWith(containerUrl) && !r.url.endsWith('/')).length
    expect(after).toBe(before)
    await a.dispose()
    await c.dispose()
  })

  it('concurrent edits become a conflict the store can show and resolve', async () => {
    const { device, server } = setup()
    const a = device('a')
    await a.ready
    await a.post({ '@id': 'n1', title: 'Base', body: 'Body' })
    await vi.waitFor(async () => expect(await server.get('n1').catch(() => null)).toBeTruthy())
    await a.dispose()
    // Two devices edit their own copies while apart, then both reach the server.
    const apart = memoryDb()
    await server.replicate.to(apart)
    const onServer = await server.get('n1')
    await server.put({ ...onServer, title: 'From A' })
    const offline = await apart.get('n1')
    await apart.put({ ...offline, body: 'From B' })
    await apart.replicate.to(server)
    const fresh = device('fresh')
    await fresh.ready
    await vi.waitFor(async () => expect(await fresh.conflicts('n1')).not.toBeNull())
    const c = await fresh.conflicts('n1')
    const { merged, clashes } = threeWayMerge(c.others[0].base, c.winner, c.others[0].doc)
    expect(clashes).toEqual([])
    expect(merged).toMatchObject({ title: 'From A', body: 'From B' })
    await fresh.resolve('n1', merged, c)
    expect(await fresh.conflicts('n1')).toBeNull()
    await fresh.dispose()
  })

  it('compacts on start when nothing is conflicted', async () => {
    const { device } = setup()
    const a = device('a')
    const compacted = []
    a.on('compacted', (e) => compacted.push(e))
    await a.ready
    await vi.waitFor(() => expect(compacted).toHaveLength(1))
    await a.dispose()
  })

  it('without sync it behaves as 0.3 (no replication events)', async () => {
    const { pod } = setup()
    const s = SolidState({
      graph: `solo-${crypto.randomUUID()}`,
      session: { info: { webId: pod.webId }, fetch: pod.fetch },
      context: ctx,
      container: 'thoughtloom-data/solo/',
      pouch: { adapter: 'memory' },
    })
    const seen = []
    s.on('replication', (e) => seen.push(e))
    expect((await s.ready).ok).toBe(true)
    await s.post({ '@id': 'x', title: 'y' })
    await s.idle()
    expect(seen).toEqual([])
    await s.dispose()
  })
})
