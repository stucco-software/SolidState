---
title: Put Data
type: Documentation
---

Update an Entity with the `db.put()` function, passing the Entities `@id` as the first parameter, and the new keys as the second.


#### Example

```js
let ref = await db.put("chickpeas", {
  "name": "Garbanzo Beans"
})

```

##### Returns

```js
{
  "@id": "chickpeas",
  "@type": "Ingredient",
  "name": "Garbanzo Beans"
}
```