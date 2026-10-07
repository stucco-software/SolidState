import { describe, it, expect } from 'vitest'
import { projectionId, isInternal, isProjectable, PROJECTION_PREFIX, revList } from './internal.js'

describe('internal ids', () => {
  it('prefixes projection docs', () => {
    expect(projectionId('uuid:1')).toBe(`${PROJECTION_PREFIX}uuid:1`)
    expect(isInternal(projectionId('uuid:1'))).toBe(true)
    expect(isInternal('uuid:1')).toBe(false)
  })

  it('projects user docs only, never internal or blank-node docs', () => {
    expect(isProjectable('uuid:1')).toBe(true)
    expect(isProjectable('stuccoworks')).toBe(true)
    expect(isProjectable(projectionId('x'))).toBe(false)
    expect(isProjectable('_:b0')).toBe(false)
    expect(isProjectable('')).toBe(false)
    expect(isProjectable(undefined)).toBe(false)
  })

  it('lists the revision history of a doc, newest first', () => {
    expect(revList({ _revisions: { start: 3, ids: ['c', 'b', 'a'] } })).toEqual(['3-c', '2-b', '1-a'])
  })
})
