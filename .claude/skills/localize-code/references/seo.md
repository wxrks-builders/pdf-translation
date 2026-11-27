# URLs, hreflang and search

Search engines index URLs, not sessions. A page that serves Spanish or
English from the same address by cookie or browser setting shows one
language in search and hides the other. Google's guide to localized versions
is the reference: https://developers.google.com/search/docs/specialty/international/localized-versions

## URL structure

- Subdirectories (`example.com/es/pricing`) suit most apps: one domain, one
  deployment. Subdomains (`es.example.com`) and country domains
  (`example.es`) work too, at more cost.
- The default language can live at `/` (`localePrefix: 'as-needed'` in
  next-intl, `prefix_except_default` in Nuxt, `prefixDefaultLocale: false`
  in Astro).
- Translated slugs (`/es/precios`) are optional. Pick one rule and keep it.
- Avoid `?lang=es` parameters and cookie-only switching for public pages.

## On every page

- `<html lang="es">` with the page's language, plus `dir="rtl"` where it
  applies.
- Translated `<title>`, meta description, Open Graph title and description,
  `og:locale`, and `alt` text.
- A self-referencing canonical: the Spanish page's canonical is the Spanish
  URL. Pointing every language's canonical at the English page tells search
  engines to drop the translations.

## hreflang

Each page lists every language version of itself, including itself, plus an
`x-default` for visitors whose language you don't have.

```html
<link rel="alternate" hreflang="en" href="https://example.com/pricing" />
<link rel="alternate" hreflang="es" href="https://example.com/es/pricing" />
<link rel="alternate" hreflang="pt-BR" href="https://example.com/pt-br/pricing" />
<link rel="alternate" hreflang="x-default" href="https://example.com/pricing" />
```

- Absolute URLs.
- Return links: if the English page points to the Spanish page, the Spanish
  page points back. One-way annotations are ignored.
- Codes are a language (ISO 639-1), optionally plus a region (ISO 3166-1):
  `es`, `es-MX`, `pt-BR`. The United Kingdom is `en-GB`, not `en-UK`.
- Only list pages that exist and are translated. A link to a page that
  redirects or shows English text breaks the set.

Next.js metadata API:

```ts
export async function generateMetadata({ params }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pricing.meta' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical: locale === 'en' ? '/pricing' : `/${locale}/pricing`,
      languages: { en: '/pricing', es: '/es/pricing', 'pt-BR': '/pt-br/pricing', 'x-default': '/pricing' },
    },
  };
}
```

(Set `metadataBase` in the root layout so these become absolute URLs.)

Astro, Nuxt, SvelteKit and static sites: render the same `<link>` set in the
shared layout from the list of locales, or use the framework's i18n head
helper.

## Sitemaps

List each URL once with its alternates, or one sitemap per language. Either
way, every language version appears.

```xml
<url>
  <loc>https://example.com/es/pricing</loc>
  <xhtml:link rel="alternate" hreflang="en" href="https://example.com/pricing"/>
  <xhtml:link rel="alternate" hreflang="es" href="https://example.com/es/pricing"/>
  <xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/pricing"/>
</url>
```

## Redirects

- Don't force a redirect by browser language or IP on every request.
  Crawlers usually send no `Accept-Language` and crawl from one country, so
  forced redirects hide every other language from them.
- Do redirect on the first visit to `/` if you want, then respect the
  user's choice, or show a small banner suggesting their language.
- The language switcher links to the same page in the other language, not
  to that language's home page.

## Check before launch

- [ ] Every localized page returns 200 and has `lang`, translated title and description
- [ ] hreflang sets are complete, reciprocal and absolute, with `x-default`
- [ ] Canonicals are self-referencing per language
- [ ] The sitemap lists every language version
- [ ] No page mixes languages (a translated page with an English footer, English alt text, or English structured data)
