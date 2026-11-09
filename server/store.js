const crypto = require("crypto");
const { db } = require("./db");

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

const newId = () => crypto.randomUUID();
// Short base36 id — doubles as the wxrks filename prefix, so keep it compact.
const newJobId = () => Date.now().toString(36).slice(-4) + crypto.randomBytes(3).toString("hex");

const nowIso = () => new Date().toISOString();
const isoIn = (ms) => new Date(Date.now() + ms).toISOString();
const todayUtc = () => new Date().toISOString().slice(0, 10);

// JSON columns come back as TEXT; parse them once, here.
function parseJob(row) {
  if (!row) return null;
  return {
    ...row,
    target_locales: JSON.parse(row.target_locales),
    timeline: JSON.parse(row.timeline),
    tone: row.tone ? JSON.parse(row.tone) : null,
    confidence: row.confidence ? JSON.parse(row.confidence) : null,
  };
}

// --- users / auth ---

async function upsertUserByEmail(email) {
  const normalized = email.trim().toLowerCase();
  return db
    .prepare(
      `INSERT INTO users (id, email, last_login_at) VALUES (?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET last_login_at = excluded.last_login_at
       RETURNING *`
    )
    .get(newId(), normalized, nowIso());
}

async function getUserByEmail(email) {
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(String(email).trim().toLowerCase()) || null;
}

async function getUserById(id) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) || null;
}

async function createLoginToken(email) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare(`INSERT INTO login_tokens (id, token, email, expires_at) VALUES (?, ?, ?, ?)`).run(
    newId(),
    token,
    email.trim().toLowerCase(),
    isoIn(LOGIN_TOKEN_TTL_MS)
  );
  return token;
}

// Atomically consumes the token (single use) and returns its email, or null.
async function consumeLoginToken(token) {
  const row = db
    .prepare(
      `UPDATE login_tokens SET used_at = ?
       WHERE token = ? AND used_at IS NULL AND expires_at > ?
       RETURNING email`
    )
    .get(nowIso(), token, nowIso());
  return row?.email || null;
}

// via: "link" when a sign-in link proved the email, "purchase" when a Checkout made the account.
async function createSession(userId, via) {
  const id = crypto.randomBytes(32).toString("hex");
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, via) VALUES (?, ?, ?, ?)`).run(
    id,
    userId,
    isoIn(SESSION_MAX_AGE_MS),
    via || null
  );
  return id;
}

async function getSessionWithUser(sessionId) {
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.via, u.id AS user_id, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`
    )
    .get(sessionId, nowIso());
  if (!row) return null;
  return { sessionId: row.session_id, user: { id: row.user_id, email: row.email, emailProven: row.via === "link" } };
}

async function touchSession(sessionId) {
  db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(nowIso(), sessionId);
}

async function deleteSession(sessionId) {
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
}

// --- credits ---

async function getCreditBalance(userId) {
  const row = db.prepare(`SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_ledger WHERE user_id = ?`).get(userId);
  return row.balance;
}

