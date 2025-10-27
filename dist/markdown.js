import { render } from 'svelte/server';
import * as jsonld from 'jsonld'
import context from './context.json'

// const resolveFiles = async (iterable) => await Promise.all(
//   iterable.map(async ([path, resolver]) => {
//     const data = await resolver()
//     const meta = data.metadata || {}
//     let rendered = render(data.default)
//     console.log(rendered)
//     return {
//       uri: path.slice(5, -3),
//       ...meta,
//       html: rendered.html
//     }
//   })
// )

export const getGraph = async () => {
  const allPosts = await import.meta.glob(`./md/*.md`, { eager: true })
  const allCode = await import.meta.glob(`./md/*.js`, {
    eager: true,
    query: '?raw'
  })

  const code = Object
    .entries(allCode)
    .map(([slug, content]) => {
      console.log(slug)
      console.log(content)
    })

  const graph = Object
    .entries(allPosts)
    .map(([slug, post]) => {
      let meta = post.metadata || {}
      let id = slug.split('.md')[0].split('/').pop()
      let rendered = render(post.default)
      return {
        id,
        ...meta,
        html: rendered.html
      }
    })
  return {
    "@context": context,
    "@graph": graph
  }
}

const frame = async (doc, f) => {
  if (jsonld.default) {
    return await jsonld.default.frame(doc, f)
  } else {
    return await jsonld.frame(doc, f)
  }
}

export const getFramed = async (query) => {
  const graph = await getGraph()
  console.log(graph)
  let f = {
    "@context": context,
    ...query
  }
  return await frame(graph, f)
}