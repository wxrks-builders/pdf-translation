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

const PACKS = [
  { words: 5000, cents: 900 },
  { words: 30000, cents: 2900 },
  { words: 200000, cents: 9900 },
];

const isConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
const packFor = (words) => PACKS.find((p) => p.words === Number(words)) || null;

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

function createCheckout({ pack, email, userId, jobId, baseUrl }) {
  const words = pack.words.toLocaleString("en-US");
  return stripe("post", "/checkout/sessions", {
    mode: "payment",
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
    cancel_url: `${baseUrl}${jobId ? `/jobs/${jobId}` : "/pricing"}`,
    metadata: { source: "translate.wxrks.com", words: pack.words, user_id: userId || null, job_id: jobId || null },
  });
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

module.exports = { PACKS, isConfigured, packFor, createCheckout, verifyWebhook, encode };
