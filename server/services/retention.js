/**
 * The warning before a translation is deleted (Rodrigo, 2026-11-25: "let the user know that their
 * document is going to be deleted in 7 days"). Files are kept RETENTION_DAYS (30), and the
 * poller's daily sweep deletes them after that (store.sweepOldBlobs, store.keptUntil).
 * DELETION_WARNING_DAYS (7) before, the address a delivered translation is known by gets one email
 * with the last day and a link to download it: one email per address per sweep, listing every
 * file due, and never a second warning about the same file.
 *
 * Only delivered files: their owner has translations to lose. A file stopped at a price already
 * had its one reminder, which names the same day (services/reminders.js); a second email about
 * it would need marketing consent. This one is about files they have, so it needs none.
 *
 * Off unless DELETION_WARNINGS=on; until then a sweep only counts what it would send (the admin
 * route shows each email, routes/admin.js). What the sweep deleted goes in the daily digest
 * (services/digest.js).
 */
const store = require("../store");
const email = require("./email");
const locales = require("./locales");
const { accessKey } = require("./access");

const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || "30", 10);
const WARN_DAYS = parseInt(process.env.DELETION_WARNING_DAYS || "7", 10);
const DAILY_CAP = parseInt(process.env.DELETION_WARNING_DAILY_CAP || "200", 10);
const SWEEP_EVERY_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const isEnabled = () => process.env.DELETION_WARNINGS === "on";
const base = () => process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Our own addresses (tests, demos) and the domains reserved for examples never get one.
const SKIP = String(process.env.FEEDBACK_SKIP_DOMAINS ?? "wxrks.com,bureauworks.com")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);
const RESERVED = /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/;

let lastSweep = 0;
let lastCountLogged = null;

// The account's address, else the one left for the files, else the one typed on the sign-up offer.
function addressOf(job) {
  const to = String(job.user_email || job.unlocked_email || job.reminder_email || "").trim().toLowerCase();
  const domain = to.split("@")[1] || "";
  if (!domain || SKIP.includes(domain) || RESERVED.test(domain)) return null;
  return to;
}

const utcDay = (ms) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const keptUntil = (job) => store.keptUntil(job.created_at, RETENTION_DAYS);
// Whole days from today to the last day the files are kept: 0 on that day itself.
const daysLeft = (job, now) => Math.round((keptUntil(job).getTime() - utcDay(now)) / DAY_MS);
const longDate = (d) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

// → [{ to, jobs }], one per address, each job with WARN_DAYS or fewer left but at least one
// more day after today.
async function due(now = Date.now()) {
  const rows = await store.listDeletionWarningCandidates(
    new Date(now - (RETENTION_DAYS - WARN_DAYS - 1) * DAY_MS).toISOString(),
    new Date(now - (RETENTION_DAYS + 1) * DAY_MS).toISOString()
  );
  const groups = new Map();
  for (const job of rows) {
    const left = daysLeft(job, now);
    const to = addressOf(job);
    if (!to || left < 1 || left > WARN_DAYS) continue;
    if (!groups.has(to)) groups.set(to, []);
    groups.get(to).push(job);
  }
  return [...groups].map(([to, jobs]) => ({ to, jobs }));
}

