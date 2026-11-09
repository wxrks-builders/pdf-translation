/**
 * Word packs through Stripe Checkout, paid once. Off until STRIPE_SECRET_KEY and
 * STRIPE_WEBHOOK_SECRET are set; until then the client's buy buttons open an email instead.
 * Checkout gets each price inline (price_data), so nothing has to be created in Stripe first.
 * Keep PACKS in step with client/src/pricing.js.
 *
 * The words land when Stripe calls the webhook (routes/checkout.js), keyed by the email the
 * buyer gave Checkout: an existing account gets them, or a new account is made.
 */
const crypto = require("crypto");
const axios = require("axios");

const API = process.env.STRIPE_API_URL || "https://api.stripe.com/v1";
const SIGNATURE_TOLERANCE_S = 5 * 60;

// Rodrigo, 2026-11-09: "$9 per 10,000 words ... 29 per 60,000 words. Then 99 per 400,000 words".
const PACKS = [
  { words: 10000, cents: 900 },
  { words: 60000, cents: 2900 },
  { words: 400000, cents: 9900 },
];
// The packs before 2026-11-09. Nobody can start a Checkout for them any more, but one opened
// just before the change can still be paid (a session lives 24 h), and its words must land.
const EARLIER_PACK_WORDS = [5000, 30000, 200000];

const isConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
const packFor = (words) => PACKS.find((p) => p.words === Number(words)) || null;
const isGrantable = (words) => Boolean(packFor(words)) || EARLIER_PACK_WORDS.includes(Number(words));

// Stripe takes form encoding with brackets for nesting: line_items[0][price_data][currency].
function encode(value, prefix, out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(value)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") encode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

function stripe(method, url, data) {
  return axios({
    method,
    url: `${API}${url}`,
    data: data ? encode(data).toString() : undefined,
    headers: data ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
    auth: { username: process.env.STRIPE_SECRET_KEY, password: "" },
    timeout: 15000,
  }).then((res) => res.data);
}

// place: where the Buy button was (services/events.js), carried through Stripe so the payment
// and a cancelled return are counted against it.
function createCheckout({ pack, email, userId, jobId, baseUrl, place }) {
  const words = pack.words.toLocaleString("en-US");
  return stripe("post", "/checkout/sessions", {
    mode: "payment",
    // Cards only (Apple Pay and Google Pay ride on them). A US bank payment clears days later,
    // so the buyer would land on /thanks with no words and a "taking longer" note.
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: pack.cents,
          product_data: {
            name: `${words} words, wxrks Translate`,
            description: "One credit is one source word into one language. Paid once, no subscription.",
          },
        },
      },
    ],
    customer_email: email || null,
    success_url: `${baseUrl}/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}${jobId ? `/jobs/${jobId}` : "/pricing"}?checkout=cancelled${place ? `&place=${place}` : ""}`,
    metadata: { source: "translate.wxrks.com", words: pack.words, user_id: userId || null, job_id: jobId || null, place: place || null },
  });
}

// The translator's Checkout Sessions since a moment, paid or not: who opened Checkout before
// the funnel was measured. → [{ id, created, status, paid, words, place, jobId }]
async function listSessions(sinceIso) {
  const created = Math.floor(new Date(sinceIso).getTime() / 1000);
  const out = [];
  let after = null;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ limit: "100", "created[gte]": String(created) });
    if (after) params.set("starting_after", after);
    const data = await stripe("get", `/checkout/sessions?${params}`);
    for (const s of data.data || []) {
      if (s.metadata?.source !== "translate.wxrks.com") continue;
      out.push({
        id: s.id,
        created: new Date(s.created * 1000).toISOString(),
        status: s.status, // open | complete | expired
        paid: s.payment_status === "paid",
        words: Number(s.metadata.words) || null,
        place: s.metadata.place || null,
        jobId: s.metadata.job_id || null,
      });
    }
    if (!data.has_more || !data.data?.length) break;
    after = data.data[data.data.length - 1].id;
  }
  return out;
}

// Stripe-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">[,v1=…]. → the event.
function verifyWebhook(rawBody, header) {
  const parts = String(header || "").split(",").map((p) => p.split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !signatures.length) throw new Error("missing signature");
  if (Math.abs(Date.now() / 1000 - Number(t)) > SIGNATURE_TOLERANCE_S) throw new Error("stale signature");
  const expected = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest("hex");
  const ok = signatures.some(
    (sig) => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  );
  if (!ok) throw new Error("bad signature");
  return JSON.parse(rawBody.toString("utf8"));
}

module.exports = { PACKS, isConfigured, packFor, isGrantable, createCheckout, listSessions, verifyWebhook, encode };
