import { describe, it, expect, beforeEach} from 'vitest';
import SolidState from '$lib/solidstate'

let db = SolidState('test-graph')

beforeEach(async () => {
  await db.clear()
  db = SolidState('test-graph')
})

describe('lets test solidstate!', () => {
  it('constructs a datastore graph', () => {
    expect(db.version).toBe("0.0.1#POUCH")
    expect(typeof db.post).toBe("function")
    expect(typeof db.put).toBe("function")
    expect(typeof db.patch).toBe("function")
    expect(typeof db.get).toBe("function")
    expect(typeof db.getAll).toBe("function")
    expect(typeof db.query).toBe("function")
    expect(typeof db.delete).toBe("function")
    expect(typeof db.clear).toBe("function")
  })
})

describe('CRUD Operations', () => {
  it('Creates a document', async () => {
    let ref = await db.post({
      "@type": "Food",
      "name": "Hummus",
      "vegetarian": true,
      "number": 10,
      "ingredient": [
        "Garbanzo Beans",
        "Lemon"
      ]
    })
    expect(ref["@id"].includes('uuid:')).toBe(true)
    expect(ref['@type']).toBe("Food")
    expect(ref.name).toBe("Hummus")
    expect(ref.vegetarian).toBe(true)
    expect(ref.number).toBe(10)
  })

  it('Reads a document', async () => {
    let ref = await db.post({
      "@id": "chickpeas",
      "@type": "Ingredient",
      "name": "Chickpeas"
    })
    let chickpeas = await db.get("chickpeas")
    expect(ref).toStrictEqual(chickpeas)
  })

  it('Reads all documents', async () => {
    let chickpeas = await db.post({
      "@id": "chickpeas",
      "@type": "Ingredient",
      "name": "Chickpeas"
    })
    let lemon = await db.post({
      "@id": "lemon",
      "@type": "Ingredient",
      "name": "Lemon"
    })
    let all = await db.getAll()
    expect(all).toStrictEqual([chickpeas, lemon])
  })
})


