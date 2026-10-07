import { describe, it, expect } from 'vitest'
import { memoryDb } from './test/helpers.js'
import { conflicts, resolve, hasConflicts, resolveIfIdentical } from './conflicts.js'

// Two devices edit the same doc offline, then replicate both ways.
const conflicted = async () => {
  const a = memoryDb()
  const b = memoryDb()
  await a.put({ _id: 'x', '@id': 'x', title: 'Base', body: 'Body' })
  await a.replicate.to(b)
  const docA = await a.get('x')
  const docB = await b.get('x')
  await a.put({ ...docA, title: 'From A' })
  await b.put({ ...docB, body: 'From B' })
  await a.replicate.to(b)
  await b.replicate.to(a)
  return { a, b }
}

describe('conflicts', () => {
  it('is null for a doc without conflicts, or no doc', async () => {
    const db = memoryDb()
    await db.put({ _id: 'x', t: 1 })
    expect(await conflicts(db, 'x')).toBeNull()
    expect(await conflicts(db, 'missing')).toBeNull()
  })

  it('returns the winner, the other branch, and their common ancestor', async () => {
    const { a } = await conflicted()
    const c = await conflicts(a, 'x')
    expect(c.others).toHaveLength(1)
    const titles = [c.winner.title, c.others[0].doc.title].sort()
    expect(titles).toEqual(['Base', 'From A'])
    expect(c.others[0].base).toMatchObject({ title: 'Base', body: 'Body' })
    expect(c.winner._revisions).toBeUndefined()
  })

  it('base is null when compaction removed the ancestor', async () => {
    const { a } = await conflicted()
    await a.compact()
    const c = await conflicts(a, 'x')
    expect(c.others[0].base).toBeNull()
  })

  it('finds the ancestor on the server when this device only has the branches', async () => {
    const { a, b } = await conflicted()
    const fresh = memoryDb()
    await b.replicate.to(fresh)
    expect((await conflicts(fresh, 'x')).others[0].base).toBeNull()
    expect((await conflicts(fresh, 'x', { remote: a })).others[0].base).toMatchObject({ title: 'Base' })
  })

  it('resolves branches with identical content, and only those', async () => {
    const a = memoryDb()
    const b = memoryDb()
    // Same content by different histories (identical first revisions get
    // the same deterministic _rev and wouldn't conflict at all).
    const draft = await a.put({ _id: 'same', '@id': 'same', title: 'Draft' })
    await a.put({ _id: 'same', _rev: draft.rev, '@id': 'same', title: 'T' })
    await b.put({ _id: 'same', '@id': 'same', title: 'T' })
    await a.put({ _id: 'diff', '@id': 'diff', title: 'A' })
    await b.put({ _id: 'diff', '@id': 'diff', title: 'B' })
    await b.replicate.to(a)
    expect(await resolveIfIdentical(a, 'same')).toBe(true)
    expect(await conflicts(a, 'same')).toBeNull()
    expect(await resolveIfIdentical(a, 'diff')).toBe(false)
    expect(await conflicts(a, 'diff')).not.toBeNull()
  })

  it('resolve saves the merge and removes the losing branch', async () => {
    const { a } = await conflicted()
    expect(await hasConflicts(a)).toBe(true)
    await resolve(a, 'x', { '@id': 'x', title: 'From A', body: 'From B', _rev: 'ignored' })
    const doc = await a.get('x', { conflicts: true })
    expect(doc._conflicts).toBeUndefined()
    expect(doc).toMatchObject({ title: 'From A', body: 'From B' })
    expect(await hasConflicts(a)).toBe(false)
  })
})
