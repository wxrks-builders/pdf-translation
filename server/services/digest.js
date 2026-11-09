/**
 * Who used the translator: every upload since a moment, with what became of it, for the people
 * who run it (ADMIN_EMAILS). The admin page (/admin) shows it; once a day the digest sends the
 * last day's to Slack, as a DM to SLACK_DIGEST_USER with SLACK_DIGEST_TOKEN (a token with
 * chat:write, the same kind the ideas app uses for its alerts), or by email to ADMIN_EMAILS
 * when Slack isn't set. Each line links to the job, which an admin can open when signed in.
 *
 * The digest goes at DIGEST_HOUR (8) in DIGEST_TZ (America/Toronto), once a day, covering
 * everything since the last one (the first covers a week). The settings table remembers when
 * it went, so a restart doesn't send it twice.
 */
const axios = require("axios");
const store = require("../store");
const email = require("./email");
const locales = require("./locales");
const events = require("./events");
const payments = require("./payments");

const TZ = process.env.DIGEST_TZ || "America/Toronto";
const HOUR = parseInt(process.env.DIGEST_HOUR || "8", 10);
const CHECK_MS = 10 * 60 * 1000;
const base = () => process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

const STATUS = {
  delivered: "Delivered",
  over_free_limit: "Over the free limit",
  needs_credits: "Needed more credits",
  no_text: "No text found",
  failed: "Failed",
  cancelled: "Cancelled",
};
const ACTIVE = ["created", "uploading", "analyzing", "approving", "translating"];

const n = (x) => Number(x || 0).toLocaleString("en-US");

// One row per job: what a person needs to follow it up.
async function activity(sinceIso) {
  const names = Object.fromEntries((await locales.listLanguages().catch(() => [])).map((l) => [locales.normalize(l.code), l.name]));
  const name = (code) => names[locales.normalize(code)] || code;
  const jobs = [];
  for (const job of await store.listJobsSince(sinceIso)) {
    const files = await store.listJobFiles(job.id);
    const scores = Object.entries(job.confidence?.byLocale || {}).map(([loc, e]) => ({ language: name(loc), score: e.score, flagged: e.flagged }));
    const ocr = job.timeline.find((e) => e.event === "ocr_skipped");
    jobs.push({
      id: job.id,
      url: `${base()}/jobs/${job.id}`,
      at: job.created_at,
      tier: job.tier,
      email: job.user_email || job.unlocked_email || null,
      file: files.length === 1 ? files[0].original_filename : `${files.length} files`,
      scannedPages: files.reduce((s, f) => s + (f.ocr_pages || 0), 0),
      from: name(job.source_locale),
      to: job.target_locales.map(name),
      words: job.analyzed_words,
      status: ACTIVE.includes(job.status) ? "In progress" : STATUS[job.status] || job.status,
      problem: job.status === "failed" ? String(job.error || "").slice(0, 160) : job.status === "no_text" && ocr ? `scan not read (${ocr.detail?.reason || "?"})` : null,
      scores,
      tone: job.tone?.preset && job.tone.preset !== "auto" ? job.tone.preset : null,
    });
  }
  const purchases = (await store.listPurchasesSince(sinceIso)).map((p) => ({
    at: p.created_at,
    email: p.email,
    words: p.words,
    amount: p.amount_cents != null ? `${(p.amount_cents / 100).toFixed(2)} ${String(p.currency || "usd").toUpperCase()}` : null,
    jobId: p.job_id,
  }));
  const count = (status) => jobs.filter((j) => j.status === status).length;
  const feedbackRows = await store.listFeedbackSince(sinceIso);
  const files = Object.fromEntries(jobs.map((j) => [j.id, j.file]));
  // Checkout Sessions straight from Stripe: who opened Checkout, including before the funnel
  // was measured. Soft: without Stripe, or on an error, the list is just missing.
  let checkouts = null;
  if (payments.isConfigured()) checkouts = await payments.listSessions(sinceIso).catch(() => null);
  const funnel = events.funnel(await store.listEventsSince(sinceIso));
  return {
    since: sinceIso,
    jobs,
    purchases,
    funnel,
    emails: await store.emailStatsSince(sinceIso),
    feedback: feedbackRows.map((f) => ({ jobId: f.job_id, file: files[f.job_id] || null, source: f.source, rating: f.rating, comment: f.comment, at: f.created_at })),
    checkouts,
    totals: {
      uploads: jobs.length,
      delivered: count("Delivered"),
      overLimit: count("Over the free limit") + count("Needed more credits"),
      failed: count("Failed"),
      emails: new Set(jobs.map((j) => j.email).filter(Boolean)).size,
      purchases: purchases.length,
      signupCredits: funnel.signupCredits,
      thumbsUp: feedbackRows.filter((f) => f.rating === "up").length,
      thumbsDown: feedbackRows.filter((f) => f.rating === "down").length,
    },
  };
}

