/**
 * One reminder about a file stopped at a price (Rodrigo, 2026-11-21: "send via email for those
 * who left the email asking to finish the translation"). A guest leaves an address while the
 * file is still being read (the files email, services/leads.js) or on the sign-up offer
 * (routes/auth.js keeps it as jobs.reminder_email); when the file then stops at a price, nothing
 * else ever reaches them. A day later, this sends one email: what the file needs, the sample they
 * can see, how sign-up covers it, and the day the file is deleted (RETENTION_DAYS, true: the
 * poller's sweep deletes it then).
 *
 * One per file, never a series: it answers the request they made for that file, so it needs no
 * marketing consent. Anything after it would. Off unless REMINDER_EMAILS=on; until then a sweep
 * only counts what it would send (the admin route shows each email, routes/admin.js).
 */
const store = require("../store");
const email = require("./email");
const signupCredit = require("./signupCredit");
const { accessKey } = require("./access");

const AFTER_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || "30", 10);
const DAILY_CAP = parseInt(process.env.REMINDER_DAILY_CAP || "100", 10);
const SWEEP_EVERY_MS = 60 * 60 * 1000;
const FREE_WORDS = parseInt(process.env.FREE_TIER_MAX_WORDS || "2000", 10);

const isEnabled = () => process.env.REMINDER_EMAILS === "on";
const base = () => process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const n = (x) => Number(x).toLocaleString("en-US");
const pages = (words) => Math.max(1, Math.round(words / 250));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let lastSweep = 0;
let lastCountLogged = null;

// The address a file's reminder goes to: the one typed on its sign-up offer, else the one left
// for its files, else its account's. Never our own (tests from the team).
function addressOf(job) {
  const to = job.reminder_email || job.unlocked_email || job.user_email || null;
  return to && !/@wxrks\.com$/i.test(to) ? to : null;
}

// Files stopped at a price a day or more ago, still kept for at least two more days, not
// translated since (a rerun), with an address, and no reminder yet.
async function due(now = Date.now()) {
  const rows = await store.listReminderCandidates(
    new Date(now - AFTER_MS).toISOString(),
    new Date(now - (RETENTION_DAYS - 2) * 24 * 60 * 60 * 1000).toISOString()
  );
  return rows.filter((job) => addressOf(job) && !job.timeline.some((e) => e.event === "rerun_paid"));
}

function deletionDate(job) {
  const d = new Date(new Date(job.created_at).getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

// → { to, subject, html } for a job (also what the admin preview shows).
async function render(job) {
  const [file] = await store.listJobFiles(job.id);
  const documentName = file?.original_filename || "your document";
  const words = job.analyzed_words || 0;
  const credits = words * (job.target_locales?.length || 1);
  const sample = await store.getExcerptFor(job.id);
  const sampled =
    sample && sample.status === "delivered"
      ? (() => {
          const first = sample.excerpt_first_page || 1;
          const last = first + (sample.excerpt_pages || 1) - 1;
          return last > first ? `pages ${first} to ${last}` : `page ${first}`;
        })()
      : null;
  const credit = signupCredit.WORDS;
  const guest = !job.user_id;
  const offer = guest
    ? credit >= credits
      ? `Sign up with this email and your account starts with ${n(credit)} words ($${signupCredit.DOLLARS} in credits): enough to translate all of it, free. No card, no password.`
      : `Sign up with this email and your account starts with ${n(credit)} words ($${signupCredit.DOLLARS} in credits) toward it. A word pack covers the rest, from $9.`
    : `It needs ${n(credits)} credits. A word pack covers it, from $9, and it translates from the same page.`;
  const url = `${base()}/jobs/${job.id}?k=${accessKey(job.id)}`;
  const p = (text, extra = "") =>
    `<p style="Margin:0 0 16px;font-size:15px;line-height:23px;color:#57616d;${extra}">${text}</p>`;
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f3f5f7;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background-color:#f3f5f7;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="border-collapse:collapse;width:600px;max-width:600px;">
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #dfe3e8;border-radius:10px;padding:40px 40px 36px;font-family:helvetica,'helvetica neue',arial,sans-serif;">
            <p style="Margin:0 0 20px;font-size:15px;line-height:20px;color:#252a31;font-weight:600;">wxrks <span style="color:#57616d;font-weight:400;">Translate</span></p>
            <h1 style="Margin:0 0 12px;font-size:22px;line-height:30px;color:#252a31;font-weight:600;">Finish translating ${esc(documentName)}</h1>
            ${p(`It has ${n(words)} words (about ${n(pages(words))} pages), more than the free ${n(FREE_WORDS)}.${sampled ? ` We translated ${sampled} for free, so you can see the result.` : ""}`)}
            ${p(offer, "color:#176b45;")}
            <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 24px;">
              <tr>
                <td align="center" bgcolor="#252a31" style="background-color:#252a31;border-radius:6px;">
                  <a href="${url}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:helvetica,'helvetica neue',arial,sans-serif;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none;border-radius:6px;">Finish the translation</a>
                </td>
              </tr>
            </table>
            ${p(`We keep your file until ${deletionDate(job)}, then delete it.`)}
            <p style="Margin:24px 0 0;font-size:12px;line-height:18px;color:#57616d;">We sent this because you left this address for this file on translate.wxrks.com. It's the only reminder we'll send about it. Reply if something looks wrong; a person reads it.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
  return { to: addressOf(job), subject: `Finish translating ${documentName}`, html };
}

async function send(job) {
  if (!(await store.claimReminder(job.id))) return false; // another sweep got there first
  try {
    const message = await render(job);
    await email.sendEmail(message);
    await store.appendJobEvent(job.id, "reminder_emailed");
    return true;
  } catch (err) {
    console.error(`[reminders] job ${job.id}: ${err.message}`);
    await store.appendJobEvent(job.id, "reminder_failed", { reason: String(err.message).slice(0, 160) });
    return false;
  }
}

// From the poller, at most once an hour.
async function sweep({ now = Date.now(), force = false } = {}) {
  if (!force && now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  const jobs = await due(now);
  if (!isEnabled() || !email.isConfigured()) {
    if (jobs.length !== lastCountLogged) console.log(`[reminders] ${jobs.length} files due a reminder (off; REMINDER_EMAILS=on sends them)`);
    lastCountLogged = jobs.length;
    return;
  }
  const since = `${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`;
  let left = DAILY_CAP - (await store.countRemindersSince(since));
  for (const job of jobs) {
    if (left <= 0) break;
    if (await send(job)) left -= 1;
  }
}

module.exports = { sweep, due, render, isEnabled, addressOf };
