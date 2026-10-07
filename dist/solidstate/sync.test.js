import { describe, it, expect, vi } from 'vitest'
import SolidState from './index.js'
import { createFakePod } from './test/fake-pod.js'
import { nodeUrl } from './layout.js'
import { memoryDb } from './test/helpers.js'

// Lets one test make projector.start() fail after it has opened its live feed.
const failure = vi.hoisted(() => ({ start: false, afterStart: null }))
vi.mock('./projector.js', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    createProjector: (options) => {
      const projector = real.createProjector(options)
      if (!failure.start && !failure.afterStart) return projector
      return {
        ...projector,
        start: async () => {
          await projector.start()
          if (failure.afterStart) return failure.afterStart()
          throw new Error('projectAll failed')
        },
      }
    },
  }
})

// Lets one test act just as a catch-up has finished.
const hooks = vi.hoisted(() => ({ afterCatchUp: null }))
vi.mock('./replication.js', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    createReplication: (options) => {
      const replication = real.createReplication(options)
      return {
        ...replication,
        catchUp: async () => {
          const caughtUp = await replication.catchUp()
          hooks.afterCatchUp?.()
          return caughtUp
        },
      }
    },
  }
})

const ctx = { '@base': 'https://e.x/v/', '@vocab': '#' }

const open = (pod, extra = {}) => {
  const graph = `thoughtloom/site-${crypto.randomUUID()}`
  const store = SolidState({
    graph,
    session: { info: { webId: pod.webId }, fetch: pod.fetch },
    context: ctx,
    container: `thoughtloom-data/${graph.split('/')[1]}/`,
    pouch: { adapter: 'memory' },
    ...extra,
  })
  return { store, graph, containerUrl: `${pod.storage}thoughtloom-data/${graph.split('/')[1]}/` }
}

