import { describe, it, expect, vi } from 'vitest'
import PouchDB from 'pouchdb'
import SolidState, { threeWayMerge } from '../index.js'
import { createFakePod } from './test/fake-pod.js'
import { memoryDb } from './test/helpers.js'
import { nodeUrl } from './layout.js'
import { nodeToNQuads } from './rdf.js'
import { readProjection } from './projections.js'

const ctx = { '@base': 'https://e.x/v/', '@vocab': '#' }

// A second handle on the server's database (memory databases are shared by
// name) that fails every request while `down`, as an unreachable server does.
const flaky = (server) => {
  const handle = new PouchDB(server.name, { adapter: 'memory' })
  const link = { down: true, remote: handle }
  for (const method of ['info', 'get', 'put', 'revsDiff', 'bulkDocs', 'bulkGet', 'allDocs']) {
    const real = handle[method].bind(handle)
    handle[method] = (...args) =>
      link.down ? Promise.reject(Object.assign(new Error('offline'), { status: 0 })) : real(...args)
  }
  return link
}

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
    // Any second write, even of the same content, would change the ETag.
    const etag = pod.files.get(nodeUrl(containerUrl, 'n1')).etag
    await vi.waitFor(async () => expect(await b.get('n1')).not.toBeNull())
    await b.idle()
    expect(pod.files.get(nodeUrl(containerUrl, 'n1')).etag).toBe(etag)
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

  // The pod import would give every node a revision of its own, which would
  // collide with the server's once it's back; and the pod round trip isn't
  // exact (a one-item array comes back as a plain value), so they'd clash.
  it('does not import the pod while the server is unreachable, so nothing conflicts once it is back', async () => {
    const { device, server, pod, containerUrl } = setup()
    const a = device('a')
    await a.ready
    await a.post({ '@id': 'n1', title: 'Shared', tags: ['only'] })
    await a.idle()
    await vi.waitFor(async () => expect(await server.get('n1').catch(() => null)).toBeTruthy())
    await a.dispose()
    expect(pod.files.has(nodeUrl(containerUrl, 'n1'))).toBe(true)

    const link = flaky(server)
    const b = device('b', { sync: { remote: link.remote } })
    const conflicted = []
    b.on('conflicted', (e) => conflicted.push(e))
    expect((await b.ready).ok).toBe(true)
    expect(await b.get('n1')).toBeNull()

    link.down = false
    await vi.waitFor(async () => expect((await b.get('n1'))?.title).toBe('Shared'), { timeout: 10_000 })
    await b.idle()
    expect(await b.conflicts('n1')).toBeNull()
    expect(conflicted).toEqual([])
    await b.dispose()
  }, 15_000)

  it('does not migrate a 0.2 graph while the server is unreachable', async () => {
    const { device, server, pod } = setup()
    const legacyUrl = `${pod.origin}/legacy-${crypto.randomUUID()}`
    await pod.fetch(legacyUrl, {
      method: 'PUT',
      body: '<https://solidstate.rdf.systems/a> <https://solidstate.rdf.systems/title> "A" .',
    })
    const link = flaky(server)
    const b = device('b', {
      sync: { remote: link.remote },
      legacy: { path: legacyUrl.slice(pod.origin.length + 1), archivePath: 'archive/legacy-0.2.nq' },
    })
    const migrated = []
    b.on('migrated', (e) => migrated.push(e))
    expect((await b.ready).ok).toBe(true)
    expect(migrated).toEqual([])
    expect(await b.get('a')).toBeNull()
    expect(pod.files.has(legacyUrl)).toBe(true)
    await b.dispose()
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

describe('outside changes at start-up', () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  // Device a is cut off from the server; the test carries its changes there,
  // and so decides what device b has when b starts.
  const twoDevices = () => {
    const { device, pod, containerUrl, server } = setup()
    const a = device('a', { sync: { remote: memoryDb() } })
    // Never closed: memory databases share one connection per name.
    const carry = (options) => new PouchDB(a.config.graph, { adapter: 'memory' }).replicate.to(server, options)
    const graphB = a.config.graph.replace(/-a$/, '-b')
    const url = nodeUrl(containerUrl, 'n1')
    const outside = []
    const errors = []
    // b's pod fetch runs `onGet(n)` before its n-th GET of n1 (1: the import's
    // look, 2: the re-check's) and counts its PUTs of n1.
    const startB = (onGet = () => {}) => {
      let gets = 0
      const puts = { count: 0 }
      const fetch = async (u, init = {}) => {
        const method = init.method ?? 'GET'
        if (String(u) === url && method === 'GET') await onGet(++gets)
        if (String(u) === url && method === 'PUT') puts.count += 1
        return pod.fetch(u, init)
      }
      const b = device('b', { session: { info: { webId: pod.webId }, fetch } })
      b.on('outside-change', (e) => outside.push(e))
      b.on('sync-error', (e) => errors.push(e))
      return { b, puts }
    }
    return { device, pod, server, a, carry, graphB, url, outside, errors, startB }
  }

  // a's first revision and its record are on the server; a's second revision
  // is on the pod.
  const editedOnA = async (t) => {
    await t.a.ready
    await t.a.post({ '@id': 'n1', title: 'First' })
    await t.a.idle()
    await t.carry()
    await t.a.put('n1', { title: 'Second' })
    await t.a.idle()
  }

  // A crash between a PUT and its record leaves the pod holding this device's
  // revision under an ETag it never recorded.
  it('adopts a pod copy that holds this device’s revision, without a report', async () => {
    const { device, pod, containerUrl } = setup()
    const url = nodeUrl(containerUrl, 'n1')
    const first = device('solo')
    await first.ready
    await first.post({ '@id': 'n1', title: 'First' })
    await first.idle()
    await first.close()
    const db = new PouchDB(first.config.graph, { adapter: 'memory' })
    const doc = await db.get('n1')
    const { rev } = await db.put({ ...doc, title: 'Second' })
    await pod.fetch(url, { method: 'PUT', body: await nodeToNQuads({ '@id': 'n1', title: 'Second' }, ctx) })
    const puts = pod.requests('PUT').length
    const again = device('solo')
    const outside = []
    again.on('outside-change', (e) => outside.push(e))
    expect((await again.ready).ok).toBe(true)
    await again.idle()
    expect(outside).toEqual([])
    expect(pod.requests('PUT')).toHaveLength(puts)
    expect(await readProjection(db, 'n1')).toMatchObject({ rev, etag: pod.files.get(url).etag })
    await again.close()
  })

  it('waits for replication before reporting: another device’s edit and record arrive after the import', async () => {
    const t = twoDevices()
    await editedOnA(t)
    // b starts with 'First'. a's edit and its record reach the server while
    // b imports, so b's import finds the pod changed.
    const { b } = t.startB(async (n) => {
      if (n === 1) await t.carry()
    })
    // A listener that throws must not stop the re-check.
    b.on('replication', () => {
      throw new Error('a listener bug')
    })
    expect((await b.ready).ok).toBe(true)
    await vi.waitFor(async () => expect((await b.get('n1'))?.title).toBe('Second'))
    // Released after the re-check: b's next edit reaches the pod.
    await b.put('n1', { title: 'Third' })
    await vi.waitFor(() => expect(t.pod.files.get(t.url).body).toContain('"Third"'))
    await b.close()
    await t.a.close()
    expect(t.outside).toEqual([])
  })

  it('holds a node with an unprojected local edit until the re-check', async () => {
    const t = twoDevices()
    await editedOnA(t)
    // b got a's edit but not its record, then edited it offline.
    await t.carry({ doc_ids: ['n1'] })
    const bDb = new PouchDB(t.graphB, { adapter: 'memory' })
    await bDb.replicate.from(t.server)
    await bDb.put({ ...(await bDb.get('n1')), title: 'Third' })
    // a's record reaches the server while b imports.
    const { b } = t.startB(async (n) => {
      if (n === 1) await t.carry()
    })
    expect((await b.ready).ok).toBe(true)
    await vi.waitFor(() => expect(t.pod.files.get(t.url).body).toContain('"Third"'))
    await b.close()
    await t.a.close()
    expect(t.outside).toEqual([])
  })

  it('holds a never-projected node until the re-check', async () => {
    const t = twoDevices()
    await t.a.ready
    await t.a.post({ '@id': 'n1', title: 'First' })
    await t.a.idle()
    // a's first revision reaches the server without its record; a edits on.
    await t.carry({ doc_ids: ['n1'] })
    await t.a.put('n1', { title: 'Second' })
    await t.a.idle()
    const { b, puts } = t.startB(async (n) => {
      if (n === 1) await t.carry()
    })
    expect((await b.ready).ok).toBe(true)
    await vi.waitFor(async () => expect((await b.get('n1'))?.title).toBe('Second'))
    await b.idle()
    await b.close()
    await t.a.close()
    expect(puts.count).toBe(0)
    expect(t.pod.files.get(t.url).body).toContain('"Second"')
    expect(t.outside).toEqual([])
  })

  // a's revision reaches the server while b imports; its record never does.
  // b's re-check finds its GET of the pod copy held at a gate.
  const slowRecheck = async () => {
    const t = twoDevices()
    await editedOnA(t)
    let reach
    let open
    const reached = new Promise((resolve) => { reach = resolve })
    const gate = new Promise((resolve) => { open = resolve })
    const { b, puts } = t.startB(async (n) => {
      if (n === 1) await t.carry({ doc_ids: ['n1'] })
      if (n === 2) {
        reach()
        await gate
      }
    })
    expect((await b.ready).ok).toBe(true)
    await reached
    return { ...t, b, puts, open }
  }

  it('writes nothing of a held node while its re-check is slow, then projects the edit made meanwhile', async () => {
    const { b, puts, open, pod, url, outside, a } = await slowRecheck()
    await b.put('n1', { title: 'Third' })
    await b.idle()
    expect(puts.count).toBe(0)
    open()
    await vi.waitFor(() => expect(pod.files.get(url).body).toContain('"Third"'))
    await b.close()
    await a.close()
    expect(outside).toEqual([])
  })

  it('close() waits for a re-check in progress', async () => {
    const { b, open, errors, a } = await slowRecheck()
    let closed = false
    const closing = b.close().then(() => { closed = true })
    await sleep(50)
    expect(closed).toBe(false)
    open()
    await closing
    await a.close()
    expect(errors).toEqual([])
  })

  it('still reports a pod copy changed outside solidstate, once replication has caught up', async () => {
    const { device, pod, containerUrl } = setup()
    const a = device('a')
    await a.ready
    await a.post({ '@id': 'n1', title: 'Mine' })
    await a.idle()
    await a.close()
    pod.touch(nodeUrl(containerUrl, 'n1'), '<https://e.x/v/n1> <https://e.x/v/#title> "Edited elsewhere" .')
    const again = device('a')
    const outside = []
    again.on('outside-change', (e) => outside.push(e))
    expect((await again.ready).ok).toBe(true)
    await vi.waitFor(() => expect(outside).toEqual([{ id: 'n1', url: nodeUrl(containerUrl, 'n1') }]))
    await again.close()
  })
})

describe('store lifecycle with a sync server', () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  // A sync server that never answers; `reached` resolves on its first request.
  const silent = () => {
    let reach
    const reached = new Promise((resolve) => { reach = resolve })
    const fetch = () => {
      reach()
      return new Promise(() => {})
    }
    return { sync: { url: `https://sync.invalid/db/${crypto.randomUUID()}`, fetch }, reached }
  }

  it('does not compact a conflicted store (compaction would drop the merge base)', async () => {
    const { device, server } = setup()
    await server.bulkDocs(
      [
        { _id: 'n1', _rev: '1-base', '@id': 'n1', title: 'Base' },
        { _id: 'n1', _rev: '2-aaaa', _revisions: { start: 2, ids: ['aaaa', 'base'] }, '@id': 'n1', title: 'From A' },
        { _id: 'n1', _rev: '2-bbbb', _revisions: { start: 2, ids: ['bbbb', 'base'] }, '@id': 'n1', title: 'From B' },
      ],
      { new_edits: false },
    )
    const a = device('a')
    const compacted = []
    a.on('compacted', (e) => compacted.push(e))
    expect((await a.ready).ok).toBe(true)
    expect(await a.conflicts('n1')).not.toBeNull()
    // dispose waits for a compaction in progress.
    await a.dispose()
    expect(compacted).toEqual([])
  })

  it('close() right after start-up waits for the compaction', async () => {
    const { device } = setup()
    const a = device('a')
    const compacted = []
    const errors = []
    a.on('compacted', (e) => compacted.push(e))
    a.on('sync-error', (e) => errors.push(e))
    await a.post({ '@id': 'n1', title: 'x' })
    expect((await a.ready).ok).toBe(true)
    await a.close()
    expect(compacted).toHaveLength(1)
    await sleep(50)
    expect(errors).toEqual([])
  })

  it('dispose during a catch-up that never returns resolves quickly', async () => {
    const { device } = setup()
    const { sync, reached } = silent()
    const a = device('a', { sync })
    await reached
    const started = Date.now()
    await a.dispose()
    expect(Date.now() - started).toBeLessThan(1000)
    expect(await a.ready).toEqual({ ok: false, disposed: true })
  })

  it('resync() during the catch-up does not cut it short', async () => {
    const { device } = setup()
    const { sync, reached } = silent()
    const a = device('a', { sync })
    await reached
    a.resync()
    expect(await Promise.race([a.ready, sleep(200).then(() => 'still catching up')])).toBe('still catching up')
    await a.dispose()
  })

  it('after dispose, writes do not reach the server, even after resync()', async () => {
    const { device, server } = setup()
    const a = device('a')
    expect((await a.ready).ok).toBe(true)
    await a.dispose()
    await a.post({ '@id': 'late', title: 'x' })
    await sleep(100)
    await expect(server.get('late')).rejects.toMatchObject({ status: 404 })
    a.resync()
    await a.post({ '@id': 'later', title: 'x' })
    await sleep(100)
    await expect(server.get('later')).rejects.toMatchObject({ status: 404 })
  })

  // Live replication starts once the projector is watching, at the end of
  // start-up. Here the projector's start is held up (a slow PUT) to give
  // replication started too early the time to show.
  it('starts live replication only once the projector has started', async () => {
    const { device, pod } = setup()
    const order = []
    const fetch = async (url, init) => {
      if (init?.method === 'PUT' && String(url).endsWith('/n1')) {
        await vi.waitFor(() => expect(order).toContain('replication'), { timeout: 300 }).catch(() => {})
      }
      return pod.fetch(url, init)
    }
    const a = device('a', { session: { info: { webId: pod.webId }, fetch } })
    a.on('ready', () => order.push('ready'))
    a.on('replication', () => order.push('replication'))
    await a.post({ '@id': 'n1', title: 'x' })
    expect((await a.ready).ok).toBe(true)
    await vi.waitFor(() => expect(order).toContain('replication'))
    expect(order[0]).toBe('ready')
    await a.dispose()
  })
})
