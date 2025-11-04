---
title: User Provided Store
type: Documentation
---

SolidState can sync it's local data to a user-provided data store via the [Solid Protocol](https://solidproject.org/).

Provide a `Session` object to the [init options](#create-a-store) that has, at least, a `webID` string and a `fetch` function that can make requests against provided webID.

A straight-forward way to create this session object is with the [Solid Client Authentication Library from Inrupt](https://www.npmjs.com/package/@inrupt/solid-client-authn-browser), as demonstrated in the [Pocket Change sample project](https://stucco.software/pocket-change-part-2). This can also be done [without libraries](https://solid-authentication.rdf.systems/) if you're feeling brave.

If you've provided a `Session` object, SolidState will create the graph in the user-provided store at `<webid>/<graph>`. It will sync the currents state of the local store to this graph, and replicate any changes made locally upstream to this graph.

SolidState will not pro-actively live sync _from_ this upstream store. It will download the store and sync it to it's local state on initialization. To subscribe to changes live as they happen, use a Sync Server (tk).


#### Options

```js
{
  session: {
    fetch: fn(),
    webID: String
  },
  graph: `sample-graph`
}
```

#### Example

```js
import SolidState from 'solidstate-kv'
import {
  EVENTS,
  getDefaultSession
} from '@inrupt/solid-client-authn-browser'

let session = getDefaultSession()

session.events.on(EVENTS.SESSION_RESTORED, (url) => {
  let db = SetupDB({
    session: session,
    graph: `sample-graph`
  })
})

```
