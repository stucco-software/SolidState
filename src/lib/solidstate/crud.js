// import {
//   context,
//   contextualize,
//   compact,
//   toTriples,
//   castLiteral,
//   typeValue,
//   arrayify,
//   difference,
//   toFrame
// } from './utils'


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

export const put = db => async (id, update) => {
  return {}
}

export const patch = db => async (id, update) => {
  return {}
}

export const deleteStatements = db => async (id, remove) => {
  return {}
}

export const getEntity = db => async (id) => {
  let doc = await db.get(id)
  // TK: Subrepeated
  doc['@id'] = id
  delete doc._id
  delete doc._rev
  return doc
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
