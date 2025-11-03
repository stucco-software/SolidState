import PouchDB from "pouchdb"

import {
  put, post, patch, clear, getEntity, getAll, deleteStatements, query
} from './crud'

import {
  seperate
} from './utils'

import {
  createGraph,
  updateGraph,
  getGraph
} from './pod'

const configureStore = (config) => {
  let db = new PouchDB({
    name: config.graph,
  })
  if (config.session) {
    let webid = new URL(config.session.info.webId)
    let podRoot = webid.origin
    let pod = `${podRoot}/${config.graph}`

    let podGraph = getGraph({
      userFetch: config.session.fetch,
      graph: pod,
      db,
    }).then(async graph => {
      let newEdits = graph.filter(node => !node._rev)
      let oldEdits = graph.filter(node => node._rev)
      await db.bulkDocs(newEdits, {new_edits: true})
      await db.bulkDocs(oldEdits, {new_edits: false})
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