/**
 * Search-facing pages. The client is a single-page app, so without this every URL would ship the
 * same <title>; here each landing page gets its own title, description, canonical URL and a
 * server-rendered heading inside #root (React replaces it on mount). Also: robots.txt, the
 * sitemap, and the 301 from the platform hostname to the public one.
 */
const fs = require("fs");
const path = require("path");

const ORIGIN = (process.env.CANONICAL_ORIGIN || "https://translate.wxrks.com").replace(/\/$/, "");
// Hostnames that should send people (and Google) to ORIGIN instead.
const LEGACY_HOSTS = (process.env.LEGACY_HOSTS || "pdf-translation.agents.wxrks.app").split(",").map((h) => h.trim()).filter(Boolean);

// Keep in step with LANDING in client/src/pages/Upload.jsx (same headings, shown after mount).
const PAGES = {
  "/": {
    title: "Free Online Document Translator | wxrks",
    description:
      "Upload a PDF, Word, PowerPoint or Excel file and download it translated into 100+ languages. Free to try: one document a day, up to 1,000 words.",
    h1: "Translate a document",
    intro: "PDF, Word, PowerPoint, Excel and more, into 100+ languages.",
  },
  "/pdf": {
    title: "Free PDF Translator That Keeps Your Design | wxrks",
    description:
      "Translate a PDF into 100+ languages. Get an editable Word file and a PDF that keeps the original layout, fonts and images. Free to try, one PDF a day.",
    h1: "Translate a PDF and keep its design",
    intro: "Get an editable Word file and a PDF that looks like your original.",
  },
  "/documents": {
    title: "Document Translator for Word, PowerPoint & Excel | wxrks",
    description:
      "Translate Word, PowerPoint, Excel, PDF, CSV and text files into 100+ languages. Download the translated file in the same format. Free to try, one a day.",
    h1: "Translate Word, PowerPoint, Excel and more",
    intro: "Download your file translated, in the same format you uploaded.",
  },
};

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let template = null;
function render(clientDist, pagePath) {
  if (!template) template = fs.readFileSync(path.join(clientDist, "index.html"), "utf8");
  const page = PAGES[pagePath] || PAGES["/"];
  const url = `${ORIGIN}${pagePath === "/" || !PAGES[pagePath] ? "/" : pagePath}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "wxrks Document Translator",
    url,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Any",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@type": "Organization", name: "wxrks", url: "https://wxrks.com" },
  };
  const head = [
    `<title>${escape(page.title)}</title>`,
    `<meta name="description" content="${escape(page.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escape(page.title)}" />`,
    `<meta property="og:description" content="${escape(page.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
  ].join("\n    ");
  return template
    .replace(/<title>[^<]*<\/title>/, head)
    .replace('<div id="root"></div>', `<div id="root"><h1>${escape(page.h1)}</h1><p>${escape(page.intro)}</p></div>`);
}

function legacyRedirect(req, res, next) {
  if ((req.method === "GET" || req.method === "HEAD") && LEGACY_HOSTS.includes(req.hostname) && !req.path.startsWith("/api/")) {
    return res.redirect(301, `${ORIGIN}${req.originalUrl}`);
  }
  next();
}

function robots(req, res) {
  res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /jobs\nDisallow: /account\nDisallow: /login\nDisallow: /admin\nDisallow: /feedback\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
}

function sitemap(req, res) {
  const urls = Object.keys(PAGES).map((p) => `  <url><loc>${ORIGIN}${p}</loc></url>`).join("\n");
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
}

module.exports = { PAGES, render, legacyRedirect, robots, sitemap };
