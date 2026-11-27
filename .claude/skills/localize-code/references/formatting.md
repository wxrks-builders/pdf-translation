# Formatting with Intl

Every modern browser, Node, Deno and Bun ship the full `Intl` APIs. They
hold the formatting rules for hundreds of locales, so the app never needs to
know them. Pass the active locale every time.

React Native's Hermes engine ships a subset (numbers, dates, collation).
When a library warns that `Intl.PluralRules` or another formatter is
missing, add the matching FormatJS polyfill (`@formatjs/intl-pluralrules`,
`@formatjs/intl-relativetimeformat`, and so on) rather than writing your own
rules.

Outputs below come from Node 22. Exact characters can differ between
runtimes and versions (spaces in French numbers are narrow no-break spaces,
for example). **Never hardcode a formatted string in a test**; format the
expected value with the same `Intl` call instead.

## Numbers and money

```js
const price = 1234.5;
new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(price)
```

| Locale | Output |
|---|---|
| en-US | $1,234.50 |
| de-DE | 1.234,50 $ |
| fr-FR | 1 234,50 $US |
| pt-BR | US$ 1.234,50 |
| es-MX | USD 1,234.50 |
| ar-EG | ١٬٢٣٤٫٥٠ US$ |

- The currency comes from the order or the market, not from the language.
- Currencies have their own decimals. `JPY` in `ja-JP` prints ￥1,235.
- Store money as integer minor units (cents) plus the currency code.
- Indian grouping: `hi-IN` prints 1234567.8 as 12,34,567.8.
- Compact: `{ notation: 'compact' }` gives 1.2M in English, 123万 in
  Japanese, 1,2 Mio. in German.
- Percent: `{ style: 'percent' }` gives %25 in Turkish and 25 % in French.
- Units: `{ style: 'unit', unit: 'kilometer-per-hour' }` gives 50 km/h.

## Dates and times

```js
new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(date)
```

| Locale | 27 Nov 2026 |
|---|---|
| en-US | Nov 27, 2026 |
| en-GB | 27 Nov 2026 |
| de-DE | 27.11.2026 |
| ja-JP | 2026/11/27 |
| pt-BR | 27 de nov. de 2026 |
| ar-EG | ٢٧/١١/٢٠٢٦ |

- Use `dateStyle` and `timeStyle` (`full`, `long`, `medium`, `short`)
  before reaching for individual fields. The locale decides order and
  separators, and 12 or 24 hour clocks.
- Always pass `timeZone` when formatting on a server. Store the user's time
  zone (`Intl.DateTimeFormat().resolvedOptions().timeZone` in the browser).
- `date.toLocaleDateString()` with no arguments uses the machine's locale:
  the server's during server rendering and the browser's after. The two
  differ, and React reports a hydration mismatch. Pass locale and time zone
  explicitly, or format on the client only.
- Ranges: `formatRange(start, end)` writes "Nov 27 – 30, 2026" in en-US
  and "27.–30.11.2026" in de-DE.
- Don't build dates from `getMonth() + 1` and slashes.

## Relative time

```js
new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-1, 'day')
// en "yesterday" · es "ayer"
new Intl.RelativeTimeFormat('de').format(3, 'hour') // "in 3 Stunden"
```

## Lists

```js
new Intl.ListFormat(locale, { type: 'conjunction' }).format(['Ana', 'Ben', 'Chen'])
// en "Ana, Ben, and Chen" · es "Ana, Ben y Chen" · ja "Ana、Ben、Chen"
```

## Plural rules

```js
new Intl.PluralRules('ru').select(5)                          // "many"
new Intl.PluralRules('ar').resolvedOptions().pluralCategories // six categories
new Intl.PluralRules('en', { type: 'ordinal' }).select(2)     // "two" → "2nd"
```

Message libraries call this for you. Use it directly only for logic outside
messages.

## Sorting and comparing

```js
const names = ['Zoë', 'zebra', 'Äpfel', 'apple', 'Ölbaum', 'oak'];
names.sort()                                // ["Zoë","apple","oak","zebra","Äpfel","Ölbaum"]
names.sort(new Intl.Collator('de').compare) // ["Äpfel","apple","oak","Ölbaum","zebra","Zoë"]
names.sort(new Intl.Collator('sv').compare) // ["apple","oak","zebra","Zoë","Äpfel","Ölbaum"]
```

The same list sorts differently in German and Swedish. Both are right.
`{ numeric: true }` sorts "item 2" before "item 10".

## Case

```js
'istanbul'.toUpperCase()             // "ISTANBUL"
'istanbul'.toLocaleUpperCase('tr')   // "İSTANBUL"
```

## Length and cutting text

```js
const s = '👨‍👩‍👧‍👦 José';
s.length                                                                  // 16
[...new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(s)].length // 6
s.slice(0, 3)                                                             // a broken emoji
```

- Count characters a person sees with `Intl.Segmenter`, granularity
  `grapheme`.
- Find words in Japanese, Chinese and Thai (no spaces) with granularity
  `word`: "今日は良い天気です" splits into 今日 / は / 良い / 天気 / です.
- Prefer CSS (`line-clamp`, `text-overflow`) to cutting strings in code.

## Language and region names

```js
new Intl.DisplayNames([code], { type: 'language' }).of(code)
// pt-BR "português (Brasil)" · de "Deutsch" · ja "日本語" · ar "العربية" · zh-Hant "繁體中文"
new Intl.DisplayNames(['en'], { type: 'language' }).of('pt-BR') // "Brazilian Portuguese"
new Intl.DisplayNames(['es'], { type: 'region' }).of('MX')     // "México"
```

Use the first form, each language in its own name, for language switchers.

## Text direction

```js
new Intl.Locale('ar').getTextInfo?.() // { direction: "rtl" } where supported
```

Support for `getTextInfo` is not universal. A fallback that covers the
right-to-left languages in common use:

```js
const RTL = new Set(['ar', 'he', 'iw', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb']);
const dir = (locale) => (RTL.has(new Intl.Locale(locale).language) ? 'rtl' : 'ltr');
```

## Unicode normalization

The same é can be stored as one character or two. Normalize user input
with `str.normalize('NFC')` before comparing, deduplicating or storing.

## Locale codes

Use BCP 47 tags: `en`, `pt-BR`, `es-419` (Latin American Spanish),
`zh-Hans` and `zh-Hant` (Simplified and Traditional Chinese), `sr-Latn`.
Fall back from specific to general: `pt-BR` → `pt` → the default.
