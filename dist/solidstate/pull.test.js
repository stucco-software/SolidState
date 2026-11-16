import { describe, it, expect } from 'vitest'
import PouchDB from 'pouchdb'
import SolidState from '../index.js'
import { createFakePod } from './test/fake-pod.js'
import { memoryDb } from './test/helpers.js'
import { nodeUrl } from './layout.js'

const ctx = { '@base': 'https://e.x/v/', '@vocab': '#' }

// Devices sharing one pod with no sync server.
const setup = (podOptions = {}) => {
  const pod = createFakePod(podOptions)
  const site = `s-${crypto.randomUUID()}`
  const containerUrl = `${pod.storage}thoughtloom-data/${site}/`
  const stores = []
  const device = (name, extra = {}) => {
    const store = SolidState({
      graph: `${site}-${name}`,
      session: { info: { webId: pod.webId }, fetch: pod.fetch },
      context: ctx,
      container: `thoughtloom-data/${site}/`,
      pouch: { adapter: 'memory' },
      compactOnStart: false,
      ...extra,
    })
    stores.push(store)
    return store
  }
  const url = (id) => nodeUrl(containerUrl, id)
  const done = () => Promise.all(stores.map((s) => s.dispose()))
  // A second handle on a device's PouchDB (memory databases are shared by name).
  const raw = (name) => new PouchDB(`${site}-${name}`, { adapter: 'memory' })
  return { pod, containerUrl, device, url, done, raw }
}

// Two started devices, with `doc` written on A and pulled onto B.
const pair = async (doc, podOptions) => {
  const s = setup(podOptions)
  const a = s.device('a')
  const b = s.device('b')
  await Promise.all([a.ready, b.ready])
  if (doc) {
    await a.post(doc)
    await a.idle()
    await b.pull()
    await b.idle()
  }
  return { ...s, a, b }
}

const body = async (store, id) => {
  const doc = await store.get(id)
  if (!doc) return null
  const { _rev, ...rest } = doc
  return rest
}

