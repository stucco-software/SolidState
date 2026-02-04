import PouchDB from "pouchdb"

import {
  put, post, patch, clear, getEntity, getAll, deleteStatements, query
} from './crud'

import {
  getResourceURL,
  checkGraph,
  createGraph,
  updateGraph,
  getGraph,
  addToPouch
} from './pod'

export const configureStore = (config) => {
  let db = new PouchDB({
    name: config.graph,
  })

  if (config.session) {
    // connect to pod
    let pod = getResourceURL(config)
    checkGraph({userFetch: config.session.fetch, graph: pod})
      .then(graphExists => {
        if (!graphExists) {
          const fn = getAll(db)
          return fn()
        }
        return null
      })
      .then(body => {
        if (body) {
          return createGraph({
            userFetch: config.session.fetch,
            url: pod,
            body
          })
        }
      }).then(result => {
        let podGraph = getGraph({
          userFetch: config.session.fetch,
          graph: pod
        }).then(async docs => {
          await addToPouch({docs, db})
        })
      })


    const changes = db.changes({
      since: 'now',
      live: true,
      include_docs: true
    }).on('change', change => {
      updateGraph({
        url: pod,
        userFetch: config.session.fetch,
        body: change.doc
      })
    })
  }
  return db
}

const SolidState = (config) => {
  const db = configureStore(config)
  return {
    version: "0.0.1#POUCH",
    config: config,
    changes: db.changes,
    _changes: db._changes,
    _bulkDocs: db.bulkDocs,
    _allDocs: db.allDocs,
    once: db.once,
    on: db.on,
    taskqueue: db.taskqueue,
    info: db.info,
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