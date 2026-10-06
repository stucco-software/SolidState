# SolidState

A graph-based realtime replication engine for creating offline first multiplayer applications. SolidState can replicate data peer-to-peer, through a persitent triplestore, or on Solid PODs.

## Usage

```js
import SolidState from 'solidstate-kv'

const store = SolidState({
  graph: 'thoughtloom/my-site',                      // PouchDB name
  session: { info: { webId }, fetch: authFetch },    // omit for local-only
  context: siteContext,                              // JSON-LD context for pod RDF
  container: 'thoughtloom-data/my-site/',            // under the storage root
  legacy: { archivePath: 'thoughtloom-archive/my-site-0.2.nq' }, // migrate a 0.2 graph
})

store.on('outside-change', ({ id }) => console.warn('pod copy changed elsewhere', id))
const { ok, error } = await store.ready   // never rejects
await store.post({ '@id': 'uuid:1', title: { en: 'Hello' } })
await store.idle()          // everything written so far has reached the pod
await store.close()         // on sign-out or when switching sites; await it before re-creating
```

Await `close()` before creating a new store with the same graph name. PouchDB shares one database connection per name, so a `close()` that finishes after the new store opens closes the new store's connection too.

See CHANGELOG.md for the 0.3 changes and breaking changes.

## Development

To develop…

```
npm ci
npm run dev
npm run test:dev
```

To release…

```
npm release
```

## Notes

Solid Pods are downstream from local device stores. The idea is that Solid pods only reflect data states that are contemporaneous with the users authenticated session.

Starting with a simple use case,

```
[ User A Device ] => [ User Pod ]
```

This gets more complex when we want to add additional users and/or additional devices.

```
[ User A Device ] => [ User Pod ]
      ||
[ Sync Server ]
      ||
[ User B Device ] => [ User Pod ]
```

However, Local stores _may_ need to pull data from a solid pod as an upstream source in the case of multiple user devices, or a cleared device storage:

```
[ User Device A ] => [ User Pod ] => [ User Device B ]
```

The alternative to this is to connect to a sync server:

```
[ User Device A ] => [ User Pod ]
      ||                 ^
[ Sync Server ]          ||
      ||                 ||
[ User B Device ] ========|
```

Ideally a single-user sync will avoid a sync server. We'll see.

Can we encrypt the sync server, maybe with a shared secret? When inviting a user to share a graph, the two required bits of information would be the graph url and the graph secret.