describe('pull, between devices sharing a pod', () => {
  it('a new node on A arrives on B', async () => {
    const { b, done } = await pair({ '@id': 'n1', title: 'First' })
    expect((await b.get('n1'))?.title).toBe('First')
    await done()
  })

  it('an edit on A fast-forwards B, and B writes nothing back', async () => {
    const { a, b, pod, url, done } = await pair({ '@id': 'n1', title: 'First' })
    await a.put('n1', { title: 'Second' })
    await a.idle()
    const puts = pod.requests('PUT', url('n1')).length
    const counts = await b.pull()
    await b.idle()
    expect(counts.updated).toBe(1)
    expect((await b.get('n1')).title).toBe('Second')
    expect(pod.requests('PUT', url('n1')).length).toBe(puts)
    await done()
  })

  it('edits to different fields merge without asking, and reach A', async () => {
    const { a, b, pod, url, done } = await pair({ '@id': 'n1', title: 'T', note: 'N' })
    await a.put('n1', { title: 'T from A' })
    await a.idle()
    await b.put('n1', { note: 'N from B' })
    // B's projection 412s against A's write, pulls, merges and projects.
    await b.idle()
    await b.idle()
    expect(await body(b, 'n1')).toMatchObject({ title: 'T from A', note: 'N from B' })
    expect(pod.files.get(url('n1')).body).toContain('N from B')
    expect(pod.files.get(url('n1')).body).toContain('T from A')
    expect(await b.conflicts('n1')).toBeNull()
    await a.pull()
    expect(await body(a, 'n1')).toMatchObject({ title: 'T from A', note: 'N from B' })
    await done()
  })

  it('a pull merges a local edit not yet projected', async () => {
    const { a, b, done } = await pair({ '@id': 'n1', title: 'T', note: 'N' })
    await a.put('n1', { title: 'T from A' })
    await a.idle()
    const events = []
    b.on('pulled', (e) => events.push(e))
    // Pull before B's projector gets to its edit: both pulls merge it.
    await b.put('n1', { note: 'N from B' })
    await b.pull()
    await b.idle()
    expect(events.map((e) => e.how)).toContain('merged')
    expect(await body(b, 'n1')).toMatchObject({ title: 'T from A', note: 'N from B' })
    await done()
  })

  it('edits to the same field become a conflict, which resolves and projects', async () => {
    const { a, b, pod, url, done } = await pair({ '@id': 'n1', title: 'T' })
    await a.put('n1', { title: 'A' })
    await a.idle()
    const conflicted = []
    b.on('conflicted', (e) => conflicted.push(e))
    await b.put('n1', { title: 'B' })
    await b.idle()
    await b.idle()
    const c = await b.conflicts('n1')
    expect(c).not.toBeNull()
    expect([c.winner.title, c.others[0].doc.title].sort()).toEqual(['A', 'B'])
    expect(c.others[0].base?.title).toBe('T')
    expect(conflicted.length).toBeGreaterThan(0)
    // Nothing projected while conflicted: the pod still has A's.
    expect(pod.files.get(url('n1')).body).toContain('"A"')
    // Pulling the same pod copy again adds no second branch.
    await b.pull()
    expect((await b.conflicts('n1')).others).toHaveLength(1)
    await b.resolve('n1', { ...c.winner, title: 'Both' }, c)
    await b.idle()
    expect(pod.files.get(url('n1')).body).toContain('"Both"')
    await a.pull()
    expect((await a.get('n1')).title).toBe('Both')
    await done()
  })

  it('a delete on A deletes on B when B had not changed it', async () => {
    const { a, b, pod, url, done } = await pair({ '@id': 'n1', title: 'T' })
    await a.delete('n1')
    await a.idle()
    expect(pod.files.has(url('n1'))).toBe(false)
    expect((await b.pull()).deleted).toBe(1)
    expect(await b.get('n1')).toBeFalsy()
    await done()
  })

  it('an edit on B beats a delete on A: the resource comes back', async () => {
    const { a, b, pod, url, done } = await pair({ '@id': 'n1', title: 'T' })
    await a.delete('n1')
    await a.idle()
    await b.put('n1', { title: 'Kept' })
    await b.idle()
    await b.idle()
    await b.pull()
    await b.idle()
    expect(pod.files.get(url('n1'))?.body).toContain('Kept')
    await a.pull()
    expect((await a.get('n1'))?.title).toBe('Kept')
    await done()
  })

  it('an edit on A beats a delete on B', async () => {
    const { a, b, done } = await pair({ '@id': 'n1', title: 'T' })
    await a.put('n1', { title: 'Edited' })
    await a.idle()
    await b.delete('n1')
    await b.idle()
    await b.idle()
    expect((await b.get('n1'))?.title).toBe('Edited')
    await done()
  })

  it('round-trip shape is not a change: a one-item array merges cleanly', async () => {
    const { a, b, done } = await pair({ '@id': 'n1', title: 'T', tags: ['only'], note: 'N' })
    await a.put('n1', { title: 'A' })
    await a.idle()
    await b.put('n1', { note: 'B' })
    await b.pull()
    await b.idle()
    expect(await b.conflicts('n1')).toBeNull()
    expect(await body(b, 'n1')).toMatchObject({ title: 'A', note: 'B' })
    await done()
  })

  it('a record from 0.4 (no base): fast-forwards, and a merge asks about each differing field', async () => {
    const { a, b, raw, done } = await pair({ '@id': 'n1', title: 'T', note: 'N' })
    const db = raw('b')
    const { base, ...record } = await db.get('solidstate:projection:n1')
    expect(base).toBeTruthy()
    await db.put(record)
    await a.put('n1', { title: 'A' })
    await a.idle()
    await b.pull()
    expect((await b.get('n1')).title).toBe('A')
    // Strip it again: the fast-forward wrote one.
    const { base: again, ...stripped } = await db.get('solidstate:projection:n1')
    void again
    await db.put(stripped)
    await a.put('n1', { title: 'A2' })
    await a.idle()
    await b.put('n1', { note: 'B' })
    await b.pull()
    const c = await b.conflicts('n1')
    expect(c).not.toBeNull()
    await done()
  })

  it('pull does nothing with a sync server', async () => {
    const { device, done } = setup()
    const server = memoryDb()
    const c = device('c', { sync: { remote: server } })
    await c.ready
    expect(await c.pull()).toMatchObject({ added: 0, updated: 0, checked: 0 })
    await done()
  })
})

