/**
 * The buying funnel, so we can tell "never saw a price" from "saw it and left":
 *
 *   offer_shown         a price was on screen (client): over_limit, needs_credits, free_used,
 *                       pricing, account. Once per place, job and visitor a day.
 *   checkout_started    a Buy button opened Stripe Checkout (routes/checkout.js)
 *   checkout_cancelled  the buyer came back from Checkout without paying (client)
 *   checkout_paid       Stripe confirmed the payment (the webhook)
 *   free_limit_hit      an upload refused because the day's free document was used
 *
 * /admin and the daily digest add them up per place (services/digest.js funnel()).
 */
const store = require("../store");

const PLACES = ["over_limit", "needs_credits", "free_used", "pricing", "account"];
const CLIENT_EVENTS = ["offer_shown", "checkout_cancelled"];

const visitorOf = (req) => req.user?.id || req.anonId || null;
const place = (p) => (PLACES.includes(p) ? p : null);

async function record(req, name, { place: where, jobId, detail } = {}) {
  const visitor = visitorOf(req);
  const p = place(where);
  const day = new Date().toISOString().slice(0, 10);
  const dedupeKey = name === "offer_shown" ? `${name}:${p}:${jobId || ""}:${visitor}:${day}` : null;
  try {
    await store.recordEvent({ name, place: p, jobId, visitor, detail, dedupeKey });
  } catch (err) {
    console.warn(`[events] ${name}: ${err.message}`); // measuring never breaks the page
  }
}

// Per place: how many visitors saw a price, opened Checkout, came back, paid.
function funnel(events) {
  const rows = {};
  const row = (p) => (rows[p || "unknown"] ||= { shown: new Set(), started: 0, cancelled: 0, paid: 0 });
  for (const e of events) {
    if (e.name === "offer_shown") row(e.place).shown.add(e.visitor);
    if (e.name === "checkout_started") row(e.place).started += 1;
    if (e.name === "checkout_cancelled") row(e.place).cancelled += 1;
    if (e.name === "checkout_paid") row(e.place).paid += 1;
  }
  return {
    places: Object.entries(rows).map(([p, r]) => ({ place: p, shown: r.shown.size, started: r.started, cancelled: r.cancelled, paid: r.paid })),
    freeLimitHits: events.filter((e) => e.name === "free_limit_hit").length,
  };
}

module.exports = { record, funnel, CLIENT_EVENTS, PLACES };
