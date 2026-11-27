# How much text grows

## The W3C figures

The W3C's article "Text size in translation"
(https://www.w3.org/International/articles/article-text-size) publishes
IBM's average expansion for text translated from English into European
languages, by the length of the English text:

| English text | Translated length, as % of English |
|---|---|
| Up to 10 characters | 200–300% |
| 11–20 characters | 180–200% |
| 21–30 characters | 160–180% |
| 31–50 characters | 140–160% |
| Over 70 characters | 130% |

Short strings grow the most, and short strings are what buttons, tabs, menu
items and badges hold. "Save" is four characters. "Speichern" is nine.

The same article makes two points that matter for layout:

- Non-Latin scripts often have taller characters and need more space
  between lines (Arabic, especially in Nastaliq fonts, Chinese, Devanagari,
  Japanese, Korean, Thai, Tibetan).
- Chinese, Japanese and Korean can use fewer characters and still need more
  horizontal space, because each character is wider.

## What to build

- Size text containers by content, never by a fixed width or height.
- Leave room in fixed-size places you can't avoid (a toolbar, a tab bar) for
  at least twice the English length of each label, or let the bar scroll.
- Expect wrapping. Design the two-line version of every button and label.
- Character limits in messages (an SMS, a push title, a meta description)
  are counted per language. Put the limit in the string's context note and
  measure each translation, not the English.

## Words that get long

- German and Finnish join words into long compounds that don't break:
  "Datenschutzerklärung" (privacy policy) is one word. Allow wrapping inside
  long words with `overflow-wrap: anywhere` or `hyphens: auto` (with `lang`
  set) in narrow places.
- Labels that are one word in English are often phrases in other languages.

## Testing it

The `localize-code` skill's `pseudo-locale.mjs` lengthens each string
following the table above (twice the length for short labels, 30% for long
text), so a layout that survives the pseudo-locale survives most real
translations.
