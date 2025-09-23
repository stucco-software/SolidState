---
title: Get Data
type: Documentation
---

Get a single item by `@id` with `db.get()``


#### Example

```js
let ref = await db.post({
  "@id": "chickpeas",
  "@type": "Ingredient",
  "name": "Chickpeas"
})
let checkpeas = await db.get("chickpeas"})
```

##### Returns

```checkpeas
// ref
{
  "@id": "chickpeas",
  "@type": "Ingredient",
  "name": "Chickpeas"
}
```