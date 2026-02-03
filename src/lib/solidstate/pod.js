import jsonld from "jsonld"

import {
  arrayify
} from './utils'


export const getResourceURL = config => {
  let webid = new URL(config.session.info.webId)
  // @TK make this get path roots too
  let podRoot = webid.origin
  let pod = `${podRoot}/${config.graph}`
  return pod
}

export const context = {
  "@base": "https://solidstate.rdf.systems/",
  "@vocab": ""
}

export const createGraph = async ({url, userFetch, body = []}) => {
  const nquads = await jsonld.toRDF({
    "@context": context,
    "@graph": body
  }, {format: 'application/n-quads'});

  const response = await userFetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/n-quads",
    },
    body: nquads
  })
  return response
}

export const updateGraph = async ({url, userFetch, body = {}}) => {
  const nquads = await jsonld.toRDF({
    "@context": context,
    "@graph": [body]
  }, {format: 'application/n-quads'});

  const response = await userFetch(graphURL(url), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/sparql-update",
    },
    body: `delete {<${body['@id']}> ?p ?o } insert {${nquads}} where { ?s ?p ?o }`
  })

  return response
}

export const getNodeArray = ld => {
  let nodes
  if (ld['@graph']) {
    nodes = ld['@graph']
  } else {
    const { ...node } = ld
    delete node['@context']
    nodes = [node]
  }
  return nodes
}

export const transformQuads = async nquads => {
  if (nquads.length < 1) {
    return []
  }
  let doc = await jsonld.fromRDF(nquads, {format: 'application/n-quads'})
  let json = await jsonld.compact(doc, context)
  const nodes = getNodeArray(json)
  return nodes
}

export const addToPouch = async ({docs, db}) => {
    // add docs to pouch
  let id_docs = docs.map(node => {
    node._id = node['@id']
    return node
  })
  let newEdits = id_docs.filter(node => !node._rev)
  let oldEdits = id_docs.filter(node => node._rev)

  await db._bulkDocs(newEdits, {new_edits: true})
  await db._bulkDocs(oldEdits, {new_edits: false})

}

export const getGraph = async ({userFetch, graph, db}) => {

  // check if resource exists
  let head = await userFetch(graph, {
    method: 'HEAD'
  })

  // if resource doesnt exist,
  if (head.status === 404) {
    // grab current local docs
    let alldocs = await db.allDocs({
      include_docs: true
    })
    const docs = alldocs.rows.map(row => row.doc)

    // create graph with them
    let didCreateGraph = await createGraph({
      url: graph,
      userFetch: userFetch,
      body: docs
    })
  }

  // now get the graph
  let response = await userFetch(graph, {
    method: 'GET',
    headers: {
      "accept": "application/n-quads",
    },
  })

  // now get the quads
  let nquads = await response.text()

  // lets assume these _are_ real nodes
  // and node versions are stored elsewhere
  // if at all
  let nodes = transformQuads(nquads)

  return nodes
}