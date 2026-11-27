// One address per language: English at /pdf, the others under their own prefix (/es/pdf,
// /pt-br/pdf), so each language version can be found and shared (server/seo.js writes their
// hreflang). Links and navigation inside the app keep the current language.
import { forwardRef, useEffect, useState } from "react";
import { Link as RouterLink, useLocation, useNavigate as useRouterNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n, { DEFAULT_LOCALE, LOCALES, browserLocale, localeInfo, saveLocale, savedLocale } from "./index";

const byPath = new Map(LOCALES.filter((l) => l.path).map((l) => [l.path, l.code]));

// "/es/jobs/7" → { locale: "es", path: "/jobs/7" }; "/jobs/7" → { locale: "en", path: "/jobs/7" }.
export function splitLocale(pathname) {
  const [, first = "", ...rest] = pathname.split("/");
  const locale = byPath.get(first);
  return locale ? { locale, path: `/${rest.join("/")}` } : { locale: DEFAULT_LOCALE, path: pathname };
}

// "/jobs/7" in Spanish → "/es/jobs/7"; "/" → "/es/". Query strings ride along.
export function localizePath(path, locale) {
  const prefix = localeInfo(locale).path;
  return prefix && locale !== DEFAULT_LOCALE ? `/${prefix}${path}` : path;
}

export function useLocale() {
  return splitLocale(useLocation().pathname).locale;
}

// The page's path without its language prefix, for code that asks "which page is this?".
export function usePagePath() {
  return splitLocale(useLocation().pathname).path;
}

const withLocale = (to, locale) => (typeof to === "string" && to.startsWith("/") ? localizePath(to, locale) : to);

export const Link = forwardRef(function Link({ to, ...rest }, ref) {
  const locale = useLocale();
  return <RouterLink ref={ref} to={withLocale(to, locale)} {...rest} />;
});

export function useNavigate() {
  const navigate = useRouterNavigate();
  const locale = useLocale();
  return (to, options) => (typeof to === "number" ? navigate(to) : navigate(withLocale(to, locale), options));
}

// Before the first render: an address without a language prefix (a link in an email, Stripe's
// return) opens in the language the visitor chose before. Returns the language to start in.
export function startingLocale() {
  const { locale, path } = splitLocale(window.location.pathname);
  if (locale !== DEFAULT_LOCALE) return locale;
  const saved = savedLocale();
  if (!saved || saved === DEFAULT_LOCALE) return DEFAULT_LOCALE;
  const { search, hash } = window.location;
  window.history.replaceState(window.history.state, "", `${localizePath(path, saved)}${search}${hash}`);
  return saved;
}

// Keeps i18next on the language the address names, and remembers a language reached by its
// address (from search, or a shared link) so the email links that come back unprefixed open in it.
export function useLocaleSync() {
  const locale = useLocale();
  useEffect(() => {
    if (i18n.language !== locale) i18n.changeLanguage(locale);
    if (locale !== DEFAULT_LOCALE) saveLocale(locale);
  }, [locale]);
  return locale;
}

// The same page in every language, each in its own name and script. Plain links, so the form on
// the page keeps what was typed (the route stays mounted) and search engines can follow them.
export function LanguageSwitcher() {
  const { t } = useTranslation();
  const { pathname, search, hash } = useLocation();
  const { locale, path } = splitLocale(pathname);
  return (
    <nav aria-label={t("footer.languages")} className="mt-3">
      <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
        {LOCALES.map((l) => (
          <li key={l.code}>
            <RouterLink
              to={`${localizePath(path, l.code)}${search}${hash}`}
              lang={l.code}
              hrefLang={l.code}
              dir={l.dir}
              aria-current={l.code === locale ? "true" : undefined}
              onClick={() => saveLocale(l.code)}
              className={l.code === locale ? "font-medium text-brand-600 no-underline" : "underline hover:text-slate-600"}
            >
              {l.name}
            </RouterLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// On an English page, for a browser that prefers another language the app has and a visitor who
// hasn't chosen: one line in that language offering it. Choosing either way is remembered.
export function LanguageSuggestion() {
  const { pathname, search, hash } = useLocation();
  const { locale, path } = splitLocale(pathname);
  const [offer, setOffer] = useState(null);

  useEffect(() => {
    if (locale !== DEFAULT_LOCALE || savedLocale()) return;
    const wanted = browserLocale();
    // Offered only once that language's own messages exist, never as English fallback text.
    if (wanted) i18n.loadLanguages(wanted).then(() => i18n.getResource(wanted, "translation", "suggest.text") && setOffer(wanted));
  }, [locale]);

  if (!offer || locale !== DEFAULT_LOCALE) return null;
  const t = i18n.getFixedT(offer);
  const info = localeInfo(offer);
  return (
    <div className="mx-auto mt-4 max-w-6xl px-4" lang={offer} dir={info.dir}>
      <div className="wx-alert flex-wrap items-center" role="region" aria-label={t("suggest.label")}>
        <span className="min-w-0 flex-1">{t("suggest.text")}</span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <RouterLink
            to={`${localizePath(path, offer)}${search}${hash}`}
            onClick={() => saveLocale(offer)}
            className="wx-button wx-button--primary wx-button--compact no-underline"
          >
            {t("suggest.accept")}
          </RouterLink>
          <button
            type="button"
            lang="en"
            dir="ltr"
            className="text-xs underline"
            onClick={() => {
              saveLocale(DEFAULT_LOCALE);
              setOffer(null);
            }}
          >
            {i18n.getFixedT(DEFAULT_LOCALE)("suggest.dismiss")}
          </button>
        </span>
      </div>
    </div>
  );
}
