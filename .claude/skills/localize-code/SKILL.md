---
name: localize-code
description: Keeps an app ready for other languages while you build it, and does the work when a language is added. Puts user-facing text in message files instead of components, writes whole sentences with ICU plurals, formats dates, numbers and prices with Intl for the active locale, sets up locale routing, language switching and hreflang, and keeps translation files in sync with context for translators. Use whenever you write or change user-facing text, scaffold a new web or mobile app, format dates, numbers, currency or times, add a language or a market, translate or review locale files, or prepare an app for launch in another country. Also use when the user mentions i18n, l10n, localization, internationalization, translation, locales, multilingual, a language switcher, or LOCALIZATION.md.
license: MIT
metadata:
  author: wxrks
  version: "1.0.0"
---

# Localize code

An app that will ever run in a second language needs three things from its
code. The text lives outside the components. Every sentence is whole. Every
date, number and price is formatted for the reader. When these are in place
from the first commit, adding a language is a file, not a rewrite.

Coding agents skip all three by default, because hardcoded English is the
shortest path to a working screen. This skill makes the short path the
localizable one.

## Start here

1. Read `LOCALIZATION.md` at the project root. It says which languages are in
   scope, where the text lives, which words never change, and the tone for
   each language. Follow it over anything in this skill.
2. If it doesn't exist, create it from `assets/LOCALIZATION.md` in this
   skill's folder. Ask the user two questions at most: which languages, and
   which names must never be translated. If they don't know yet, record the
   source language only and work at the **Ready** level.
3. Find what the project already uses (`next-intl`, `react-i18next`,
   `vue-i18n`, Paraglide, `flutter gen-l10n`, String Catalogs...). Never add a
   second i18n library next to an existing one. For new projects, pick from
   `references/stacks.md`. If a docs tool such as Context7 is available, read
   the current docs for the library version you install before writing setup
   code, because file names and APIs move between major versions.

## Two levels

**Ready (every project, even English-only).** Rules 1 to 6 below. They cost
almost nothing on day one and remove the rewrite later.

**Adding a language.** Everything below, plus `references/translating.md`
for how translations get made, reviewed and kept.

## The rules

### 1. Text lives in message files, not in components

Every string a person can see or hear goes in the source message file under a
key: labels, headings, body copy, placeholders, `alt`, `aria-label`, `title`,
page metadata, toasts, validation and error messages, empty states, emails,
push notifications, PDF and invoice text, and messages the server returns to
the UI.

```tsx
// Before: English is welded into the component
<button>Start free trial</button>

// After
<button>{t('pricing.trial.cta')}</button>
// messages/en.json → "pricing": { "trial": { "cta": "Start free trial" } }
```

- Keys are stable and say where the text is used (`checkout.payButton`), not
  what it says. Text changes; keys shouldn't.
- One key per meaning. "Close" on a dialog and "Close" for an account are two
  keys, because other languages use two different words.
- One component for every language. Never duplicate a component per language.
- The source file (usually `en`) is the only file you edit by hand. Target
  files change through the translation step in `references/translating.md`.
- Don't call a model at runtime to translate interface strings. Translate
  once, review, ship files.

### 2. Whole sentences with named placeholders

Word order changes between languages. A sentence glued from pieces can't be
translated, only mangled.

```ts
// Before
'Welcome back, ' + name + '! You have ' + count + ' new messages.'
// After
t('home.welcome', { name, count })
// "Welcome back, {name}! You have {count, plural, one {# new message} other {# new messages}}."
```

- Named placeholders (`{name}`), never positional ones, so a translator can
  move them.
- Links and bold text inside a sentence stay in the sentence as tags:
  `"Read the <terms>terms</terms> first."` Use the library's rich-text
  helper (`t.rich`, `<Trans>`, `<FormattedMessage>`).
- Never build a sentence out of UI controls ("Show [10 ▾] results per page").
  Put the control next to a complete label.

### 3. Plurals, ordinals and gender through the message format

English has two plural forms. Arabic has six, Polish and Russian four,
Japanese one. `count === 1 ? '' : 's'` is wrong in most languages.

