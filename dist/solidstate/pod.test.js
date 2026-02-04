import SolidState, {configureStore} from './'

import { describe, it, expect, beforeEach} from 'vitest'
import {
  docs2nodes,
  getAll
} from './crud.js'

import {
  checkGraph,
  createGraph,
  getResourceURL,
  transformQuads,
  getNodeArray,
  addToPouch,
} from './pod.js'


const sampleConfig = {
  graph: 'test-graph',
  session: {
    info: {
      webId: "https://test.login.stucco.software/profile/card#me"
    },
    fetch: () => {

    }
  }
}

let db = SolidState({
  graph: 'pod-connect'
})

const simpleTriples = `
  <https://wise.login.stucco.software/profile/card#me> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://xmlns.com/foaf/0.1/Person> .
  <https://wise.login.stucco.software/profile/card#me> <https://solidid.stucco.software/vocabulary#displayName> "Nikolas Wise" .
`
const simpleJSON = [
 {
   "@id": "https://wise.login.stucco.software/profile/card#me",
   "@type": "http://xmlns.com/foaf/0.1/Person",
   "https://solidid.stucco.software/vocabulary#displayName": "Nikolas Wise",
 }
]

const nestedTriples = `
  <https://wise.login.stucco.software/profile/card#me> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://xmlns.com/foaf/0.1/Person> .
  <https://wise.login.stucco.software/profile/card#me> <https://solidid.stucco.software/vocabulary#displayName> "Nikolas Wise" .
  <https://wise.login.stucco.software/profile/card#me> <https://solidid.stucco.software/vocabulary#links> <urn:uuid:e8d37d3e93cf4c93a820ac0bda7f79a7> .
  <urn:uuid:e8d37d3e93cf4c93a820ac0bda7f79a7> <https://solidid.stucco.software/vocabulary#label> "Homepage" .
  <urn:uuid:e8d37d3e93cf4c93a820ac0bda7f79a7> <https://solidid.stucco.software/vocabulary#linkType> "Website" .
  <urn:uuid:e8d37d3e93cf4c93a820ac0bda7f79a7> <https://solidid.stucco.software/vocabulary#href> "https://nikolas.ws" .
`
const nestedJSON = [
  {
    "@id": "https://wise.login.stucco.software/profile/card#me",
    "@type": "http://xmlns.com/foaf/0.1/Person",
    "https://solidid.stucco.software/vocabulary#displayName": "Nikolas Wise",
    "https://solidid.stucco.software/vocabulary#links": {
      "@id": "urn:uuid:e8d37d3e93cf4c93a820ac0bda7f79a7",
    },
  },
  {
    "@id": "urn:uuid:e8d37d3e93cf4c93a820ac0bda7f79a7",
    "https://solidid.stucco.software/vocabulary#href": "https://nikolas.ws",
    "https://solidid.stucco.software/vocabulary#label": "Homepage",
    "https://solidid.stucco.software/vocabulary#linkType": "Website",
  },
]

beforeEach(async () => {
  await db.clear()
  db = SolidState({
    graph: 'pod-connect'
  })
})

describe('lets test pod connecters!', () => {
  it('gets the resource on the pod', () => {
    expect(getResourceURL(sampleConfig))
      .toBe("https://test.login.stucco.software/test-graph")
  })

  it('if theirs no file at the pod, create one.', async () => {
    const fetch = async (url) => {
      return {
        status: 404
      }
    }

    let graphResponse = await checkGraph({
      userFetch: fetch,
      graph: 'sample-graph'
    })

    expect(graphResponse)
      .toStrictEqual(false)
  })

  it('create graph with placeholder triple', async () => {
    const stub_fetch = async (url, body) => {
      return body
    }
    let pod = getResourceURL(sampleConfig)

    let result = await createGraph({
      userFetch: stub_fetch,
      url: pod,
      body: []
    })

    expect(result.body)
      .toStrictEqual('<#> <https://solidstate.rdf.systems/createdBy> <SolidState> .')
  })


})

