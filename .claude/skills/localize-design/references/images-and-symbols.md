# Images, icons, color and symbols

## Text in images

- Words belong in HTML or in SVG `<text>`, filled from the messages, never
  flattened into a bitmap or outlined in an SVG.
- When text has to be part of an image (social cards, app store
  screenshots, email headers), keep the source template and render one
  image per language. Record the template's location in `LOCALIZATION.md`
  so the images are regenerated when copy changes.
- Product screenshots on a translated page show the product in that
  language. Retake them per language, or use screenshots without text.
- Charts render their labels as text from the messages, with numbers and
  dates formatted per locale.
- `alt` text is a message like any other.

## Flags and languages

- A flag is a country. Use language names, each in its own language
  (Español, Deutsch, 日本語, العربية, Português (Brasil)), in language
  switchers.
- When both country and language matter (a store), offer them as two
  choices: ship to Mexico, display in English.
- Flags are right for countries: a shipping country, a phone country code,
  a regional office.

## Icons

- Prefer icons whose meaning doesn't depend on a local object or custom.
  A dollar sign for "pricing", a piggy bank for "savings" or a US-style
  mailbox for "inbox" read differently or not at all elsewhere.
- Hand gestures (thumbs up, OK sign, an open palm) are offensive or
  meaningless in some places. Avoid them as icons for core actions.
- Icons that point along the reading direction mirror in right-to-left
  languages (`rtl.md`).
- Pair icons with labels for anything that matters. A label translates; an
  icon has to be learned.

## Color

- Colors carry different meanings in different places. Red can mean danger,
  loss, luck or celebration depending on where you are; in East Asian stock
  markets red often means a price went up.
- Never let color alone carry meaning. Pair status colors with an icon and
  a word, which also serves people who don't see color.

## People, places and examples

- Illustrations and photos with people, food, homes, money and gestures
  show one place. For a product used in many countries, choose images that
  don't need explaining, or localize them for the markets that matter most.
- Example data (names, addresses, prices, dates in placeholders and demos)
  should make sense in each language, or be neutral. A placeholder of
  "John Smith, 123 Main St" in a Japanese form looks like a mistake.
- Maps and borders are political. Show the borders your legal team accepts
  for each market, or avoid showing them.

## Before launch

- [ ] No words inside images, or one rendered image per language
- [ ] Product screenshots match each page's language
- [ ] No flags standing in for languages
- [ ] Every status color has an icon and a word
- [ ] Example names, addresses and prices fit each language
