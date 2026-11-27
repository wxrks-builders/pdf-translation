---
name: localize-design
description: Designs and builds interfaces that hold up in every language. Layouts that grow with longer translations instead of cutting them, right-to-left mirroring with logical CSS, fonts and line heights that cover every script, no text baked into images, language switchers that list languages by their own names, and forms that accept any name, address and keyboard. Use whenever you build, restyle or review UI components, pages, layouts, navigation, typography, icons, images or forms, and before launching in another country. Also use when the user mentions RTL, Arabic, Hebrew, Persian, Japanese, Chinese, Korean, German, text overflow, truncation, a language switcher, or LOCALIZATION.md. Works alongside visual design skills; they decide how it looks, this one keeps it working after translation.
license: MIT
metadata:
  author: wxrks
  version: "1.0.0"
---

# Localize design

A screen designed around English breaks in predictable places once it is
translated. German labels overflow their buttons. Arabic needs the whole
layout mirrored. Japanese needs taller lines and fonts that have the
characters. A hero headline that fit on two lines takes four.

None of this needs a redesign if the components are built to flex from the
start. This skill covers what to build in, what to test, and what to leave
alone. Visual design skills decide how the screen looks; this one makes sure
it still works in every language.

## Start here

1. Read `LOCALIZATION.md` at the project root. Its language list decides
   which checks matter: a right-to-left language in scope means rule 2 is
   required, Chinese, Japanese or Korean means rule 3 is, and German,
   Finnish or Russian makes rule 1 strict. If the file is missing, follow
   the `localize-code` skill's instructions to create it.
2. Apply the rules below to every component you build or change.
3. Run the checks in **Test in other languages** before you call a screen
   done.

## The rules

### 1. Let text grow

Translations are longer than English, and short labels grow the most. The
W3C, citing IBM's figures, puts text of up to 10 English characters at two to
three times its length in translation, and text over 70 characters at about
130%. Details and per-language notes: `references/text-length.md`.

- No fixed widths or heights on anything that holds text. Size buttons,
  tabs, pills and badges with padding and a `min-width` at most.
- Let labels wrap. A two-line button is better than a cut-off one. Allow two
  lines for navigation items and tabs, or collapse the overflow into a menu
  based on measured width, not on breakpoints tuned to English.
- Never cut primary actions, headings, prices, totals or legal text with an
  ellipsis. Truncate only secondary text that can be read in full elsewhere
  (a title with a tooltip or a detail page).
- Flex and grid children that hold text get `min-width: 0` and can wrap.
- Headlines: let them wrap (`text-wrap: balance` helps), and don't scale font
  size to the viewport on the assumption of an English-length line.
- Tables: let headers wrap, and allow horizontal scroll on narrow screens
  rather than crushing columns.

```tsx
// Before: fits "Save", cuts "Speichern"
<button className="w-24 truncate">{t('form.save')}</button>
// After
<button className="min-w-24 px-4 py-2">{t('form.save')}</button>
```

### 2. Mirror for right-to-left languages with logical properties

Arabic, Hebrew, Persian and Urdu read right to left, and the whole layout
follows: navigation, alignment, the order of columns, the side a drawer
opens from, the direction of arrows. With `dir="rtl"` on `<html>` and logical
properties in the CSS, the browser mirrors the layout without a second
stylesheet.

| Physical (avoid) | Logical (use) | Tailwind |
|---|---|---|
| `margin-left` / `margin-right` | `margin-inline-start` / `-end` | `ms-*` / `me-*` |
| `padding-left` / `padding-right` | `padding-inline-start` / `-end` | `ps-*` / `pe-*` |
| `left` / `right` | `inset-inline-start` / `-end` | `start-*` / `end-*` |
| `text-align: left` | `text-align: start` | `text-start` |
| `border-left` | `border-inline-start` | `border-s` |
| `border-top-left-radius` | `border-start-start-radius` | `rounded-ss` (`rounded-s` for both start corners) |
| `float: left` | `float: inline-start` | `float-start` (v4) |

- Use `gap` in flex and grid layouts instead of `space-x-*` and side margins.
- Icons that point along the reading direction mirror: back and forward
  arrows, chevrons on list rows and breadcrumbs, next and previous, undo and
  redo, indentation and text-alignment icons. Use the `rtl:` variant
  (`rtl:-scale-x-100`) or `[dir="rtl"] .icon { transform: scaleX(-1) }`.
- Leave alone what doesn't depend on reading direction: logos, icons of real
  objects (a camera, a phone), clocks, numbers, phone numbers and code.
  Media playback controls and their timeline are commonly left unmirrored
  too. When in doubt, ask someone who reads the language.
- Text direction inside text: numbers, Latin brand names and phone numbers
  stay left to right within Arabic or Hebrew sentences. Wrap inserted values
  in `<bdi>`, and give user-generated text and inputs `dir="auto"`.
- shadcn/ui converts its components to logical classes when RTL is enabled
  in its CLI. Other libraries: check for an RTL option before overriding by
  hand.
- Full guide, including animations, charts and carousels: `references/rtl.md`.

### 3. Type that covers every script

- Every font in the stack must have the characters for every language in
  scope, or the browser falls back to a mismatched font, or shows empty
  boxes (□, called tofu). Add a fallback per script and set it with
  `:lang()` selectors.
- Chinese, Japanese and Korean fonts are large. Load them with
  `unicode-range` subsets or use system fonts. Never ship one full CJK font
  to every visitor.
