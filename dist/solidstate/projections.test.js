import { describe, it, expect } from 'vitest'
import { memoryDb } from './test/helpers.js'
import { docState } from './pouch.js'
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
