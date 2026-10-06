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

  it('throws when the profile cannot be fetched', async () => {
    const pod = createFakePod()
    pod.failNext('GET', 500)
    await expect(discoverStorageRoot(pod.webId, pod.fetch)).rejects.toThrow(/could not read WebID profile/)
  })

  it('throws when the profile fetch errors', async () => {
    const pod = createFakePod()
    const fetch = async () => { throw new Error('offline') }
    await expect(discoverStorageRoot(pod.webId, fetch)).rejects.toThrow(/could not read WebID profile .*offline/)
  })

  it('finds pim:storage on a nested node of a JSON-LD profile', async () => {
    const pod = createFakePod()
    pod.files.set(pod.profileUrl, {
      body: JSON.stringify({
        '@id': pod.profileUrl,
        'http://xmlns.com/foaf/0.1/primaryTopic': {
          '@id': pod.webId,
          'http://www.w3.org/ns/pim/space#storage': { '@id': 'https://nested.example/' },
        },
      }),
      type: 'application/ld+json', etag: '"p"',
    })
    expect(await discoverStorageRoot(pod.webId, pod.fetch)).toBe('https://nested.example/')
  })

  it('times out a profile fetch that never settles', async () => {
    const hang = (url, init) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal.reason)))
    await expect(discoverStorageRoot('https://e.x/profile/card#me', hang, { timeoutMs: 20 }))
      .rejects.toThrow(/could not read WebID profile/)
  })
})
