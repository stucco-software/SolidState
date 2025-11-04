export const arrayify = target => target
  ? Array.isArray(target)
    ? target
    : [target]
  : []

export const difference = (A, B) => A.filter(x => !B.includes(x))

export const seperate = nodes => {
  let seperated = nodes.map(node => {
    let id = node['@id']
    let rev = node._rev
    delete node['@id']
    delete node._rev
    delete node._id
    return {
      "@id": id,
      "_rev": {
        "@id": rev,
        ...node
      }
    }
  })
  return seperated
}