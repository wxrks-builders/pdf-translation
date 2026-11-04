/**
 * What the visitor has left, for the meters on the upload screen: today's free document for
 * anonymous visitors, the credit balance once signed in.
 */
const express = require("express");
const store = require("../store");
const freeTier = require("../services/freeTier");
const { FREE_TIER_MAX_WORDS } = require("../services/pipeline");
const { optionalSession } = require("../middleware/auth");

const router = express.Router();

function nextUtcMidnight() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

router.get("/", optionalSession, freeTier.anonCookie, async (req, res) => {
  if (req.user) return res.json({ signedIn: true, balance: await store.getCreditBalance(req.user.id) });
  const used = await freeTier.findUsageToday(req);
  res.json({ signedIn: false, freeAvailable: !used, maxWords: FREE_TIER_MAX_WORDS, resetsAt: nextUtcMidnight() });
});

module.exports = router;
