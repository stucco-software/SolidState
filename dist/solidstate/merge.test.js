import { describe, it, expect } from 'vitest'
import { threeWayMerge } from './merge.js'

const base = { '@id': 'a', title: 'Old', body: 'Body', tags: ['x'] }

describe('threeWayMerge', () => {
  it('takes each side\'s one-sided changes without asking', () => {
    const mine = { ...base, title: 'Mine' }
    const theirs = { ...base, body: 'Theirs' }
    expect(threeWayMerge(base, mine, theirs)).toEqual({
      merged: { '@id': 'a', title: 'Mine', body: 'Theirs', tags: ['x'] },
      clashes: [],
    })
  })

  it('reports fields both sides changed differently, keeping mine provisionally', () => {
    const r = threeWayMerge(base, { ...base, title: 'Mine' }, { ...base, title: 'Theirs' })
    expect(r.clashes).toEqual(['title'])
    expect(r.merged.title).toBe('Mine')
  })

  it('agrees when both sides made the same change', () => {
    const r = threeWayMerge(base, { ...base, title: 'Same' }, { ...base, title: 'Same' })
    expect(r).toEqual({ merged: { ...base, title: 'Same' }, clashes: [] })
  })

  it('applies a one-sided deletion and an added field', () => {
    const { body, ...withoutBody } = base
    const r = threeWayMerge(base, withoutBody, { ...base, summary: 'New' })
    expect(r.merged).toEqual({ '@id': 'a', title: 'Old', tags: ['x'], summary: 'New' })
    expect(r.clashes).toEqual([])
  })

  it('compares values structurally (arrays, objects, key order)', () => {
    const r = threeWayMerge({ m: { a: 1, b: 2 } }, { m: { b: 2, a: 1 } }, { m: { a: 1, b: 3 } })
    expect(r).toEqual({ merged: { m: { a: 1, b: 3 } }, clashes: [] })
    const list = threeWayMerge({ m: [{ a: 1, b: 2 }] }, { m: [{ b: 2, a: 1 }] }, { m: [{ a: 1, b: 3 }] })
    expect(list).toEqual({ merged: { m: [{ a: 1, b: 3 }] }, clashes: [] })
  })

  it('a deletion against a change is a clash, keeping mine (the deletion)', () => {
    const { body, ...withoutBody } = base
    const r = threeWayMerge(base, withoutBody, { ...base, body: 'Theirs' })
    expect(r).toEqual({ merged: { '@id': 'a', title: 'Old', tags: ['x'] }, clashes: ['body'] })
  })

  it('without an ancestor, every differing field is a clash', () => {
    const r = threeWayMerge(null, { title: 'A', same: 1 }, { title: 'B', same: 1 })
    expect(r.clashes).toEqual(['title'])
    expect(r.merged).toEqual({ title: 'A', same: 1 })
  })

  it('never merges PouchDB metadata', () => {
    const r = threeWayMerge({ _rev: '1-a', t: 1 }, { _rev: '2-b', t: 1 }, { _rev: '2-c', t: 1 })
    expect(r.merged).toEqual({ t: 1 })
  })
})