async function getCreditLedger(userId, limit = 50) {
  return db
    .prepare(
      `SELECT id, delta, kind, job_id, note, created_at FROM credit_ledger
       WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(userId, limit);
}

async function grantCredits(userId, amount, kind, note) {
  db.prepare(`INSERT INTO credit_ledger (id, user_id, delta, kind, note) VALUES (?, ?, ?, ?, ?)`).run(
    newId(),
    userId,
    amount,
    kind,
    note || null
  );
}

// The sign-up credit (services/signupCredit.js): once per account and at most dailyCap a day,
// checked and written in one transaction so two sign-ins at the same moment can't both get it.
// → true when it was granted.
async function grantSignupCredit(userId, words, note, dailyCap, sinceIso) {
  return db.transaction(() => {
    if (db.prepare(`SELECT 1 FROM credit_ledger WHERE user_id = ? AND kind = 'signup'`).get(userId)) return false;
    const given = db.prepare(`SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'signup' AND created_at >= ?`).get(sinceIso).n;
    if (given >= dailyCap) return false;
    db.prepare(`INSERT INTO credit_ledger (id, user_id, delta, kind, note) VALUES (?, ?, ?, 'signup', ?)`).run(newId(), userId, words, note);
    return true;
  })();
}

async function countSignupCreditsSince(sinceIso) {
  return db.prepare(`SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'signup' AND created_at >= ?`).get(sinceIso).n;
}

// Transactional: check balance and insert the charge atomically. SQLite
// serializes writers, so the transaction alone prevents double-spends.
// Returns { ok: true } or { ok: false, balance }. Idempotent per job via the
// partial unique index on (job_id, kind).
const chargeTx = db.transaction((userId, jobId, amount) => {
  const already = db.prepare(`SELECT id FROM credit_ledger WHERE job_id = ? AND kind = 'charge'`).get(jobId);
  if (already) return { ok: true, alreadyCharged: true };
  const { balance } = db
    .prepare(`SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_ledger WHERE user_id = ?`)
    .get(userId);
  if (balance < amount) return { ok: false, balance };
  db.prepare(
    `INSERT INTO credit_ledger (id, user_id, delta, kind, job_id, note) VALUES (?, ?, ?, 'charge', ?, ?)`
  ).run(newId(), userId, -amount, jobId, "translation charge");
  db.prepare(`UPDATE jobs SET credits_charged = ?, updated_at = ? WHERE id = ?`).run(amount, nowIso(), jobId);
  return { ok: true };
});

async function chargeForJob(userId, jobId, amount) {
  return chargeTx(userId, jobId, amount);
}

// Refund exactly what the job charged; no-op if nothing was charged or already refunded.
async function refundForJob(jobId) {
  const job = db.prepare(`SELECT user_id, credits_charged FROM jobs WHERE id = ?`).get(jobId);
  if (!job || !job.user_id || !job.credits_charged) return false;
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO credit_ledger (id, user_id, delta, kind, job_id, note)
       VALUES (?, ?, ?, 'refund', ?, 'refund: job failed or cancelled')`
    )
    .run(newId(), job.user_id, job.credits_charged, jobId);
  return info.changes > 0;
}

// --- jobs ---

async function createJob({ userId, anonCookieId, tier, sourceLocale, targetLocales, orgUnitUuid, tone, excerptOf, excerptPages, excerptTotalPages, clientIp, welcomeEligible }) {
  const id = newJobId();
  const row = db
    .prepare(
      `INSERT INTO jobs (id, user_id, anon_cookie_id, tier, status, source_locale, target_locales, org_unit_uuid, timeline,
                         tone, excerpt_of, excerpt_pages, excerpt_total_pages, client_ip, welcome_eligible)
       VALUES (?, ?, ?, ?, 'created', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .get(
      id,
      userId || null,
      anonCookieId || null,
      tier,
      sourceLocale,
      JSON.stringify(targetLocales),
      orgUnitUuid,
      JSON.stringify([{ at: nowIso(), event: "created" }]),
      tone ? JSON.stringify(tone) : null,
      excerptOf || null,
      excerptPages || null,
      excerptTotalPages || null,
      clientIp || null,
      welcomeEligible ? 1 : 0
    );
  return parseJob(row);
}

// The page-1 preview job of a free job over the word limit, if one was started.
async function getExcerptFor(jobId) {
  return parseJob(db.prepare(`SELECT * FROM jobs WHERE excerpt_of = ? ORDER BY created_at DESC LIMIT 1`).get(jobId));
}

async function getJob(id) {
  return parseJob(db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id));
}

async function listJobsForUser(userId, limit = 50) {
  return db
    .prepare(
      `SELECT id, tier, status, source_locale, target_locales, analyzed_words, credits_charged, error, created_at, updated_at
       FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(userId, limit)
    .map((r) => ({ ...r, target_locales: JSON.parse(r.target_locales) }));
}

async function listActiveJobs() {
  return db.prepare(`SELECT * FROM jobs WHERE status IN ('approving', 'translating')`).all().map(parseJob);
}

async function listJobsWithConfidence(status) {
  return db.prepare(`SELECT * FROM jobs WHERE confidence_status = ?`).all(status).map(parseJob);
}

// Everything visitors started since a moment (excerpts are part of their parent job), newest
// first, with the email the job is known by: the account's, or the one left at the email step.
async function listJobsSince(sinceIso) {
  return db
    .prepare(
      `SELECT jobs.*, users.email AS user_email FROM jobs LEFT JOIN users ON users.id = jobs.user_id
       WHERE jobs.created_at >= ? AND jobs.excerpt_of IS NULL ORDER BY jobs.created_at DESC`
    )
    .all(sinceIso)
    .map(parseJob);
}

async function listPurchasesSince(sinceIso) {
  return db.prepare(`SELECT * FROM purchases WHERE created_at >= ? ORDER BY created_at DESC`).all(sinceIso);
}

async function recordEvent({ name, place, jobId, visitor, detail, dedupeKey }) {
  db.prepare(`INSERT OR IGNORE INTO events (name, place, job_id, visitor, detail, dedupe_key) VALUES (?, ?, ?, ?, ?, ?)`).run(
    name,
    place || null,
    jobId || null,
    visitor || null,
    detail ? JSON.stringify(detail) : null,
    dedupeKey || null
  );
}

async function listEventsSince(sinceIso) {
  return db
    .prepare(`SELECT * FROM events WHERE created_at >= ? ORDER BY created_at`)
    .all(sinceIso)
    .map((e) => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null }));
}

