import PouchDB from 'pouchdb'
import { createFakePod } from './fake-pod.js'

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

// nk's pod and Ruth's, reached through one session: nk is signed in and signs
// every request, and each pod answers for its own URLs. A store given
// `storage: ruth.storage` projects into Ruth's pod as nk.
export const twoPods = () => {
  const nk = createFakePod({ origin: 'https://nk.test' })
  const ruth = createFakePod({ origin: 'https://ruth.test' })
  const fetch = (url, init) => (String(url).startsWith(ruth.origin) ? ruth : nk).fetch(url, init)
  return { nk, ruth, session: { info: { webId: nk.webId }, fetch } }
}
