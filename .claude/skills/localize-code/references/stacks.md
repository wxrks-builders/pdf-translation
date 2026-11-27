# Setting up i18n by stack

If the project already has an i18n library, use it. Otherwise pick the one
listed for its stack. These notes say what to set up and what to watch for.
The libraries change file names and APIs between major versions, so read
the current docs for the installed version before writing setup code.

Wherever the stack lives, the shape is the same:

- One message file per language, the source language edited by hand
- A locale resolved per request or per session, with a fallback chain
- `lang` and `dir` set from that locale
- A switcher that keeps the user on the same page
- `Intl` (or the platform's formatters) for every date, number and price

## Next.js (App Router): next-intl

- Files: `messages/{locale}.json`, `i18n/routing.ts` (`defineRouting` with
  `locales` and `defaultLocale`), `i18n/request.ts` (`getRequestConfig`
  loads the messages), `i18n/navigation.ts` (`createNavigation` gives a
  locale-aware `Link`, `redirect`, `useRouter`), and the middleware that
  resolves the locale. Next.js 16 renamed `middleware.ts` to `proxy.ts`;
  next-intl supports both.
- Wrap `next.config` with `createNextIntlPlugin()`.
- Pages live under `app/[locale]/`. The `[locale]/layout.tsx` sets
  `<html lang={locale} dir={dir(locale)}>` and wraps children in
  `NextIntlClientProvider`.
- Server components: `getTranslations`. Client components: `useTranslations`.
  Rich text: `t.rich`. Formatting: `useFormatter` or `Intl`.
- Static rendering: `generateStaticParams` returns the locales and each page
  calls `setRequestLocale(locale)`.
- Metadata: translate `title` and `description` in `generateMetadata` and
  add `alternates.languages` for hreflang (see `seo.md`).
- Routing choice: `localePrefix: 'as-needed'` keeps the default language at
  `/` and the others under `/es`, `/de`.

## React + Vite (and most Lovable and Bolt apps): react-i18next

- Install `i18next`, `react-i18next`, `i18next-browser-languagedetector`.
- `src/i18n.ts` initializes with `fallbackLng`, `supportedLngs`, and
  `interpolation: { escapeValue: false }` (React already escapes). Import it
  once in `main.tsx`.
- Messages in `src/locales/{lng}/{namespace}.json`. Load languages on demand
  (`i18next-resources-to-backend` with dynamic imports) instead of bundling
  every language into the first page load.
- Syntax: `{{name}}` placeholders and plural keys with suffixes
  (`key_one`, `key_other`, plus `key_few`, `key_many` where a language needs
  them). Add `i18next-icu` if you want ICU syntax instead. Pick one and
  record it in `LOCALIZATION.md`.
- `useTranslation()` for `t`, `<Trans>` for rich text.
- On `languageChanged`, set `document.documentElement.lang` and `dir`
  (`i18n.dir(lng)` returns `rtl` or `ltr`).
- A single-page app serves every language from the same URL unless you add
  locale routes (`/es/...` in React Router). For pages that must rank in
  search, add locale routes and prerender them.

## Vue and Nuxt: vue-i18n, @nuxtjs/i18n

- Vue: `vue-i18n` with the Composition API (`useI18n()` returns `t`, `d`,
  `n` for text, dates and numbers).
- Nuxt: `@nuxtjs/i18n` with `strategy: 'prefix_except_default'`, lazy-loaded
  locale files, and the module's head helper (`useLocaleHead`) to set
  `lang`, `dir` and hreflang links.
- vue-i18n's pipe plurals (`"invoice | invoices"`) follow English rules.
  Add `pluralRules` for Russian, Polish, Arabic and any language with more
  forms.

## SvelteKit: Paraglide JS

- `npx sv add paraglide` sets it up. Messages in `messages/{locale}.json`,
  compiled to typed functions: `m.invoice_sent({ client })`.
- Choose the locale strategy (URL prefix, cookie, base locale) in its config
  and use its helpers to localize links.

## Astro: built-in i18n routing

- `astro.config.mjs`: `i18n: { locales, defaultLocale, routing: { prefixDefaultLocale: false } }`.
- Localized pages in `src/pages/{locale}/`, or one dynamic route with
  `getStaticPaths`. Content collections can hold one folder per locale.
- UI strings in a small dictionary module with a `useTranslations(lang)`
  helper, or Paraglide for larger sites.
- `getRelativeLocaleUrl(locale, path)` from `astro:i18n` builds links.

## Expo and React Native

- `expo-localization` reads the device settings: `getLocales()` returns the
  user's languages in order, with `languageTag`, `textDirection` and
  `currencyCode`.
- Pair it with `i18next` and `react-i18next` (or Lingui). Add the
  `@formatjs/intl-pluralrules` polyfill if plurals all fall back to `other`.
- Right-to-left: enable it with the `supportsRTL` setting described in the
  Expo localization guide. `I18nManager.isRTL` tells you the direction, and
  changing direction needs an app reload.
- Styles: `marginStart`, `marginEnd`, `paddingStart`, `paddingEnd`,
  `start`, `end` instead of left and right.
- Native strings (app name, permission prompts) are localized through the
  `locales` field in the app config, one JSON file per language.
- App store listings and screenshots are separate per language.

## Flutter

- `flutter_localizations` plus `intl`, `generate: true` in `pubspec.yaml`,
  and an `l10n.yaml` pointing at `lib/l10n/app_en.arb`.
- ARB files carry ICU messages and a `@key` entry per message with a
  `description` and typed `placeholders`. Fill the description: it is the
  translator's context.
- `AppLocalizations.of(context)!.invoiceSent(client)` in widgets.
- Direction-aware layout: `EdgeInsetsDirectional`, `AlignmentDirectional`,
  `TextAlign.start`.

## iOS (SwiftUI)

- String Catalogs (`Localizable.xcstrings`). SwiftUI `Text("…")` literals and
  `String(localized:comment:)` are extracted at build time. Fill `comment`.
- Plurals: "Vary by Plural" in the catalog.
- Formatting: `FormatStyle` (`price.formatted(.currency(code: "USD"))`,
  `date.formatted(date: .abbreviated, time: .shortened)`).
- Use leading and trailing, not left and right. Preview with
  `.environment(\.layoutDirection, .rightToLeft)` and
  `.environment(\.locale, Locale(identifier: "ar"))`.

## Android

- `res/values/strings.xml` plus `res/values-es/`, `res/values-pt-rBR/` and
  so on. Plurals in `<plurals>` with `quantity` one, few, many, other.
- Compose: `stringResource`, `pluralStringResource`.
- `android:supportsRtl="true"` in the manifest. `start` and `end`
  attributes (`paddingStart`, `layout_marginEnd`).
- Per-app language (Android 13+): `locales_config.xml` and
  `AppCompatDelegate.setApplicationLocales`.
- `translatable="false"` for strings that never change, like the brand name.

## Django

- `gettext` and `gettext_lazy` as `_`, `{% translate %}` and
  `{% blocktranslate count counter=n %}` in templates.
- `makemessages -l es`, then `compilemessages`. Translator notes go in
  comments starting with `Translators:`.
- `LocaleMiddleware` and `i18n_patterns` for language prefixes in URLs.

## Rails

- `config/locales/{locale}.yml`, `t('.title')` lazy lookup in views,
  `l(date, format: :long)` for dates.
- The `rails-i18n` gem adds date and number formats for most locales.
  `i18n-tasks` finds missing and unused keys.
- Set the locale per request with `around_action` from the URL or the
  user's profile.

## Laravel

- `lang/{locale}.json` or `lang/{locale}/*.php`, `__('messages.welcome', ['name' => $name])`.
- Plurals with `trans_choice` and its `{0} …|{1} …|[2,*] …` syntax, which
  covers languages with more forms through ranges.
- `php artisan lang:publish` adds the framework's own strings.

## Database content (Supabase, Postgres, any SQL)

Interface strings live in message files. Content the app manages (products,
articles, help pages, plan names) lives in the database and needs its own
translation model.

- A translations table beats one column per language:
  `content_translations (entity_type, entity_id, locale, field, value, status, updated_at)`
  with a unique key on `(entity_type, entity_id, locale, field)`. Adding a
  language is rows, not a migration, and each translation keeps its own
  status. A JSONB column keyed by locale works for small, fixed sets.
- Never add `title_en`, `title_es` columns.
- Slugs are per locale when URLs are translated.
- Full-text search uses a language configuration per locale
  (`to_tsvector('spanish', …)`).
- Sort by language with ICU collations where the database supports them
  (`COLLATE "de-x-icu"` in Postgres built with ICU).
- Store each user's `locale` and `time_zone` on their profile. Server code
  that sends email, push notifications or PDFs reads them from there, not
  from the server.
- User-generated content stays in the language it was written in. If you
  show it inside a page in another language, mark it with `lang` (when
  known) and `dir="auto"`.

## Email and notifications

- Subject lines, preview text and push titles are messages too.
- Render each email in the recipient's saved locale and time zone.
- Keep one template per email with messages, not one template per language.
