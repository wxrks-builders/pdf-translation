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
  return { ...row, target_locales: JSON.parse(row.target_locales), timeline: JSON.parse(row.timeline) };
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

async function createSession(userId) {
  const id = crypto.randomBytes(32).toString("hex");
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`).run(
    id,
    userId,
    isoIn(SESSION_MAX_AGE_MS)
  );
  return id;
}

async function getSessionWithUser(sessionId) {
  const row = db
    .prepare(
      `SELECT s.id AS session_id, u.id AS user_id, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`
    )
    .get(sessionId, nowIso());
  if (!row) return null;
  return { sessionId: row.session_id, user: { id: row.user_id, email: row.email } };
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

async function createJob({ userId, anonCookieId, tier, sourceLocale, targetLocales, orgUnitUuid }) {
  const id = newJobId();
  const row = db
    .prepare(
      `INSERT INTO jobs (id, user_id, anon_cookie_id, tier, status, source_locale, target_locales, org_unit_uuid, timeline)
       VALUES (?, ?, ?, ?, 'created', ?, ?, ?, ?) RETURNING *`
    )
    .get(
      id,
      userId || null,
      anonCookieId || null,
      tier,
      sourceLocale,
      JSON.stringify(targetLocales),
      orgUnitUuid,
      JSON.stringify([{ at: nowIso(), event: "created" }])
    );
  return parseJob(row);
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

async function updateJob(id, fields) {
  const allowed = ["status", "wxrks_project_uuid", "layout_project_uuid", "analyzed_words", "credits_charged", "error"];
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
    : "id, job_id, original_filename, wxrks_filename, resource_uuid, size_bytes, content_type, status, layout_status, layout_filename, layout_resource_uuid";
  return db.prepare(`SELECT ${cols} FROM job_files WHERE job_id = ? ORDER BY original_filename`).all(jobId);
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

async function findFreeTierUsageToday({ ip, cookieId }) {
  return (
    db
      .prepare(
        `SELECT * FROM free_tier_usage
         WHERE used_on = ? AND (ip = ? OR (cookie_id IS NOT NULL AND cookie_id = ?))
         LIMIT 1`
      )
      .get(todayUtc(), ip, cookieId || null) || null
  );
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
  chargeForJob,
  refundForJob,
  createJob,
  getJob,
  listJobsForUser,
  listActiveJobs,
  updateJob,
  appendJobEvent,
  createJobFile,
  listJobFiles,
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
  sweepOldBlobs,
};