async function getSetting(key) {
  return db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key)?.value ?? null;
}

async function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

async function updateJob(id, fields) {
  const allowed = [
    "status",
    "wxrks_project_uuid",
    "layout_project_uuid",
    "analyzed_words",
    "credits_charged",
    "error",
    "unlocked_at",
    "unlocked_email",
    "tone_agent_uuid",
    "confidence_status",
    "confidence",
    "welcome_used",
  ];
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k)) throw new Error(`updateJob: field ${k} not allowed`);
    sets.push(`${k} = ?`);
    params.push(v);
  }
  sets.push(`updated_at = ?`);
  params.push(nowIso(), id);
  const row = db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ? RETURNING *`).get(...params);
  return parseJob(row);
}

async function appendJobEvent(id, event, detail) {
  const entry = { at: nowIso(), event, ...(detail ? { detail } : {}) };
  db.prepare(`UPDATE jobs SET timeline = json_insert(timeline, '$[#]', json(?)), updated_at = ? WHERE id = ?`).run(
    JSON.stringify(entry),
    nowIso(),
    id
  );
}

// --- job files ---

async function createJobFile({ jobId, originalFilename, wxrksFilename, sizeBytes, contentType, content }) {
  return db
    .prepare(
      `INSERT INTO job_files (id, job_id, original_filename, wxrks_filename, size_bytes, content_type, source_content)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id, job_id, original_filename, wxrks_filename, size_bytes, status`
    )
    .get(newId(), jobId, originalFilename, wxrksFilename, sizeBytes, contentType || null, content);
}

async function listJobFiles(jobId, { withContent = false } = {}) {
  const cols = withContent
    ? "*"
    : "id, job_id, original_filename, wxrks_filename, resource_uuid, size_bytes, content_type, status, layout_status, layout_filename, layout_resource_uuid, ocr_pages";
  return db.prepare(`SELECT ${cols} FROM job_files WHERE job_id = ? ORDER BY original_filename`).all(jobId);
}

// A scanned PDF after OCR: the same pages with their text readable (services/layout.js ocr).
async function replaceScannedFileContent(id, content, ocrPages) {
  db.prepare(`UPDATE job_files SET source_content = ?, size_bytes = ?, ocr_pages = ? WHERE id = ?`).run(content, content.length, ocrPages, id);
}

async function getJobFileContent(id) {
  const row = db.prepare(`SELECT source_content FROM job_files WHERE id = ?`).get(id);
  return row?.source_content || null;
}

async function getJobFileLayoutUnits(id) {
  const row = db.prepare(`SELECT layout_units FROM job_files WHERE id = ?`).get(id);
  return row?.layout_units ? JSON.parse(row.layout_units) : null;
}

async function updateJobFile(id, { resourceUuid, status, wxrksFilename, layoutStatus, layoutFilename, layoutResourceUuid, layoutUnits }) {
  db.prepare(
    `UPDATE job_files SET resource_uuid = COALESCE(?, resource_uuid), status = COALESCE(?, status),
       wxrks_filename = COALESCE(?, wxrks_filename), layout_status = COALESCE(?, layout_status),
       layout_filename = COALESCE(?, layout_filename), layout_resource_uuid = COALESCE(?, layout_resource_uuid),
       layout_units = COALESCE(?, layout_units) WHERE id = ?`
  ).run(
    resourceUuid || null,
    status || null,
    wxrksFilename || null,
    layoutStatus || null,
    layoutFilename || null,
    layoutResourceUuid || null,
    layoutUnits ? JSON.stringify(layoutUnits) : null,
    id
  );
}

// --- deliverables + dedupe ---

// Stores a deliverable and marks its (project, filename, locale) triple
// processed in one transaction, so poller/webhook overlap can't double-store.
const storeDeliverableTx = db.transaction((args) => {
  const dedupe = db
    .prepare(
      `INSERT OR IGNORE INTO processed_work_units (wxrks_project_uuid, wxrks_filename, locale) VALUES (?, ?, ?)`
    )
    .run(args.projectUuid, args.wxrksFilename, args.locale);
  if (dedupe.changes === 0) return false; // already processed by a concurrent worker
  // One work unit can yield several files (a design-kept PDF + its page-image version).
  const files = args.files || [{ variant: "translation", filename: args.filename, content: args.content }];
  for (const f of files) {
    db.prepare(
      `INSERT OR IGNORE INTO deliverables (id, job_id, job_file_id, locale, variant, filename, content, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(newId(), args.jobId, args.jobFileId, args.locale, f.variant, f.filename, f.content, f.content.length);
  }
  return true;
});

