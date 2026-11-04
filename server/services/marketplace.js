/**
 * Translators to suggest once a file is delivered, so a person can check it: the wxrks
 * marketplace's own directory for the target language (marketplace.wxrks.com/?lang=portuguese).
 * Paid listings only, Premium Partners first and then Pro, each group shuffled per call, up to
 * three. The directory is read as HTML, so a change to its markup only empties the list, and the
 * delivered page then links to the marketplace instead. Cached per language for a few minutes.
 */
const axios = require("axios");

const BASE = (process.env.MARKETPLACE_URL || "https://marketplace.wxrks.com").replace(/\/$/, "");
const TTL_MS = 10 * 60 * 1000;
const PAID = ["Premium Partner", "Pro"];
const cache = new Map();

// "Portuguese (Brazil)" → "portuguese": the directory's ?lang= key (lib/marketplace-languages.ts there).
function keyOf(languageName) {
  const base = String(languageName || "").replace(/\s*\(.*\)\s*$/, "").trim();
  return base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const text = (html) =>
  String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

// One directory card → { name, slug, badge, place, logo } or null.
function parseCard(li) {
  const slug = /href="\.\/([a-z0-9-]+)"/.exec(li)?.[1];
  const name = /<a class="text-\[19px\][^"]*" href="[^"]*">([\s\S]*?)<\/a>/.exec(li)?.[1];
  if (!slug || !name) return null;
  const badge = [...li.matchAll(/<span class="inline-flex items-center[^"]* h-6 px-2 rounded-full[^"]*">([\s\S]*?)<\/span>/g)]
    .map((m) => text(m[1]))
    .find((b) => PAID.includes(b));
  const place = /lucide-map-pin[\s\S]*?<\/svg>([^<]+)<\/span>/.exec(li)?.[1];
  const logo = /<img src="(\/uploads\/[^"]+)"/.exec(li)?.[1];
  return { name: text(name), slug, badge: badge || null, place: place ? text(place) : null, logo: logo ? `${BASE}${logo}` : null };
}

function parse(html) {
  const cards = String(html).match(/<li class="bg-surface border[^"]*"[^>]*>[\s\S]*?<\/li>/g) || [];
  return cards.map(parseCard).filter(Boolean);
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function listingsFor(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.list;
  try {
    const res = await axios.get(`${BASE}/?lang=${encodeURIComponent(key)}`, { timeout: 8000, responseType: "text" });
    const list = parse(res.data);
    cache.set(key, { at: Date.now(), list });
    return list;
  } catch (err) {
    console.warn(`[marketplace] ${key}: ${err.message}`);
    cache.set(key, { at: Date.now() - TTL_MS + 60000, list: [] }); // try again in a minute
    return [];
  }
}

// → { language, url (the directory for it), partners: [{ name, badge, place, logo, url }] }
async function reviewersFor(languageName, { limit = 3, utm = "" } = {}) {
  const key = keyOf(languageName);
  const directory = `${BASE}/${key ? `?lang=${encodeURIComponent(key)}` : ""}`;
  if (!key) return { language: languageName, url: directory, partners: [] };
  const all = await listingsFor(key);
  const ordered = PAID.flatMap((badge) => shuffle(all.filter((p) => p.badge === badge)));
  const partners = ordered.slice(0, limit).map(({ slug, ...p }) => ({ ...p, url: `${BASE}/${slug}${utm}` }));
  return { language: languageName, url: `${directory}${utm ? `${key ? "&" : "?"}${utm.slice(1)}` : ""}`, partners };
}

module.exports = { reviewersFor, keyOf, parse };
