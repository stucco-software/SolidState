# SolidState — Sharing Support

Changes to SolidState to support collaborative graphs hosted in another user's POD.

## Motivation

Today, `SolidState({session, graph})` writes the graph to `<session.webID>/<graph>`. This conflates two things that need to be separable for collaboration:

- **Who I am** — my session, my credentials.
- **Whose graph I'm touching** — the POD that hosts the resource.

When Alice shares a graph with Bob, Bob and Alice are collaborating on *one* graph with *one* revision history. Bob writes to Alice's POD using his own credentials, and Alice's POD's ACL decides whether the write is allowed. Bob does not get his own copy in his own POD — that would be forking, not collaboration, and PouchDB's conflict model doesn't survive divergent revision histories.

The changes below introduce that separation and the surface area for managing shares.

---

## API Changes

### 1. New `storage` option

`SolidState({...})` accepts an optional `storage` parameter:

```js
const db = SolidState({
  session: bobSession,           // who I am
  graph: 'shopping-list',        // what I'm touching
  storage: 'https://alice.pod/'  // whose POD hosts it (optional)
})
```

**Semantics:**

- When `storage` is **omitted**, behavior is unchanged. The graph lives at `<session.webID>/<graph>`. This is the existing single-user POD case.
- When `storage` is **present**, the graph lives at `<storage>/<graph>`. The session's credentials are used to authenticate every write against that POD's ACL.
- If the ACL denies a write, the operation rejects with a clear error and the local PouchDB state remains intact (so the client can retry, queue, or surface the denial to the app).

This is the only structural change. Everything else is convenience built on top.

### 2. `db.share(webID, options)`

Grant another WebID access to this graph. Combines the two operations a share button needs into one call so app authors don't have to learn Solid ACL semantics:

```js
await db.share('https://bob.webid', { access: 'write' })
```

**Parameters:**

- `webID` — the WebID being granted access.
- `options.access` — one of `'read'`, `'write'`, `'control'`. Mirrors Solid's ACL levels. `control` lets the grantee re-share; most apps want `write`.
- `options.notify` — optional boolean, default `false`. When `true`, drops a notification into the grantee's Solid inbox pointing at the graph URL. (Deferred — see Build Order.)

**Behavior:**

1. Reads the graph resource's existing ACL.
2. Adds the requested grant.
3. Writes the ACL back, using whichever ACL format the POD advertises (WAC or ACP).
4. Optionally posts a notification.
5. Returns the canonical share URL.

Only callable when the current session has `control` on the resource — typically the graph's creator.

### 3. `db.unshare(webID)`

Revoke access:

```js
await db.unshare('https://bob.webid')
```

Removes all grants for that WebID from the resource's ACL. Bob's open clients will get 403s on their next write attempts; their local PouchDB copies remain on their devices, which is correct — revocation cuts off future collaboration, not historical knowledge.

### 4. `db.collaborators()`

List who currently has access:

```js
const people = await db.collaborators()
// [
//   { webID: 'https://alice.pod/profile#me', access: 'control' },
//   { webID: 'https://bob.webid',            access: 'write'   }
// ]
```

Reads the ACL and returns grantees with their access levels. Public or group grants are represented honestly:

```js
{ webID: 'https://www.w3.org/ns/solid/acl#PublicAgent', access: 'read' }
```

Apps can filter or render these as they see fit; SolidState doesn't hide them.

### 5. `db.shareURL()`

Returns the canonical URL for this graph — `<storage>/<graph>` or `<session.webID>/<graph>` depending on configuration. Useful for "copy share link" UI and for out-of-band sharing flows.

```js
const url = db.shareURL()
// 'https://alice.pod/shopping-list'
```

---

## Discovery: How Bob Knows Alice Shared Something

Two paths, not mutually exclusive.

**Out-of-band (v1).** Alice sends Bob a URL — Slack, email, QR code, whatever. Bob's app parses it into `{storage, graph}` and constructs a SolidState instance:

```js
const url = new URL(sharedLink)
const db = SolidState({
  session: bobSession,
  storage: url.origin + '/',
  graph: url.pathname.slice(1)
})
```

This works today with the proposed changes alone. No protocol additions required.

**In-band via Solid inbox (later).** When `share()` is called with `notify: true`, it posts a notification to the grantee's inbox referencing the graph URL. Bob's client can list pending shares with a helper:

```js
const pending = await SolidState.pendingShares({ session: bobSession })
// [{ from: 'https://alice.pod/profile#me', graph: 'https://alice.pod/shopping-list', receivedAt: ... }]
```

