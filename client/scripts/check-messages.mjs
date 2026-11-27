#!/usr/bin/env node
// npm run i18n:check — the messages and the code agree (LOCALIZATION.md):
//   1. every key the code uses exists in src/locales/en.json, and every English key is used;
//   2. every message in every language parses as ICU MessageFormat, as the app parses it
//      (i18next-icu: tags left to <Trans>), and formats with sample values in its own language;
//   3. a translation uses the same placeholders and tags as its English message.
// The skill's check-i18n.mjs covers the rest (plural categories, missing keys, out-of-date text).
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { IntlMessageFormat } from "intl-messageformat";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const dir = join(src, "locales");
const problems = [];

const flatten = (obj, prefix = "", out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") flatten(v, `${prefix}${k}.`, out);
    else out[`${prefix}${k}`] = v;
  }
  return out;
};
const en = flatten(JSON.parse(readFileSync(join(dir, "en.json"), "utf8")));

// Keys built at runtime from a list (the code says where): seo.<page>.title, tone.preset.<key>...
const DYNAMIC = [
  /^seo\.(home|pdf|documents)\.(title|heading)$/,
  /^seo\.[a-z]+\.(description|intro)$/, // read by server/seo.js
  /^upload\.landing\.(home|pdf|documents)$/,
  /^platform\.(memory|glossary|history)\.(label|title|note)$/,
  /^tone\.preset\.[a-z]+\.(label|hint)$/,
  /^account\.kind\.[a-z]+$/,
  /^jobs\.status\.[a-z_A-Z]+$/,
  /^job\.score\.part\.[a-z]+$/,
  /^errors\.[a-z_]+$/,
  /^suggest\.(dismiss)$/, // always read in English (i18n/routing.jsx)
];

// 1. Keys in the code.
const used = new Set();
const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.(jsx?|mjs)$/.test(e.name) ? [join(d, e.name)] : []));
for (const file of walk(src)) {
  const code = readFileSync(file, "utf8");
  for (const m of code.matchAll(/(?:\bt|i18n\.t|\btr)\(\s*["'`]([a-zA-Z][\w.]*)["'`]/g)) used.add(m[1]);
  for (const m of code.matchAll(/i18nKey=["']([\w.]+)["']/g)) used.add(m[1]);
  // Keys kept in a constant or in state ("job.variant.design", { key: "login.expired" }).
  for (const m of code.matchAll(/["']((?:job|progress|errors|offer|login)\.[a-zA-Z_]+(?:\.[a-zA-Z_]+)*)["']/g)) used.add(m[1]);
}
for (const key of used) if (!(key in en) && !DYNAMIC.some((re) => re.test(key))) problems.push(`code uses "${key}", which en.json doesn't have`);
for (const key of Object.keys(en)) if (!used.has(key) && !DYNAMIC.some((re) => re.test(key))) problems.push(`en.json has "${key}", which the code doesn't use`);

// 2 and 3. Every message, every language.
const sample = new Proxy({}, { get: (_, name) => (typeof name === "string" ? sampleValue(name) : undefined), has: () => true });
function sampleValue(name) {
  if (/^(range)$/.test(name)) return "span";
  if (/^(span|hasTotal|hasTone|hasPages|fits|restPack|alsoFree|toGo|known|partners|several|note)$/.test(name)) return "yes";
  if (/^(when)$/.test(name)) return "other";
  if (/^(offer|account)$/.test(name)) return "other";
  return 2;
}
const argNames = (msg) => {
  const names = new Set();
  const visit = (els) => {
    for (const el of els) {
      if (el.value && typeof el.value === "string" && el.type !== 0) names.add(el.value);
      if (el.options) for (const o of Object.values(el.options)) visit(o.value);
      if (el.children) visit(el.children);
    }
  };
  visit(new IntlMessageFormat(msg, "en", undefined, { ignoreTag: true }).getAst());
  return names;
};
const tags = (msg) => new Set([...msg.matchAll(/<\/?([a-z]+)\/?>/g)].map((m) => m[1]));

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_"))) {
  const locale = file.replace(/\.json$/, "");
  const messages = flatten(JSON.parse(readFileSync(join(dir, file), "utf8")));
  for (const [key, msg] of Object.entries(messages)) {
    if (!(key in en)) continue; // extra keys: check-i18n.mjs reports them
    try {
      const fmt = new IntlMessageFormat(msg, locale, undefined, { ignoreTag: true });
      fmt.format(sample);
      if (locale !== "en") {
        const want = argNames(en[key]);
        const have = argNames(msg);
        const lost = [...want].filter((n) => !have.has(n));
        const extra = [...have].filter((n) => !want.has(n));
        if (lost.length || extra.length) problems.push(`${locale} ${key}: placeholders ${lost.length ? `missing {${lost.join("}, {")}}` : ""}${extra.length ? ` unknown {${extra.join("}, {")}}` : ""}`);
        const tw = tags(en[key]);
        const th = tags(msg);
        if ([...tw].some((x) => !th.has(x)) || [...th].some((x) => !tw.has(x))) problems.push(`${locale} ${key}: tags differ from English (${[...tw].join(", ") || "none"})`);
      }
    } catch (err) {
      problems.push(`${locale} ${key}: ${err.message}`);
    }
  }
}

if (problems.length) {
  console.error(`i18n:check found ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`i18n:check: ${Object.keys(en).length} messages, ${used.size} keys in the code, every language parses.`);