const PLACE_LABEL = {
  over_limit: "over the free limit",
  needs_credits: "not enough credits",
  free_used: "free document used",
  pricing: "pricing page",
  account: "account page",
  signup: "sign-up credit offer",
  unknown: "elsewhere",
};

// "Prices shown: over the free limit 3 people → 1 opened Checkout → 0 paid; …"
function funnelLine(a) {
  const rows = a.funnel.places.filter((p) => p.shown || p.started || p.paid);
  const parts = rows.map((p) => `${PLACE_LABEL[p.place] || p.place}: ${p.shown} saw it → ${p.started} opened Checkout → ${p.paid} paid`);
  const stripe = a.checkouts
    ? ` · Stripe: ${a.checkouts.length} Checkouts opened, ${a.checkouts.filter((c) => c.paid).length} paid, ${a.checkouts.filter((c) => c.status === "expired").length} expired unpaid`
    : "";
  return `Prices shown: ${parts.join("; ") || "none recorded"}${a.funnel.freeLimitHits ? ` · ${a.funnel.freeLimitHits} uploads stopped by the free limit` : ""}${stripe}`;
}

function emailLine(a) {
  const e = a.emails;
  return `Emails: ${e.leadPeople} left at the email step (${e.newsOptIns} want product news) · ${e.accounts} accounts made · ${a.totals.purchases} purchases`;
}

function feedbackLine(a) {
  const f = a.feedback;
  if (!f.length) return "Feedback: none yet";
  const notes = f.filter((x) => x.comment).slice(0, 5).map((x) => `${x.rating === "up" ? "+" : "−"} “${x.comment.slice(0, 140)}”`);
  return [`Feedback: ${a.totals.thumbsUp} thumbs up · ${a.totals.thumbsDown} thumbs down`, ...notes].join("\n");
}

function line(j) {
  const scores = j.scores.map((s) => `${Math.round(s.score * 100)}%${j.scores.length > 1 ? ` ${s.language}` : ""}`).join(", ");
  return [
    j.file,
    `${j.from} → ${j.to.join(", ")}`,
    j.words != null ? `${n(j.words)} words` : null,
    j.scannedPages ? `scan, ${j.scannedPages} pages` : null,
    j.status + (j.problem ? ` (${j.problem})` : ""),
    scores ? `score ${scores}` : null,
    j.tier,
    j.email,
  ]
    .filter(Boolean)
    .join(" · ");
}

function slackText(a, label) {
  const t = a.totals;
  const head = [
    `*Translator, ${label}*`,
    `${t.uploads} uploads · ${t.delivered} delivered · ${t.overLimit} stopped at a price · ${t.failed} failed · ${t.signupCredits} sign-up credits given`,
    funnelLine(a),
    emailLine(a),
    feedbackLine(a),
  ].join("\n");
  const jobs = a.jobs.slice(0, 40).map((j) => `• <${j.url}|${line(j).replace(/[<>|]/g, "")}>`);
  const more = a.jobs.length > 40 ? [`…and ${a.jobs.length - 40} more`] : [];
  const buys = a.purchases.map((p) => `• Bought ${n(p.words)} words${p.amount ? ` for ${p.amount}` : ""} · ${p.email}`);
  return [head, ...jobs, ...more, ...buys, `<${base()}/admin|Everything on /admin>`].join("\n");
}

