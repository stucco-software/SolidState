---
title: Delete Data
type: Documentation
exampleCode: post-code.js
---

Delete a key/value off an Entity with `db.delete(id, data)`.

Delete the entire entity with `db.delete(id)`.

#### Example

```js
await db.post({
  "@id": "hummus",
  "@type": "Food",
  "name": "Hummus",
  "vegetarian": true,
  "number": 10,
  "ingredient": [
    "Garbanzo Beans",
    "Lemon"
  ]
})
let ref = await db.patch('hummus', {
  "ingredient": "Olive Oil"
})
```

##### Returns

```js
// ref
{
  "@id": "hummus",
  "@type": "Food",
  "name": "Hummus",
  "vegetarian": true,
  "number": 10,
  "ingredient": [
    "Garbanzo Beans",
    "Lemon"
  ]
}

```