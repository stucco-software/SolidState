import { getGraph, getFramed } from "$lib/markdown.js"



export async function load({ params }){
  let graph = await getFramed({
    id: "documentation-sections",
    hasPart: {}
  })
  return graph
}