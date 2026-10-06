import { describe, it, expect } from 'vitest'
import { createPodClient, PodError } from './podClient.js'
import { createFakePod } from './test/fake-pod.js'

const setup = (opts) => {
  const pod = createFakePod(opts)
  return { pod, client: createPodClient(pod.fetch) }
}

describe('pod client', () => {
  it('GET returns null for a missing resource and body+etag otherwise', async () => {
    const { pod, client } = setup()
    expect(await client.get(`${pod.storage}nope`)).toBeNull()
    await pod.fetch(`${pod.storage}x`, { method: 'PUT', body: 'hello' })
    expect(await client.get(`${pod.storage}x`)).toMatchObject({ body: 'hello', etag: expect.any(String) })
  })

  it('PUT creates with If-None-Match and updates with If-Match', async () => {
    const { pod, client } = setup()
    const url = `${pod.storage}n`
    const first = await client.put(url, 'a', { create: true })
    expect(pod.requests('PUT').at(-1).headers['if-none-match']).toBe('*')
    await client.put(url, 'b', { etag: first.etag })
    expect(pod.requests('PUT').at(-1).headers['if-match']).toBe(first.etag)
    expect(pod.files.get(url).body).toBe('b')
  })

  it('reports a 412 as a conflict instead of throwing', async () => {
    const { pod, client } = setup()
    const url = `${pod.storage}n`
    await client.put(url, 'a')
    expect(await client.put(url, 'b', { create: true })).toEqual({ conflict: true })
    expect(await client.remove(url, { etag: '"stale"' })).toEqual({ conflict: true })
  })

  it('writes unconditionally when there is neither an etag nor create', async () => {
    const { pod, client } = setup()
    const url = `${pod.storage}n`
    await client.put(url, 'a')
    await client.put(url, 'b')
    const { headers } = pod.requests('PUT').at(-1)
    expect(headers['if-match']).toBeUndefined()
    expect(headers['if-none-match']).toBeUndefined()
    expect(pod.files.get(url).body).toBe('b')
  })

  it('overwrite skips conditional headers', async () => {
    const { pod, client } = setup()
    const url = `${pod.storage}n`
    await client.put(url, 'a')
    await client.put(url, 'b', { overwrite: true })
    expect(pod.files.get(url).body).toBe('b')
  })

  it('reads the ETag with HEAD when the PUT response has none', async () => {
    const { pod, client } = setup({ etagOnWrite: false })
    const { etag } = await client.put(`${pod.storage}n`, 'a')
    expect(etag).toBe(pod.files.get(`${pod.storage}n`).etag)
  })

  it('remove treats 404 as done', async () => {
    const { pod, client } = setup()
    expect(await client.remove(`${pod.storage}gone`)).toEqual({})
  })

  it('lists container members as absolute URLs', async () => {
    const { pod, client } = setup()
    await client.put(`${pod.storage}c/a`, '')
    await client.put(`${pod.storage}c/b`, '')
    expect((await client.list(`${pod.storage}c/`)).sort()).toEqual([`${pod.storage}c/a`, `${pod.storage}c/b`])
    expect(await client.list(`${pod.storage}none/`)).toEqual([])
  })

  it('creates each missing container level', async () => {
    const { pod, client } = setup({ autoCreateParents: false })
    await client.ensurePath(pod.storage, `${pod.storage}a/b/c/`)
    expect(pod.files.has(`${pod.storage}a/`)).toBe(true)
    expect(pod.files.has(`${pod.storage}a/b/c/`)).toBe(true)
  })

  it('throws PodError with retryable set for 5xx', async () => {
    const { pod, client } = setup()
    pod.failNext('PUT', 503)
    const err = await client.put(`${pod.storage}n`, 'a').catch((e) => e)
    expect(err).toBeInstanceOf(PodError)
    expect(err.retryable).toBe(true)
    pod.failNext('PUT', 403)
    expect((await client.put(`${pod.storage}m`, 'a').catch((e) => e)).retryable).toBe(false)
  })
})
