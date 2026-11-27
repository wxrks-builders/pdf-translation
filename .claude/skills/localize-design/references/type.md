# Type for every script

## Fonts that have the characters

A Latin web font usually covers English and Western European languages. It
may not cover Vietnamese (stacked diacritics), Polish, Czech, Turkish or
Romanian (Latin Extended), and it never covers Cyrillic, Greek, Arabic,
Hebrew, Devanagari, Thai, Chinese, Japanese or Korean unless it says so.

- Check the font's supported character sets against `LOCALIZATION.md`
  before choosing it.
- Build stacks with a fallback per script. Google's Noto family covers
  almost every script and pairs well as a fallback.
- Assign fonts per language with `:lang()` so each language gets the right
  regional forms. Chinese, Japanese and Korean share many characters that
  are drawn differently in each, so a Chinese font on Japanese text looks
  wrong to a Japanese reader.

```css
:root { --font-body: "Inter", system-ui, sans-serif; }
:lang(ar) { --font-body: "Noto Sans Arabic", system-ui, sans-serif; }
:lang(he) { --font-body: "Noto Sans Hebrew", system-ui, sans-serif; }
:lang(ja) { --font-body: "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif; }
:lang(ko) { --font-body: "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
:lang(zh-Hans) { --font-body: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif; }
:lang(zh-Hant) { --font-body: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif; }
:lang(th) { --font-body: "Noto Sans Thai", system-ui, sans-serif; }
:lang(hi) { --font-body: "Noto Sans Devanagari", system-ui, sans-serif; }
body { font-family: var(--font-body); }
```

## Loading

- Chinese, Japanese and Korean fonts hold tens of thousands of characters
  and can weigh several megabytes. Use providers that split them into
  `unicode-range` subsets (Google Fonts does), self-host subsets, or rely
  on system fonts.
- Load a script's font only on pages in that language.
- `font-display: swap` avoids invisible text while fonts load.

## Size and line height

| Script | Body line height to start from | Notes |
|---|---|---|
| Latin, Cyrillic, Greek | 1.4–1.6 | Vietnamese needs the top of the range |
| Arabic, Hebrew | 1.6–1.8 | Arabic marks sit above and below |
| Devanagari, Thai, Burmese | 1.6–1.9 | Tall marks above and below the line |
| Chinese, Japanese, Korean | 1.6–1.8 | Dense characters need air between lines |

- Keep body text at 16px or more in every script. Dense scripts become hard
  to read below that.
- Check that accents and marks aren't clipped by `overflow: hidden` or a
  tight `line-height` on single-line elements like buttons.

## Emphasis and case

- Italics don't exist in Chinese, Japanese, Korean, Arabic, Hebrew or Thai.
  Browsers fake them by slanting, which looks broken. Emphasize with weight
  or color.
- Capital letters don't exist in most scripts. Don't use uppercase as the
  only sign of a heading or a button. When you use `text-transform`, set
  `lang` so casing follows the language (Turkish i).
- Don't add `letter-spacing` to Arabic. It breaks the connections between
  letters. Be careful with tracking on other non-Latin scripts too.

## Line breaking

- Set `lang` on `<html>` (and on embedded text in other languages). The
  browser uses it to choose line-breaking and hyphenation rules.
- Japanese and Chinese break between characters, not at spaces. Keep
  `line-break: strict` so punctuation doesn't start a line.
- Korean uses spaces. `word-break: keep-all` wraps Korean between words
  instead of in the middle of them.
- Thai and Lao have no spaces between words. Browsers break them with a
  dictionary; don't fight it with `word-break: break-all`.
- German and Finnish compounds may need `hyphens: auto` or
  `overflow-wrap: anywhere` in narrow columns.

## Numbers

Arabic locales may use Arabic-Indic digits (١٢٣) and Persian uses its own
(۱۲۳). `Intl.NumberFormat` picks the right ones. Check that your font has
them, and use tabular figures (`font-variant-numeric: tabular-nums`) in
tables in every script.
