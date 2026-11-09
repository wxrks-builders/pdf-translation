/**
 * Buying a word pack (services/payments.js). POST /api/checkout opens a Stripe Checkout
 * Session; Stripe sends the buyer back to /thanks, which reads GET /api/checkout/session/:id
 * until the webhook (POST /api/stripe/webhook, mounted before the JSON parser in index.js)
 * has granted the words.
 */
const express = require("express");
const store = require("../store");
const payments = require("../services/payments");
const crm = require("../services/crm");
const events = require("../services/events");
const freeTier = require("../services/freeTier");
const { canSeeJob } = require("../services/access");
const { createRateLimiter } = require("../middleware/rateLimit");
const { optionalSession, setSessionCookie, deleteSessionFromRequestCookie } = require("../middleware/auth");

const router = express.Router();
const checkoutLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
const baseUrl = () => process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

router.get("/config", (req, res) => res.json({ enabled: payments.isConfigured() }));

router.post("/", checkoutLimiter, optionalSession, freeTier.anonCookie, async (req, res) => {
  if (!payments.isConfigured()) return res.status(503).json({ error: "checkout_unavailable" });
  const pack = payments.packFor(req.body?.words);
  if (!pack) return res.status(400).json({ error: "unknown_pack" });
  // The file over the free limit that this purchase is for, so /thanks can offer to translate it.
  let jobId = null;
  if (req.body?.jobId) {
    const job = await store.getJob(String(req.body.jobId));
    if (job && canSeeJob(req, job)) jobId = job.id;
  }
  const place = events.PLACES.includes(req.body?.place) ? req.body.place : null;
  try {
    const session = await payments.createCheckout({ pack, email: req.user?.email, userId: req.user?.id, jobId, baseUrl: baseUrl(), place });
    await events.record(req, "checkout_started", { place, jobId, detail: { words: pack.words } });
    res.json({ url: session.url });
  } catch (err) {
    console.error(`[checkout] session failed: ${err.response?.data?.error?.message || err.message}`);
    res.status(502).json({ error: "checkout_failed" });
  }
});

// After Checkout. A buyer whose account the purchase itself created is signed in here, once:
// the account holds nothing but what they just bought. An existing account signs in by email.
router.get("/session/:id", optionalSession, async (req, res) => {
  const purchase = await store.getPurchase(String(req.params.id));
  if (!purchase) return res.json({ status: "pending" }); // the webhook hasn't arrived yet
  let signedIn = Boolean(req.user && req.user.id === purchase.user_id);
  if (!signedIn && (await store.claimPurchase(purchase.stripe_session_id))) {
    await deleteSessionFromRequestCookie(req);
    setSessionCookie(res, await store.createSession(purchase.user_id));
    signedIn = true;
  }
  res.json({ status: "paid", words: purchase.words, email: purchase.email, signedIn, jobId: purchase.job_id });
});

async function fulfil(session) {
  const words = parseInt(session.metadata?.words, 10);
  const email = String(session.customer_details?.email || session.customer_email || "").trim().toLowerCase();
  if (!payments.packFor(words) || !email) {
    console.error(`[checkout] session ${session.id}: no pack or no email, nothing granted`);
    return;
  }
  let user = session.metadata?.user_id ? await store.getUserById(session.metadata.user_id) : null;
  const existing = user || (await store.getUserByEmail(email));
  user = existing || (await store.upsertUserByEmail(email));
  const granted = await store.recordPurchase({
    sessionId: session.id,
    userId: user.id,
    email,
    words,
    amountCents: session.amount_total,
    currency: session.currency,
    jobId: session.metadata?.job_id || null,
    createdUser: !existing,
  });
  if (granted) {
    console.log(`[checkout] ${words} words for ${user.id} (session ${session.id})`);
    await events.record({ user }, "checkout_paid", { place: session.metadata?.place, jobId: session.metadata?.job_id || null, detail: { words } });
    if (!existing) await crm.queue(crm.accountEvent(user, "purchase"));
    await crm.queue(crm.purchaseEvent(await store.getPurchase(session.id)));
  }
}

async function webhook(req, res) {
  if (!payments.isConfigured()) return res.status(503).end();
  let event;
  try {
    event = payments.verifyWebhook(req.body, req.headers["stripe-signature"]);
  } catch (err) {
    console.warn(`[checkout] webhook refused: ${err.message}`);
    return res.status(400).json({ error: "bad_signature" });
  }
  const session = event.data?.object;
  const paid = ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type);
  if (paid && session?.payment_status === "paid" && session.metadata?.source === "translate.wxrks.com") {
    await fulfil(session);
  }
  res.json({ received: true });
}

module.exports = { router, webhook };
