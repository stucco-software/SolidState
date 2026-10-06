import { NQUADS } from './rdf.js'

export class PodError extends Error {
  constructor(method, url, status, detail = '') {
    super(`${method} ${url} → ${status}${detail ? ` ${detail}` : ''}`)
    this.status = status
    this.retryable = status >= 500 || status === 429
  }
}

const CONTAINS = /<([^>]+)>\s+<http:\/\/www\.w3\.org\/ns\/ldp#contains>\s+<([^>]+)>/g

// Release the socket for responses whose body we never read.
const drain = (res) => res.body?.cancel?.().catch(() => {})

export const createPodClient = (rawFetch, { timeoutMs = 30000 } = {}) => {
  // A timeout rejects with a TimeoutError DOMException, which has no
  // `retryable`, so callers treat it like a network error and retry.
  const fetch = (url, init = {}) => rawFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })

  const fail = async (method, url, res) =>
    new PodError(method, url, res.status, (await res.text().catch(() => '')).slice(0, 200))

  const etag = async (url) => {
    const res = await fetch(url, { method: 'HEAD' })
    drain(res)
    return res.ok ? res.headers.get('etag') : null
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
  const put = async (url, body, { etag: expected, create = false, overwrite = false, contentType = NQUADS } = {}) => {
    const headers = { 'content-type': contentType }
    if (overwrite) {
      // no conditional header
    } else if (expected) headers['if-match'] = expected
    else if (create) headers['if-none-match'] = '*'
    const res = await fetch(url, { method: 'PUT', headers, body })
    if (res.status === 412) {
      drain(res)
      return { conflict: true }
    }
    if (!res.ok) throw await fail('PUT', url, res)
    drain(res)
    // CSS doesn't return an ETag on PUT, so we HEAD afterwards. Another client
    // writing in between would make us record their ETag. Accepted: the window
    // is narrow and there is a single writer per node in practice.
    return { etag: res.headers.get('etag') ?? (await etag(url)) }
  }

  // As in put, If-Match uses strong comparison; weak ETags would always 412.
  const remove = async (url, { etag: expected } = {}) => {
    const res = await fetch(url, { method: 'DELETE', headers: expected ? { 'if-match': expected } : {} })
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
  const list = async (containerUrl) => {
    const found = await get(containerUrl)
    if (!found) return []
    const members = []
    for (const [, subject, member] of found.body.matchAll(CONTAINS)) {
      if (subject === containerUrl) members.push(new URL(member, containerUrl).href)
    }
    return members
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

  return { get, put, remove, list, etag, ensurePath }
}
