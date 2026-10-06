import { describe, it, expect } from 'vitest'
import { nodeUrl, idFromUrl } from './layout.js'

const c = 'https://pod.test/thoughtloom-data/site/'

describe('layout', () => {
  it('maps ids to percent-encoded resource names and back', () => {
    for (const id of ['uuid:9f1c', 'stuccoworks', '079ecbdf-2bd4', 'a b/c?d']) {
      const url = nodeUrl(c, id)
      expect(url.startsWith(c)).toBe(true)
      expect(url.slice(c.length)).not.toContain('/')
      expect(idFromUrl(c, url)).toBe(id)
    }
  })

  it('ignores sub-containers and other containers', () => {
    expect(idFromUrl(c, `${c}sub/`)).toBeNull()
    expect(idFromUrl(c, 'https://pod.test/elsewhere/x')).toBeNull()
  })
})
