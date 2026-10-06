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
const decimalString = (n) =>
  Number.isInteger(n) ? `${n}.0` : n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 })

const typeDecimals = (node, context) => {
  const walk = (value, type) => {
    if (Array.isArray(value)) return value.map((v) => walk(v, type))
    if (typeof value === 'number' && xsdName(type) === 'decimal') return { '@value': decimalString(value), '@type': `${XSD}decimal` }
    if (value && typeof value === 'object' && !('@value' in value)) {
      const out = {}
      for (const [key, v] of Object.entries(value)) out[key] = key.startsWith('@') ? v : walk(v, termType(context, key))
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
const toNative = (type, value) => {
  if (xsdName(type) === 'boolean') return value === true || value === 'true' || value === '1'
  const n = Number(value)
  return Number.isNaN(n) ? value : n
}
const termType = (context, key) => {
  const def = context?.[key]
  return def && typeof def === 'object' ? def['@type'] : undefined
}

export const nativize = (node, context) => {
  const walk = (value, type) => {
    if (Array.isArray(value)) return value.map((v) => walk(v, type))
    if (value && typeof value === 'object') {
      if ('@value' in value) return isNative(value['@type']) ? toNative(value['@type'], value['@value']) : value
      const out = {}
      for (const [key, v] of Object.entries(value)) out[key] = key.startsWith('@') ? v : walk(v, termType(context, key))
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
// objects come back nested rather than as separate "_:b0" docs.
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
