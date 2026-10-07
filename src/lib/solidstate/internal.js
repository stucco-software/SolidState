// solidstate's bookkeeping docs share the PouchDB with user docs. Their ids
// start with this prefix, and the public API never returns them.
export const INTERNAL_PREFIX = 'solidstate:'
export const PROJECTION_PREFIX = `${INTERNAL_PREFIX}projection:`

export const projectionId = (id) => `${PROJECTION_PREFIX}${id}`

export const isInternal = (id) => typeof id === 'string' && id.startsWith(INTERNAL_PREFIX)

// Blank-node ids ("_:b0") name nested objects inside a node's RDF. They're
// never projected on their own. (PouchDB rejects ids starting with "_", so
// none can be in the store; the check is defensive.)
export const isProjectable = (id) =>
  typeof id === 'string' && id.length > 0 && !isInternal(id) && !id.startsWith('_:')

// A PouchDB revision's generation: how many edits deep it is ("3-abc" → 3).
export const generation = (rev) => Number.parseInt(String(rev).split('-')[0], 10) || 0
