import PouchDB from 'pouchdb'

// A fresh in-memory PouchDB. Memory DBs are shared by name inside one
// process, so every call gets a unique name.
export const memoryDb = () => new PouchDB(`test-${crypto.randomUUID()}`, { adapter: 'memory' })

// Collects events emitted through an `emit(name, detail)` callback.
export const events = () => {
  const seen = []
  const emit = (name, detail) => seen.push({ name, ...detail })
  const named = (name) => seen.filter((e) => e.name === name)
  return { emit, seen, named }
}
