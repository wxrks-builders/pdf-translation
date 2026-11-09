/**
 * Thumbs up or down on a delivered translation. Two places ask: the job page, right after the
 * downloads, and one email FEEDBACK_EMAIL_DAYS (3) after delivery to the address the job is known
 * by, with a link per answer. The email is about that translation only (no offers), goes once
 * per job, never to a job already answered on the page, and stops at FEEDBACK_EMAIL_DAILY_CAP.
 * FEEDBACK_EMAIL_DAYS=0 turns the email off. Answers show on /admin and in the daily digest.
 */
const crypto = require("crypto");
const store = require("../store");
const email = require("./email");
const locales = require("./locales");

const DAYS = parseInt(process.env.FEEDBACK_EMAIL_DAYS ?? "3", 10);
const DAILY_CAP = parseInt(process.env.FEEDBACK_EMAIL_DAILY_CAP || "100", 10);
const MAX_AGE_DAYS = 14; // older deliveries never get asked
const base = () => process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

function token(jobId) {
  return crypto.createHmac("sha256", process.env.COOKIE_SECRET || "dev").update(`feedback:${jobId}`).digest("hex").slice(0, 24);
}

function validToken(jobId, given) {
  const expected = token(jobId);
  return typeof given === "string" && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const RATINGS = ["up", "down"];

async function record({ jobId, source, rating, comment, visitor }) {
  if (!RATINGS.includes(rating)) throw Object.assign(new Error("rating must be up or down"), { status: 400 });
  await store.saveFeedback({ jobId, source, rating, comment: comment ? String(comment).slice(0, 2000) : null, visitor });
  await store.appendJobEvent(jobId, "feedback", { source, rating });
}

function render({ documentName, languages, days, upUrl, downUrl }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const btn = (href, label, primary) =>
    `<a href="${href}" target="_blank" style="display:inline-block;margin:0 8px 8px 0;padding:12px 20px;border-radius:6px;font-size:15px;font-weight:500;text-decoration:none;${
      primary ? "background-color:#252a31;color:#ffffff;" : "background-color:#ffffff;color:#252a31;border:1px solid #757d88;"
    }">${label}</a>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f3f5f7;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f5f7;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;"><tr><td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #dfe3e8;border-radius:10px;padding:36px 40px;font-family:helvetica,'helvetica neue',arial,sans-serif;">
<p style="Margin:0 0 18px;font-size:15px;color:#252a31;font-weight:600;">wxrks <span style="color:#57616d;font-weight:400;">Translate</span></p>
<h1 style="Margin:0 0 12px;font-size:22px;line-height:30px;color:#252a31;font-weight:600;">Did your translation work for you?</h1>
<p style="Margin:0 0 22px;font-size:15px;line-height:23px;color:#57616d;">You translated ${esc(documentName)} into ${esc(languages)} ${days} days ago. One click tells us how it went.</p>
${btn(upUrl, "Yes, it worked", true)}${btn(downUrl, "No, something was off", false)}
<p style="Margin:18px 0 0;font-size:14px;line-height:21px;color:#57616d;">Want to say more? Reply to this email; a person reads it.</p>
<p style="Margin:24px 0 0;font-size:12px;line-height:18px;color:#57616d;">We ask once, about this translation only.</p>
</td></tr></table></td></tr></table></body></html>`;
}

const deliveredAt = (job) => new Date([...job.timeline].reverse().find((e) => e.event === "delivered")?.at || job.updated_at).getTime();

// Our own addresses never get asked (tests, demos): FEEDBACK_SKIP_DOMAINS, comma-separated.
const SKIP = String(process.env.FEEDBACK_SKIP_DOMAINS ?? "wxrks.com,bureauworks.com")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

async function sendDue() {
  if (!DAYS || !email.isConfigured()) return;
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  let sentToday = (await store.listEventsSince(since)).filter((e) => e.name === "feedback_email_sent").length;
  const names = Object.fromEntries((await locales.listLanguages().catch(() => [])).map((l) => [locales.normalize(l.code), l.name]));
  // One email per person: about their latest translation; the earlier ones are marked asked too.
  const due = new Map();
  for (const job of await store.listFeedbackEmailCandidates()) {
    const to = String(job.user_email || job.unlocked_email).toLowerCase();
    const age = (Date.now() - deliveredAt(job)) / (24 * 3600 * 1000);
    if (age < DAYS || age > MAX_AGE_DAYS || SKIP.includes(to.split("@")[1])) continue;
    if ((await store.getFeedback(job.id)).length) continue; // answered on the page already
    (due.get(to) || due.set(to, []).get(to)).push({ job, age });
  }
  for (const [to, list] of due) {
    list.sort((a, b) => a.age - b.age);
    const { job, age } = list[0];
    if (sentToday >= DAILY_CAP) return;
    for (const other of list.slice(1)) await store.claimFeedbackEmail(other.job.id);
    if (!(await store.claimFeedbackEmail(job.id))) continue;
    const files = await store.listJobFiles(job.id);
    const link = (r) => `${base()}/feedback?job=${job.id}&r=${r}&t=${token(job.id)}`;
    try {
      await email.sendEmail({
        to,
        subject: `Did your translation of ${files[0]?.original_filename || "your document"} work for you?`,
        html: render({
          documentName: files.length === 1 ? files[0].original_filename : `${files.length} files`,
          languages: job.target_locales.map((l) => names[locales.normalize(l)] || l).join(", "),
          days: Math.round(age),
          upUrl: link("up"),
          downUrl: link("down"),
        }),
      });
      await store.recordEvent({ name: "feedback_email_sent", jobId: job.id });
      sentToday += 1;
    } catch (err) {
      console.error(`[feedback] email for job ${job.id} failed: ${err.message}`);
    }
  }
}

function start() {
  const run = () => sendDue().catch((err) => console.error(`[feedback] ${err.message}`));
  setInterval(run, 30 * 60 * 1000);
  setTimeout(run, 60 * 1000);
}

module.exports = { token, validToken, record, sendDue, start, render, RATINGS };
