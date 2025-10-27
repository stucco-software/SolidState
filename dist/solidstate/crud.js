import {
  arrayify,
  difference
} from './utils.js'

export const post = db => async (doc) => {
  if (!doc['@id']) {
    doc['@id'] = `uuid:${crypto.randomUUID()}`
  }
  doc._id = doc['@id']
  let ref = await db.post(doc)
  delete doc._id
  doc['@id'] = ref.id
  return doc
}

export const putDoc = db => async (doc) => {
  let ref = await db.put(doc)
  doc['@id'] = ref.id
  delete doc._id
  delete doc._rev
  return doc
}

export const put = db => async (id, update) => {
  let doc = await db.get(id)
  const updated = Object.assign({}, doc, update);
  const ref = await putDoc(db)(updated)
  return ref
}

export const patch = db => async (id, update) => {
  let doc = await db.get(id)
  const updated = structuredClone(doc)
  const keys = Object.keys(update)
  keys.forEach(key => {
    updated[key] = [...arrayify(doc[key]), ...arrayify(update[key])]
  })
  const ref = await putDoc(db)(updated)
  return ref
}

export const deleteStatements = db => async (id, remove) => {
  let doc = await db.get(id)
  const updated = structuredClone(doc)
  if (!remove) {
    let ref = await db.remove(doc)
    return null
  } else {
    const keys = Object.keys(remove)
    keys.forEach(key => {
      updated[key] = difference(arrayify(doc[key]), arrayify(remove[key]))
    })
    let ref = await putDoc(db)(updated)
    return ref
  }
}

export const getEntity = db => async (id) => {
  try {
    let doc = await db.get(id)
    // TK: Subrepeated
    doc['@id'] = id
    delete doc._id
    delete doc._rev
    return doc
  } catch (e) {
    return null
  }
}

export const getAll = db => async () => {
  const results = await db.allDocs({
    include_docs: true,
  })
  const docs = results
    .rows
    .map(row => row.doc)
    .map(doc => {
      delete doc._id
      delete doc._rev
      return doc
    })
  return docs
}

export const query = db => async (frame) => {
  return []
}

export const clear = db => async () => {
  await db.destroy()
  return true
}