describe('SolidState 0.3 with a pod', () => {
  it('projects posts, updates and deletes', async () => {
    const pod = createFakePod()
    const { store, containerUrl } = open(pod)
    expect(await store.ready).toEqual({ ok: true, containerUrl })
    const doc = await store.post({ '@id': 'n1', title: 'Hello' })
    await vi.waitFor(() => expect(pod.files.get(nodeUrl(containerUrl, 'n1'))?.body).toContain('"Hello"'))
    await store.put('n1', { title: 'Bye' })
    await vi.waitFor(() => expect(pod.files.get(nodeUrl(containerUrl, 'n1')).body).toContain('"Bye"'))
    await store.delete('n1')
    await vi.waitFor(() => expect(pod.files.has(nodeUrl(containerUrl, 'n1'))).toBe(false))
    expect(doc['@id']).toBe('n1')
    await store.dispose()
  })

  it('exposes a working, bound changes feed that hides internal docs', async () => {
    const pod = createFakePod()
    const { store } = open(pod)
    await store.ready
    const seen = []
    const feed = store.changes({ since: 'now', live: true })
    feed.on('change', (c) => seen.push(c.id))
    await store.post({ '@id': 'n1', title: 'x' })
    await store.idle()
    await vi.waitFor(() => expect(seen).toContain('n1'))
    expect(seen.some((id) => id.startsWith('solidstate:'))).toBe(false)
    await store.dispose()
  })

  it('imports pod nodes on start', async () => {
    const pod = createFakePod()
    const first = open(pod)
    await first.store.ready
    await first.store.post({ '@id': 'shared', title: 'From A' })
    await first.store.idle()
    await first.store.dispose()
    const second = SolidState({
      graph: `${first.graph}-other-device`,
      session: { info: { webId: pod.webId }, fetch: pod.fetch },
      context: ctx,
      container: first.containerUrl.slice(pod.storage.length),
      pouch: { adapter: 'memory' },
    })
    await second.ready
    expect((await second.get('shared')).title).toBe('From A')
    await second.dispose()
  })

  it('migrates a 0.2 graph when asked', async () => {
    const pod = createFakePod()
    const graph = `thoughtloom/legacy-${crypto.randomUUID()}`
    await pod.fetch(`${pod.origin}/${graph}`, {
      method: 'PUT',
      body: '<https://solidstate.rdf.systems/a> <https://solidstate.rdf.systems/title> "A" .',
    })
    const store = SolidState({
      graph,
      session: { info: { webId: pod.webId }, fetch: pod.fetch },
      context: ctx,
      container: 'thoughtloom-data/legacy/',
      legacy: { archivePath: 'thoughtloom-archive/legacy-0.2.nq' },
      pouch: { adapter: 'memory' },
    })
    const migrated = []
    store.on('migrated', (e) => migrated.push(e))
    await store.ready
    expect(migrated).toHaveLength(1)
    expect(pod.files.has(`${pod.origin}/${graph}`)).toBe(false)
    expect((await store.get('a')).title).toBe('A')
    await store.dispose()
  })

  it('keeps syncing when migration fails', async () => {
    const pod = createFakePod()
    const graph = `thoughtloom/broken-${crypto.randomUUID()}`
    pod.failNext('GET', 500, 1, graph)
    const store = SolidState({
      graph,
      session: { info: { webId: pod.webId }, fetch: pod.fetch },
      context: ctx,
      container: 'thoughtloom-data/broken/',
      legacy: { archivePath: 'thoughtloom-archive/broken-0.2.nq' },
      pouch: { adapter: 'memory' },
    })
    const errors = []
    store.on('sync-error', (e) => errors.push(e))
    await store.ready
    await store.post({ '@id': 'after', title: 'x' })
    await store.idle()
    expect(errors[0]).toMatchObject({ stage: 'migrate' })
    expect(pod.files.has(`${pod.storage}thoughtloom-data/broken/after`)).toBe(true)
    await store.dispose()
  })

  it('stops projecting after dispose', async () => {
    const pod = createFakePod()
    const { store, containerUrl } = open(pod)
    await store.ready
    await store.dispose()
    await store.post({ '@id': 'late', title: 'x' })
    await new Promise((r) => setTimeout(r, 30))
    expect(pod.files.has(nodeUrl(containerUrl, 'late'))).toBe(false)
  })

  it('works without a session (local only)', async () => {
    const store = SolidState({ graph: `local-${crypto.randomUUID()}`, pouch: { adapter: 'memory' } })
    expect(await store.ready).toEqual({ ok: true, local: true })
    await store.post({ '@id': 'x', title: 'y' })
    expect((await store.get('x')).title).toBe('y')
    await store.dispose()
  })

  it('reports start-up failures as sync-error, not a crash', async () => {
    const pod = createFakePod()
    pod.failNext('HEAD', 500, 10)
    const { store } = open(pod)
    const errors = []
    store.on('sync-error', (e) => errors.push(e))
    const result = await store.ready
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
    expect(errors[0]).toMatchObject({ stage: 'start' })
    await store.dispose()
  })
})

