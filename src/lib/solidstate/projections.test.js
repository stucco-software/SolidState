import { describe, it, expect } from 'vitest'
import { memoryDb } from './test/helpers.js'
import { docState } from './pouch.js'
import { projectionId } from './internal.js'
import {
  readProjection, writeProjection, dropProjection, listProjections, forAnotherTarget, droppedElsewhere, untargetedContainer,
} from './projections.js'

describe('docState', () => {
  it('tells present, deleted and missing apart', async () => {
    const db = memoryDb()
    const { rev } = await db.put({ _id: 'a' })
    expect((await docState(db, 'a')).state).toBe('present')
    await db.remove('a', rev)
    expect((await docState(db, 'a')).state).toBe('deleted')
    expect((await docState(db, 'b')).state).toBe('missing')
  })
})

describe('projection records', () => {
  it('writes, updates, lists and drops', async () => {
    const db = memoryDb()
    expect(await readProjection(db, 'n1')).toBeNull()
    await writeProjection(db, 'n1', { rev: '1-a', etag: '"e1"' })
    await writeProjection(db, 'n1', { rev: '2-b', etag: '"e2"' })
    expect(await readProjection(db, 'n1')).toMatchObject({ rev: '2-b', etag: '"e2"' })
    await writeProjection(db, 'n2', { rev: '1-c', etag: '"e3"' })
    expect((await listProjections(db)).map((p) => p.id).sort()).toEqual(['n1', 'n2'])
    await dropProjection(db, 'n1')
    expect(await readProjection(db, 'n1')).toBeNull()
    await writeProjection(db, 'n1', { rev: '3-d', etag: '"e4"' })
    expect(await readProjection(db, 'n1')).toMatchObject({ rev: '3-d' })
  })
})

describe('projection records from two devices', () => {
  it('a conflicted record keeps its winner and drops the rest', async () => {
    const db = memoryDb()
    await writeProjection(db, 'n1', { rev: '1-a', etag: '"e1"' })
    await db.bulkDocs([{ _id: projectionId('n1'), _rev: '1-zzzz', rev: '1-a', etag: '"e1"' }], { new_edits: false })
    expect((await db.get(projectionId('n1'), { conflicts: true }))._conflicts).toHaveLength(1)
    const kept = await readProjection(db, 'n1')
    expect(kept).toMatchObject({ _rev: '1-zzzz', rev: '1-a', etag: '"e1"' })
    expect(kept).not.toHaveProperty('_conflicts')
    expect((await db.get(projectionId('n1'), { conflicts: true }))._conflicts).toBeUndefined()
  })

  it('keeps the record of the newest node revision, even when it loses the conflict', async () => {
    const db = memoryDb()
    // PouchDB's winner (1-zzzz, by hash) names an older node revision than
    // the other record: keeping it would send a stale If-Match.
    await db.bulkDocs(
      [
        { _id: projectionId('n1'), _rev: '1-aaaa', rev: '5-new', etag: '"e5"' },
        { _id: projectionId('n1'), _rev: '1-zzzz', rev: '4-old', etag: '"e4"' },
      ],
      { new_edits: false },
    )
    expect((await db.get(projectionId('n1')))._rev).toBe('1-zzzz')
    expect(await readProjection(db, 'n1')).toMatchObject({ rev: '5-new', etag: '"e5"' })
    const stored = await db.get(projectionId('n1'), { conflicts: true })
    expect(stored).toMatchObject({ rev: '5-new', etag: '"e5"' })
    expect(stored._conflicts).toBeUndefined()
    await writeProjection(db, 'n1', { rev: '6-next', etag: '"e6"' })
    expect(await readProjection(db, 'n1')).toMatchObject({ rev: '6-next' })
  })
})

const HERE = 'https://ruth.test/thoughtloom-data/hello/'
const THERE = 'https://nk.test/thoughtloom-data/hello/'

