import { describe, it, expect } from 'vitest'
import { memoryDb } from './test/helpers.js'
import { getEntity, getAll } from './crud.js'
import { projectionId } from './internal.js'

describe('crud hides internal docs', () => {
  it('get returns null and getAll skips them', async () => {
    const db = memoryDb()
    await db.put({ _id: 'a', '@id': 'a', title: 'A' })
    await db.put({ _id: projectionId('a'), rev: '1-x', etag: '"e"' })
    expect(await getEntity(db)(projectionId('a'))).toBeNull()
    expect((await getAll(db)()).map((n) => n['@id'])).toEqual(['a'])
  })
})
