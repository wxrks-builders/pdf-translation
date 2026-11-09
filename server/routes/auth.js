const express = require("express");
const store = require("../store");
const email = require("../services/email");
const crm = require("../services/crm");
const signupCredit = require("../services/signupCredit");
const freeTier = require("../services/freeTier");
const { canSeeJob, accessKey } = require("../services/access");
const { createRateLimiter } = require("../middleware/rateLimit");
const { setSessionCookie, clearSessionCookie, deleteSessionFromRequestCookie, optionalSession } = require("../middleware/auth");

const router = express.Router();

const requestLinkLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

// Where the link brings the person back to (their file, from the offer on a file over the free
// limit). Only a path on this site: no other host, no "//", no backslash.
const safeNext = (value) => {
  const s = String(value || "");
  return s.length <= 200 && /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/.test(s) ? s : null;
};

// Magic link request. Response is deliberately generic — it never reveals
// whether the address has an account. The email itself, which only that address reads, says
// when the link also brings the sign-up credit.
router.post("/request-link", requestLinkLimiter, optionalSession, freeTier.anonCookie, async (req, res) => {
  const address = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    return res.status(400).json({ error: "invalid_email" });
  }

  const token = await store.createLoginToken(address);
  let next = safeNext(req.body?.next);
  // Back to a guest's own file: with its key, so the link opens it on any device (the email
  // may be read on a phone), and only for a job this browser can already see.
  const jobId = next?.match(/^\/jobs\/([A-Za-z0-9_-]+)$/)?.[1];
  if (jobId) {
    const job = await store.getJob(jobId);
    next = job && canSeeJob(req, job) ? `/jobs/${job.id}?k=${accessKey(job.id)}` : null;
  }
  const loginUrl =
    `${process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`}/api/auth/verify?token=${token}` +
    (next ? `&next=${encodeURIComponent(next)}` : "");
  const signupWords = !(await store.getUserByEmail(address)) && (await signupCredit.available()) ? signupCredit.WORDS : 0;

  try {
    await email.sendLoginEmail(address, loginUrl, { signupWords });
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
  const existed = await store.getUserByEmail(address);
  const user = await store.upsertUserByEmail(address);
  // A new account starts with the sign-up credit; ?credit= tells the page to say so.
  const credited = existed ? 0 : await signupCredit.grant(user, "sign-in link");
  await crm.queue(crm.accountEvent(user, "sign-in")); // once per account: the key is the user id
  await deleteSessionFromRequestCookie(req);
  const sessionId = await store.createSession(user.id, "link");
  setSessionCookie(res, sessionId);
  const next = safeNext(req.query.next) || "/";
  res.redirect(credited ? `${next}${next.includes("?") ? "&" : "?"}credit=${credited}` : next);
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
