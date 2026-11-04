/**
 * The free tier's email step. A visitor sees page 1 of the translation, leaves an email, and
 * the downloads open; once the files are delivered, they also get one email with the links
 * (sendFilesIfRequested runs from the unlock route and from the poller, whichever comes
 * last). Product news needs its own unticked box; the address alone is not consent.
 *
 * Public forms that send mail get abused, so: a headless-browser check (a suspected bot is
 * answered like everyone else, but nothing is sent or forwarded), at most
 * FILES_EMAIL_PER_ADDRESS_DAILY emails to one address and FILES_EMAIL_DAILY_CAP in all.
 *
 * LEAD_WEBHOOK_URL, when set, receives every real lead as JSON (for n8n / the CRM).
 */
const axios = require("axios");
const store = require("../store");
const email = require("./email");
const locales = require("./locales");
const { accessKey } = require("./access");
const crm = require("./crm");

const DAILY_CAP = parseInt(process.env.FILES_EMAIL_DAILY_CAP || "300", 10);
const PER_ADDRESS_DAILY = parseInt(process.env.FILES_EMAIL_PER_ADDRESS_DAILY || "3", 10);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function normalizeEmail(raw) {
  const address = String(raw || "").trim().toLowerCase();
  return EMAIL_RE.test(address) && address.length <= 254 ? address : null;
}

// HeadlessChrome says so in its client hints or user agent; a forged browser sends client
// hints with a user agent that isn't Chrome.
function looksAutomated(req) {
  const ua = String(req.headers["user-agent"] || "");
  const hints = String(req.headers["sec-ch-ua"] || "");
  if (!ua) return true;
  if (/HeadlessChrome/i.test(ua) || /HeadlessChrome/i.test(hints)) return true;
  return Boolean(hints) && !/Chrome\//.test(ua);
}

async function unlock(req, job, { address, marketingOptIn }) {
  const suspectedBot = looksAutomated(req);
  const leadId = await store.recordLead({
    email: address,
    jobId: job.id,
    marketingOptIn,
    suspectedBot,
    ip: req.ip,
    userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
  });
  if (!suspectedBot) await crm.queue(crm.leadEvent({ id: leadId, email: address, jobId: job.id, marketingOptIn }));
  if (job.unlocked_email) return store.getJob(job.id); // first address wins; the email goes there

  const updated = await store.updateJob(job.id, {
    unlocked_at: new Date().toISOString(),
    // A suspected bot gets the downloads but never an email.
    unlocked_email: suspectedBot ? null : address,
  });
  await store.appendJobEvent(job.id, "unlocked", { suspectedBot, marketingOptIn: Boolean(marketingOptIn) });
  if (!suspectedBot) forward({ address, marketingOptIn, job: updated });
  await sendFilesIfRequested(updated);
  await crm.recordTranslation(updated); // when the email came after delivery
  return store.getJob(job.id);
}

function forward({ address, marketingOptIn, job }) {
  const url = process.env.LEAD_WEBHOOK_URL;
  if (!url) return;
  axios
    .post(
      url,
      {
        email: address,
        marketingOptIn: Boolean(marketingOptIn),
        source: "translate.wxrks.com",
        jobId: job.id,
        words: job.analyzed_words,
        sourceLocale: job.source_locale,
        targetLocales: job.target_locales,
        at: new Date().toISOString(),
      },
      { timeout: 5000 }
    )
    .catch((err) => console.error(`[leads] webhook failed: ${err.message}`));
}

function startOfTodayUtc() {
  return `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
}

async function sendFilesIfRequested(job) {
  if (!job || job.status !== "delivered" || !job.unlocked_email || job.files_emailed_at) return;
  if (!email.isConfigured()) return;
  const since = startOfTodayUtc();
  if ((await store.countFilesEmailsSince(since)) >= DAILY_CAP) {
    console.warn(`[leads] daily files-email cap (${DAILY_CAP}) reached; job ${job.id} not emailed`);
    return;
  }
  if ((await store.countFilesEmailsSince(since, job.unlocked_email)) >= PER_ADDRESS_DAILY) return;
  const claimed = await store.claimFilesEmail(job.id);
  if (!claimed) return; // the other caller got there first

  try {
    const base = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const k = accessKey(job.id);
    const [files, deliverables, names] = await Promise.all([
      store.listJobFiles(job.id),
      store.listDeliverables(job.id),
      languageNames(),
    ]);
    const groups = job.target_locales.map((loc) => ({
      language: names[locales.normalize(loc)] || loc,
      files: deliverables
        .filter((d) => d.locale === locales.normalize(loc))
        .map((d) => ({ filename: d.filename, url: `${base}/api/jobs/${job.id}/files/${d.id}?k=${k}` })),
    }));
    await email.sendFilesEmail(job.unlocked_email, {
      documentName: files[0]?.original_filename || "your document",
      groups,
      jobUrl: `${base}/jobs/${job.id}?k=${k}`,
    });
    await store.appendJobEvent(job.id, "files_emailed");
  } catch (err) {
    console.error(`[leads] files email for job ${job.id} failed: ${err.message}`);
    await store.appendJobEvent(job.id, "files_email_failed", { reason: err.message.slice(0, 160) });
  }
}

async function languageNames() {
  try {
    const list = await locales.listLanguages();
    return Object.fromEntries(list.map((l) => [locales.normalize(l.code), l.name]));
  } catch {
    return {};
  }
}

module.exports = { normalizeEmail, unlock, sendFilesIfRequested };
