---
title: Get Started
type: Documentation
lastUpdated: 2025.11-03
order: 1
---

```js
import SolidState from "solidstate-kv"

const db = SolidState({
  graph: "your-graph-name"
})

const reference = await db.post({
  "@type": "Document",
  "name": "Your Document Goes Here"
})
```

[Read The Docs](/api) [Install](https://www.npmjs.com/package/solidstate-kv)