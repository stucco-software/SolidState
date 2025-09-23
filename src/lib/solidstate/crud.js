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
  return {}
}

export const getAll = db => async () => {
  return []
}

export const query = db => async (frame) => {
  return []
}

export const clear = db => async () => {
  await db.destroy()
  return true
}
