// Minimal in-memory Solid/LDP server for tests. Implements only what
// solidstate uses: GET/HEAD/PUT/DELETE, ETags, If-Match / If-None-Match,
// container listings as n-quads, and a WebID profile.
export const createFakePod = ({
  origin = 'https://pod.test',
  advertiseStorage = true,
  etagOnWrite = true,
  autoCreateParents = true,
} = {}) => {
  const storage = `${origin}/`
  const webId = `${origin}/profile/card#me`
  const profileUrl = `${origin}/profile/card`
  const files = new Map()
  const log = []
  const failures = []
  let counter = 0
  const nextEtag = () => `"e${++counter}"`

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
    for (const c of chain.reverse()) files.set(c, { body: '', type: 'text/turtle', etag: nextEtag() })
  }
  const respond = (status, body = null, headers = {}) =>
    new Response([204, 205, 304].includes(status) || body === '' ? null : body, { status, headers })

  const fetch = async (input, init = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    const headers = new Headers(init.headers ?? {})
    log.push({ method, url, headers: Object.fromEntries(headers) })

    const failure = failures.find((f) => f.times > 0 && f.method === method && (!f.match || url.includes(f.match)))
    if (failure) {
      failure.times -= 1
      return respond(failure.status, 'injected failure')
    }

    const file = files.get(url)
    const ifMatch = headers.get('if-match')
    const ifNoneMatch = headers.get('if-none-match')

    if (method === 'GET' || method === 'HEAD') {
      if (!file) return respond(404)
      const body = isContainer(url)
        ? childrenOf(url).map((c) => `<${url}> <http://www.w3.org/ns/ldp#contains> <${c}> .`).join('\n')
        : file.body
      return respond(200, method === 'HEAD' ? null : body, {
        'content-type': isContainer(url) ? 'application/n-quads' : file.type,
        etag: file.etag,
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
      files.set(url, { body, type: headers.get('content-type') ?? 'text/turtle', etag })
      return respond(file ? 205 : 201, null, etagOnWrite ? { etag } : {})
    }

    if (method === 'DELETE') {
      if (!file) return respond(404)
      if (ifMatch && file.etag !== ifMatch) return respond(412)
      if (isContainer(url) && childrenOf(url).length) return respond(409)
      files.delete(url)
      return respond(205)
    }

    return respond(405)
  }

  // Simulate another app editing a resource: new body, new ETag.
  const touch = (url, body) => {
    const file = files.get(url)
    files.set(url, { ...file, body: body ?? file.body, etag: nextEtag() })
  }
  // Make the next `times` requests with this method (and URL substring) fail.
  const failNext = (method, status, times = 1, match) => failures.push({ method, status, times, match })
  const requests = (method, match) => log.filter((r) => r.method === method && (!match || r.url.includes(match)))

  return { fetch, files, log, requests, webId, origin, storage, profileUrl, touch, failNext }
}
