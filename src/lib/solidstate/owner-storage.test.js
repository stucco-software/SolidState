import { describe, it, expect } from 'vitest'
import SolidState from './index.js'
import { twoPods } from './test/helpers.js'
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