async function storeDeliverable(args) {
  return storeDeliverableTx(args);
}

// A work unit that ends without a file (a design-kept PDF that couldn't be rebuilt) is still
// marked processed, so the job can complete without it.
async function markProcessed(projectUuid, wxrksFilename, locale) {
  db.prepare(
    `INSERT OR IGNORE INTO processed_work_units (wxrks_project_uuid, wxrks_filename, locale) VALUES (?, ?, ?)`
  ).run(projectUuid, wxrksFilename, locale);
}

async function countProcessed(projectUuid) {
  return db.prepare(`SELECT COUNT(*) AS n FROM processed_work_units WHERE wxrks_project_uuid = ?`).get(projectUuid).n;
}

async function isProcessed(projectUuid, wxrksFilename, locale) {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM processed_work_units WHERE wxrks_project_uuid = ? AND wxrks_filename = ? AND locale = ?`)
      .get(projectUuid, wxrksFilename, locale)
  );
}

async function listDeliverables(jobId, { withContent = false } = {}) {
  const cols = withContent ? "*" : "id, job_id, job_file_id, locale, variant, filename, size_bytes, created_at";
  return db.prepare(`SELECT ${cols} FROM deliverables WHERE job_id = ? ORDER BY locale, filename`).all(jobId);
}

async function getDeliverable(id) {
  return db.prepare(`SELECT * FROM deliverables WHERE id = ?`).get(id) || null;
}

// --- free tier ---

// A released row (the document was never translated) doesn't use the day up, but only
// MAX_RELEASED_PER_DAY of them, so a visitor can't keep the analysis running all day.
const MAX_RELEASED_PER_DAY = 3;

async function findFreeTierUsageToday({ ip, cookieId }) {
  const rows = db
    .prepare(
      `SELECT * FROM free_tier_usage
       WHERE used_on = ? AND (ip = ? OR (cookie_id IS NOT NULL AND cookie_id = ?))`
    )
    .all(todayUtc(), ip, cookieId || null);
  const used = rows.find((r) => !r.released);
  if (used) return used;
  return rows.length >= MAX_RELEASED_PER_DAY ? rows[0] : null;
}

async function releaseFreeTierUsage(jobId) {
  db.prepare(`UPDATE free_tier_usage SET released = 1 WHERE job_id = ?`).run(jobId);
}

// --- leads (the free tier's email step) ---

async function recordLead({ email, jobId, marketingOptIn, suspectedBot, ip, userAgent }) {
  const id = newId();
  db.prepare(
    `INSERT INTO leads (id, email, job_id, marketing_opt_in, suspected_bot, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, email, jobId || null, marketingOptIn ? 1 : 0, suspectedBot ? 1 : 0, ip || null, userAgent || null);
  return id;
}

