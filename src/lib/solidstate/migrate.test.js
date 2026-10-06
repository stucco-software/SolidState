import { describe, it, expect } from 'vitest'
import { memoryDb, events } from './test/helpers.js'
import { createFakePod } from './test/fake-pod.js'
import { createPodClient } from './podClient.js'
import { createProjector } from './projector.js'
import { migrateLegacy } from './migrate.js'
import { nodeUrl } from './layout.js'

const ctx = { '@base': 'https://e.x/v/', '@vocab': '#' }
const S = 'https://solidstate.rdf.systems/'
const legacyBody = [
  `<#> <${S}createdBy> <SolidState> .`,
  `<${S}a> <${S}title> "A" .`,
  `<${S}a> <${S}_rev> "3-abc" .`,
  `<${S}a> <${S}mention> _:b0 .`,
  `_:b0 <${S}url> "https://x" .`,
  `<uuid:b> <${S}title> "B" .`,
].join('\n')

const setup = async ({ legacy = true } = {}) => {
  const pod = createFakePod()
  const client = createPodClient(pod.fetch)
  const legacyUrl = `${pod.origin}/thoughtloom/site`
  const archiveUrl = `${pod.storage}thoughtloom-archive/site-0.2.nq`
  const containerUrl = `${pod.storage}thoughtloom-data/site/`
  if (legacy) await client.put(legacyUrl, legacyBody)
  const db = memoryDb()
  const ev = events()
  const projector = createProjector({ db, pod: client, containerUrl, context: ctx, emit: ev.emit, retryBaseMs: 60000 })
  const run = () => migrateLegacy({ db, pod: client, rootUrl: pod.storage, legacyUrl, archiveUrl, projector, emit: ev.emit })
  return { pod, db, ev, run, legacyUrl, archiveUrl, containerUrl, projector }
}

describe('migrateLegacy', () => {
  it('does nothing without a 0.2 graph', async () => {
    const { run, pod } = await setup({ legacy: false })
    expect(await run()).toEqual({ migrated: false, reason: 'no-legacy-graph' })
    expect(pod.requests('PUT')).toHaveLength(0)
  })

  it('imports, projects, archives the same triples, then deletes the original', async () => {
    const { run, db, pod, ev, legacyUrl, archiveUrl, containerUrl, projector } = await setup()
    expect(await run()).toEqual({ migrated: true, count: 2 })
    projector.stop()
    expect((await db.allDocs()).rows.map((r) => r.id).filter((id) => !id.startsWith('solidstate:')).sort()).toEqual(['a', 'uuid:b'])
    const a = await db.get('a')
    expect(a._rev).not.toBe('3-abc')
    expect(a.mention).toEqual({ url: 'https://x' })
    expect(Object.keys(a)).not.toContain('_:b0')
    expect(pod.files.has(nodeUrl(containerUrl, 'a'))).toBe(true)
    expect(pod.files.has(nodeUrl(containerUrl, 'uuid:b'))).toBe(true)
    // The fake pod stores bytes, so the archive is the original text. (On
    // stuccoid it would be the same triples, re-serialised.)
    expect(pod.files.get(archiveUrl).body).toBe(legacyBody)
    expect(pod.files.has(legacyUrl)).toBe(false)
    expect(ev.named('migrated')[0]).toMatchObject({ count: 2, archiveUrl })
  })

  it('keeps the local version of a node this device already has', async () => {
    const { run, db } = await setup()
    await db.put({ _id: 'a', '@id': 'a', title: 'Local' })
    await run()
    expect((await db.get('a')).title).toBe('Local')
  })

  it('keeps the original when a node fails to project', async () => {
    const { run, pod, ev, legacyUrl, archiveUrl, projector } = await setup()
    pod.failNext('PUT', 503, 1, 'uuid%3Ab')
    const result = await run()
    projector.stop()
    expect(result).toMatchObject({ migrated: false, reason: 'pending', pending: ['uuid:b'] })
    expect(pod.files.has(legacyUrl)).toBe(true)
    expect(pod.files.has(archiveUrl)).toBe(false)
    expect(ev.named('migration-incomplete')).toHaveLength(1)
  })
})
