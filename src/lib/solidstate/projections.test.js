import { describe, it, expect } from 'vitest'
import { memoryDb } from './test/helpers.js'
import { docState } from './pouch.js'
import { projectionId } from './internal.js'
import { readProjection, writeProjection, dropProjection, listProjections } from './projections.js'

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
