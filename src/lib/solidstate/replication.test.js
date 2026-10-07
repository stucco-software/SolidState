import { describe, it, expect, vi } from 'vitest'
import { memoryDb, events } from './test/helpers.js'
import { createReplication, remoteFor } from './replication.js'

describe('replication', () => {
  it('catches up from the server once', async () => {
    const server = memoryDb()
    await server.put({ _id: 'a', t: 1 })
    const db = memoryDb()
    const r = createReplication({ db, remote: server, emit: () => {} })
    expect(await r.catchUp()).toBe(true)
    expect((await db.get('a')).t).toBe(1)
  })

  it('then keeps both ways live until stopped', async () => {
    const server = memoryDb()
    const db = memoryDb()
    const ev = events()
    const r = createReplication({ db, remote: server, emit: ev.emit })
    r.start()
    await db.put({ _id: 'up', t: 1 })
    await server.put({ _id: 'down', t: 2 })
    await vi.waitFor(async () => {
      expect((await server.get('up')).t).toBe(1)
      expect((await db.get('down')).t).toBe(2)
    })
    r.stop()
    await db.put({ _id: 'after', t: 3 })
    await new Promise((resolve) => setTimeout(resolve, 50))
    await expect(server.get('after')).rejects.toMatchObject({ status: 404 })
  })

  it('reports a catch-up that fails or times out, without throwing', async () => {
    const db = memoryDb()
    const ev = events()
    const broken = { replicate: undefined } // not a database
    const r = createReplication({ db, remote: broken, emit: ev.emit, catchUpTimeoutMs: 50 })
    expect(await r.catchUp()).toBe(false)
    expect(ev.named('sync-error')[0]).toMatchObject({ stage: 'replication' })
  })

  it('reports offline when the server is unreachable', async () => {
    const db = memoryDb()
    const ev = events()
    const failing = async () => { throw new TypeError('offline') }
    const r = createReplication({ db, remote: remoteFor({ url: 'https://sync.invalid/db/x', fetch: failing }), emit: ev.emit })
    r.start()
    await vi.waitFor(() => expect(ev.named('replication').some((e) => e.state === 'offline')).toBe(true))
    r.stop()
  })

  it('stop cancels a catch-up in progress', async () => {
    const db = memoryDb()
    const hang = () => new Promise(() => {})
    const r = createReplication({ db, remote: remoteFor({ url: 'https://sync.invalid/db/x', fetch: hang }), emit: () => {}, catchUpTimeoutMs: 10_000 })
    const started = Date.now()
    const done = r.catchUp()
    setTimeout(() => r.stop(), 20)
    expect(await done).toBe(false)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('passes a plain headers object to the signing fetch', async () => {
    let seen = null
    const signing = async (url, options) => {
      seen = options.headers
      throw new TypeError('stop here')
    }
    await remoteFor({ url: 'https://sync.invalid/db/x', fetch: signing }).info().catch(() => {})
    expect(seen).not.toBeInstanceOf(Headers)
    expect(typeof seen).toBe('object')
  })

  it('remoteFor returns a given database, or builds an http one with the fetch', () => {
    const server = memoryDb()
    expect(remoteFor({ remote: server })).toBe(server)
    const fetch = () => {}
    const http = remoteFor({ url: 'https://sync.example/db/x', fetch })
    expect(http.adapter).toMatch(/^https?$/)
    expect(http.name).toBe('https://sync.example/db/x')
  })
})
