const express = require("express");
const store = require("../store");
const email = require("../services/email");
const crm = require("../services/crm");
const { createRateLimiter } = require("../middleware/rateLimit");
const { setSessionCookie, clearSessionCookie, deleteSessionFromRequestCookie, optionalSession } = require("../middleware/auth");

const router = express.Router();

const requestLinkLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

// Magic link request. Response is deliberately generic — it never reveals
// whether the address has an account.
router.post("/request-link", requestLinkLimiter, async (req, res) => {
  const address = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    return res.status(400).json({ error: "invalid_email" });
  }

  const token = await store.createLoginToken(address);
  const loginUrl = `${process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`}/api/auth/verify?token=${token}`;

  try {
    await email.sendLoginEmail(address, loginUrl);
    return res.json({ ok: true });
  } catch (err) {
    if (err.code === "EMAIL_NOT_CONFIGURED" && process.env.NODE_ENV !== "production") {
      console.log(`[auth] Mailgun not configured — login link for ${address}: ${loginUrl}`);
      return res.json({ ok: true, devLoginUrl: loginUrl });
    }
    console.error("[auth] failed to send login email:", err.message);
    return res.status(502).json({ error: "email_send_failed" });
  }
});

router.get("/verify", async (req, res) => {
  const address = await store.consumeLoginToken(String(req.query.token || ""));
  if (!address) {
    return res.redirect("/login?error=expired");
  }
  const user = await store.upsertUserByEmail(address);
  await crm.queue(crm.accountEvent(user, "sign-in")); // once per account: the key is the user id
  await deleteSessionFromRequestCookie(req);
  const sessionId = await store.createSession(user.id);
  setSessionCookie(res, sessionId);
  res.redirect("/");
});

router.post("/logout", async (req, res) => {
  await deleteSessionFromRequestCookie(req);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", optionalSession, async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const balance = await store.getCreditBalance(req.user.id);
  res.json({ user: { id: req.user.id, email: req.user.email }, creditBalance: balance });
});

module.exports = router;