describe('pull, polite servers', () => {
  it('hikari-like: once learnt, an idle pull is a single HEAD', async () => {
    const { a, b, pod, done } = await pair({ '@id': 'n1', title: 'T' }, { containerEtagMoves: true, listModified: 'ms' })
    // Learn: edits seen alongside a moving container ETag.
    for (const title of ['1', '2', '3']) {
      await a.put('n1', { title })
      await a.idle()
      await b.pull()
    }
    await b.pull()
    const before = pod.log.length
    expect(await b.pull({ budget: 50 })).toMatchObject({ skipped: true })
    expect(pod.log.slice(before).map((r) => r.method)).toEqual(['HEAD'])
    // And a change still gets through.
    await a.put('n1', { title: 'after' })
    await a.idle()
    await b.pull({ budget: 50 })
    expect((await b.get('n1')).title).toBe('after')
    await done()
  })

  it('listing times spare the per-node HEADs', async () => {
    const s = setup({ listModified: 'ms' })
    const a = s.device('a')
    const b = s.device('b')
    await Promise.all([a.ready, b.ready])
    for (let i = 0; i < 5; i += 1) await a.post({ '@id': `n${i}`, title: `${i}` })
    await a.idle()
    await b.pull()
    await b.pull()
    const before = s.pod.log.length
    const counts = await b.pull()
    expect(counts.checked).toBe(0)
    const heads = s.pod.log.slice(before).filter((r) => r.method === 'HEAD' && !r.url.endsWith('/'))
    expect(heads).toHaveLength(0)
    await a.put('n3', { title: 'changed' })
    await a.idle()
    expect((await b.pull()).checked).toBe(1)
    expect((await b.get('n3')).title).toBe('changed')
    await s.done()
  })
})

describe('pull, impolite servers', () => {
  it('no listing times: HEADs per node, in rolling slices on a budget', async () => {
    const s = setup()
    const a = s.device('a')
    const b = s.device('b')
    await Promise.all([a.ready, b.ready])
    for (let i = 0; i < 5; i += 1) await a.post({ '@id': `n${i}`, title: `${i}` })
    await a.idle()
    await b.pull()
    for (let i = 0; i < 5; i += 1) await a.put(`n${i}`, { title: `x${i}` })
    await a.idle()
    const seen = new Set()
    for (let i = 0; i < 3; i += 1) {
      const counts = await b.pull({ budget: 2 })
      expect(counts.checked).toBeLessThanOrEqual(2)
      for (let j = 0; j < 5; j += 1) if ((await b.get(`n${j}`)).title === `x${j}`) seen.add(j)
    }
    expect(seen.size).toBe(5)
    await s.done()
  })

  it('whole-second times: a second write in the same second is still caught', async () => {
    let clock = 1_800_000_000_000
    const { a, b, done } = await pair({ '@id': 'n1', title: 'T' }, { listModified: 'seconds', now: () => clock })
    await a.put('n1', { title: 'one' })
    await a.idle()
    await b.pull()
    expect((await b.get('n1')).title).toBe('one')
    // Same second on the server's clock.
    await a.put('n1', { title: 'two' })
    await a.idle()
    await b.pull()
    expect((await b.get('n1')).title).toBe('two')
    clock += 5000
    await done()
  })

  it('a container ETag that never moves is not trusted', async () => {
    const { a, b, done } = await pair({ '@id': 'n1', title: 'T' }, { listModified: 'ms' })
    for (const title of ['1', '2', '3', '4']) {
      await a.put('n1', { title })
      await a.idle()
      const counts = await b.pull()
      expect(counts.skipped).toBeUndefined()
      expect((await b.get('n1')).title).toBe(title)
    }
    await done()
  })

  it('no ETags at all: content comparison, nothing lost', async () => {
    const { a, b, pod, url, done } = await pair({ '@id': 'n1', title: 'T', note: 'N' }, { noEtags: true })
    await a.put('n1', { title: 'A' })
    await a.idle()
    expect((await b.pull()).updated).toBe(1)
    expect((await b.get('n1')).title).toBe('A')
    await b.put('n1', { note: 'B' })
    await b.idle()
    await a.pull()
    expect(await body(a, 'n1')).toMatchObject({ title: 'A', note: 'B' })
    expect(pod.files.get(url('n1')).body).toContain('"A"')
    await done()
  })

  it('a write overtaken before its read-back is merged, not lost', async () => {
    const { a, b, pod, url, done } = await pair({ '@id': 'n1', title: 'T', note: 'N' }, { etagOnWrite: false, ignoreIfMatch: true })
    // Between B's PUT and B's read-back, A's edit lands (as another app, or a
    // server that ignored A's If-Match would let it).
    const theirs = pod.files.get(url('n1')).body.replace('"T"', '"T from A"')
    pod.before('GET', url('n1'), () => pod.touch(url('n1'), theirs))
    await b.put('n1', { note: 'N from B' })
    await b.idle()
    await b.idle()
    expect(await body(b, 'n1')).toMatchObject({ title: 'T from A', note: 'N from B' })
    const final = pod.files.get(url('n1')).body
    expect(final).toContain('T from A')
    expect(final).toContain('N from B')
    void a
    await done()
  })

  it('429 with Retry-After: no requests until it passes', async () => {
    const { b, pod, done } = await pair({ '@id': 'n1', title: 'T' })
    pod.failNext('HEAD', 429, 1, null, { 'retry-after': '60' })
    expect(await b.pull()).toMatchObject({ paused: true })
    const before = pod.log.length
    expect(await b.pull()).toMatchObject({ paused: true })
    expect(pod.log.length).toBe(before)
    await done()
  })

  it('a truncated listing deletes nothing', async () => {
    const s = setup({ truncateListing: 1 })
    const a = s.device('a')
    const b = s.device('b')
    await Promise.all([a.ready, b.ready])
    await a.post({ '@id': 'n1', title: '1' })
    await a.post({ '@id': 'n2', title: '2' })
    await a.idle()
    // B only sees one through the listing; give it both directly.
    await b.post({ '@id': 'n1', title: '1' })
    await b.post({ '@id': 'n2', title: '2' })
    await b.idle()
    await b.pull()
    await b.pull()
    expect(await b.get('n1')).toBeTruthy()
    expect(await b.get('n2')).toBeTruthy()
    await s.done()
  })

  it('weak ETags refused in If-Match: edits still go through', async () => {
    const { a, b, pod, url, done } = await pair({ '@id': 'n1', title: 'T' }, { weakEtags: true })
    await a.put('n1', { title: 'A' })
    await a.idle()
    expect(pod.files.get(url('n1')).body).toContain('"A"')
    await b.pull()
    expect((await b.get('n1')).title).toBe('A')
    await done()
  })
})

