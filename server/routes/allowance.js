/**
 * What the visitor has left: today's free document for a guest, the credit balance once signed
 * in. The upload screen shows no meter (Rodrigo, 2026-11-09: limits show after the upload); it
 * reads this to tell a guest whose free document is used before they upload another, and whether
 * the sign-up credit can still be given today.
 */
const express = require("express");
const store = require("../store");
const freeTier = require("../services/freeTier");
const signupCredit = require("../services/signupCredit");
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
  res.json({
    signedIn: false,
    freeAvailable: !used,
    maxWords: FREE_TIER_MAX_WORDS,
    resetsAt: nextUtcMidnight(),
    signupCredit: (await signupCredit.available()) ? signupCredit.WORDS : 0,
  });
});

module.exports = router;