This is nicer UX but commits to a notification format; ship it after the core mechanic is proven.

---

## Interaction With Sync Server

The Sync Server's authorization tuple changes from `(webid, graph)` to `(webid, storage, graph)`. The validator's job becomes: "does this WebID have ACL access to `<storage>/<graph>`?" — answered by `HEAD`-ing the resource with the client's own token, exactly as the architecture doc already specifies for cross-WebID access.

The ephemeral CouchDB database is keyed on `(storage, graph)`, **not** on WebID. Alice and Bob connecting to the same shared graph land in the same rendezvous. That's the whole point — they're both editing one resource, so they share one rendezvous.

No other Sync Server changes are required. The cross-WebID code path that already exists in the architecture plan becomes the common case for shared graphs rather than an edge case.

---

## What Sharing Is Not

- **Not a copy.** Sharing does not write data into the grantee's POD. There is one graph at one URL with one revision history. Bob's POD stays out of it.
- **Not a fork.** If a user wants a personal snapshot, that's a separate `db.fork()` or export operation. It should be named that way so nobody confuses it with collaboration. (Not in this spec — listed under Future Work.)
- **Not dependent on the Sync Server.** Sharing works without live sync; you get the existing degraded-mode behavior of seeing changes on reload. The ACL makes it shared; the Sync Server makes it real-time. Orthogonal.

---

## Error Cases Worth Naming

- **Write denied by ACL.** Operation rejects with a typed error (`SolidStateAccessError`). Local state preserved. App can prompt for re-auth or surface the denial.
- **Storage POD unreachable.** Falls back to local-only mode for the duration. Writes queue locally and replay on reconnect, exactly as they do for the single-user POD case today.
- **ACL format not supported.** If the POD advertises an ACL grammar SolidState can't speak (some custom ACP profile, say), `share()` and `unshare()` reject with `SolidStateACLError` and surface the underlying POD response. The graph itself still works for whoever already has access.
- **`share()` called without `control` permission.** Rejects with `SolidStateAccessError` before touching the network.

---

## Build Order

### v0.1 — The mechanic

- `storage` option on `SolidState({...})`
- All existing CRUD operations (`post`, `get`, `getAll`, `put`, `patch`, `delete`) work transparently against a graph in another POD when the session has the right ACL grants.
- `db.shareURL()`

This is the minimum that makes collaboration possible. Two users with manually-configured `storage` pointing at the same POD can already collaborate (clunkily) once this lands.

### v0.2 — The share surface

- `db.share(webID, {access})`
- `db.unshare(webID)`
- `db.collaborators()`
- ACL writing for WAC. ACP if the test PODs need it.
- Out-of-band share URL is the documented sharing flow.

### v0.3 — Niceties

- Inbox-based notifications on share
- `SolidState.pendingShares({session})` helper
- Better error types and recovery paths

---

## Documentation Changes

The API reference grows a new top-level section between **User Provided Store** and **Entities**, called **Sharing**. It introduces the `storage` option, the share/unshare/collaborators API, and the model: *one graph, one URL, one revision history; sharing is a property of the resource, not of the data.*

The existing **User Provided Store** section gets a one-line addition noting that the same mechanism extends to graphs in *other* users' PODs via the `storage` option, with a link forward to the Sharing section.

---

## Future Work

- **`db.fork()`** — explicitly copy a shared graph into the caller's own POD as a new, independent graph. Useful for "save a copy" UX. Different operation, different name, no confusion with sharing.
- **Group ACLs.** Solid supports granting access to groups of WebIDs. Worth supporting in `share()` once the single-WebID case is solid.
- **Access requests.** Bob discovers Alice's graph but doesn't have access — a flow for him to request it and her to approve. Solid has primitives for this; SolidState can wrap them later.

---

## Summary of Changes

| Change | Type | Phase |
|---|---|---|
| `storage` option on `SolidState({...})` | New option | v0.1 |
| Routing of all CRUD through `<storage>/<graph>` when set | Behavior | v0.1 |
| `db.shareURL()` | New method | v0.1 |
| `db.share(webID, {access})` | New method | v0.2 |
| `db.unshare(webID)` | New method | v0.2 |
| `db.collaborators()` | New method | v0.2 |
| ACL write support (WAC, optionally ACP) | Internal | v0.2 |
| `notify: true` on share + inbox helpers | New method | v0.3 |
| Typed error classes for access/ACL failures | Internal | v0.2 |

The architectural commitment, restated: *shared* means **one resource with multiple writers**, not multiple resources kept in sync. The API additions all follow from that.