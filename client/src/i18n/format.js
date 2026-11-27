// Numbers, prices, dates, lists and language names in the active language, always through Intl
// (LOCALIZATION.md). Formatters are cached per language.
import i18n, { localeInfo } from "./index";

const active = () => i18n.resolvedLanguage || i18n.language || "en";
const cache = new Map();
function cached(kind, options, make) {
  const key = `${active()}|${kind}|${JSON.stringify(options)}`;
  if (!cache.has(key)) cache.set(key, make(active(), options));
  return cache.get(key);
}

export const formatNumber = (n) => cached("number", {}, (l) => new Intl.NumberFormat(l)).format(Number(n) || 0);

// Prices are in US dollars in every language (the packs are sold in USD). Whole amounts without
// cents ("$9", "9 $US") unless asked, others with two decimals ("$0.90").
// In a right-to-left page the symbol Intl writes for Arabic, "US$", would split: "$" is neutral,
// so the bidi algorithm carries it to the far side of the number ("$US 9"). Wrapped in a
// left-to-right isolate it stays one symbol ("US$ 9", read from the right: 9, then US$).
export function formatMoney(amount, { currency = "USD", cents = !Number.isInteger(amount) } = {}) {
  const digits = cents ? 2 : 0;
  const options = { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits };
  const format = cached("money", options, (l, o) => new Intl.NumberFormat(l, o));
  if (localeInfo(active()).dir !== "rtl") return format.format(amount);
  return format
    .formatToParts(amount)
    .map((p) => (p.type === "currency" ? `⁦${p.value}⁩` : p.value))
    .join("");
}

export const formatPercent = (fraction) =>
  cached("percent", { style: "percent", maximumFractionDigits: 0 }, (l, o) => new Intl.NumberFormat(l, o)).format(fraction);

// "1.4 MB", "1,4 Mo", "312 KB": file sizes with the language's own unit names.
export function formatFileSize(bytes) {
  const mb = bytes >= 1024 * 1024;
  const value = mb ? Math.round((bytes / 1024 / 1024) * 10) / 10 : Math.max(1, Math.round(bytes / 1024));
  const options = { style: "unit", unit: mb ? "megabyte" : "kilobyte", maximumFractionDigits: 1 };
  return cached("size", options, (l, o) => new Intl.NumberFormat(l, o)).format(value);
}

// "French, German and Italian", "French, German e Italian"...
export const formatList = (items) => cached("list", { type: "conjunction" }, (l, o) => new Intl.ListFormat(l, o)).format(items);

export const formatShortDate = (iso) =>
  cached("date", { month: "short", day: "numeric" }, (l, o) => new Intl.DateTimeFormat(l, o)).format(new Date(iso));

// wxrks spells locales its own way (pt_br, en_us, zh_cn). As a BCP 47 tag for Intl, or null.
function toTag(code) {
  try {
    return Intl.getCanonicalLocales(String(code || "").replace(/_/g, "-"))[0] || null;
  } catch {
    return null;
  }
}

// A wxrks language in the reader's language: "portugués (Brasil)" in Spanish. English keeps the
// names the wxrks catalog gives ("Portuguese (Brazil)"); a code Intl doesn't know keeps its
// catalog name too. This form is for use inside a sentence.
export function languageName(code, catalogName) {
  const locale = active();
  if (locale === "en" || locale === "en-XA") return catalogName || code;
  const tag = toTag(code);
  if (!tag) return catalogName || code;
  const names = cached("names", { type: "language", languageDisplay: "standard", fallback: "none" }, (l, o) => new Intl.DisplayNames(l, o));
  return names.of(tag) || catalogName || code;
}

// The same name standing alone (a list item, a chip, a tab): first letter capitalized, the way
// CLDR writes language names in menus ("Portugués (Brasil)"). Scripts without case are unchanged.
export function languageLabel(code, catalogName) {
  const name = languageName(code, catalogName);
  const [first] = new Intl.Segmenter(active(), { granularity: "grapheme" }).segment(name);
  return first ? first.segment.toLocaleUpperCase(active()) + name.slice(first.segment.length) : name;
}

// Text a person wrote (a file name, an email address) inside a right-to-left sentence keeps its
// own direction: wrapped in first-strong isolates, the plain-text form of <bdi>.
export const isolate = (text) => (localeInfo(active()).dir === "rtl" ? `⁨${text}⁩` : String(text));

// The sort order of the reader's language.
export const compareText = (a, b) => cached("collator", {}, (l) => new Intl.Collator(l)).compare(a, b);
