// Minimal in-memory Solid/LDP server for tests. Implements only what
// solidstate uses: GET/HEAD/PUT/DELETE, ETags, If-Match / If-None-Match,
// container listings as n-quads, and a WebID profile.
//
// The defaults are the bare minimum. Options make it politer (hikari's
// container ETags and listing times) or ruder (no ETags, ignored
// preconditions, weak ETags, truncated listings):
//   containerEtagMoves  a child's write or delete gives its container a new ETag
//   listModified        'ms' lists dcterms:modified in milliseconds, 'seconds'
//                       lists stat:mtime in whole seconds, null lists neither
//   noEtags             no ETag header, ever
//   ignoreIfMatch       If-Match and If-None-Match are ignored
//   weakEtags           ETags are W/"…"; If-Match with one answers 400
//   pageSize            listings page, with Link: rel="next"
//   truncateListing     listings silently show only the first n members
//   now                 the server's clock (ms)
export const createFakePod = ({
  origin = 'https://pod.test',
  advertiseStorage = true,
  etagOnWrite = true,
  autoCreateParents = true,
  containerEtagMoves = false,
  listModified = null,
  noEtags = false,
  ignoreIfMatch = false,
  weakEtags = false,
  pageSize = null,
  truncateListing = null,
  now = () => Date.now(),
} = {}) => {
  const storage = `${origin}/`
  const webId = `${origin}/profile/card#me`
  const profileUrl = `${origin}/profile/card`
  const files = new Map()
  const log = []
  const failures = []
  const forbidden = new Map()
  const hooks = []
  let counter = 0
  const nextEtag = () => (weakEtags ? `W/"e${++counter}"` : `"e${++counter}"`)
  // Like hikari: at least 1 ms past the previous value, so it moves on every write.
  const nextModified = (previous) => Math.max(now(), (previous ?? 0) + 1)

  files.set(storage, { body: '', type: 'text/turtle', etag: nextEtag() })
  files.set(`${origin}/profile/`, { body: '', type: 'text/turtle', etag: nextEtag() })
  files.set(profileUrl, {
    body: advertiseStorage
      ? `<${webId}> <http://www.w3.org/ns/pim/space#storage> <${storage}> .\n`
      : `<${webId}> <http://xmlns.com/foaf/0.1/name> "Test" .\n`,
    type: 'text/turtle',
    etag: nextEtag(),
  })

  const isContainer = (url) => url.endsWith('/')
  const parentOf = (url) => {
    const { origin: o, pathname } = new URL(url)
    const path = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
    const i = path.lastIndexOf('/')
    return i < 0 ? null : `${o}${path.slice(0, i + 1)}`
  }
  const childrenOf = (url) =>
    [...files.keys()].filter((k) => k !== url && parentOf(k) === url)
  const createParents = (url) => {
    const chain = []
    for (let p = parentOf(url); p && !files.has(p); p = parentOf(p)) chain.push(p)
    for (const c of chain.reverse()) {
      files.set(c, { body: '', type: 'text/turtle', etag: nextEtag(), modified: nextModified() })
      touchParent(c)
    }
  }
  const touchParent = (url) => {
    const parent = parentOf(url)
    if (!containerEtagMoves || !parent || !files.has(parent)) return
    const file = files.get(parent)
    files.set(parent, { ...file, etag: nextEtag(), modified: nextModified(file.modified) })
  }
  const respond = (status, body = null, headers = {}) => {
    const h = { date: new Date(now()).toUTCString(), ...headers }
    if (noEtags) delete h.etag
    return new Response([204, 205, 304].includes(status) || body === '' ? null : body, { status, headers: h })
  }
  const DCTERMS_MODIFIED = 'http://purl.org/dc/terms/modified'
  const STAT_MTIME = 'http://www.w3.org/ns/posix/stat#mtime'
  const XSD = 'http://www.w3.org/2001/XMLSchema#'
  const listingLines = (url, child) => {
    const lines = [`<${url}> <http://www.w3.org/ns/ldp#contains> <${child}> .`]
    const modified = files.get(child)?.modified
    if (modified != null && listModified === 'ms') {
      lines.push(`<${child}> <${DCTERMS_MODIFIED}> "${new Date(modified).toISOString()}"^^<${XSD}dateTime> .`)
    }
    if (modified != null && listModified === 'seconds') {
      lines.push(`<${child}> <${STAT_MTIME}> "${Math.floor(modified / 1000)}"^^<${XSD}integer> .`)
    }
    return lines
  }

  const fetch = async (input, init = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    const headers = new Headers(init.headers ?? {})
    log.push({ method, url, headers: Object.fromEntries(headers) })
    const hook = hooks.findIndex((h) => h.method === method && (!h.match || url.includes(h.match)))
    if (hook >= 0) await hooks.splice(hook, 1)[0].fn()

    const failure = failures.find((f) => f.times > 0 && f.method === method && (!f.match || url.includes(f.match)))
    if (failure) {
      failure.times -= 1
      return respond(failure.status, 'injected failure', failure.headers)
    }
    if (forbidden.has(url)) return respond(forbidden.get(url))

    const file = files.get(url)
    const ifMatch = ignoreIfMatch ? null : headers.get('if-match')
    const ifNoneMatch = ignoreIfMatch ? null : headers.get('if-none-match')
    if (weakEtags && ifMatch?.startsWith('W/')) return respond(400, 'weak ETag in If-Match')

    if (method === 'GET' || method === 'HEAD') {
      const [path, query = ''] = url.split('?')
      const listed = files.get(path)
      if (!listed) return respond(404)
      const extra = {}
      let body = listed.body
      if (isContainer(path)) {
        let children = childrenOf(path)
        if (truncateListing != null) children = children.slice(0, truncateListing)
        if (pageSize) {
          const page = Number(new URLSearchParams(query).get('page') ?? 0)
          if ((page + 1) * pageSize < children.length) extra.link = `<${path}?page=${page + 1}>; rel="next"`
          children = children.slice(page * pageSize, (page + 1) * pageSize)
        }
        body = children.flatMap((c) => listingLines(path, c)).join('\n')
      }
      return respond(200, method === 'HEAD' ? null : body, {
        'content-type': isContainer(path) ? 'application/n-quads' : listed.type,
        etag: listed.etag,
        ...extra,
      })
    }

    if (method === 'PUT') {
      if (ifNoneMatch === '*' && file) return respond(412)
      if (ifMatch && (!file || file.etag !== ifMatch)) return respond(412)
      const parent = parentOf(url)
      if (parent && !files.has(parent)) {
        if (!autoCreateParents) return respond(409, 'parent container missing')
        createParents(url)
      }
      const body = init.body == null ? '' : typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body)
      const etag = nextEtag()
      files.set(url, { body, type: headers.get('content-type') ?? 'text/turtle', etag, modified: nextModified(file?.modified) })
      touchParent(url)
      return respond(file ? 205 : 201, null, etagOnWrite ? { etag } : {})
    }

    if (method === 'DELETE') {
      if (!file) return respond(404)
      if (ifMatch && file.etag !== ifMatch) return respond(412)
      if (isContainer(url) && childrenOf(url).length) return respond(409)
      files.delete(url)
      touchParent(url)
      return respond(205)
    }

    return respond(405)
  }

  // Simulate another app editing a resource: new body, new ETag.
  const touch = (url, body) => {
    const file = files.get(url)
    files.set(url, { type: "text/turtle", ...file, body: body ?? file?.body ?? "", etag: nextEtag(), modified: nextModified(file?.modified) })
    touchParent(url)
  }
  // Simulate another app deleting a resource.
  const remove = (url) => {
    files.delete(url)
    touchParent(url)
  }
  // Make the next `times` requests with this method (and URL substring) fail.
  const failNext = (method, status, times = 1, match, headers = {}) => failures.push({ method, status, times, match, headers })
  // Refuse every request for exactly `url`, as a pod does for a resource this
  // agent has no access to. Resources below it stay reachable.
  const forbid = (url, status = 403) => forbidden.set(url, status)
  // Run `fn` just before the next request with this method (and URL substring)
  // is answered: another writer sneaking in.
  const before = (method, match, fn) => hooks.push({ method, match, fn })
  const requests = (method, match) => log.filter((r) => r.method === method && (!match || r.url.includes(match)))

  return { fetch, files, log, requests, webId, origin, storage, profileUrl, touch, remove, failNext, before, forbid }
}
