# Changelog

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