describe('pull, failures', () => {
  it('a network failure ends the pull with one report', async () => {
    const { a, b, pod, done } = await pair({ '@id': 'n1', title: 'T' })
    await a.post({ '@id': 'n2', title: 'U' })
    await a.idle()
    const errors = []
    b.on('sync-error', (e) => errors.push(e))
    pod.before('HEAD', '/thoughtloom-data/', () => { throw new TypeError('Load failed') })
    const counts = await b.pull()
    expect(counts.error).toBeInstanceOf(TypeError)
    expect(errors).toHaveLength(1)
    await done()
  })

  it('a resource that will not parse is skipped and reported, the rest still pull', async () => {
    const { a, b, pod, url, done } = await pair({ '@id': 'n1', title: 'T' })
    await a.post({ '@id': 'n2', title: 'U' })
    await a.idle()
    pod.touch(url('n1'), 'this is not n-quads')
    await a.put('n2', { title: 'U2' })
    await a.idle()
    const errors = []
    b.on('sync-error', (e) => errors.push(e))
    await b.pull()
    expect((await b.get('n2')).title).toBe('U2')
    expect(errors.some((e) => e.id === 'n1' && e.stage === 'pull')).toBe(true)
    await done()
  })
})

describe('pull, budgets and a trusted container ETag', () => {
  it('a budgeted pull that stops short does not let the container ETag hide the rest', async () => {
    const s = setup({ containerEtagMoves: true })
    const a = s.device('a')
    const b = s.device('b')
    await Promise.all([a.ready, b.ready])
    for (let i = 0; i < 4; i += 1) await a.post({ '@id': `n${i}`, title: `${i}` })
    await a.idle()
    // Learn to trust the container ETag.
    for (const t of ['x', 'y', 'z']) {
      await a.put('n0', { title: t })
      await a.idle()
      await b.pull()
    }
    await a.put('n3', { title: 'late' })
    await a.idle()
    for (let i = 0; i < 4; i += 1) await b.pull({ budget: 1 })
    expect((await b.get('n3')).title).toBe('late')
    await s.done()
  })
})
