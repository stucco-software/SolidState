---
title: Create A Store
type: Documentation
---

Create a new interface to a graph by calling `SolidState(options)`.

#### Options

```js
{
  graph: 'string',
  session: {optional}
}
```

#### Example

```js
import SolidState from 'solidstate-kv'

const db = SolidState({
  graph: 'test-graph'
})
```
