// PouchDB 404s both deleted and never-existing docs; the reason tells them
// apart. Importers must not resurrect a doc this device deleted.
export const docState = async (db, id, options) => {
  try {
    return { state: 'present', doc: await db.get(id, options) }
  } catch (e) {
    if (e.status !== 404) throw e
    return { state: e.reason === 'deleted' ? 'deleted' : 'missing', doc: null }
  }
}