- Scripts with tall marks or stacked diacritics (Thai, Vietnamese,
  Devanagari, Arabic, Burmese) need more line height. Start at 1.6 to 1.8
  for body text and check that marks above and below aren't clipped.
- Don't letter-space Arabic: it breaks the joins between letters. Use
  weight, not italics or capitals, for emphasis in scripts that have
  neither (Chinese, Japanese, Korean, Arabic, Hebrew, Thai).
- Line breaking: Korean wraps between words with `word-break: keep-all`;
  Japanese uses `line-break: strict` to keep punctuation off the start of a
  line. Set `lang` so the browser applies each language's rules and
  hyphenation (`hyphens: auto` needs it).
- Minimum sizes go up for dense scripts. 12px Chinese is hard to read; keep
  body text at 16px.
- Font stacks, sizes and line-breaking details: `references/type.md`.

### 4. Keep text out of images

- Text in a PNG, JPG or a flattened SVG can't be translated, searched or
  read by a screen reader. Put the words in HTML over the image, or in an
  SVG `<text>` element filled from the messages.
- If text must live in an image (a social card, an app store screenshot),
  generate one image per language from a template, and say so in
  `LOCALIZATION.md`.
- Screenshots of the product inside a translated page show the product in
  that language, or no text at all.
- `alt` text comes from the messages like any other string.

### 5. Languages are not flags

- A language switcher lists each language in its own name and script:
  English, Español, Deutsch, 日本語, العربية. `Intl.DisplayNames` gives the
  names (see `localize-code`). Flags stand for countries. Spanish isn't
  Spain, English isn't the UK or the US, and Arabic is spoken in more than
  twenty countries.
- The switcher is visible on every page (header or footer), reachable by
  keyboard, and changes language without losing the page or the form state.
- Country and language are separate choices when both matter (a store
  asking for a shipping country and a display language).
- Colors, gestures, hand signs and symbols carry different meanings in
  different places. Never let color alone carry meaning; pair status colors
  with an icon and a word. More in `references/images-and-symbols.md`.

### 6. Forms that accept everyone

- Names: one "Full name" field, or given and family name fields that don't
  assume order or that everyone has both. Accept any script and any length.
- Addresses differ by country: postal codes are optional in some, states
  don't exist in most. Use a country-aware form or one free-text block.
- Phone numbers carry a country code. Store them in E.164 (`+14155550123`).
- Dates: use the platform date picker or one that follows the locale (first
  day of week, 12 or 24 hour clock). Don't ask people to type MM/DD/YYYY.
- Chinese, Japanese and Korean users type through an input method that uses
  Enter to confirm a character. An Enter handler that submits must skip
  `event.isComposing` (`event.nativeEvent.isComposing` in React), or every
  confirmed character sends the message.
- `autocomplete` attributes (`name`, `given-name`, `postal-code`, `tel`)
  help everyone, in every language.
- Validation messages come from the messages file and say what to fix.
- Details: `references/forms.md`.

### 7. Components that survive translation

- Never put a control in the middle of a sentence ("Show [10 ▾] results per
  page"). Put a complete label next to the control.
- Icon-only buttons need a translated `aria-label` and usually a tooltip.
- Placeholder text isn't a label. It disappears on typing and is often
  longer in translation than the field is wide.
- Keep space for the longest state: a "Following" button is longer than
  "Follow" in many languages too.
- Empty states, errors and toasts grow like everything else.

## Test in other languages

Do this before calling a screen done, at a phone width (360 to 390 px) and
on desktop.

1. **Pseudo-locale.** Generate it with the `localize-code` skill's
   `scripts/pseudo-locale.mjs` and switch to it. Accented, bracketed, longer
   text shows hardcoded strings (still plain English), cut text (a missing
   closing bracket), and layouts that don't grow.
2. **The longest real language in scope** (often German, Finnish or Russian).
3. **A right-to-left language** if one is in scope, or `dir="rtl"` on
   `<html>` with the pseudo-locale's `--bidi` mode to check the mirroring.
4. **Chinese, Japanese or Korean** if in scope, to check fonts, line height
   and line breaks.
5. Take a screenshot of each and look for: cut or overlapping text, wrong
   alignment, arrows pointing the wrong way, empty boxes instead of
   characters, clipped accents, and English left behind.

## Before you say done

- [ ] No fixed widths or heights on text; buttons sized by padding
- [ ] No ellipsis on actions, headings, prices or legal text
- [ ] Logical properties only (no left and right in margins, padding, positions, alignment)
- [ ] Directional icons mirror under `dir="rtl"`; logos and clocks don't
- [ ] Fonts cover every script in scope, with line heights that fit them
- [ ] No text inside images; `alt` text translated
- [ ] Language switcher with each language in its own name, on every page
- [ ] Forms accept any name, address and phone number; Enter respects `isComposing`
- [ ] Screens checked in the pseudo-locale, and in RTL and CJK when in scope

## Reference files

| File | Read it when |
|---|---|
| `references/text-length.md` | Sizing components, writing labels, or checking how much a language grows |
| `references/rtl.md` | Supporting Arabic, Hebrew, Persian or Urdu, or mirroring icons, animations, charts and carousels |
| `references/type.md` | Choosing fonts, font stacks, sizes, line heights or line breaking for other scripts |
| `references/forms.md` | Building forms with names, addresses, phone numbers, dates or text input |
| `references/images-and-symbols.md` | Using images, illustrations, icons, colors, flags or screenshots |
