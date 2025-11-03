import jsonld from "jsonld"

export const context = {
  "@base": "https://solidstate.rdf.systems/",
  "@vocab": "",
  "_rev": {
    "@type": "@id",
    "@id": "_rev"
  },
  "_id": {
    "@reverse": "_rev"
  }
}

export const createGraph = async ({url, userFetch, body = []}) => {
  const nquads = await jsonld.toRDF({
    "@context": context,
    "@graph": seperate(body)
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

export const updateGraph = async ({url, userFetch, body = []}) => {
  const nquads = await jsonld.toRDF({
    "@context": context,
    "@graph": seperate([body])
  }, {format: 'application/n-quads'});

  const response = await userFetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/sparql-update",
    },
    body: `insert data {${nquads}}`
  })
  return response
}

export const getGraph = async ({userFetch, graph, db}) => {
  // let DEL = await userFetch(graph, {
  //   method: 'DELETE'
  // })
  let head = await userFetch(graph, {
    method: 'HEAD'
  })
  if (head.status === 404) {
    let alldocs = await db.allDocs({
      include_docs: true
    })
    const docs = alldocs.rows.map(row => row.doc)

    let didCreateGraph = await createGraph({
      url: graph,
      userFetch: userFetch,
      body: docs
    })
  }
  let response = await userFetch(graph, {
    method: 'GET',
    headers: {
      "Content-Type": "application/n-quads",
    },
  })
  let nquads = await response.text()
  if (nquads.length < 1) {
    return []
  }
  let doc = await jsonld.fromRDF(nquads, {format: 'application/n-quads'})
  let json = await jsonld.compact(doc, context)
  let docs = await jsonld.frame(json, {
    "@context": context,
    "@id": {},
    "_rev": {}
  })
  delete docs["@context"]
  let nodes
  if (docs['@graph']) {
    nodes = docs['@graph']
  } else {
    nodes = [docs]
  }
  let realNodes = nodes
    .filter(node => node._rev)
    .map(node => {
      let rev_id = node._rev['@id']
      delete node._rev['@id']
      let rev = node._rev
      delete node._rev
      return {
        ...node,
        ...rev,
        _rev: rev_id,
        _id: node['@id']
      }
    })
  return realNodes
}