import { NQUADS } from './rdf.js'

export class PodError extends Error {
  constructor(method, url, status, detail = '', { retryAfterMs = null } = {}) {
    super(`${method} ${url} → ${status}${detail ? ` ${detail}` : ''}`)
    this.status = status
    this.retryable = status >= 500 || status === 429
    // How long the server asked us to wait (429/503 Retry-After), or null.
    this.retryAfterMs = retryAfterMs
  }
}

// Retry-After is either delta-seconds or an HTTP-date.
export const parseRetryAfter = (value, now = Date.now()) => {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - now) : null
}

const CONTAINS = /<([^>]+)>\s+<http:\/\/www\.w3\.org\/ns\/ldp#contains>\s+<([^>]+)>/g
const MODIFIED = /<([^>]+)>\s+<http:\/\/purl\.org\/dc\/terms\/modified>\s+"([^"]+)"/g
const MTIME = /<([^>]+)>\s+<http:\/\/www\.w3\.org\/ns\/posix\/stat#mtime>\s+"(\d+)"/g

// `rel="next"` from a Link header, resolved against the request URL.
const nextLink = (link, base) => {
  for (const part of (link ?? '').split(',')) {
    const match = part.match(/<([^>]+)>\s*;(.*)/)
    if (match && /rel="?next"?/.test(match[2])) return new URL(match[1], base).href
  }
  return null
}

// A listing's modification time for a member: { ms, precise }. `precise`
// means sub-second, so an unchanged value means an unchanged resource;
// whole seconds can hide a second write in the same second.
const modifiedTimes = (body) => {
  const times = new Map()
  for (const [, member, seconds] of body.matchAll(MTIME)) {
    times.set(member, { ms: Number(seconds) * 1000, precise: false })
  }
  // dcterms:modified wins over stat:mtime when a server lists both.
  for (const [, member, value] of body.matchAll(MODIFIED)) {
    const ms = Date.parse(value)
    if (Number.isFinite(ms)) times.set(member, { ms, precise: /T\d\d:\d\d:\d\d\.\d+/.test(value) })
  }
  return times
}

const isWeak = (etag) => typeof etag === 'string' && etag.startsWith('W/')

// Release the socket for responses whose body we never read.
const drain = (res) => res.body?.cancel?.().catch(() => {})

