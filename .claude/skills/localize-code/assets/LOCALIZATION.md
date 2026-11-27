# LOCALIZATION.md

How this project handles languages. Coding agents read this before writing
any text a person will see, and update it when a decision changes. Keep it
short and true. Delete the hints in brackets as you fill it in.

## Languages

- Source language: en
- Target languages: [es, pt-BR, de, ja, ar as BCP 47 tags, or "none yet"]
- Fallback: [pt-BR → pt → en]
- First visit: [browser language if we support it, otherwise en; never by IP]
- Right-to-left languages in scope: [ar, or none]

## Where the text lives

- Messages: [messages/{locale}.json]
- Format: [ICU MessageFormat / i18next JSON v4 / ARB / String Catalogs]
- Library: [next-intl / react-i18next / vue-i18n / Paraglide / gen-l10n]
- Context notes for translators: [description fields / messages/_context.json]
- Approval status: [messages/_status.json]
- Key style: [area.element.purpose, for example checkout.summary.total]
- Content from the database: [table content_translations, or none]
- Images with text: [where the templates live, or none]

## Never translate

Names that stay exactly as written in every language.

- [Product name]
- [Feature names]
- [Company and partner names]

## Glossary

Terms that must be translated the same way everywhere. Add a row the first
time a term is decided, and use it from then on.

| Term | Notes | es | pt-BR | de | ja |
|---|---|---|---|---|---|
| [workspace] | [the shared area a team works in] | | | | |

## Voice per language

- [es: tú, friendly, neutral Latin American Spanish]
- [de: du or Sie? Decide once.]
- [ja: です/ます form]

## Markets

| Market | Locale | Currency | Notes |
|---|---|---|---|
| [United States] | [en-US] | [USD] | |

## Review

- Who approves each language: [name or team per language]
- Always reviewed by a person who speaks the language before going live:
  legal text, prices and payment, security and account messages, health and
  safety, marketing headlines.

## Decisions

- [YYYY-MM-DD: chose next-intl with localePrefix as-needed]
