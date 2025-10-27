import { describe, it, expect, beforeEach} from 'vitest'
import {
  arrayify,
  difference
} from './utils.js'

describe('arrayify()', () => {
  it('Returns the input if it is an array', () => {
    expect(arrayify(['a', 'b', 'c'])).toStrictEqual(['a', 'b', 'c'])
  })

  it('Returns the an array with the input if it is not an array', () => {
    expect(arrayify('a')).toStrictEqual(['a'])
  })

  it('Returns an empty array if input is null', () => {
    expect(arrayify(null)).toStrictEqual([])
  })

  it('Returns an empty array if input is undefined', () => {
    expect(arrayify(undefined)).toStrictEqual([])
  })

  it('Returns an empty array if input is false', () => {
    expect(arrayify(false)).toStrictEqual([])
  })
})

describe('difference()', () => {
  it('Returns an array of the difference between two arrays', () => {
    let setA = [1, 2, 3]
    let setB = [1, 3]
    let diff = difference(setA, setB)
    expect(diff).toStrictEqual([2])
  })
})