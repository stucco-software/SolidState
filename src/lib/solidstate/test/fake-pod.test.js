import { describe, it, expect } from 'vitest'
import { createFakePod } from './fake-pod.js'

describe('fake pod', () => {
  it('serves a WebID profile advertising storage', async () => {
    const pod = createFakePod()
    const res = await pod.fetch(pod.profileUrl)
    expect(await res.text()).toContain(`<${pod.storage}>`)
  })

  it('creates on PUT, honours If-None-Match and If-Match', async () => {
    const pod = createFakePod()
    const url = `${pod.storage}a/b`
    const created = await pod.fetch(url, { method: 'PUT', headers: { 'if-none-match': '*' }, body: 'x' })
    expect(created.status).toBe(201)
    const etag = created.headers.get('etag')
    const again = await pod.fetch(url, { method: 'PUT', headers: { 'if-none-match': '*' }, body: 'y' })
    expect(again.status).toBe(412)
    const stale = await pod.fetch(url, { method: 'PUT', headers: { 'if-match': '"nope"' }, body: 'y' })
    expect(stale.status).toBe(412)
    const ok = await pod.fetch(url, { method: 'PUT', headers: { 'if-match': etag }, body: 'y' })
    expect(ok.status).toBe(205)
  })

  it('lists container members as n-quads and auto-creates parents', async () => {
    const pod = createFakePod()
    await pod.fetch(`${pod.storage}c/one`, { method: 'PUT', body: '' })
    await pod.fetch(`${pod.storage}c/sub/two`, { method: 'PUT', body: '' })
    const listing = await (await pod.fetch(`${pod.storage}c/`)).text()
    expect(listing).toContain(`<${pod.storage}c/one>`)
    expect(listing).toContain(`<${pod.storage}c/sub/>`)
    expect(listing).not.toContain('two')
  })

  it('refuses a PUT under a missing parent when autoCreateParents is off', async () => {
    const pod = createFakePod({ autoCreateParents: false })
    const res = await pod.fetch(`${pod.storage}missing/x`, { method: 'PUT', body: '' })
    expect(res.status).toBe(409)
  })

  it('injects failures and simulates outside edits', async () => {
    const pod = createFakePod()
    const url = `${pod.storage}x`
    await pod.fetch(url, { method: 'PUT', body: 'a' })
    pod.failNext('GET', 500)
    expect((await pod.fetch(url)).status).toBe(500)
    const before = pod.files.get(url).etag
    pod.touch(url, 'b')
    expect(pod.files.get(url).etag).not.toBe(before)
    expect(await (await pod.fetch(url)).text()).toBe('b')
  })
})
