// The interface's languages (LOCALIZATION.md). Messages are ICU MessageFormat in
// src/locales/{locale}.json; English ships in the main bundle and is the fallback for any key a
// language doesn't have yet, every other language loads on demand. The server reads the same
// files for the landing pages' titles and headings (server/seo.js).
import i18n from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import config from "../locales/_languages.json";
import en from "../locales/en.json";

const bundles = import.meta.glob(["../locales/*.json", "!../locales/_*.json", "!../locales/en.json"]);

// The pseudo-locale (npm run i18n:pseudo) finds hardcoded text and layouts that don't grow. It
// exists in development and in a build made with --mode pseudo (a preview for reviewers), never
// in a production build.
const PSEUDO_ON = import.meta.env.DEV || import.meta.env.MODE === "pseudo";
const PSEUDO = PSEUDO_ON && bundles["../locales/en-XA.json"] ? [{ code: "en-XA", path: "en-xa", name: "Ƥşḗŭḓǿ (en-XA)", dir: "ltr" }] : [];

export const DEFAULT_LOCALE = config.default;
export const LOCALES = [...config.languages, ...PSEUDO];
const CODES = LOCALES.map((l) => l.code);

export const isLocale = (code) => CODES.includes(code);
export const localeInfo = (code) => LOCALES.find((l) => l.code === code) || LOCALES[0];

// Missing keys fall back to English; in development they are listed once per language.
function reportMissing(locale, messages) {
  const flat = (obj, prefix = "") =>
    Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  const have = new Set(flat(messages));
  const missing = flat(en).filter((k) => !have.has(k));
  if (missing.length) console.warn(`[i18n] ${locale} has ${missing.length} keys in English only:`, missing);
}

const lazyBundles = {
  type: "backend",
  init() {},
  read(locale, ns, done) {
    const load = bundles[`../locales/${locale}.json`];
    if (!load) return done(null, {});
    load().then(
      (m) => {
        if (PSEUDO_ON) reportMissing(locale, m.default);
        done(null, m.default);
      },
      (err) => done(err, null)
    );
  },
};

i18n.on("languageChanged", (locale) => {
  document.documentElement.lang = locale;
  document.documentElement.dir = localeInfo(locale).dir;
});

export function initI18n(locale) {
  return i18n
    .use(ICU)
    .use(lazyBundles)
    .use(initReactI18next)
    .init({
      lng: locale,
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: CODES,
      load: "currentOnly",
      resources: { [DEFAULT_LOCALE]: { translation: en } },
      partialBundledLanguages: true,
      returnEmptyString: false,
      interpolation: { escapeValue: false }, // React escapes
      react: { useSuspense: true },
    });
}

// The visitor's choice, remembered for a year. A cookie rather than local storage so the server
// can read it too (LOCALIZATION.md: emails are the next step).
const COOKIE = "wx_locale";

export function savedLocale() {
  try {
    const hit = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE}=`));
    const code = hit ? decodeURIComponent(hit.slice(COOKIE.length + 1)) : null;
    return code && isLocale(code) ? code : null;
  } catch {
    return null;
  }
}

export function saveLocale(code) {
  try {
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${COOKIE}=${encodeURIComponent(code)}; path=/; max-age=31536000; samesite=lax${secure}`;
  } catch {
    // cookies blocked: the choice lasts as long as the address has the language in it
  }
}

// The first language in the browser's list that the app has, or null when that is English or
// none: what the suggestion offers (never a redirect). Traditional Chinese readers aren't offered
// Simplified Chinese.
export function browserLocale() {
  const wanted = (navigator.languages?.length ? navigator.languages : [navigator.language]).filter(Boolean);
  for (const tag of wanted) {
    const lower = tag.toLowerCase();
    const exact = LOCALES.find((l) => l.code.toLowerCase() === lower);
    if (exact) return exact.code === DEFAULT_LOCALE ? null : exact.code;
    const base = lower.split("-")[0];
    if (base === "zh" && /-(tw|hk|mo|hant)/.test(lower)) continue;
    const near = config.languages.find((l) => l.code.toLowerCase().split("-")[0] === base);
    if (near) return near.code === DEFAULT_LOCALE ? null : near.code;
  }
  return null;
}

// A server error as a sentence in the visitor's language. The API answers with stable codes
// (server/routes/*.js); their English `message` is never shown.
export function errorText(err) {
  const code = err?.code;
  if (code && i18n.exists(`errors.${code}`)) return i18n.t(`errors.${code}`, err.data || {});
  return i18n.t("errors.generic");
}

export default i18n;
