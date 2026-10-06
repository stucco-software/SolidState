import { NQUADS } from './rdf.js'

export class PodError extends Error {
  constructor(method, url, status, detail = '') {
    super(`${method} ${url} → ${status}${detail ? ` ${detail}` : ''}`)
    this.status = status
    this.retryable = status >= 500 || status === 429
  }
}

const CONTAINS = /<([^>]+)>\s+<http:\/\/www\.w3\.org\/ns\/ldp#contains>\s+<([^>]+)>/g

export const createPodClient = (fetch) => {
  const fail = async (method, url, res) =>
    new PodError(method, url, res.status, (await res.text().catch(() => '')).slice(0, 200))

  const etag = async (url) => {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok ? res.headers.get('etag') : null
  }

  const get = async (url) => {
    const res = await fetch(url, { headers: { accept: NQUADS } })
    if (res.status === 404) return null
    if (!res.ok) throw await fail('GET', url, res)
    return { body: await res.text(), etag: res.headers.get('etag') }
  }

  // New resources use If-None-Match: *, updates If-Match: <etag>, so a change
  // made outside solidstate is never overwritten silently. `overwrite` skips
  // both (the migration archive).
  const put = async (url, body, { etag: expected, overwrite = false, contentType = NQUADS } = {}) => {
    const headers = { 'content-type': contentType }
    if (!overwrite) {
      if (expected) headers['if-match'] = expected
      else headers['if-none-match'] = '*'
    }
    const res = await fetch(url, { method: 'PUT', headers, body })
    if (res.status === 412) return { conflict: true }
    if (!res.ok) throw await fail('PUT', url, res)
    return { etag: res.headers.get('etag') ?? (await etag(url)) }
  }

  const remove = async (url, { etag: expected } = {}) => {
    const res = await fetch(url, { method: 'DELETE', headers: expected ? { 'if-match': expected } : {} })
    if (res.status === 412) return { conflict: true }
    if (res.ok || res.status === 404) return {}
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
      if (head.ok) continue
      if (head.status !== 404) throw await fail('HEAD', url, head)
      const res = await fetch(url, { method: 'PUT', headers: { 'content-type': 'text/turtle' }, body: '' })
      if (!res.ok && res.status !== 409) throw await fail('PUT', url, res)
    }
  }

  return { get, put, remove, list, etag, ensurePath }
}
