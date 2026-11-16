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

  it('goes past a folder above the container that answers 401 or 403', async () => {
    for (const status of [401, 403]) {
      const { pod, client } = setup({ autoCreateParents: false })
      await client.ensurePath(pod.storage, `${pod.storage}a/b/`)
      pod.forbid(`${pod.storage}a/`, status)
      await client.ensurePath(pod.storage, `${pod.storage}a/b/c/`)
      expect(pod.files.has(`${pod.storage}a/b/c/`)).toBe(true)
    }
  })

  it('still fails when the container itself answers 401 or 403', async () => {
    for (const status of [401, 403]) {
      const { pod, client } = setup()
      await client.ensurePath(pod.storage, `${pod.storage}a/b/`)
      pod.forbid(`${pod.storage}a/b/`, status)
      await expect(client.ensurePath(pod.storage, `${pod.storage}a/b/`)).rejects.toMatchObject({ status })
    }
  })

  // Some servers answer 404 for a folder the agent may not see, then refuse
  // the PUT that would create it.
  it('goes past a folder above the container that hides behind a 404 and refuses its PUT', async () => {
    for (const status of [401, 403]) {
      const pod = createFakePod({ autoCreateParents: false })
      const hidden = `${pod.storage}a/`
      await pod.fetch(hidden, { method: 'PUT', body: '' })
      await pod.fetch(`${hidden}b/`, { method: 'PUT', body: '' })
      const fetch = (url, init = {}) =>
        url === hidden
          ? Promise.resolve(new Response(null, { status: init.method === 'PUT' ? status : 404 }))
          : pod.fetch(url, init)
      const client = createPodClient(fetch)
      await client.ensurePath(pod.storage, `${hidden}b/c/`)
      expect(pod.files.has(`${hidden}b/c/`)).toBe(true)
      // The container itself still decides: refused, it fails start-up.
      await expect(client.ensurePath(pod.storage, hidden)).rejects.toMatchObject({ status })
    }
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

  it('times out a request that never settles', async () => {
    const hang = (url, init) =>
      new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
    const client = createPodClient(hang, { timeoutMs: 20 })
    await expect(client.get('https://e.x/a')).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('sends the n-quads accept header on HEAD, as GET does', async () => {
    const { pod, client } = setup()
    await client.put(`${pod.storage}h`, 'a')
    await client.etag(`${pod.storage}h`)
    expect(pod.requests('HEAD').at(-1).headers.accept).toBe('application/n-quads')
  })
})

describe('pod client: what a pull needs', () => {
  it('lists members with millisecond modification times (hikari)', async () => {
    const { pod, client } = setup({ listModified: 'ms', containerEtagMoves: true })
    const c = `${pod.storage}c/`
    await client.put(`${c}a`, 'x')
    await client.put(`${c}b`, 'y')
    const { etag, date, members } = await client.listing(c)
    expect(etag).toEqual(expect.any(String))
    expect(date).toEqual(expect.any(Number))
    expect(members.map((m) => m.url).sort()).toEqual([`${c}a`, `${c}b`])
    for (const m of members) expect(m.modified).toMatchObject({ ms: expect.any(Number), precise: true })
  })

  it('lists whole-second times as imprecise', async () => {
    const { pod, client } = setup({ listModified: 'seconds' })
    const c = `${pod.storage}c/`
    await client.put(`${c}a`, 'x')
    const { members } = await client.listing(c)
    expect(members[0].modified).toMatchObject({ precise: false })
    expect(members[0].modified.ms % 1000).toBe(0)
  })

  it('follows Link rel="next" across pages', async () => {
    const { pod, client } = setup({ pageSize: 2 })
    const c = `${pod.storage}c/`
    for (const n of ['a', 'b', 'c', 'd', 'e']) await client.put(`${c}${n}`, n)
    expect((await client.list(c)).sort()).toEqual(['a', 'b', 'c', 'd', 'e'].map((n) => `${c}${n}`))
  })

  it('stat tells a missing resource from a server error', async () => {
    const { pod, client } = setup()
    expect(await client.stat(`${pod.storage}nope`)).toEqual({ exists: false, etag: null })
    pod.failNext('HEAD', 503)
    await expect(client.stat(`${pod.storage}nope`)).rejects.toBeInstanceOf(PodError)
  })

  it('carries Retry-After on a 429', async () => {
    const { pod, client } = setup()
    pod.failNext('GET', 429, 1, null, { 'retry-after': '30' })
    const error = await client.get(`${pod.storage}x`).catch((e) => e)
    expect(error.retryAfterMs).toBe(30000)
  })

  it('reads back after a write that carries no ETag, returning the body', async () => {
    const { pod, client } = setup({ etagOnWrite: false })
    const url = `${pod.storage}n`
    const result = await client.put(url, 'mine')
    expect(result).toEqual({ etag: pod.files.get(url).etag, body: 'mine' })
  })

  it('shows another write that landed before the read-back', async () => {
    const { pod, client } = setup({ etagOnWrite: false })
    const url = `${pod.storage}n`
    pod.before('GET', '/n', () => pod.touch(url, 'theirs'))
    expect((await client.put(url, 'mine')).body).toBe('theirs')
  })

  it('falls back to GET-compare-PUT when a server refuses weak ETags in If-Match', async () => {
    const { pod, client } = setup({ weakEtags: true })
    const url = `${pod.storage}n`
    await client.put(url, 'a')
    const etag = pod.files.get(url).etag
    expect(etag.startsWith('W/')).toBe(true)
    expect(await client.put(url, 'b', { etag })).toMatchObject({ etag: expect.any(String) })
    expect(pod.files.get(url).body).toBe('b')
    expect(await client.put(url, 'c', { etag })).toEqual({ conflict: true })
    expect(pod.files.get(url).body).toBe('b')
  })
})
