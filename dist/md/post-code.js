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