// --- CRM outbox (services/crm.js) ---

async function queueCrmEvent(event) {
  db.prepare(`INSERT OR IGNORE INTO crm_outbox (key, payload) VALUES (?, ?)`).run(event.key, JSON.stringify(event));
}

async function listUnsentCrmEvents(limit, maxAttempts) {
  return db
    .prepare(`SELECT key, payload FROM crm_outbox WHERE sent_at IS NULL AND attempts < ? ORDER BY created_at LIMIT ?`)
    .all(maxAttempts, limit)
    .map((r) => ({ key: r.key, event: JSON.parse(r.payload) }));
}

async function markCrmEventSent(key) {
  db.prepare(`UPDATE crm_outbox SET sent_at = ?, last_error = NULL WHERE key = ?`).run(nowIso(), key);
}

async function markCrmEventFailed(key, error) {
  db.prepare(`UPDATE crm_outbox SET attempts = attempts + 1, last_error = ? WHERE key = ?`).run(String(error).slice(0, 300), key);
}

// What the CRM has been told about, for the backfill: everything the outbox has never seen.
async function listCrmBackfill() {
  const seen = `SELECT 1 FROM crm_outbox WHERE key = `;
  return {
    users: db.prepare(`SELECT id, email, created_at FROM users u WHERE NOT EXISTS (${seen} 'account:' || u.id)`).all(),
    leads: db
      .prepare(`SELECT id, email, job_id, marketing_opt_in, created_at FROM leads l WHERE suspected_bot = 0 AND NOT EXISTS (${seen} 'lead:' || l.id)`)
      .all(),
    purchases: db.prepare(`SELECT * FROM purchases p WHERE NOT EXISTS (${seen} 'purchase:' || p.stripe_session_id)`).all(),
    jobs: db
      .prepare(
        `SELECT id FROM jobs j WHERE status = 'delivered' AND excerpt_of IS NULL
           AND (user_id IS NOT NULL OR unlocked_email IS NOT NULL)
           AND NOT EXISTS (${seen} 'translation:' || j.id)`
      )
      .all()
      .map((r) => r.id),
  };
}

// The newest email-step answer for a job: did they tick "product news"?
async function getLatestLeadForJob(jobId) {
  return db.prepare(`SELECT * FROM leads WHERE job_id = ? AND suspected_bot = 0 ORDER BY created_at DESC LIMIT 1`).get(jobId) || null;
}

async function createdUserForPurchase(userId) {
  return Boolean(db.prepare(`SELECT 1 FROM purchases WHERE user_id = ? AND created_user = 1`).get(userId));
}

async function saveFeedback({ jobId, source, rating, comment, visitor }) {
  db.prepare(
    `INSERT INTO feedback (job_id, source, rating, comment, visitor, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(job_id, source) DO UPDATE SET rating = excluded.rating,
       comment = COALESCE(excluded.comment, feedback.comment), created_at = excluded.created_at`
  ).run(jobId, source, rating, comment || null, visitor || null, nowIso());
}

async function getFeedback(jobId) {
  return db.prepare(`SELECT * FROM feedback WHERE job_id = ? ORDER BY created_at DESC`).all(jobId);
}

async function listFeedbackSince(sinceIso) {
  return db.prepare(`SELECT * FROM feedback WHERE created_at >= ? ORDER BY created_at DESC`).all(sinceIso);
}

// Delivered jobs that haven't had the feedback email, with the address it would go to.
async function listFeedbackEmailCandidates() {
  return db
    .prepare(
      `SELECT jobs.*, users.email AS user_email FROM jobs LEFT JOIN users ON users.id = jobs.user_id
       WHERE jobs.status = 'delivered' AND jobs.excerpt_of IS NULL AND jobs.feedback_email_sent_at IS NULL
         AND COALESCE(users.email, jobs.unlocked_email) IS NOT NULL`
    )
    .all()
    .map(parseJob);
}