// A file name safe for a subject line: no line breaks or control characters, not too long.
function subjectName(name) {
  const clean = String(name).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

// → { to, subject, html } for one address and its files (also what the admin preview shows).
async function render({ to, jobs }) {
  const names = Object.fromEntries((await locales.listLanguages().catch(() => [])).map((l) => [locales.normalize(l.code), l.name]));
  const language = (code) => names[locales.normalize(code)] || code;
  const files = [];
  for (const job of [...jobs].sort((a, b) => keptUntil(a) - keptUntil(b))) {
    const list = await store.listJobFiles(job.id);
    files.push({
      name: list.length === 1 ? list[0].original_filename : `${list.length} files`,
      languages: job.target_locales.map(language).join(", "),
      until: longDate(keptUntil(job)),
      url: `${base()}/jobs/${job.id}?k=${accessKey(job.id)}`,
    });
  }
  const one = files.length === 1 ? files[0] : null;
  const first = files[0].until;
  const subject = one ? `Download your translation of ${subjectName(one.name)} by ${one.until}` : `Download your ${files.length} translations by ${first}`;
  const p = (text, extra = "") => `<p style="Margin:0 0 16px;font-size:15px;line-height:23px;color:#57616d;${extra}">${text}</p>`;
  const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 24px;">
              <tr>
                <td align="center" bgcolor="#252a31" style="background-color:#252a31;border-radius:6px;">
                  <a href="${href}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:helvetica,'helvetica neue',arial,sans-serif;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none;border-radius:6px;">${label}</a>
                </td>
              </tr>
            </table>`;
  const rows = files
    .map(
      (f) => `<tr>
                <td style="padding:12px 0;border-top:1px solid #dfe3e8;font-family:helvetica,'helvetica neue',arial,sans-serif;">
                  <p style="Margin:0;font-size:15px;line-height:22px;color:#252a31;font-weight:600;">${esc(f.name)}</p>
                  <p style="Margin:2px 0 0;font-size:14px;line-height:21px;color:#57616d;">${esc(f.languages)} · kept until ${esc(f.until)} · <a href="${f.url}" target="_blank" style="color:#252a31;">Download</a></p>
                </td>
              </tr>`
    )
    .join("");
  const body = one
    ? `<h1 style="Margin:0 0 12px;font-size:22px;line-height:30px;color:#252a31;font-weight:600;">Download your translation of ${esc(one.name)} by ${esc(one.until)}</h1>
            ${p(`You translated it into ${esc(one.languages)} on translate.wxrks.com. We keep files for ${RETENTION_DAYS} days. After ${esc(one.until)}, the original and its translations are deleted, and the download link stops working.`)}
            ${button(one.url, "Download your files")}`
    : `<h1 style="Margin:0 0 12px;font-size:22px;line-height:30px;color:#252a31;font-weight:600;">Download your translations by ${esc(first)}</h1>
            ${p(`We keep files for ${RETENTION_DAYS} days. After the day beside each one, the original and its translations are deleted, and the download links stop working.`)}
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 20px;">
              ${rows}
            </table>`;
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
            ${body}
            ${p("Already saved them? Then there's nothing to do.")}
            <p style="Margin:24px 0 0;font-size:12px;line-height:18px;color:#57616d;">We sent this because you translated ${one ? "this file" : "these files"} on translate.wxrks.com. It's the only notice we'll send about ${one ? "it" : "them"}. Reply if something looks wrong; a person reads it.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
  return { to, subject, html };
}

// Claims each file first, so two sweeps never warn twice; a failed send isn't retried.
async function send(group) {
  const claimed = [];
  for (const job of group.jobs) if (await store.claimDeletionWarning(job.id)) claimed.push(job);
  if (!claimed.length) return 0;
  try {
    await email.sendEmail(await render({ to: group.to, jobs: claimed }));
    for (const job of claimed) await store.appendJobEvent(job.id, "deletion_warned");
    return claimed.length;
  } catch (err) {
    console.error(`[retention] warning for ${claimed.map((j) => j.id).join(", ")}: ${err.message}`);
    for (const job of claimed) await store.appendJobEvent(job.id, "deletion_warning_failed", { reason: String(err.message).slice(0, 160) });
    return 0;
  }
}

// From the poller, at most once an hour.
async function sweep({ now = Date.now(), force = false } = {}) {
  if (!force && now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  const groups = await due(now);
  if (!isEnabled() || !email.isConfigured()) {
    const files = groups.reduce((s, g) => s + g.jobs.length, 0);
    if (files !== lastCountLogged) console.log(`[retention] ${files} files due a deletion warning, to ${groups.length} addresses (off; DELETION_WARNINGS=on sends them)`);
    lastCountLogged = files;
    return;
  }
  const since = `${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`;
  let left = DAILY_CAP - (await store.countDeletionWarningsSince(since));
  for (const group of groups) {
    if (left <= 0) break;
    left -= await send(group);
  }
}

module.exports = { sweep, due, render, isEnabled, addressOf, RETENTION_DAYS, WARN_DAYS };
