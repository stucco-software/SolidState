import { describe, it, expect, vi } from 'vitest'
import SolidState from './index.js'
import { createFakePod } from './test/fake-pod.js'
import { nodeUrl } from './layout.js'

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
    await store.ready
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
    await store.ready
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
    await store.ready
    expect(errors[0]).toMatchObject({ stage: 'start' })
    await store.dispose()
  })
})