// Exactly one feedback email per job.
async function claimFeedbackEmail(jobId) {
  return Boolean(db.prepare(`UPDATE jobs SET feedback_email_sent_at = ? WHERE id = ? AND feedback_email_sent_at IS NULL`).run(nowIso(), jobId).changes);
}

// The email addresses visitors gave since a moment: at the email step (leads), and accounts made.
async function emailStatsSince(sinceIso) {
  const leads = db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT email) AS people, SUM(marketing_opt_in) AS news FROM leads WHERE created_at >= ? AND suspected_bot = 0`).get(sinceIso);
  const accounts = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE created_at >= ?`).get(sinceIso);
  return { leads: leads.n, leadPeople: leads.people, newsOptIns: leads.news || 0, accounts: accounts.n };
}

// The people who first gave the translator their email since a moment, one row per address:
// accounts made (by a sign-in link or a purchase), then emails left at the email step by someone
// who has no account and never left one before. Each row carries the upload it came with (the
// account's first job, or the job of the email step) and what they bought since.
async function newPeopleSince(sinceIso) {
  const firstJob = db.prepare(`SELECT id FROM jobs WHERE user_id = ? AND excerpt_of IS NULL ORDER BY created_at LIMIT 1`);
  const leadJob = db.prepare(`SELECT job_id FROM leads WHERE lower(email) = ? AND job_id IS NOT NULL ORDER BY created_at LIMIT 1`);
  const bought = db.prepare(`SELECT COALESCE(SUM(words), 0) AS words FROM purchases WHERE lower(email) = ? AND created_at >= ?`);
  const accounts = db.prepare(`SELECT id, email, created_at FROM users WHERE created_at >= ? ORDER BY created_at`).all(sinceIso);
  const leads = db
    .prepare(
      `SELECT lower(email) AS email, MIN(created_at) AS created_at, MAX(marketing_opt_in) AS news FROM leads l
       WHERE created_at >= ? AND suspected_bot = 0
         AND lower(email) NOT IN (SELECT email FROM users)
         AND NOT EXISTS (SELECT 1 FROM leads o WHERE lower(o.email) = lower(l.email) AND o.created_at < ?)
       GROUP BY lower(email) ORDER BY MIN(created_at)`
    )
    .all(sinceIso, sinceIso);
  const row = (how, email, at, news, jobId) => ({ how, email, at, news: Boolean(news), jobId: jobId || null, boughtWords: bought.get(email, sinceIso).words });
  return [
    ...accounts.map((u) => row("account", u.email, u.created_at, false, firstJob.get(u.id)?.id || leadJob.get(u.email)?.job_id)),
    ...leads.map((l) => row("email", l.email, l.created_at, l.news, leadJob.get(l.email)?.job_id)),
  ];
}

// Exactly one files email per job: whoever sets files_emailed_at first sends it.
async function claimFilesEmail(jobId) {
  const row = db
    .prepare(`UPDATE jobs SET files_emailed_at = ? WHERE id = ? AND files_emailed_at IS NULL RETURNING *`)
    .get(nowIso(), jobId);
  return parseJob(row);
}

async function countFilesEmailsSince(sinceIso, email) {
  const sql = email
    ? `SELECT COUNT(*) AS n FROM jobs WHERE files_emailed_at >= ? AND unlocked_email = ?`
    : `SELECT COUNT(*) AS n FROM jobs WHERE files_emailed_at >= ?`;
  return db.prepare(sql).get(...(email ? [sinceIso, email] : [sinceIso])).n;
}

async function recordFreeTierUsage({ ip, cookieId, jobId }) {
  db.prepare(`INSERT INTO free_tier_usage (id, ip, cookie_id, used_on, job_id) VALUES (?, ?, ?, ?, ?)`).run(
    newId(),
    ip,
    cookieId || null,
    todayUtc(),
    jobId
  );
}

