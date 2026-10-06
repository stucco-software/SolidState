import { describe, it, expect } from 'vitest'
import { discoverStorageRoot } from './storage.js'
import { createFakePod } from './test/fake-pod.js'

describe('discoverStorageRoot', () => {
  it('uses pim:storage from a Turtle profile', async () => {
    const pod = createFakePod()
    pod.files.set(pod.profileUrl, {
      body: `<${pod.webId}> <http://www.w3.org/ns/pim/space#storage> <https://storage.example/abc> .`,
      type: 'text/turtle', etag: '"p"',
    })
    expect(await discoverStorageRoot(pod.webId, pod.fetch)).toBe('https://storage.example/abc/')
  })

  it('uses pim:storage from a JSON-LD profile', async () => {
    const pod = createFakePod()
    pod.files.set(pod.profileUrl, {
      body: JSON.stringify({ '@id': pod.webId, 'http://www.w3.org/ns/pim/space#storage': { '@id': 'https://s.example/' } }),
      type: 'application/ld+json', etag: '"p"',
    })
    expect(await discoverStorageRoot(pod.webId, pod.fetch)).toBe('https://s.example/')
  })

  it('falls back to the WebID origin', async () => {
    const pod = createFakePod({ advertiseStorage: false })
    expect(await discoverStorageRoot(pod.webId, pod.fetch)).toBe(`${pod.origin}/`)
  })

  it('falls back when the profile cannot be fetched', async () => {
    const pod = createFakePod()
    pod.failNext('GET', 500)
    expect(await discoverStorageRoot(pod.webId, pod.fetch)).toBe(`${pod.origin}/`)
  })
})
