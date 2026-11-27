# Getting translations made and keeping them

The code side is done when the text lives in message files. This file is
about what happens to those files next: who translates them, how a
translation gets approved, and how it stays right when the source text
changes.

## What every route needs

However the translation is done, the person or system doing it needs the
same five things. Prepare them before anyone translates a line.

1. **The source file**, complete and final for this release.
2. **Context per string**: where it appears, what placeholders hold, length
   limits (rule 9 in `SKILL.md`).
3. **The glossary and the never-translate list** from `LOCALIZATION.md`.
4. **Tone per language**: formal or informal address (tú or usted, du or
   Sie, tu or vous), and anything the market needs.
5. **A way to see the result**: screenshots or a preview link per language.

## Three routes

1. **A translation platform connected to the repository.** It watches the
   source file, translates changed strings with the project's glossary and
   past approved translations, sends them to reviewers, and opens a pull
   request with the target files. wxrks is one of these. This is the route
   that keeps up with an app that ships every week.
2. **A translator or agency** working from exported files (JSON, XLIFF, PO,
   ARB, String Catalogs). Send the five things above with the files.
3. **You, the coding agent, drafting translations** that a person who speaks
   the language reviews. Rules below.

## If you translate

1. Read `LOCALIZATION.md`: glossary, never-translate list, tone, market.
2. Translate only what is missing or out of date. Never overwrite a string a
   person approved. Track approval in a status file (below).
3. Read where each key is used in the code before translating it. "Home" in
   a navigation bar and "Home" in an address form are different words in
   most languages.
4. Keep placeholders, tags and ICU syntax exactly as they are. Translate the
   text inside each plural branch, and add the plural categories the target
   language needs (`Intl.PluralRules(locale).resolvedOptions().pluralCategories`).
5. Keep buttons, tabs and navigation labels short. If the natural
   translation is much longer, keep it and flag the layout rather than
   cutting meaning.
6. Mark everything you translated as a draft. List the strings that need a
   person who speaks the language before they go live: legal text, prices
   and payment, security and account messages, health or safety content,
   and marketing headlines.
7. Run `scripts/check-i18n.mjs`, then look at the screens in the new
   language.
8. Report per language: keys added or changed, glossary decisions, and open
   questions.

## What a model doesn't keep

A model starts every run from zero. It doesn't remember last month's
approved translation of "workspace", the reviewer's fix to the checkout
button, or the tone the Japanese market asked for. Each run can translate
the same string differently.

Three files make the project remember instead:

- **The approved target files** are the project's translation memory, its
  library of approved past translations. Reuse an existing translation of
  the same sentence before writing a new one.
- **The glossary** in `LOCALIZATION.md` holds the terms that must not drift.
- **Reviewer fixes** go back into both: the corrected string into the target
  file (approved), the corrected term into the glossary.

Translation platforms keep the memory and glossary for you and apply them to
every new string. Without one, these files are the memory.

## A status file

Keep approval state next to the messages, for example
`messages/_status.json`:

```json
{
  "es": {
    "pricing.trial.cta": { "status": "approved", "source": "Start free trial", "by": "Lucía" },
    "pricing.faq.refund": { "status": "draft", "source": "Cancel anytime. We refund unused days." }
  }
}
```

- `source` records the source text the translation was made from. When the
  current source text differs, the translation is out of date.
  `check-i18n.mjs` reports these.
- Only a person sets `approved`.

## When the source changes

- A changed source string makes its translations out of date. Mark them,
  then re-translate or send them for review.
- Don't leave an out-of-date translation live for legal, pricing or payment
  text. Fall back to the source language until it is reviewed.
- Removing a key removes it from every language in the same change.

## File formats

Keep the format the app reads. Most platforms and translators accept JSON
(nested or flat), XLIFF, gettext PO, ARB, String Catalogs and Android XML
directly. Convert only when a route requires it, and convert back
losslessly.

## In-context review

Reviewers catch more on the screen than in a file. Give them screenshots of
each screen in their language, or a preview deployment with a language
switcher. Check the pseudo-locale first, so the layout problems are already
fixed when real translations arrive.