async function setFreeTierUsageWords(jobId, words) {
  db.prepare(`UPDATE free_tier_usage SET words = ? WHERE job_id = ?`).run(words, jobId);
}

// --- retention ---

// --- purchases (Stripe Checkout) ---

// Records a paid Checkout Session and grants its words, together. → true the first time,
// false when Stripe delivers the same session again.
async function recordPurchase({ sessionId, userId, email, words, amountCents, currency, jobId, createdUser }) {
  return db.transaction(() => {
    const info = db
      .prepare(
        `INSERT OR IGNORE INTO purchases (id, stripe_session_id, user_id, email, words, amount_cents, currency, job_id, created_user)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(newId(), sessionId, userId, email, words, amountCents ?? null, currency || null, jobId || null, createdUser ? 1 : 0);
    if (!info.changes) return false;
    db.prepare(`INSERT INTO credit_ledger (id, user_id, delta, kind, note) VALUES (?, ?, ?, 'purchase', ?)`).run(
      newId(),
      userId,
      words,
      `${words.toLocaleString("en-US")}-word pack`
    );
    return true;
  })();
}

async function getPurchase(sessionId) {
  return db.prepare(`SELECT * FROM purchases WHERE stripe_session_id = ?`).get(sessionId) || null;
}

// Signs the buyer's browser in once, for an account the purchase itself created.
async function claimPurchase(sessionId) {
  return (
    db
      .prepare(`UPDATE purchases SET claimed_at = ? WHERE stripe_session_id = ? AND claimed_at IS NULL AND created_user = 1 RETURNING *`)
      .get(nowIso(), sessionId) || null
  );
}

async function sweepOldBlobs(retentionDays) {
  const cutoff = isoIn(-retentionDays * 24 * 60 * 60 * 1000);
  const d = db
    .prepare(`UPDATE deliverables SET content = zeroblob(0) WHERE created_at < ? AND length(content) > 0`)
    .run(cutoff);
  const f = db
    .prepare(
      `UPDATE job_files SET source_content = NULL
       WHERE source_content IS NOT NULL AND job_id IN (SELECT id FROM jobs WHERE created_at < ?)`
    )
    .run(cutoff);
  return { deliverables: d.changes, jobFiles: f.changes };
}

module.exports = {
  SESSION_MAX_AGE_MS,
  LOGIN_TOKEN_TTL_MS,
  newId,
  newJobId,
  upsertUserByEmail,
  getUserByEmail,
  getUserById,
  createLoginToken,
  consumeLoginToken,
  createSession,
  getSessionWithUser,
  touchSession,
  deleteSession,
  getCreditBalance,
  getCreditLedger,
  grantCredits,
  grantSignupCredit,
  countSignupCreditsSince,
  chargeForJob,
  refundForJob,
  createJob,
  getExcerptFor,
  getJob,
  listJobsForUser,
  listActiveJobs,
  listJobsWithConfidence,
  listJobsSince,
  listPurchasesSince,
  recordEvent,
  listEventsSince,
  saveFeedback,
  getFeedback,
  listFeedbackSince,
  listFeedbackEmailCandidates,
  claimFeedbackEmail,
  emailStatsSince,
  newPeopleSince,
  getSetting,
  setSetting,
  updateJob,
  appendJobEvent,
  createJobFile,
  listJobFiles,
  replaceScannedFileContent,
  getJobFileContent,
  getJobFileLayoutUnits,
  updateJobFile,
  storeDeliverable,
  markProcessed,
  countProcessed,
  isProcessed,
  listDeliverables,
  getDeliverable,
  findFreeTierUsageToday,
  recordFreeTierUsage,
  setFreeTierUsageWords,
  releaseFreeTierUsage,
  recordPurchase,
  getPurchase,
  claimPurchase,
  queueCrmEvent,
  listUnsentCrmEvents,
  markCrmEventSent,
  markCrmEventFailed,
  listCrmBackfill,
  getLatestLeadForJob,
  createdUserForPurchase,
  recordLead,
  claimFilesEmail,
  countFilesEmailsSince,
  sweepOldBlobs,
};
