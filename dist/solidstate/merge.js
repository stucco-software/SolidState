// Three-way merge of two conflicting revisions of a doc, field by field,
// against their common ancestor:
// - a field only one side changed takes that side's value;
// - a field both sides changed to the same value takes it;
// - a field both sides changed differently is a clash, for the user to decide
//   (mine is kept provisionally).
// Without an ancestor (compaction removed it), every differing field is a
// clash. PouchDB metadata (_id, _rev, …) is never merged.
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
      : value

const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

export const threeWayMerge = (base, mine, theirs) => {
  const keys = new Set(
    [...Object.keys(base ?? {}), ...Object.keys(mine), ...Object.keys(theirs)].filter((key) => !key.startsWith('_')),
  )
  const merged = {}
  const clashes = []
  for (const key of keys) {
    const a = mine[key]
    const b = theirs[key]
    let value
    if (same(a, b)) value = a
    else if (base && same(base[key], a)) value = b
    else if (base && same(base[key], b)) value = a
    else {
      value = a
      clashes.push(key)
    }
    if (value !== undefined) merged[key] = value
  }
  return { merged, clashes }
}
