# Writing messages

How to write the strings in a message file so a translator can turn them into
any language without touching code. Examples use ICU MessageFormat, which
next-intl, FormatJS (react-intl), Lingui, Paraglide, Flutter ARB and many
platforms read. i18next has its own syntax, shown where it differs.

## Placeholders

```json
"invoice.sentTo": "Invoice {number} was sent to {client}."
```

- Name every placeholder after what it holds. `{client}`, not `{0}` or `{s}`.
- Keep the whole sentence, punctuation included, inside the message.
- i18next uses double braces: `"Invoice {{number}} was sent to {{client}}."`

## Plurals

Languages have between one and six plural forms. CLDR, the Unicode database
every `Intl` API uses, names them `zero`, `one`, `two`, `few`, `many` and
`other`. Each language uses a subset. Ask the runtime instead of guessing:

```js
new Intl.PluralRules('pl').resolvedOptions().pluralCategories
// ["few", "many", "one", "other"]
```

| Language | Categories |
|---|---|
| English, German, Swedish, Turkish, Hindi | one, other |
| French, Spanish, Italian, Portuguese | one, many, other (`many` only for round millions, like "1 million de") |
| Russian, Polish, Ukrainian, Czech | one, few, many, other |
| Hebrew | one, two, other |
| Arabic, Welsh | zero, one, two, few, many, other |
| Japanese, Chinese, Korean, Thai, Vietnamese, Indonesian | other |

```json
"invoices.overdue": "{count, plural, =0 {No overdue invoices} one {# overdue invoice} other {# overdue invoices}}"
```

- `other` is required in every plural, in every language.
- `#` prints the number, formatted for the locale.
- `=0` matches exactly zero. The `zero` category is a grammatical form that
  exists in a few languages (Arabic, Latvian, Welsh) and never fires in
  English. Use `=0` for "No invoices".
- Each branch holds a complete phrase. Don't share words across branches.
- The translator adds the categories their language needs. A Polish file
  will have `few` and `many` branches the English file doesn't.

i18next stores plurals as sibling keys with suffixes and picks one from
`count`:

```json
"overdue_one": "{{count}} overdue invoice",
"overdue_other": "{{count}} overdue invoices"
```

A Polish file then needs `overdue_one`, `overdue_few`, `overdue_many` and
`overdue_other`. vue-i18n's pipe syntax (`"invoice | invoices"`) only knows
English-style plurals until you add `pluralRules` for each language that
needs more.

## Ordinals

```json
"race.place": "You finished {place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}."
```

English ordinals use `one`, `two`, `few` and `other` (1st, 2nd, 3rd, 4th).
Other languages differ, which is why the suffix lives in the message.

## Gender and other choices

```json
"share.notice": "{gender, select, female {She shared a file} male {He shared a file} other {They shared a file}}"
```

- `other` is required and is the safe default.
- When a sentence has both a choice and a plural, put `select` outside and
  `plural` inside, with complete sentences in every branch.

## Rich text

Keep links and emphasis inside the sentence as tags, and map the tags to
elements in code.

```json
"signup.terms": "By signing up you accept the <terms>terms of service</terms>."
```

```tsx
t.rich('signup.terms', { terms: (chunks) => <a href="/terms">{chunks}</a> }) // next-intl
<Trans i18nKey="signup.terms" components={{ terms: <a href="/terms" /> }} />  // react-i18next
```

## Apostrophes and braces

In ICU, an apostrophe followed by `{` or `}` starts an escape. "Don't" and
"it's" are fine. To print a literal brace, write `'{'`. Typographic
apostrophes (’) avoid the question entirely.

## Keys

- Shape: `area.element.purpose`, for example `checkout.summary.total`.
- Keys never change when the English text changes. A renamed key looks like
  a deleted string plus a new one, and its translations are lost.
- Never use the English sentence as the key in key-based libraries.
- Split large projects into namespaces (one file per area) and load only
  what a page needs.

## Source text that translates well

The English (or other source) text is what every translation starts from.
Write it so the meaning survives.

- One idea per sentence. Short sentences.
- No idioms, puns, slang or cultural references in interface text. "Hit it
  out of the park" has no translation, only a rewrite.
- Use the same word for the same thing everywhere, as listed in the glossary
  in `LOCALIZATION.md`. "Workspace" on one screen and "project" on the next
  makes translators guess.
- Avoid words that are both noun and verb in short labels ("Order", "Book",
  "Post", "Close"). Add a note saying which one it is.
- Give the object: "Delete invoice?" not "Delete?".
- Spell out abbreviations and avoid "&" and "+" as words.
- Link text says where it goes. "Read the pricing guide", not "Click here".

## What not to do

| Don't | Why | Do |
|---|---|---|
| `t('hello') + ' ' + name` | Word order and spacing change | `t('hello', { name })` |
| `count + ' ' + t(count === 1 ? 'item' : 'items')` | Most languages have more than two forms | ICU `plural` |
| `t('total').toUpperCase()` | Casing is language-specific (Turkish i becomes İ) and most scripts have no case at all | Write the case into the message, or use CSS `text-transform` with `lang` set |
| Reusing `common.close` for "close the dialog" and "close your account" | Two meanings, two words in most languages | Two keys |
| A sentence split across two elements for styling | Translators get two fragments | One message with a tag |
| Text in an SVG or image file | Nobody can translate it | Live text from a message |
