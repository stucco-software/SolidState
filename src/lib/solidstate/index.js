import PouchDB from "pouchdb"
import {
  put, post, patch, clear, getEntity, getAll, deleteStatements, query
} from './crud'

const configureStore = (config) => {
  console.log(`SOLIDSTATE:----------`)
  console.log(config)
  console.log(`---------------------`)
  let db = new PouchDB(config)
  return db
}

const SolidState = (config) => {
  const db = configureStore(config)
  return {
    version: "0.0.1#POUCH",
    post: post(db),
    put: put(db),
    patch: patch(db),
    get: getEntity(db),
    getAll: getAll(db),
    query: query(db),
    delete: deleteStatements(db),
    clear: clear(db)
  }
}

export default SolidState