export const createPodClient = (rawFetch, { timeoutMs = 30000 } = {}) => {
  // A timeout rejects with a TimeoutError DOMException, which has no
  // `retryable`, so callers treat it like a network error and retry.
  const fetch = (url, init = {}) => rawFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })

  const fail = async (method, url, res) =>
    new PodError(method, url, res.status, (await res.text().catch(() => '')).slice(0, 200), {
      retryAfterMs: [429, 503].includes(res.status) ? parseRetryAfter(res.headers.get('retry-after')) : null,
    })

  const etag = async (url) => {
    // Same accept as get(), so the ETag compares like-for-like on servers
    // whose ETag varies by representation.
    const res = await fetch(url, { method: 'HEAD', headers: { accept: NQUADS } })
    drain(res)
    return res.ok ? res.headers.get('etag') : null
  }

  // { exists, etag } for a resource. Throws on anything but 2xx/404/410, so a
  // 5xx is never mistaken for "gone".
  const stat = async (url) => {
    const res = await fetch(url, { method: 'HEAD', headers: { accept: NQUADS } })
    drain(res)
    if (res.status === 404 || res.status === 410) return { exists: false, etag: null }
    if (!res.ok) throw await fail('HEAD', url, res)
    return { exists: true, etag: res.headers.get('etag') }
  }

  const get = async (url) => {
    const res = await fetch(url, { headers: { accept: NQUADS } })
    if (res.status === 404) return null
    if (!res.ok) throw await fail('GET', url, res)
    return { body: await res.text(), etag: res.headers.get('etag') }
  }

  // Preconditions, in order: `overwrite` sends none (the migration archive);
  // a known `etag` sends If-Match so a change made outside solidstate is never
  // overwritten silently; `create` sends If-None-Match: * so we never clobber an
  // existing resource. With none of these we don't know the current ETag (e.g.
  // a server that doesn't expose it via CORS), so we write unconditionally
  // rather than 412 forever.
  // If-Match uses strong comparison: a server issuing weak (W/"...") ETags
  // would 412 every update. CSS issues strong ETags.
  //
  // A server that hands out weak ETags may refuse them in If-Match (400) or
  // compare strongly (412). Then fall back to GET-compare-PUT: write
  // unconditionally only if the resource still has the ETag we expected.
  //
  // Hikari and CSS send no ETag on a write (the server transforms what it
  // stores), so we read the resource back. With several devices another
  // write can land between ours and the read: the result carries `body` so
  // the caller can check it's what it wrote before trusting the ETag.
  const put = async (url, body, { etag: expected, create = false, overwrite = false, contentType = NQUADS } = {}) => {
    const headers = { 'content-type': contentType }
    if (overwrite) {
      // no conditional header
    } else if (expected) headers['if-match'] = expected
    else if (create) headers['if-none-match'] = '*'
    const res = await fetch(url, { method: 'PUT', headers, body })
    if (isWeak(expected) && !overwrite && (res.status === 400 || res.status === 412)) {
      drain(res)
      const current = await stat(url)
      if (!current.exists || current.etag !== expected) return { conflict: true }
      return put(url, body, { overwrite: true, contentType })
    }
    if (res.status === 412) {
      drain(res)
      return { conflict: true }
    }
    if (!res.ok) throw await fail('PUT', url, res)
    drain(res)
    const written = res.headers.get('etag')
    if (written) return { etag: written }
    const readBack = await get(url)
    return readBack ? { etag: readBack.etag, body: readBack.body } : { etag: null }
  }

  // As in put, If-Match uses strong comparison; weak ETags would always 412.
  const remove = async (url, { etag: expected } = {}) => {
    const res = await fetch(url, { method: 'DELETE', headers: expected ? { 'if-match': expected } : {} })
    if (isWeak(expected) && (res.status === 400 || res.status === 412)) {
      drain(res)
      const current = await stat(url)
      if (!current.exists) return {}
      if (current.etag !== expected) return { conflict: true }
      return remove(url)
    }
    if (res.status === 412) {
      drain(res)
      return { conflict: true }
    }
    if (res.ok || res.status === 404) {
      drain(res)
      return {}
    }
    throw await fail('DELETE', url, res)
  }

  // Relies on the server honouring `accept: application/n-quads` for
  // containers (absolute IRIs, one triple per line). A Turtle listing with
  // prefixes or relative IRIs would come back empty.
  const list = async (containerUrl) => (await listing(containerUrl)).members.map((member) => member.url)

  // The container's members with their listed modification times, following
  // `Link: rel="next"` pages. `etag` is the container's ETag from the first
  // page; `date` the server's clock (the Date header), for judging whether a
  // whole-second time can still move. A missing container lists nothing.
  const listing = async (containerUrl) => {
    const members = []
    let etag = null
    let date = null
    let url = containerUrl
    for (let page = 0; url && page < 100; page += 1) {
      const res = await fetch(url, { headers: { accept: NQUADS } })
      if (res.status === 404 && page === 0) {
        drain(res)
        return { etag: null, date: null, members: [] }
      }
      if (!res.ok) throw await fail('GET', url, res)
      if (page === 0) {
        etag = res.headers.get('etag')
        const d = Date.parse(res.headers.get('date') ?? '')
        date = Number.isFinite(d) ? d : null
      }
      const body = await res.text()
      const times = modifiedTimes(body)
      for (const [, subject, member] of body.matchAll(CONTAINS)) {
        if (subject !== containerUrl && subject !== url) continue
        const href = new URL(member, containerUrl).href
        members.push({ url: href, modified: times.get(member) ?? times.get(href) ?? null })
      }
      url = nextLink(res.headers.get('link'), url)
    }
    return { etag, date, members }
  }

  // Create every container between rootUrl and containerUrl that doesn't
  // exist. Some servers (brolly) don't create parents on PUT.
  const ensurePath = async (rootUrl, containerUrl) => {
    let url = rootUrl
    for (const segment of containerUrl.slice(rootUrl.length).split('/').filter(Boolean)) {
      url += `${segment}/`
      const head = await fetch(url, { method: 'HEAD' })
      if (head.ok) {
        drain(head)
        continue
      }
      if (head.status !== 404) throw await fail('HEAD', url, head)
      drain(head)
      const res = await fetch(url, { method: 'PUT', headers: { 'content-type': 'text/turtle' }, body: '' })
      // A 409 is accepted as "exists or being created". Some servers (NSS)
      // answer 409 for a PUT to a container URL, in which case a later PUT
      // will fail with that server's own error.
      if (!res.ok && res.status !== 409) throw await fail('PUT', url, res)
      drain(res)
    }
  }

  return { get, put, remove, list, listing, etag, stat, ensurePath }
}
