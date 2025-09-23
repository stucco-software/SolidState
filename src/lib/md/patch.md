---
title: Patch Data
type: Documentation
---

Add to the existing value of an Entity with `db.patch()`.

Note: If the original value was a single scalar, the new value will be an Array. This can be tricky and also confusing.

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
    "Lemon",
    "Olive Oil"
  ]
}
```