describe('SolidState lifecycle', () => {
  it('survives a throwing event listener', async () => {
    const pod = createFakePod()
    const { store, containerUrl } = open(pod)
    const errors = []
    store.on('ready', () => { throw new Error('listener bug') })
    store.on('sync-error', (e) => errors.push(e))
    expect(await store.ready).toEqual({ ok: true, containerUrl })
    expect(errors).toEqual([])
    await store.dispose()
  })

  it('stops the projector when start-up fails part way', async () => {
    const pod = createFakePod()
    failure.start = true
    const { store, containerUrl } = open(pod)
    const errors = []
    store.on('sync-error', (e) => errors.push(e))
    const result = await store.ready
    failure.start = false
    expect(result.ok).toBe(false)
    expect(errors[0]).toMatchObject({ stage: 'start' })
    // Not disposed: a leaked live feed would still project this write.
    await store.post({ '@id': 'late', title: 'x' })
    await new Promise((r) => setTimeout(r, 50))
    expect(pod.files.has(nodeUrl(containerUrl, 'late'))).toBe(false)
    await store.dispose()
  })

  it('re-checks dispose after the projector starts', async () => {
    const pod = createFakePod()
    const { store, containerUrl } = open(pod)
    const ready = []
    store.on('ready', (e) => ready.push(e))
    // dispose() lands while projector.start() is still running
    failure.afterStart = () => { store.dispose() }
    const result = await store.ready
    failure.afterStart = null
    expect(result).toEqual({ ok: false, disposed: true })
    expect(ready).toEqual([])
    await store.idle()
    await store.post({ '@id': 'late', title: 'x' })
    await new Promise((r) => setTimeout(r, 50))
    expect(pod.files.has(nodeUrl(containerUrl, 'late'))).toBe(false)
  })

  it('re-checks dispose after catching up from the sync server', async () => {
    const pod = createFakePod()
    const { store } = open(pod, { sync: { remote: memoryDb() } })
    let requests = null
    // dispose() lands just as a successful catch-up returns.
    hooks.afterCatchUp = () => {
      store.dispose()
      requests = pod.log.length
    }
    const result = await store.ready
    hooks.afterCatchUp = null
    expect(result).toEqual({ ok: false, disposed: true })
    // Nothing more: no pod import.
    expect(pod.log.slice(requests)).toEqual([])
  })

  it('idle does nothing before start-up has succeeded', async () => {
    const pod = createFakePod()
    pod.failNext('GET', 500, 1, 'profile')
    const { store } = open(pod)
    const errors = []
    store.on('sync-error', (e) => errors.push(e))
    await store.post({ '@id': 'n1', title: 'x' })
    await store.idle()
    await store.ready
    await store.idle()
    expect(errors[0]).toMatchObject({ stage: 'start' })
    expect(pod.requests('PUT').length > 0).toBe(false)
    await store.dispose()
  })

  it('clear() right after construction settles cleanly and projects nothing', async () => {
    const pod = createFakePod()
    const { store } = open(pod)
    const errors = []
    store.on('sync-error', (e) => errors.push(e))
    await expect(store.clear()).resolves.toBe(true)
    const before = pod.log.length
    await new Promise((r) => setTimeout(r, 30))
    expect(errors).toEqual([])
    expect(pod.log.slice(before).some((r) => r.method === 'PUT')).toBe(false)
  })

  // A second device whose import of 'shared' is held open until `release()`.
  const openGated = async () => {
    const pod = createFakePod()
    const first = open(pod)
    await first.store.ready
    await first.store.post({ '@id': 'shared', title: 'From A' })
    await first.store.idle()
    await first.store.dispose()
    let release
    const gate = new Promise((r) => { release = r })
    let reached
    const atGate = new Promise((r) => { reached = r })
    const fetch = async (url, init) => {
      if (String(url).endsWith('/shared') && (init?.method ?? 'GET') === 'GET') {
        reached()
        await gate
      }
      return pod.fetch(url, init)
    }
    const store = SolidState({
      graph: `${first.graph}-gated`,
      session: { info: { webId: pod.webId }, fetch },
      context: ctx,
      container: first.containerUrl.slice(pod.storage.length),
      pouch: { adapter: 'memory' },
    })
    await atGate
    return { pod, store, release, containerUrl: first.containerUrl }
  }

  it('idle does nothing while the import is still running', async () => {
    const { pod, store, release, containerUrl } = await openGated()
    await store.post({ '@id': 'n2', title: 'x' })
    await store.idle()
    expect(pod.files.has(nodeUrl(containerUrl, 'n2'))).toBe(false)
    release()
    expect((await store.ready).ok).toBe(true)
    await store.idle()
    expect(pod.files.has(nodeUrl(containerUrl, 'n2'))).toBe(true)
    await store.dispose()
  })

  it('clear() during start-up waits for it instead of racing the destroy', async () => {
    const { store, release } = await openGated()
    const errors = []
    store.on('sync-error', (e) => errors.push(e))
    const cleared = store.clear()
    release()
    await expect(cleared).resolves.toBe(true)
    expect(await store.ready).toMatchObject({ ok: false, disposed: true })
    expect(errors).toEqual([])
  })

  it('close() resolves and releases the database', async () => {
    const pod = createFakePod()
    const { store } = open(pod)
    await store.ready
    await store.post({ '@id': 'x', title: 'y' })
    await expect(store.close()).resolves.toBeUndefined()
  })

  it('changes() rejects named filters and forgets feeds that error or complete', async () => {
    const store = SolidState({ graph: `local-${crypto.randomUUID()}`, pouch: { adapter: 'memory' } })
    await store.ready
    expect(() => store.changes({ filter: 'ddoc/name' })).toThrow(TypeError)
    expect(() => store.changes({ filter: 'ddoc/name' })).toThrow('solidstate changes() supports filter functions only')
    const feed = store.changes({ since: 0 })
    await new Promise((r) => feed.on('complete', r))
    await store.close()
  })
})
