---
title: Post Data
type: Documentation
exampleCode: post-code.js
---

Create a new entity with `db.post`. This will return a copy of the document. Note that we have a new property, `@id`. This is a generated UUID, but you can also provide your own, so long as it's unique to this entity.

#### Example

```js
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
```

##### Returns

```js
// ref
{
  "@type": "Food",
  "name": "Hummus",
  "vegetarian": true,
  "number": 10,
  "ingredient": [
    "Garbanzo Beans",
    "Lemon"
  ],
  "@id": "uuid:5974d4a4-4b44-4c2d-a9f5-fbccc8da2760"
}

```