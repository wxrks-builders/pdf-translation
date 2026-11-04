/**
 * What the CRM hears about people using the translator (crm.wxrks.app, the Twenty app's
 * /s/translate/events route; ~/twenty-crm/TRANSLATE.md on the receiving side):
 *
 *   account      a translator account was made (magic-link sign-in, or a purchase)
 *   lead         a free visitor left an email to download
 *   translation  a delivered translation with a known email: file, words, languages, tone
 *   purchase     a word pack bought through Stripe Checkout
 *
 * The CRM registers the person by email and puts translations and purchases on their
 * timeline. Events go into the crm_outbox table where they happen and are sent in batches
 * (right away, and again on every poller tick) until the CRM confirms each key, so nothing
 * is lost while CRM_EVENTS_URL is unset or the CRM is down. Keys make every event
 * idempotent at both ends. backfill() queues everything from before this existed.
 */
const axios = require("axios");
const store = require("../store");

const BATCH = 50;
const MAX_ATTEMPTS = 20;

const isConfigured = () => Boolean(process.env.CRM_EVENTS_URL && process.env.CRM_EVENTS_SECRET);

let flushTimer = null;
function soon() {
  if (flushTimer || !isConfigured()) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch((err) => console.error(`[crm] flush failed: ${err.message}`));
  }, 2000);
}

async function queue(event) {
  if (!event?.email) return;
  await store.queueCrmEvent(event);
  soon();
}

function accountEvent(user, via) {
  return { key: `account:${user.id}`, type: "account", at: user.created_at, email: user.email, via };
}

function leadEvent({ id, email, jobId, marketingOptIn, at }) {
  return { key: `lead:${id}`, type: "lead", at: at || new Date().toISOString(), email, jobId, marketingOptIn: Boolean(marketingOptIn) };
}

function purchaseEvent(p) {
  return {
    key: `purchase:${p.stripe_session_id}`,
    type: "purchase",
    at: p.created_at,
    email: p.email,
    words: p.words,
    amountCents: p.amount_cents,
    currency: p.currency,
    stripeSessionId: p.stripe_session_id,
  };
}

// A delivered job, once its email is known: the account's for a paid job, the email step's
// for a free one. The excerpt (page-1 preview over the free limit) is not a translation.
async function translationEvent(job) {
  if (!job || job.status !== "delivered" || job.excerpt_of) return null;
  const email = job.user_id ? (await store.getUserById(job.user_id))?.email : job.unlocked_email;
  if (!email) return null;
  const files = await store.listJobFiles(job.id);
  const delivered = [...job.timeline].reverse().find((e) => e.event === "delivered");
  const lead = job.tier === "free" ? await store.getLatestLeadForJob(job.id) : null;
  return {
    key: `translation:${job.id}`,
    type: "translation",
    at: delivered?.at || job.updated_at,
    email,
    jobId: job.id,
    tier: job.tier,
    fileName: files.length === 1 ? files[0].original_filename : `${files.length} files`,
    words: job.analyzed_words,
    credits: job.tier === "paid" ? job.credits_charged : null,
    sourceLocale: job.source_locale,
    targetLocales: job.target_locales,
    tone: job.tone,
    marketingOptIn: lead ? Boolean(lead.marketing_opt_in) : null,
  };
}

async function recordTranslation(job) {
  const event = await translationEvent(job);
  if (event) await queue(event);
}

async function backfill() {
  const { users, leads, purchases, jobs } = await store.listCrmBackfill();
  for (const u of users) await store.queueCrmEvent(accountEvent(u, (await store.createdUserForPurchase(u.id)) ? "purchase" : "sign-in"));
  for (const l of leads) {
    await store.queueCrmEvent(leadEvent({ id: l.id, email: l.email, jobId: l.job_id, marketingOptIn: l.marketing_opt_in, at: l.created_at }));
  }
  for (const p of purchases) await store.queueCrmEvent(purchaseEvent(p));
  for (const id of jobs) {
    const event = await translationEvent(await store.getJob(id));
    if (event) await store.queueCrmEvent(event);
  }
  const total = users.length + leads.length + purchases.length + jobs.length;
  if (total) console.log(`[crm] backfill queued ${total} events`);
}

let flushing = false;
async function flush() {
  if (!isConfigured() || flushing) return;
  flushing = true;
  try {
    for (;;) {
      const batch = await store.listUnsentCrmEvents(BATCH, MAX_ATTEMPTS);
      if (!batch.length) return;
      let results;
      try {
        const res = await axios.post(
          process.env.CRM_EVENTS_URL,
          { events: batch.map((b) => b.event) },
          { headers: { "x-translate-secret": process.env.CRM_EVENTS_SECRET }, timeout: 30000 }
        );
        results = res.data?.results || [];
      } catch (err) {
        const why = err.response ? `HTTP ${err.response.status} ${JSON.stringify(err.response.data).slice(0, 200)}` : err.message;
        for (const b of batch) await store.markCrmEventFailed(b.key, why);
        console.error(`[crm] batch of ${batch.length} not delivered: ${why}`);
        return; // the next tick tries again
      }
      const byKey = new Map(results.map((r) => [r.key, r]));
      let failed = 0;
      for (const b of batch) {
        const r = byKey.get(b.key);
        if (r && ["created", "updated", "skipped"].includes(r.status)) await store.markCrmEventSent(b.key);
        else {
          failed++;
          await store.markCrmEventFailed(b.key, r?.error || "no result for this key");
        }
      }
      if (failed) {
        console.error(`[crm] ${failed} of ${batch.length} events refused; they retry next tick`);
        return;
      }
    }
  } finally {
    flushing = false;
  }
}

module.exports = { isConfigured, queue, accountEvent, leadEvent, purchaseEvent, recordTranslation, backfill, flush };