function emailHtml(a, label) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const t = a.totals;
  const rows = a.jobs.map((j) => `<li style="margin:0 0 8px;"><a href="${j.url}" style="color:#252a31;">${esc(j.file)}</a><br><span style="color:#57616d;">${esc(line(j))}</span></li>`);
  const buys = a.purchases.map((p) => `<li>Bought ${n(p.words)} words${p.amount ? ` for ${esc(p.amount)}` : ""} · ${esc(p.email)}</li>`);
  return `<div style="font-family:helvetica,arial,sans-serif;font-size:14px;line-height:20px;color:#252a31;">
<p style="font-size:17px;font-weight:600;">Translator, ${esc(label)}</p>
<p>${t.uploads} uploads · ${t.delivered} delivered · ${t.overLimit} stopped at a price · ${t.failed} failed</p>
<p>${esc(funnelLine(a))}<br>${esc(emailLine(a))}<br>${esc(feedbackLine(a)).replace(/\n/g, "<br>")}</p>
<ul style="padding-left:18px;">${rows.join("")}${buys.join("")}</ul>
<p><a href="${base()}/admin" style="color:#252a31;">Everything on /admin</a> (sign in with an admin email).</p></div>`;
}

async function slackDm(text) {
  const token = process.env.SLACK_DIGEST_TOKEN;
  const user = process.env.SLACK_DIGEST_USER;
  if (!token || !user) return false;
  const headers = { Authorization: `Bearer ${token}` };
  const opened = (await axios.post("https://slack.com/api/conversations.open", { users: user }, { headers, timeout: 15000 })).data;
  if (!opened.ok) throw new Error(`Slack conversations.open: ${opened.error}`);
  const sent = (await axios.post("https://slack.com/api/chat.postMessage", { channel: opened.channel.id, text, unfurl_links: false }, { headers, timeout: 15000 })).data;
  if (!sent.ok) throw new Error(`Slack chat.postMessage: ${sent.error}`); // Slack answers 200 with ok:false
  return true;
}

// Sends the activity since `sinceIso`. → where it went: "slack", "email", or "log".
async function send(sinceIso, label) {
  const a = await activity(sinceIso);
  // The log keeps no emails: counts and files only.
  console.log(`[digest] ${label}: ${JSON.stringify(a.totals)}`);
  console.log(`[digest] ${funnelLine(a)}`);
  console.log(`[digest] ${emailLine(a)}`);
  for (const c of a.checkouts || []) console.log(`[digest]   checkout ${c.created} ${c.status}${c.paid ? " paid" : ""} ${c.words} words place=${c.place || "-"} job=${c.jobId || "-"}`);
  for (const j of a.jobs) console.log(`[digest]   ${j.id} ${line({ ...j, email: j.email ? "(email)" : null })}`);
  if (await slackDm(slackText(a, label))) return "slack";
  const to = String(process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);
  if (to.length && email.isConfigured()) {
    for (const address of to) await email.sendEmail({ to: address, subject: `Translator, ${label}: ${a.totals.uploads} uploads`, html: emailHtml(a, label) });
    return "email";
  }
  return "log";
}

function localNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parseInt(parts.hour, 10) };
}

let sending = false;
let loggedOn = null; // with nowhere to send it, the digest is logged once a day and not marked sent
async function tick() {
  if (sending) return;
  const { date, hour } = localNow();
  if (hour < HOUR || loggedOn === date || (await store.getSetting("digest_last_date")) === date) return;
  sending = true;
  try {
    const since = (await store.getSetting("digest_last_at")) || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const now = new Date().toISOString();
    const label = (await store.getSetting("digest_last_at")) ? "the last day" : "the last 7 days";
    const via = await send(since, label);
    if (via === "log") {
      loggedOn = date; // Slack or email set later still gets this one
      console.log("[digest] nowhere to send it: set SLACK_DIGEST_TOKEN and SLACK_DIGEST_USER, or ADMIN_EMAILS");
      return;
    }
    await store.setSetting("digest_last_date", date);
    await store.setSetting("digest_last_at", now);
    console.log(`[digest] sent by ${via}`);
  } catch (err) {
    console.error(`[digest] failed: ${err.message}`); // tries again at the next check
  } finally {
    sending = false;
  }
}

function start() {
  setInterval(() => tick(), CHECK_MS);
  setTimeout(() => tick(), 30 * 1000);
}

module.exports = { activity, send, start, tick };
