import jsonld from 'jsonld'

const PIM_STORAGE = 'http://www.w3.org/ns/pim/space#storage'
const withSlash = (url) => (url.endsWith('/') ? url : `${url}/`)

// The pod's storage root for a WebID. Many servers (Inrupt among them) host
// storage on a different origin from the WebID and advertise it as
// pim:storage in the profile. Fall back to the WebID's origin only when the
// profile loaded and says nothing about storage; if the profile can't be
// read at all, throw, because a guessed root would read and write the wrong
// place.
export const discoverStorageRoot = async (webId, fetch) => {
  const profileUrl = webId.split('#')[0]
  let res
  try {
    res = await fetch(profileUrl, {
      headers: { accept: 'application/ld+json, text/turtle;q=0.8' },
    })
  } catch (err) {
    throw new Error(`could not read WebID profile ${profileUrl}: ${err?.message ?? err}`)
  }
  if (!res.ok) {
    throw new Error(`could not read WebID profile ${profileUrl}: ${res.status}`)
  }

  const body = await res.text()
  const type = res.headers.get('content-type') ?? ''
  let storage = null
  if (type.includes('json') || /^\s*[[{]/.test(body)) {
    try {
      // Flatten so pim:storage is found on any node, including nested ones.
      const flat = await jsonld.flatten(JSON.parse(body), null, { base: webId })
      const nodes = Array.isArray(flat) ? flat : (flat['@graph'] ?? [flat])
      storage = nodes.flatMap((n) => n[PIM_STORAGE] ?? []).map((v) => v?.['@id']).find(Boolean) ?? null
    } catch {
      // Not JSON-LD after all; try the Turtle pattern below.
    }
  }
  if (!storage) {
    const match = body.match(/(?:pim:storage|space:storage|<http:\/\/www\.w3\.org\/ns\/pim\/space#storage>)\s*<([^>]+)>/)
    storage = match?.[1] ?? null
  }
  if (storage) return withSlash(new URL(storage, webId).href)
  return `${new URL(webId).origin}/`
}
