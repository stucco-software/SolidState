import jsonld from 'jsonld'

const PIM_STORAGE = 'http://www.w3.org/ns/pim/space#storage'
const withSlash = (url) => (url.endsWith('/') ? url : `${url}/`)

// The pod's storage root for a WebID. Many servers (Inrupt among them) host
// storage on a different origin from the WebID and advertise it as
// pim:storage in the profile; fall back to the WebID's origin.
export const discoverStorageRoot = async (webId, fetch) => {
  try {
    const res = await fetch(webId.split('#')[0], {
      headers: { accept: 'application/ld+json, text/turtle;q=0.8' },
    })
    if (res.ok) {
      const body = await res.text()
      const type = res.headers.get('content-type') ?? ''
      let storage = null
      if (type.includes('json') || /^\s*[[{]/.test(body)) {
        try {
          const expanded = await jsonld.expand(JSON.parse(body), { base: webId })
          storage = expanded.flatMap((n) => n[PIM_STORAGE] ?? []).map((v) => v?.['@id']).find(Boolean) ?? null
        } catch {
          // Not JSON-LD after all; try the Turtle pattern below.
        }
      }
      if (!storage) {
        const match = body.match(/(?:pim:storage|space:storage|<http:\/\/www\.w3\.org\/ns\/pim\/space#storage>)\s*<([^>]+)>/)
        storage = match?.[1] ?? null
      }
      if (storage) return withSlash(new URL(storage, webId).href)
    }
  } catch {
    // Network error: fall back.
  }
  return `${new URL(webId).origin}/`
}
