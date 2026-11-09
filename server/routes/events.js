/**
 * What the page reports about the buying funnel (services/events.js): a price on screen, or a
 * return from Checkout without paying. Everything else is recorded by the server itself.
 */
const express = require("express");
const freeTier = require("../services/freeTier");
const events = require("../services/events");
const { createRateLimiter } = require("../middleware/rateLimit");
const { optionalSession } = require("../middleware/auth");

const router = express.Router();
const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 120 });

router.post("/", limiter, optionalSession, freeTier.anonCookie, async (req, res) => {
  const { name, place, jobId, words, fits } = req.body || {};
  if (!events.CLIENT_EVENTS.includes(name) || !events.PLACES.includes(place)) return res.status(400).json({ error: "unknown_event" });
  const detail = {};
  if (Number.isFinite(words)) detail.words = Math.round(words);
  if (Number.isFinite(fits)) detail.fits = Math.round(fits);
  await events.record(req, name, { place, jobId: typeof jobId === "string" ? jobId.slice(0, 20) : null, detail });
  res.status(204).end();
});

module.exports = router;
