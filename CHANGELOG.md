# Changelog

## 0.5.0

- **Devices sharing a pod without a sync server now sync.** Before, a device only imported nodes it had never seen, at start-up, and reported every other pod change as an outside change; after that, its own edits to such a node 412'd and stayed local, so two devices drifted apart node by node. Now `store.pull()` brings the pod's changes in: a node unchanged here fast-forwards to the pod's version; a node changed on both sides merges three ways (`threeWayMerge`), and clashing fields become a PouchDB conflict for the existing `conflicts`/`resolve` flow; a resource deleted elsewhere is deleted here, unless edited here (the edit wins and the resource is made again); a node another device made is added. Start-up runs a full pull instead of the import. A projection's 412 pulls that node and tries again, rather than reporting an outside change. New event: `pulled` (`{ id, how }`). With a sync server nothing changes and `pull()` does nothing.
- **Cheap pulls on polite servers, working pulls on rude ones.** A pull uses the container's ETag once it has learnt that it moves with every child write (an idle pull is then one HEAD, as on hikari), then the listing's `dcterms:modified`/`stat:mtime` against each record's, then a HEAD per node, in rolling slices when given a `{ budget }`. What a server does is learnt per container and rechecked. Whole-second times are rechecked while they could still hide a write. A 429/503 `Retry-After` pauses pulls and projections. Weak ETags refused in `If-Match` fall back to GET-compare-PUT. Resources with no ETag are compared by content. Paged listings are followed (`Link: rel="next"`), and nothing is deleted on the strength of a listing alone: a HEAD must say 404 or 410.
- **A write overtaken before its read-back is merged, not lost.** Servers that send no ETag on a write (hikari, CSS) are read back after a PUT; if another write landed in between, its ETag is no longer recorded as ours (0.4 did, and would never have pulled it). Without a sync server the node is pulled and merged; with one, it's reported as an outside change.
- Projection records keep `base` (the node as last written to or read from the pod, the ancestor for merges; `conflicts()` falls back to it when compaction removed the real one) and `listed`/`listedSettled`, without a sync server. The pod client gains `listing()`, `stat()` and `PodError.retryAfterMs`.

## 0.4.1

- Read `pim:storage` from a profile served as a named graph
  (`[{ '@id': …, '@graph': […] }]`). Servers (hikari among them) serve the
  profile that way, and the JSON-LD walk only checked top-level nodes, so the
  triple was missed and the storage root fell back to the WebID origin —
  writing to the wrong place on servers that host storage elsewhere (hikari
  keeps it under `/~/`, so pod writes answered 404).

## 0.4.0

- **Sync server** (`sync: { url, fetch }`): devices replicate through a
  CouchDB database, so changes to docs other devices already have reach them.
  Start-up catches up from the server first (a fresh device gets everything in
  one pull), then imports from the pod only what the server lacked, then
  replicates live both ways, retrying while offline. If the server can't be
  reached at start-up, the pod import and 0.2 migration wait for a start that
  reaches it (their copies would otherwise conflict with the server's).
- **Conflicts:** `store.conflicts(id)` (each competing revision with its common
  ancestor, or null after compaction) and `store.resolve(id, merged, based)`,
  which refuses with a 409 if a branch moved since `based` was read.
  `threeWayMerge(base, mine, theirs)` is exported: one-sided changes merge
  automatically, and clashes are listed for the user. Branches with identical
  content resolve themselves. Conflicted docs are not projected until
  resolved. `store.resync()` restarts live replication (e.g. after signing in
  again).
- **Projection records replicate**, so a device doesn't re-upload another's
  projection, and never rolls the pod back to an older revision; of duplicate
  records from two devices, the one naming the newest revision is kept.
- **Compaction** after start-up when nothing is conflicted (`compactOnStart:
  false` turns it off). Events: `replication` (`active`/`idle`/`offline`),
  `compacted`.
- `store.version` reports the package version again (0.3.1 said 0.3.0).

## 0.3.1

- Parse `\UXXXXXXXX` escapes in N-Quads. Servers (CSS among them) write
  characters outside the Basic Multilingual Plane, such as emoji, that way,
  and jsonld's parser rejected them ("Unsupported U escape"), so graphs
  containing emoji couldn't be migrated, imported or compared.

## 0.3.0

Sync rebuilt around one pod resource per node.

- **Per-node projection.** Each doc is written to
  `<storage>/<container>/<encoded @id>` as n-quads, with `If-None-Match` /
  `If-Match`. A change made outside solidstate is reported
  (`outside-change`), never overwritten.
- **Per-graph context** (`context` option). Language maps, `@list` order and
  typed values round-trip.
- **Storage root** comes from the profile's `pim:storage`, falling back to the
  WebID origin.
- **Import on start:** nodes in the pod that this device lacks are added.
- **0.2 migration** (`legacy` option): the single graph resource is split into
  per-node resources, then archived (same triples) and deleted.
- **`dispose()`** waits for start-up, then stops the projector and every
  feed; the store stays usable locally. **`close()`** also releases the
  PouchDB (use it when recreating stores, e.g. on session change).
- **`changes()`** is bound (0.2's crashed in the browser) and hides internal
  docs.
- **`ready`** resolves (never rejects) to `{ ok: true, containerUrl }`,
  `{ ok: false, error }`, `{ ok: false, disposed: true }` (disposed during
  start-up) or `{ ok: true, local: true }`.
- **`on(event, fn)`** (returns an unsubscribe); a throwing listener can't
  break sync. Events:
  `ready`, `projected`, `conflicted`, `outside-change`, `migrated`,
  `migration-incomplete`, `sync-error`.
- Pod requests time out after 30 seconds and are retried with backoff.
- If the WebID profile can't be read, sync doesn't start (`ready` resolves
  `{ ok: false }`)—it never guesses a storage root.
- Await `close()` before creating a new store with the same graph name.
  PouchDB shares one database connection per name, so a `close()` that
  finishes after the new store opens closes the new store's connection too.
- 401 and 403 responses aren't retried; after re-authenticating, call
  `store.idle()` to project anything that failed.

Not yet:

- Resolving an `outside-change` (keep solidstate's version or adopt the
  pod's) — planned with conflict handling in a later release.
- A store whose start-up failed (`ready` → `{ ok: false }`) doesn't retry;
  create a new store to try again.

Breaking:

- Removed `_changes`, `_bulkDocs`, `_allDocs`, `once`, `taskqueue`, and the
  PouchDB `on`. `on` is now solidstate's event API.
- `version` is the package version.
- Pod data moves from `<WebID origin>/<graph>` to `<storage>/<container>/`.
  Pass `legacy` to migrate. Without `context`, pod RDF still uses the 0.2
  context, in the new layout.
- `clear()` now disposes the store first.
- Ids starting with `solidstate:` are reserved and hidden from the API.
- `changes()` combines a caller's `filter` function with its own; named
  (design doc) filters throw a TypeError.
- `info().doc_count` includes solidstate's internal bookkeeping docs.

Known 0.2 leftovers: 0.2 never removed deleted nodes from the pod graph, so a
device migrating a 0.2 graph it has no local copy of brings those deleted
nodes back. Delete them again after migrating.
