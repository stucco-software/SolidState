import jsonld from 'jsonld'

export const XSD = 'http://www.w3.org/2001/XMLSchema#'
export const NQUADS = 'application/n-quads'

// The 0.2 context: keys become https://solidstate.rdf.systems/<key>. The
// default for graphs that pass no context, and the one 0.2 graph resources
// were written with.
export const legacyContext = { '@base': 'https://solidstate.rdf.systems/', '@vocab': '' }

const POUCH_FIELDS = ['_id', '_rev', '_deleted', '_conflicts', '_attachments', '_revisions', '_revs_info', '_local_seq']

export const stripPouch = (doc) => {
  const node = { ...doc }
  for (const field of POUCH_FIELDS) delete node[field]
  if (!node['@id'] && doc._id) node['@id'] = doc._id
  return node
}

// jsonld writes a number under an xsd:decimal term in exponent form
// ("5.05E1"), which isn't a legal xsd:decimal. Write those as plain decimal
// strings instead.
// Plain decimal notation for any finite number: 50 → "50.0", 1e21 →
// "1000000000000000000000.0", 1.5e-7 → "0.00000015". null for NaN/Infinity.
const decimalString = (n) => {
  if (!Number.isFinite(n)) return null
  const [mantissa, exponent] = String(Math.abs(n)).split('e')
  const [whole, fraction = ''] = mantissa.split('.')
  const digits = whole + fraction
  const point = whole.length + Number(exponent ?? 0)
  const sign = n < 0 ? '-' : ''
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}.0`
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

const typeDecimals = (node, context) => {
  const walk = (value, type) => {
    if (Array.isArray(value)) return value.map((v) => walk(v, type))
    if (typeof value === 'number' && xsdName(type) === 'decimal') {
      const s = decimalString(value)
      return s === null ? value : { '@value': s, '@type': `${XSD}decimal` }
    }
    if (value && typeof value === 'object' && !('@value' in value)) {
      const out = {}
      for (const [key, v] of Object.entries(value)) out[key] = key.startsWith('@') || isMap(context, key) ? v : walk(v, termType(context, key))
      return out
    }
    return value
  }
  return walk(node)
}

// Only terms the context declares keep their shape: an undeclared one-element
// array comes back as a scalar, and an undeclared multi-valued array loses its
// order. Declare `@set` / `@list` for array fields (thoughtloom's
// generateContext does).
export const nodeToNQuads = (doc, context) =>
  jsonld.toRDF({ '@context': context, '@graph': [typeDecimals(stripPouch(doc), context)] }, { format: NQUADS })

// Same triples, regardless of blank-node labels and line order.
const canonical = (nquads) =>
  jsonld.canonize(nquads, { inputFormat: NQUADS, algorithm: 'URDNA2015', format: NQUADS })
// A body that doesn't parse as n-quads (another app wrote Turtle or plain
// text) is never the same graph.
export const sameGraph = async (a, b) => {
  try {
    return (await canonical(a)) === (await canonical(b))
  } catch {
    return false
  }
}

// --- native types -----------------------------------------------------------
// jsonld returns xsd numbers and booleans as strings or value objects
// (its useNativeTypes option breaks typed terms). Convert them back.
const NUMERIC = new Set([
  'integer', 'decimal', 'double', 'float', 'int', 'long', 'short', 'byte',
  'nonNegativeInteger', 'positiveInteger', 'negativeInteger', 'nonPositiveInteger',
  'unsignedInt', 'unsignedLong',
])
const xsdName = (type) => {
  if (typeof type !== 'string') return null
  if (type.startsWith('xsd:')) return type.slice(4)
  if (type.startsWith(XSD)) return type.slice(XSD.length)
  return null
}
const isNative = (type) => {
  const name = xsdName(type)
  return name === 'boolean' || NUMERIC.has(name)
}
// Fractional types may lose precision as a Number; integer types must not.
const FRACTIONAL = new Set(['decimal', 'double', 'float'])
const toNative = (type, value) => {
  if (xsdName(type) === 'boolean') return value === true || value === 'true' || value === '1'
  if (typeof value === 'string' && value.trim() === '') return value
  const n = Number(value)
  if (Number.isNaN(n)) return value
  if (!FRACTIONAL.has(xsdName(type)) && !Number.isSafeInteger(n)) return value
  return n
}
const termType = (context, key) => {
  const def = context?.[key]
  return def && typeof def === 'object' ? def['@type'] : undefined
}
const containerOf = (context, key) => {
  const container = context?.[key]?.['@container']
  return container === undefined ? [] : [container].flat()
}
// Keys of a language or index map are languages / indexes, not terms.
const isMap = (context, key) => {
  const container = containerOf(context, key)
  return container.includes('@language') || container.includes('@index')
}

export const nativize = (node, context) => {
  const walk = (value, type) => {
    if (Array.isArray(value)) return value.map((v) => walk(v, type))
    if (value && typeof value === 'object') {
      if ('@value' in value) return isNative(value['@type']) ? toNative(value['@type'], value['@value']) : value
      const out = {}
      for (const [key, v] of Object.entries(value)) out[key] = key.startsWith('@') || isMap(context, key) ? v : walk(v, termType(context, key))
      return out
    }
    if (typeof value === 'string' && isNative(type)) return toNative(type, value)
    return value
  }
  return walk(node)
}

// --- n-quads → nodes --------------------------------------------------------
const isBlank = (id) => typeof id === 'string' && id.startsWith('_:')

const nodesOf = (compacted) => {
  if (compacted['@graph']) return compacted['@graph']
  const { '@context': _, ...node } = compacted
  return Object.keys(node).length ? [node] : []
}

// Put each blank node back inside the node that references it, so nested
// objects come back nested rather than as separate "_:b0" docs. Only blank
// nodes referenced exactly once round-trip faithfully: orphan blank nodes are
// dropped, and shared ones are copied into each referrer. JSON docs from Pouch
// never produce either; only RDF written by other apps can. (Likewise
// nativize and typeDecimals read the top-level context only, not scoped
// contexts.)
const inlineBlankNodes = (nodes) => {
  const blanks = new Map(nodes.filter((n) => isBlank(n['@id'])).map((n) => [n['@id'], n]))
  const expand = (id, seen) => {
    const { '@id': _, ...rest } = blanks.get(id)
    return inline(rest, new Set(seen).add(id))
  }
  const inline = (value, seen) => {
    if (Array.isArray(value)) return value.map((v) => inline(v, seen))
    // A term typed @id compacts a blank reference to a bare "_:b0" string.
    if (isBlank(value) && blanks.has(value) && !seen.has(value)) return expand(value, seen)
    if (!value || typeof value !== 'object') return value
    const id = value['@id']
    if (isBlank(id) && Object.keys(value).length === 1 && blanks.has(id) && !seen.has(id)) return expand(id, seen)
    const out = {}
    for (const [key, v] of Object.entries(value)) out[key] = key === '@id' ? v : inline(v, seen)
    return out
  }
  return nodes.filter((n) => !isBlank(n['@id'])).map((n) => inline(n, new Set()))
}

export const nquadsToNodes = async (nquads, context) => {
  if (!nquads || !nquads.trim()) return []
  const expanded = await jsonld.fromRDF(nquads, { format: NQUADS })
  const compacted = await jsonld.compact(expanded, context)
  return inlineBlankNodes(nodesOf(compacted)).map((node) => nativize(node, context))
}

export const nquadsToNode = async (nquads, context, id) =>
  (await nquadsToNodes(nquads, context)).find((node) => node['@id'] === id) ?? null
