/**
 * What people really translated here lately, for the upload page and the price screen (Rodrigo,
 * 2026-11-21, asked to show people finishing translations; only real ones are shown). Each row is
 * a delivered job: its languages, its words and when, never a name, a file or an address. The
 * team's own jobs are left out (store.listRecentDeliveries). Public, cached for ten minutes.
 */
const express = require("express");
const store = require("../store");
const locales = require("../services/locales");

const router = express.Router();
const CACHE_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
let cache = null;

router.get("/recent", async (req, res) => {
  try {
    if (!cache || Date.now() - cache.at > CACHE_MS) {
      const names = Object.fromEntries((await locales.listLanguages().catch(() => [])).map((l) => [locales.normalize(l.code), l.name]));
      const name = (code) => names[locales.normalize(code)] || code;
      const month = await store.listRecentDeliveries(new Date(Date.now() - 30 * DAY_MS).toISOString());
      const week = month.filter((r) => Date.now() - new Date(r.at).getTime() < 7 * DAY_MS);
      cache = {
        at: Date.now(),
        body: {
          recent: week.slice(0, 5).map((r) => ({ from: name(r.sourceLocale), to: r.targetLocales.map(name), words: r.words, at: r.at })),
          last30: { documents: month.length, words: month.reduce((sum, r) => sum + r.words * Math.max(1, r.targetLocales.length), 0) },
        },
      };
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(cache.body);
  } catch (err) {
    console.error(`[activity] ${err.message}`);
    res.json({ recent: [], last30: { documents: 0, words: 0 } });
  }
});

module.exports = router;
