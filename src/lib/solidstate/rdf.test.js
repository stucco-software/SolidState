import { describe, it, expect } from 'vitest'
import { stripPouch, nodeToNQuads, nquadsToNode, nquadsToNodes, nativize, legacyContext, sameGraph } from './rdf.js'

// A site-style context, shaped like thoughtloom's generateContext output.
const ctx = {
  '@base': 'https://e.x/v/',
  '@vocab': '#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  title: { '@id': 'title', '@container': '@language' },
  blocks: { '@id': 'blocks', '@type': '@id', '@container': '@list' },
  tags: { '@id': 'tags', '@container': '@set' },
  price: { '@id': 'price', '@type': 'xsd:decimal' },
  limit: { '@id': 'limit', '@type': 'xsd:integer' },
  open: { '@id': 'open', '@type': 'xsd:boolean' },
  author: { '@id': 'author', '@type': '@id' },
}

describe('stripPouch', () => {
  it('drops PouchDB fields and keeps @id', () => {
    expect(stripPouch({ _id: 'a', _rev: '1-x', _conflicts: [], '@id': 'a', t: 1 })).toEqual({ '@id': 'a', t: 1 })
  })
  it('fills @id from _id when missing', () => {
    expect(stripPouch({ _id: 'a', _rev: '1-x' })).toEqual({ '@id': 'a' })
  })
})

describe('node round trip with a site context', () => {
  const doc = {
    _id: 'p1', _rev: '3-abc', '@id': 'p1', '@type': 'Page',
    title: { en: 'Hi', nl: 'Hoi' },
    blocks: ['b3', 'b1', 'b2'],
    tags: ['one'],
    price: 50.5, limit: 3, open: false, count: 7, flag: true,
    author: 'person-1',
    mention: { url: 'https://x.y', label: 'X' },
  }

  it('never writes Pouch metadata', async () => {
    const nq = await nodeToNQuads(doc, ctx)
    expect(nq).not.toContain('_rev')
    expect(nq).not.toContain('3-abc')
    expect(nq).toContain('"Hi"@en')
  })

  it('writes decimals as legal xsd:decimal literals', async () => {
    const nq = await nodeToNQuads(doc, ctx)
    expect(nq).toContain('"50.5"^^<http://www.w3.org/2001/XMLSchema#decimal>')
    const whole = await nodeToNQuads({ '@id': 'w', price: 50 }, ctx)
    expect(whole).toContain('"50.0"^^<http://www.w3.org/2001/XMLSchema#decimal>')
    expect((await nquadsToNode(whole, ctx, 'w')).price).toBe(50)
  })

  it('sameGraph ignores line order and blank-node labels', async () => {
    const nq = await nodeToNQuads(doc, ctx)
    const shuffled = nq.trim().split('\n').reverse().join('\n').replaceAll('_:b', '_:x')
    expect(await sameGraph(nq, shuffled)).toBe(true)
    expect(await sameGraph(nq, await nodeToNQuads({ ...doc, title: { en: 'Other' } }, ctx))).toBe(false)
  })

  it('comes back equal, in order, with native types and nested objects', async () => {
    const back = await nquadsToNode(await nodeToNQuads(doc, ctx), ctx, 'p1')
    expect(back).toEqual(stripPouch(doc))
  })

  it('returns null for an id that is not there, or empty input', async () => {
    expect(await nquadsToNode(await nodeToNQuads(doc, ctx), ctx, 'nope')).toBeNull()
    expect(await nquadsToNode('', ctx, 'p1')).toBeNull()
  })

  it('reads an untagged string under a language container as @none', async () => {
    const nq = await nodeToNQuads({ '@id': 'x', title: 'legacy' }, { ...ctx, title: { '@id': 'title' } })
    expect((await nquadsToNode(nq, ctx, 'x')).title).toEqual({ '@none': 'legacy' })
  })
})

describe('legacy (0.2) graphs', () => {
  const nq = [
    '<https://solidstate.rdf.systems/a> <https://solidstate.rdf.systems/title> "A" .',
    '<https://solidstate.rdf.systems/a> <https://solidstate.rdf.systems/_rev> "3-abc" .',
    '<https://solidstate.rdf.systems/a> <https://solidstate.rdf.systems/mention> _:b0 .',
    '_:b0 <https://solidstate.rdf.systems/url> "https://x" .',
    '<https://solidstate.rdf.systems/b> <https://solidstate.rdf.systems/link> "a" .',
    '<uuid:c> <https://solidstate.rdf.systems/title> "C" .',
  ].join('\n')

  it('returns every named node, with blank nodes inlined and none on their own', async () => {
    const nodes = await nquadsToNodes(nq, legacyContext)
    expect(nodes.map((n) => n['@id']).sort()).toEqual(['a', 'b', 'uuid:c'])
    expect(nodes.find((n) => n['@id'] === 'a').mention).toEqual({ url: 'https://x' })
    expect(nodes.find((n) => n['@id'] === 'b').link).toBe('a')
  })
})

describe('nativize', () => {
  it('converts typed values and leaves the rest', () => {
    const out = nativize({
      price: '5.05E1',
      count: { '@type': 'xsd:integer', '@value': '7' },
      when: { '@type': 'xsd:dateTime', '@value': '2026-01-01' },
      title: { en: 'Hi' },
    }, ctx)
    expect(out).toEqual({
      price: 50.5,
      count: 7,
      when: { '@type': 'xsd:dateTime', '@value': '2026-01-01' },
      title: { en: 'Hi' },
    })
  })
})
