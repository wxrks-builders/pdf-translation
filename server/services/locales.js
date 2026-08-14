/**
 * Locale codes are wxrks's own spelling — lowercase with underscores
 * (pt_br, en_us). wxrks echoes this spelling back everywhere (work units,
 * webhooks, ZIP entry paths) even if a request used something else, so
 * every comparison in this app goes through normalize() and every stored
 * locale is the wxrks code as served by GET /language.
 */
const wxrks = require("./wxrks");

const TTL_MS = 30 * 60 * 1000;
let cache = null; // { at, list }

function normalize(code) {
  return String(code || "").toLowerCase().replace(/[-_]/g, "");
}

function sameLocale(a, b) {
  return normalize(a) === normalize(b);
}

async function listLanguages() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.list;
  const list = await wxrks.listLanguages();
  cache = { at: Date.now(), list };
  return list;
}

// Validates a client-supplied code against the live catalog and returns the
// canonical wxrks spelling, or null.
async function toCanonical(code) {
  const list = await listLanguages();
  const hit = list.find((l) => sameLocale(l.code, code));
  return hit ? hit.code : null;
}

module.exports = { normalize, sameLocale, listLanguages, toCanonical };
