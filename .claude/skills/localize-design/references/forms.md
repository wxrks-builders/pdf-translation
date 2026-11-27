# Forms for every country

Forms are where an app built around one country turns people away. The W3C
article "Personal names around the world"
(https://www.w3.org/International/questions/qa-personal-names) is the
standard reference for names.

## Names

- Simplest and safest: one "Full name" field, plus an optional "What should
  we call you?" field if the app greets people.
- If you need given and family names separately (payments, legal), label
  them "Given name" and "Family name", not "First" and "Last". Many people
  write the family name first, and some have only one name.
- Accept any script, spaces, hyphens and apostrophes, and long values.
  No `/^[a-zA-Z]+$/` patterns.
- Don't change the case of names (McDonald, van der Berg, Ó Briain).

## Addresses

- Formats differ by country: postal code before or after the city,
  no postal code at all, no state or province, building and floor lines.
- Either a country-aware form (ask the country first, then show that
  country's fields) or a free multi-line address field plus country.
- Don't validate postal codes with one country's pattern.
- Store the country as an ISO 3166-1 code and show its name with
  `Intl.DisplayNames`.

## Phone numbers

- A country selector or a `+` prefix, and store numbers in E.164
  (`+14155550123`). A library such as `libphonenumber-js` validates and
  formats per country.
- `type="tel"` and `autocomplete="tel"` bring up the right keyboard and
  autofill.

## Dates and times

- Use `<input type="date">` or a date picker that follows the locale: the
  first day of the week (Monday in most of Europe, Sunday in the US,
  Saturday in parts of the Middle East), month and day names, and 12 or
  24 hour time.
- Never ask people to type a date in a fixed pattern like MM/DD/YYYY.
- Birthdays and other dates without a time are dates, not timestamps. Don't
  shift them across time zones.

## Typing in Chinese, Japanese and Korean

These languages are typed through an input method editor (IME): the person
types sounds, picks characters from a list, and presses Enter to confirm.
During that, `keydown` fires for Enter with `isComposing` set to true.

```tsx
<textarea
  onKeyDown={(e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return; // still composing
    e.preventDefault();
    send();
  }}
/>
```

Without that check, a chat box sends a half-typed message every time a
Japanese user confirms a character. Also listen for `compositionstart` and
`compositionend` if you run search-as-you-type, and query on
`compositionend`.

## Text input in general

- `dir="auto"` on inputs and textareas, so Arabic and Hebrew input aligns
  and displays correctly.
- `lang` on fields where the expected language is known (a translation
  field, for example) so spell-checkers use the right dictionary.
- `autocomplete` tokens (`name`, `given-name`, `family-name`, `email`,
  `street-address`, `postal-code`, `country`, `tel`) work in every
  language.
- Validation messages are translated messages that say what to fix and
  read naturally with the field's translated label.
- Count length with `Intl.Segmenter` if you show a character counter; a
  single emoji or accented letter can be several code units.

## Money and numbers typed by users

- People type decimals with a comma in most of Europe and South America.
  Parse numbers by locale, or use separate whole and decimal fields, or
  `inputmode="decimal"` plus locale-aware parsing.
- Show the currency symbol from `Intl.NumberFormat`, and store amounts as
  minor units with a currency code.