describe('projection targets', () => {
  it('a record keeps the container it was written to, through partial updates', async () => {
    const db = memoryDb()
    await writeProjection(db, 'n1', { rev: '1-a', etag: '"e1"', target: HERE, base: { '@id': 'n1' } })
    await writeProjection(db, 'n1', { etag: '"e2"', listed: 5 })
    expect(await readProjection(db, 'n1')).toMatchObject({
      rev: '1-a', etag: '"e2"', target: HERE, listed: 5, base: { '@id': 'n1' },
    })
    // Written for another container: what it knew about the old one goes.
    await writeProjection(db, 'n1', { target: THERE, base: null, listed: null })
    const moved = await readProjection(db, 'n1')
    expect(moved).toMatchObject({ rev: '1-a', target: THERE })
    expect(moved).not.toHaveProperty('base')
    expect(moved).not.toHaveProperty('listed')
  })

  it('a record is for another container only when it names a different one', () => {
    expect(forAnotherTarget(null, HERE)).toBe(false)
    // Records from before 0.6 name no container, and count as the current one's…
    expect(forAnotherTarget({ rev: '1-a', etag: '"e"' }, HERE)).toBe(false)
    expect(forAnotherTarget({ rev: '1-a', etag: '"e"', target: HERE }, HERE)).toBe(false)
    expect(forAnotherTarget({ rev: '1-a', etag: '"e"', target: THERE }, HERE)).toBe(true)
    // …unless they were written to another (`untargeted`): the store has moved since.
    expect(forAnotherTarget({ rev: '1-a', etag: '"e"' }, HERE, THERE)).toBe(true)
    expect(forAnotherTarget({ rev: '1-a', etag: '"e"', target: HERE }, HERE, THERE)).toBe(false)
  })

  it('of conflicting records, keeps the newest whole, so its ETag stays with its container', async () => {
    const db = memoryDb()
    await db.bulkDocs(
      [
        { _id: projectionId('n1'), _rev: '1-aaaa', rev: '5-new', etag: '"ruth5"', target: HERE },
        { _id: projectionId('n1'), _rev: '1-zzzz', rev: '4-old', etag: '"nk4"', target: THERE, listed: 3 },
      ],
      { new_edits: false },
    )
    const kept = await readProjection(db, 'n1')
    expect(kept).toMatchObject({ rev: '5-new', etag: '"ruth5"', target: HERE })
    expect(kept).not.toHaveProperty('listed')
    expect(await db.get(projectionId('n1'))).toMatchObject({ rev: '5-new', etag: '"ruth5"', target: HERE })
  })

  // Two devices wrote the same revision into one container, each unaware of
  // the other's record. Only one ETag is the pod's, and PouchDB's winner is
  // picked by hash, not by which write landed last: keep neither ETag.
  it('of conflicting records for the same revision and container, keeps neither ETag', async () => {
    for (const [first, second] of [['"a"', '"b"'], ['"b"', '"a"'], ['"a"', undefined]]) {
      const db = memoryDb()
      await db.bulkDocs(
        [
          { _id: projectionId('n1'), _rev: '1-aaaa', rev: '3-k', ...(first ? { etag: first } : {}), target: HERE },
          { _id: projectionId('n1'), _rev: '1-zzzz', rev: '3-k', ...(second ? { etag: second } : {}), target: HERE },
        ],
        { new_edits: false },
      )
      const kept = await readProjection(db, 'n1')
      expect(kept).toMatchObject({ rev: '3-k', target: HERE })
      expect(kept).not.toHaveProperty('etag')
      const stored = await db.get(projectionId('n1'), { conflicts: true })
      expect(stored).not.toHaveProperty('etag')
      expect(stored._conflicts).toBeUndefined()
    }
  })

  it('of conflicting records that agree on the revision and ETag, keeps the ETag', async () => {
    const db = memoryDb()
    await db.bulkDocs(
      [
        { _id: projectionId('n1'), _rev: '1-aaaa', rev: '3-k', etag: '"a"', target: HERE },
        { _id: projectionId('n1'), _rev: '1-zzzz', rev: '3-k', etag: '"a"', target: HERE },
        // Same revision, written to another container: its ETag is that pod's.
        { _id: projectionId('n2'), _rev: '1-aaaa', rev: '3-k', etag: '"ruth"', target: HERE },
        { _id: projectionId('n2'), _rev: '1-zzzz', rev: '3-k', etag: '"nk"', target: THERE },
      ],
      { new_edits: false },
    )
    expect(await readProjection(db, 'n1')).toMatchObject({ rev: '3-k', etag: '"a"', target: HERE })
    // PouchDB's winner (1-zzzz) is kept whole.
    expect(await readProjection(db, 'n2')).toMatchObject({ rev: '3-k', etag: '"nk"', target: THERE })
  })

  it('a dropped record remembers which container’s copy was deleted', async () => {
    const db = memoryDb()
    expect(await droppedElsewhere(db, 'never', HERE)).toBe(false)
    for (const [id, target] of [['there', THERE], ['here', HERE], ['from05', undefined]]) {
      await writeProjection(db, id, { rev: '1-a', etag: '"e"', target })
      await dropProjection(db, id, { target })
      expect(await readProjection(db, id)).toBeNull()
    }
    expect(await droppedElsewhere(db, 'there', HERE)).toBe(true)
    expect(await droppedElsewhere(db, 'here', HERE)).toBe(false)
    expect(await droppedElsewhere(db, 'from05', HERE)).toBe(false)
    // Dropped before 0.6, in the container the store has since moved from.
    expect(await droppedElsewhere(db, 'from05', HERE, THERE)).toBe(true)
    // Recorded again: a live record isn't a dropped one.
    await writeProjection(db, 'there', { rev: '2-b', etag: '"f"', target: THERE })
    expect(await droppedElsewhere(db, 'there', HERE)).toBe(false)
  })

  it('remembers where records from before 0.6 went: the first container asked about, on this device only', async () => {
    const db = memoryDb()
    expect(await untargetedContainer(db, THERE)).toBe(THERE)
    expect(await untargetedContainer(db, HERE)).toBe(THERE)
    // A _local doc: it never replicates, so each device has its own.
    const other = memoryDb()
    await db.replicate.to(other)
    expect(await untargetedContainer(other, HERE)).toBe(HERE)
  })
})
