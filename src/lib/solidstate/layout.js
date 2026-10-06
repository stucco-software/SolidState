// One pod resource per node, named by its percent-encoded @id, directly
// inside the graph's container.
export const nodeUrl = (containerUrl, id) => `${containerUrl}${encodeURIComponent(id)}`

export const idFromUrl = (containerUrl, url) => {
  if (!url.startsWith(containerUrl) || url.endsWith('/')) return null
  const name = url.slice(containerUrl.length)
  return name.includes('/') ? null : decodeURIComponent(name)
}
