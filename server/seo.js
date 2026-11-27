/**
 * Search-facing pages. The client is a single-page app, so without this every URL would ship the
 * same <title>; here each landing page gets its own title, description, canonical URL and a
 * server-rendered heading inside #root (React replaces it on mount). Also: robots.txt, the
 * sitemap, and the 301 from the platform hostname to the public one.
 *
 * Every landing page exists once per language (LOCALIZATION.md): /pdf in English, /es/pdf in
 * Spanish... Each is rendered in its language (<html lang dir>, the `seo` messages of
 * client/src/locales/<locale>.json, the same files the app reads) and lists its public language
 * versions with hreflang, English as x-default ("public" in _languages.json: the review gate).
 */
const fs = require("fs");
const path = require("path");

const ORIGIN = (process.env.CANONICAL_ORIGIN || "https://translate.wxrks.com").replace(/\/$/, "");
// Hostnames that should send people (and Google) to ORIGIN instead.
const LEGACY_HOSTS = (process.env.LEGACY_HOSTS || "pdf-translation.agents.wxrks.app").split(",").map((h) => h.trim()).filter(Boolean);

// The languages and their messages, shared with the client (the Dockerfile copies this folder).
const LOCALES_DIR = path.join(__dirname, "..", "client", "src", "locales");
const config = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, "_languages.json"), "utf8"));
const DEFAULT = config.languages.find((l) => l.code === config.default);
const byPrefix = new Map(config.languages.filter((l) => l.path).map((l) => [l.path, l]));

// The review gate (LOCALIZATION.md, Review): only the languages in "public" get hreflang and
// sitemap entries. The others still render in their language for reviewers who open them by
// address (/es/pdf), marked noindex so search engines leave them alone until they go public.
const PUBLIC = new Set([config.default, ...(config.public || [])]);
const isPublic = (lang) => PUBLIC.has(lang.code);

// Landing page paths (without a language prefix) → their messages: seo.<key>.title, .description,
// .heading (the same heading the app shows, client/src/pages/Upload.jsx) and .intro.
const PAGES = { "/": "home", "/pdf": "pdf", "/documents": "documents" };

const seoCache = new Map();
function seoMessages(code) {
  if (!seoCache.has(code)) {
    try {
      seoCache.set(code, JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8")).seo || {});
    } catch {
      seoCache.set(code, {});
    }
  }
  return seoCache.get(code);
}
// A language has a page once its title and heading are translated; until then the page isn't
// offered in it (no hreflang, no sitemap entry) and its address shows the English text.
const translated = (lang, key) => lang === DEFAULT || Boolean(seoMessages(lang.code)[key]?.title && seoMessages(lang.code)[key]?.heading);
const text = (lang, key, field) => seoMessages(lang.code)[key]?.[field] || seoMessages(DEFAULT.code)[key][field];

// "/es/pdf" → { lang: Spanish, page: "/pdf" }; "/pdf" → { lang: English, page: "/pdf" }.
function splitLocale(pagePath) {
  const [, first = "", ...rest] = pagePath.split("/");
  const lang = byPrefix.get(first);
  return lang ? { lang, page: `/${rest.join("/")}` } : { lang: DEFAULT, page: pagePath };
}
const localize = (page, lang) => (lang.path ? `/${lang.path}${page}` : page);
const absolute = (page, lang) => `${ORIGIN}${localize(page, lang)}`;

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let template = null;
function render(clientDist, pagePath) {
  if (!template) template = fs.readFileSync(path.join(clientDist, "index.html"), "utf8");
  const split = splitLocale(pagePath);
  const landing = PAGES[split.page];
  const key = landing || "home";
  // Shown in its language once translated; any other page of the app gets its language's home head.
  const lang = translated(split.lang, key) ? split.lang : DEFAULT;
  const page = landing ? split.page : "/";
  const url = absolute(page, lang);
  const t = (field) => text(lang, key, field);
  // A page offered in one language only needs no alternates.
  const offered = landing ? config.languages.filter((l) => isPublic(l) && translated(l, key)) : [];
  const versions = offered.length > 1 ? offered : [];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "wxrks Document Translator",
    url,
    inLanguage: lang.code,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Any",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@type": "Organization", name: "wxrks", url: "https://wxrks.com" },
  };
  const head = [
    `<title>${escape(t("title"))}</title>`,
    `<meta name="description" content="${escape(t("description"))}" />`,
    `<link rel="canonical" href="${url}" />`,
    ...(isPublic(lang) ? [] : [`<meta name="robots" content="noindex" />`]),
    ...versions.map((l) => `<link rel="alternate" hreflang="${l.code}" href="${absolute(page, l)}" />`),
    ...(versions.length ? [`<link rel="alternate" hreflang="x-default" href="${absolute(page, DEFAULT)}" />`] : []),
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escape(t("title"))}" />`,
    `<meta property="og:description" content="${escape(t("description"))}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:locale" content="${lang.ogLocale}" />`,
    ...versions.filter((l) => l !== lang).map((l) => `<meta property="og:locale:alternate" content="${l.ogLocale}" />`),
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
  ].join("\n    ");
  return template
    .replace(/<html lang="[^"]*">/, `<html lang="${lang.code}" dir="${lang.dir}">`)
    .replace(/<title>[^<]*<\/title>/, head)
    .replace('<div id="root"></div>', `<div id="root"><h1>${escape(t("heading"))}</h1><p>${escape(t("intro"))}</p></div>`);
}

function legacyRedirect(req, res, next) {
  if ((req.method === "GET" || req.method === "HEAD") && LEGACY_HOSTS.includes(req.hostname) && !req.path.startsWith("/api/")) {
    return res.redirect(301, `${ORIGIN}${req.originalUrl}`);
  }
  next();
}

// The private pages stay out of search in every language.
const PRIVATE = ["/jobs", "/account", "/login", "/admin", "/feedback"];

function robots(req, res) {
  const disallow = config.languages.flatMap((l) => PRIVATE.map((p) => `Disallow: ${localize(p, l)}`));
  res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /api/\n${disallow.join("\n")}\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
}

// Every public language version of every landing page, each with all its alternates.
function sitemap(req, res) {
  const urls = Object.entries(PAGES).flatMap(([page, key]) => {
    const versions = config.languages.filter((l) => isPublic(l) && translated(l, key));
    if (versions.length < 2) return versions.map((l) => `  <url>\n    <loc>${absolute(page, l)}</loc>\n  </url>`);
    const alternates = [
      ...versions.map((a) => `    <xhtml:link rel="alternate" hreflang="${a.code}" href="${absolute(page, a)}"/>`),
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${absolute(page, DEFAULT)}"/>`,
    ].join("\n");
    return versions.map((l) => `  <url>\n    <loc>${absolute(page, l)}</loc>\n${alternates}\n  </url>`);
  });
  res
    .type("application/xml")
    .send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`
    );
}

module.exports = { PAGES, render, legacyRedirect, robots, sitemap };
