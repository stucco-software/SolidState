---
title: Get All
type: Documentation
---

Get all items in the graph with `db.getAll()`


#### Example

```js
let items = await db.getAll()
```

##### Returns

```js
// items
[{
  "@id": "chickpeas",
  "@type": "Ingredient",
  "name": "Chickpeas"
},{
  "@id": "lemon",
  "@type": "Ingredient",
  "name": "Lemon"
}]
```