- Use ICU `plural` (or the library's `count` option) for anything with a
  number. Always include `other`.
- Use `selectordinal` for 1st, 2nd, 3rd and `select` for gendered words.
- Details and examples: `references/messages.md`.

### 4. Dates, numbers, prices and times through Intl

Pass the active locale every time. Never hand-build a format.

```ts
// Before
`$${price.toFixed(2)}`              // "$1234.50" everywhere on Earth
date.toLocaleDateString()           // the server's locale on SSR, the browser's on the client

// After
new Intl.NumberFormat(locale, { style: 'currency', currency }).format(price)
// en-US "$1,234.50" · de-DE "1.234,50 $" · ja-JP "$1,234.50"
new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(date)
```

- Store dates in UTC (ISO 8601) and show them in the reader's time zone.
- Store money as integer minor units plus an ISO 4217 currency code. The
  currency comes from the order or the market, not from the language.
- Language, region, currency and time zone are four settings. A
  Spanish-speaking user in the US pays in dollars.
- Cheat sheet for every `Intl` formatter: `references/formatting.md`.

### 5. Text handling that works in every script

- Sort with `Intl.Collator(locale)` or `localeCompare(b, locale)`, never with
  the default sort.
- Change case with `toLocaleUpperCase(locale)`. Turkish has a dotted and a
  dotless i.
- Count and cut text by grapheme with `Intl.Segmenter`. `str.length` and
  `slice` split emoji and accented letters. Prefer CSS line clamping to
  cutting translated text in code.
- Validation accepts any script. A name pattern like `/^[a-zA-Z ]+$/`
  rejects José, Nguyễn, 王芳 and محمد.
- Normalize to NFC before comparing or storing user text.

### 6. The page knows its language

- `<html lang="…" dir="…">` comes from the active locale (`dir="rtl"` for
  Arabic, Hebrew, Persian, Urdu). Screen readers, hyphenation, fonts and
  casing all read `lang`.
- Quotes or names in another language get their own `lang` attribute.
- User-generated text gets `dir="auto"` so a Hebrew comment displays right
  inside an English page.

### 7. Detecting and switching languages

- Order: the user's explicit choice, then their saved preference, then
  `Accept-Language` or `navigator.languages`, then the default. Never use IP
  location to pick a language. A country is not a language.
- A language switcher on every page, listing each language in its own name
  (`Intl.DisplayNames`), switching to the same page in the other language.
- Remember the choice (cookie or profile) and store the user's locale on
  their account, so emails and notifications go out in it.

### 8. URLs and search engines

- One URL per language (`/es/precios` or `/es/pricing`), never the same URL
  serving different languages by cookie.
- Each page lists all its language versions with `hreflang`, including
  itself and an `x-default`. Titles and meta descriptions are translated.
- Don't auto-redirect by browser language on every visit. Suggest, then
  remember.
- Full checklist with framework snippets: `references/seo.md`.

### 9. Context for whoever translates

Translators see a key and a string, not your screen. Give each new string a
short note: where it appears, what each placeholder holds, and any length
limit. Use the format's own description field when it has one (ARB `@key`,
XLIFF `<note>`, gettext `#.`, String Catalog comments, FormatJS
`description`). For plain JSON, keep notes in a side file named in
`LOCALIZATION.md`. Words from the glossary in `LOCALIZATION.md` are used
exactly as written there.

### 10. Translation files stay in sync

- A missing key falls back along a chain (`pt-BR` → `pt` → `en`) and is
  logged, never shown as a raw key.
- When source text changes, its translations are out of date. Flag them for
  review instead of leaving the old meaning live.
- Run `scripts/check-i18n.mjs` before you finish (below). In CI, run it with
  `--strict`.

## Scripts

Both scripts are plain Node 18+, no dependencies. Run them from the project
root with the path to this skill.

- `node <skill>/scripts/check-i18n.mjs [dir]` finds hardcoded text, glued
  sentences, English-only plurals, hand-built prices and dates, physical
  CSS that breaks right-to-left layouts, missing `lang`, Enter handlers that
  break Japanese and Chinese input, ASCII-only validation, and missing keys,
  broken placeholders and missing plural forms across locale files. It is a
  heuristic: read each finding before changing code.
- `node <skill>/scripts/pseudo-locale.mjs messages/en.json` writes a fake
  language (`en-XA`) with accented, longer text in brackets, keeping every
  placeholder intact (`locales/en/translation.json` becomes
  `locales/en-XA/translation.json`). Add `en-XA` to the app's list of
  languages and switch to it. Any English you still see is hardcoded. Any
  text cut off or missing its brackets will break in German. Add `--bidi` to
  fake a right-to-left language (pair it with `dir="rtl"`).

## Before you say done

- [ ] No user-facing text left in components, attributes, metadata, emails or server messages
- [ ] Every sentence is one message, with named placeholders and ICU plurals
- [ ] Dates, numbers, prices and times use `Intl` with the active locale
- [ ] `<html lang dir>` follows the active locale
- [ ] New keys have a context note; glossary terms match `LOCALIZATION.md`
- [ ] `check-i18n.mjs` shows nothing you can't explain
- [ ] If languages were added: the switcher, hreflang and fallback chain work, and the pseudo-locale screens look right
- [ ] `LOCALIZATION.md` is updated with any decision you made

## Reference files

Read only what the task needs.

| File | Read it when |
|---|---|
| `references/stacks.md` | Setting up i18n in Next.js, React + Vite, Vue, Nuxt, SvelteKit, Astro, Expo, Flutter, iOS, Android, Django, Rails, Laravel, or a database |
| `references/messages.md` | Writing plurals, ordinals, gender, rich text, or naming keys |
| `references/formatting.md` | Formatting numbers, currency, dates, times, relative time, lists, units, or language names |
| `references/seo.md` | Routing, hreflang, sitemaps, metadata, or redirects for more than one language |
| `references/translating.md` | Getting translations made, translating drafts yourself, reviewing, or keeping files in sync |

The design side (layouts that grow, right-to-left mirroring, fonts for every
script, forms) is the `localize-design` skill.