describe('lets n-triple transforms!', async () => {
  it('turns an empty string into an empty array', async () => {
    expect(await transformQuads(''))
      .toStrictEqual([])
  })

  it('turns simple triples into json', async () => {
    expect(await transformQuads(simpleTriples))
      .toStrictEqual(simpleJSON)
  })

  it('turns nested triples into json', async () => {
    expect(await transformQuads(nestedTriples))
      .toStrictEqual(nestedJSON)
  })

  it('gets an array of nodes from json-ld with a @graph', async () => {
    const json = {
      '@context': {},
      '@graph': [
        {"@id": "a"},
        {"@id": "b"}
      ]
    }
    expect(getNodeArray(json))
      .toStrictEqual([
        {"@id": "a"},
        {"@id": "b"}
      ])
  })

  it('gets an array of a node from json-ld without', async () => {
    const json = {
      '@context': {},
      "@id": "a"
    }

    expect(getNodeArray(json))
      .toStrictEqual([
        {"@id": "a"}
      ])
  })
})

describe('lets test different json to pouch use cases', async () => {

  it('stuffs json we found into an empty graph', async () => {
    const docs = [
     {
       "@id": "urn:uuid:0x01",
       "val": "a",
     }
    ]
    await addToPouch({docs, db})
    const allDocs = await db.getAll()

    expect(allDocs)
      .toStrictEqual([{
        "_rev": "1-29217e0219f8db61389eb3a9850185a1",
        "@id": "urn:uuid:0x01",
        "val": "a"
      }])
  })

  it('has an object in the pouch, but pod has no rev: pouch wins', async () => {
    const doc = {
      "@id": "urn:uuid:0x01",
      "val": "a",
    }
    const pod = [{
      "@id": "urn:uuid:0x01",
      "val": "b",
    }]
    await db.post(doc)
    await addToPouch({docs: pod, db})

    const allDocs = await db.getAll()

    // expect Pouch to win
    expect(allDocs)
      .toStrictEqual([{
        "_rev": "1-29217e0219f8db61389eb3a9850185a1",
        "@id": "urn:uuid:0x01",
        "val": "a"
      }])
  })

  it('has an object in the pouch, and pod has lower rev: pouch wins', async () => {
    const pod = {
      "@id": "urn:uuid:0x02",
      "val": "a",
    }
    const doc = {
      "@id": "urn:uuid:0x01",
      "val": "a",
    }

    await db.post(doc)

    let b = await db.put("urn:uuid:0x01", {
      "val": "b"
    })

    let c = await db.put("urn:uuid:0x01", {
      "val": "c"
    })

    await addToPouch({docs: [pod, b], db})
    const docs = await db.getAll()

    expect(docs)
      .toStrictEqual([
        {
          "@id": "urn:uuid:0x01",
          "_rev": "3-1696de129edfc99ad3ebda8be49d2ec2",
          "val": "c",
        },
        {
          "@id": "urn:uuid:0x02",
          "_rev": "1-89f7ef894f0fbd94af466d5b30568f88",
          "val": "a",
        },
      ])
  })

  it('has an object in the pouch, and pod has higher rev: pod wins', async () => {
    const docs = [
      {
        "_rev": "3-29217e0219f8db61389eb3a9850185a1",
        "@id": "urn:uuid:0x01",
        "val": "c",
      }
    ]

    const doc = {
      "@id": "urn:uuid:0x01",
      "val": "a",
    }

    await db.post(doc)
    await addToPouch({docs, db})
    const allDocs = await db.getAll()

    expect(allDocs)
      .toStrictEqual([{
        "_rev": "3-29217e0219f8db61389eb3a9850185a1",
        "@id": "urn:uuid:0x01",
        "val": "c"
      }])
  })
})

describe('lets stup of the config correctly…', async () => {
  it.skip('does something???', async () => {
    let reqs = []
    const setup = configureStore({
      graph: 'setup-graph',
      session: {
        info: {
          webId: "https://test.login.stucco.software/profile/card#me"
        },
        fetch: async (url, body) => {
          console.log(url)
          console.log(body)
          reqs = [...reqs, body]
          return {
            text: async () => {''}
          }
        }
      }
    })

    const doc = {
      "@id": "urn:uuid:0x01",
      "val": "a",
    }

    await setup.post(doc)

    let ref = await setup.get(doc['@id'])
    console.log(ref)

    expect(setup.name)
      .toStrictEqual('setup-graph')

    expect(reqs)
      .toStrictEqual([])
  })
})


