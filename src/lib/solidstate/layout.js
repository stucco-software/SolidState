// One pod resource per node, named by its percent-encoded @id, directly
// inside the graph's container. Ids are expected to be UUIDs or slugs: '.',
// '..' and names ending in .acl/.meta/.acr would collide with server path
// semantics and aren't supported.
export const nodeUrl = (containerUrl, id) => `${containerUrl}${encodeURIComponent(id)}`

export const idFromUrl = (containerUrl, url) => {
  if (!url.startsWith(containerUrl) || url.endsWith('/')) return null
  const name = url.slice(containerUrl.length)
  if (name.includes('/')) return null
  try {
    return decodeURIComponent(name)
  } catch {
    // A malformed name in a listing must not abort the walk.
    return null
  }
}
