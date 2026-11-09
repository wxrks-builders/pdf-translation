/**
 * Who used the translator: every upload since a moment, with what became of it, for the people
 * who run it (access.isAdmin). The admin page (/admin) shows it. Once a day the digest goes out.
 * By default the new people go to Rodrigo's Slack through an n8n workflow (RELAY_URL below), so
 * this app holds no Slack token. With SLACK_DIGEST_TOKEN and SLACK_DIGEST_USER set, the whole day
 * goes as a DM with that token instead. When neither works, it goes by email to ADMIN_EMAILS.
 * Every version opens with the new people: each email that reached us for the first time,
 * flagged work, school or personal, with the file it came with, so a business stands out. Each
 * line links to the job, which an admin can open when signed in.
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

// Mailboxes anyone can open. An address outside them is a work email, unless it is a school's.
const PERSONAL_MAIL = new Set(
  `gmail.com googlemail.com yahoo.com ymail.com rocketmail.com hotmail.com outlook.com live.com msn.com icloud.com me.com mac.com
  aol.com proton.me protonmail.com pm.me tutanota.com fastmail.com hey.com zoho.com mail.com gmx.com gmx.net gmx.de web.de
  t-online.de yandex.com yandex.ru mail.ru bk.ru inbox.ru list.ru rambler.ru qq.com 163.com 126.com sina.com foxmail.com
  naver.com daum.net hanmail.net libero.it virgilio.it orange.fr free.fr laposte.net wanadoo.fr sfr.fr seznam.cz wp.pl
  o2.pl interia.pl onet.pl uol.com.br bol.com.br terra.com.br ig.com.br rediffmail.com`.split(/\s+/)
);
function emailKind(address) {
  const domain = String(address || "").split("@")[1]?.toLowerCase() || "";
  if (!domain) return { domain, mail: "unknown" };
  if (PERSONAL_MAIL.has(domain) || /^(yahoo|hotmail|outlook|live|windowslive|gmx|yandex)\.[a-z.]+$/.test(domain)) return { domain, mail: "personal" };
  if (/(^|\.)(edu|ac|edu\.[a-z]{2}|ac\.[a-z]{2})$|(^|\.)(uni|univ)[-.]|universi/.test(domain)) return { domain, mail: "school" };
  return { domain, mail: "work" };
}
const MAIL_ORDER = { work: 0, school: 1, unknown: 2, personal: 3 };

// One row per job: what a person needs to follow it up.
async function jobRow(job, name) {
  const files = await store.listJobFiles(job.id);
  const scores = Object.entries(job.confidence?.byLocale || {}).map(([loc, e]) => ({ language: name(loc), score: e.score, flagged: e.flagged }));
  const ocr = job.timeline.find((e) => e.event === "ocr_skipped");
  return {
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
  };
}

async function activity(sinceIso) {
  const names = Object.fromEntries((await locales.listLanguages().catch(() => [])).map((l) => [locales.normalize(l.code), l.name]));
  const name = (code) => names[locales.normalize(code)] || code;
  const jobs = [];
  for (const job of await store.listJobsSince(sinceIso)) jobs.push(await jobRow(job, name));
  // Who gave us an email for the first time, work emails first: the people worth a look.
  const byId = Object.fromEntries(jobs.map((j) => [j.id, j]));
  const people = [];
  for (const p of await store.newPeopleSince(sinceIso)) {
    let job = p.jobId ? byId[p.jobId] : null;
    if (!job && p.jobId) {
      const raw = await store.getJob(p.jobId);
      if (raw) job = await jobRow(raw, name);
    }
    const { domain, mail } = emailKind(p.email);
    people.push({ ...p, domain, mail, job: job && { id: job.id, url: job.url, file: job.file, from: job.from, to: job.to, words: job.words, status: job.status } });
  }
  people.sort((x, y) => MAIL_ORDER[x.mail] - MAIL_ORDER[y.mail] || x.at.localeCompare(y.at));
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
    people,
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
      newPeople: people.length,
      workEmails: people.filter((p) => p.mail === "work").length,
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

const MAIL_LABEL = { work: "work email", school: "school email", personal: "personal email", unknown: null };

// "ana@acme.com · work email, acme.com · made an account · bought 10,000 words"; the upload
// they came with is a separate part, so Slack and email can each link it their own way.
function personLine(p) {
  const mail = MAIL_LABEL[p.mail] && (p.mail === "personal" ? MAIL_LABEL[p.mail] : `${MAIL_LABEL[p.mail]}, ${p.domain}`);
  const how = p.how === "account" ? "made an account" : `left an email${p.news ? " (wants product news)" : ""}`;
  return [p.email, mail, how, p.boughtWords ? `bought ${n(p.boughtWords)} words` : null].filter(Boolean).join(" · ");
}
function personJob(p) {
  const j = p.job;
  if (!j) return null;
  return [j.file, `${j.from} → ${j.to.join(", ")}`, j.words != null ? `${n(j.words)} words` : null, j.status].filter(Boolean).join(", ");
}
function peopleHead(a) {
  const t = a.totals;
  return t.newPeople ? `New people: ${t.newPeople} (${t.workEmails} with a work email)` : "New people: none";
}

function slackText(a, label) {
  const t = a.totals;
  const clean = (s) => String(s).replace(/[<>|]/g, "");
  const people = a.people.slice(0, 40).map((p) => `• ${clean(personLine(p))}${p.job ? ` · <${p.job.url}|${clean(personJob(p))}>` : ""}`);
  const head = [
    `*Translator, ${label}*`,
    `*${peopleHead(a)}*`,
    ...people,
    "",
    `${t.uploads} uploads · ${t.delivered} delivered · ${t.overLimit} stopped at a price · ${t.failed} failed · ${t.signupCredits} sign-up credits given`,
    funnelLine(a),
    emailLine(a),
    feedbackLine(a),
  ].join("\n");
  const jobs = a.jobs.slice(0, 40).map((j) => `• <${j.url}|${clean(line(j))}>`);
  const more = a.jobs.length > 40 ? [`…and ${a.jobs.length - 40} more`] : [];
  const buys = a.purchases.map((p) => `• Bought ${n(p.words)} words${p.amount ? ` for ${p.amount}` : ""} · ${p.email}`);
  return [head, ...jobs, ...more, ...buys, `<${base()}/admin|Everything on /admin>`].join("\n");
}

function emailHtml(a, label) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const t = a.totals;
  const rows = a.jobs.map((j) => `<li style="margin:0 0 8px;"><a href="${j.url}" style="color:#252a31;">${esc(j.file)}</a><br><span style="color:#57616d;">${esc(line(j))}</span></li>`);
  const buys = a.purchases.map((p) => `<li>Bought ${n(p.words)} words${p.amount ? ` for ${esc(p.amount)}` : ""} · ${esc(p.email)}</li>`);
  const people = a.people.map(
    (p) => `<li style="margin:0 0 8px;">${esc(personLine(p))}${p.job ? `<br><a href="${p.job.url}" style="color:#57616d;">${esc(personJob(p))}</a>` : ""}</li>`
  );
  return `<div style="font-family:helvetica,arial,sans-serif;font-size:14px;line-height:20px;color:#252a31;">
<p style="font-size:17px;font-weight:600;">Translator, ${esc(label)}</p>
<p style="font-weight:600;">${esc(peopleHead(a))}</p>
${people.length ? `<ul style="padding-left:18px;">${people.join("")}</ul>` : ""}
<p>${t.uploads} uploads · ${t.delivered} delivered · ${t.overLimit} stopped at a price · ${t.failed} failed</p>
<p>${esc(funnelLine(a))}<br>${esc(emailLine(a))}<br>${esc(feedbackLine(a)).replace(/\n/g, "<br>")}</p>
<ul style="padding-left:18px;">${rows.join("")}${buys.join("")}</ul>
<p><a href="${base()}/admin" style="color:#252a31;">Everything on /admin</a> (sign in with your @wxrks.com email).</p></div>`;
}

// The n8n workflow that DMs Rodrigo through n8n's own Slack connection, the way the CRM's
// morning DMs reach him (marketing-writing-style/ops/n8n/translator-people.workflow.json), so
// this app holds no Slack token. The webhook only runs for a title and a link back to this app.
// It gets the new people only, and nothing on a day without any. DIGEST_RELAY_URL=off stops it.
const RELAY_URL = process.env.DIGEST_RELAY_URL ?? "https://bureauworks.app.n8n.cloud/webhook/translator-people";
const RELAY_MAX = 25;

function relayMessage(a, label) {
  const t = a.totals;
  const clean = (s) => String(s).replace(/[<>|]/g, "");
  const people = a.people.slice(0, RELAY_MAX).map((p) => `• ${clean(personLine(p))}${p.job ? ` · <${p.job.url}|${clean(personJob(p))}>` : ""}`);
  const more = a.people.length > RELAY_MAX ? [`…and ${a.people.length - RELAY_MAX} more`] : [];
  return {
    source: "translator-digest",
    title: `Translator · ${t.newPeople} new ${t.newPeople === 1 ? "person" : "people"} in ${label}${t.workEmails ? ` (${t.workEmails} with a work email)` : ""}`,
    lines: [...people, ...more, `${t.uploads} uploads · ${t.delivered} delivered · ${t.overLimit} stopped at a price · ${t.purchases} ${t.purchases === 1 ? "purchase" : "purchases"}`],
    url: `${base()}/admin`,
  };
}

async function relay(a, label) {
  if (!RELAY_URL || RELAY_URL === "off") return false;
  const res = await axios.post(RELAY_URL, relayMessage(a, label), { timeout: 15000, validateStatus: () => true });
  if (res.status >= 300) {
    console.log(`[digest] relay answered ${res.status}`); // 404 until the n8n workflow is active
    return false;
  }
  return true;
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

// Sends the activity since `sinceIso`. → where it went: "slack", "relay", "nobody new",
// "email", or "log".
async function send(sinceIso, label, { logDetails = true } = {}) {
  const a = await activity(sinceIso);
  // The log keeps no emails: counts and files only.
  console.log(`[digest] ${label}: ${JSON.stringify(a.totals)}`);
  if (logDetails) {
    console.log(`[digest] ${funnelLine(a)}`);
    console.log(`[digest] ${emailLine(a)}`);
    console.log(`[digest] ${peopleHead(a)}`);
    for (const c of a.checkouts || []) console.log(`[digest]   checkout ${c.created} ${c.status}${c.paid ? " paid" : ""} ${c.words} words place=${c.place || "-"} job=${c.jobId || "-"}`);
    for (const j of a.jobs) console.log(`[digest]   ${j.id} ${line({ ...j, email: j.email ? "(email)" : null })}`);
  }
  if (await slackDm(slackText(a, label))) return "slack";
  if (!a.people.length && RELAY_URL && RELAY_URL !== "off") return "nobody new";
  if (await relay(a, label)) return "relay";
  const to = String(process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);
  if (to.length && email.isConfigured()) {
    for (const address of to) await email.sendEmail({ to: address, subject: `Translator, ${label}: ${a.totals.newPeople} new people, ${a.totals.uploads} uploads`, html: emailHtml(a, label) });
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
// With nowhere to send it (the n8n workflow not active yet), the digest is not marked sent and
// tries again in an hour; its details go to the log once a day.
const RETRY_MS = 60 * 60 * 1000;
let retryAt = 0;
let detailsOn = null;
async function tick() {
  if (sending) return;
  const { date, hour } = localNow();
  if (hour < HOUR || Date.now() < retryAt || (await store.getSetting("digest_last_date")) === date) return;
  sending = true;
  try {
    const since = (await store.getSetting("digest_last_at")) || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const now = new Date().toISOString();
    const label = (await store.getSetting("digest_last_at")) ? "the last day" : "the last 7 days";
    const via = await send(since, label, { logDetails: detailsOn !== date });
    detailsOn = date;
    if (via === "log") {
      retryAt = Date.now() + RETRY_MS;
      console.log("[digest] nowhere to send it yet: activate the translator-people workflow in n8n, or set SLACK_DIGEST_TOKEN and SLACK_DIGEST_USER, or ADMIN_EMAILS. Trying again in an hour.");
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

module.exports = { activity, send, start, tick, slackText, relayMessage, emailKind };
