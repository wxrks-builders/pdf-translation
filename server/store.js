const crypto = require("crypto");
const { pool, query } = require("./db");

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

const newId = () => crypto.randomUUID();
// Short base36 id — doubles as the wxrks filename prefix, so keep it compact.
const newJobId = () => Date.now().toString(36).slice(-4) + crypto.randomBytes(3).toString("hex");

// --- users / auth ---

async function upsertUserByEmail(email) {
  const normalized = email.trim().toLowerCase();
  const { rows } = await query(
    `INSERT INTO users (id, email, last_login_at) VALUES ($1, $2, now())
     ON CONFLICT (email) DO UPDATE SET last_login_at = now()
     RETURNING *`,
    [newId(), normalized]
  );
  return rows[0];
}

async function getUserById(id) {
  const { rows } = await query(`SELECT * FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function createLoginToken(email) {
  const token = crypto.randomBytes(32).toString("hex");
  await query(
    `INSERT INTO login_tokens (id, token, email, expires_at) VALUES ($1, $2, $3, now() + interval '15 minutes')`,
    [newId(), token, email.trim().toLowerCase()]
  );
  return token;
}

// Atomically consumes the token (single use) and returns its email, or null.
async function consumeLoginToken(token) {
  const { rows } = await query(
    `UPDATE login_tokens SET used_at = now()
     WHERE token = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING email`,
    [token]
  );
  return rows[0]?.email || null;
}

async function createSession(userId) {
  const id = crypto.randomBytes(32).toString("hex");
  await query(`INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '30 days')`, [
    id,
    userId,
  ]);
  return id;
}

async function getSessionWithUser(sessionId) {
  const { rows } = await query(
    `SELECT s.id AS session_id, u.id, u.email, u.created_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId]
  );
  if (!rows[0]) return null;
  return { sessionId: rows[0].session_id, user: { id: rows[0].id, email: rows[0].email } };
}

function touchSession(sessionId) {
  return query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [sessionId]);
}

function deleteSession(sessionId) {
  return query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

// --- credits ---

async function getCreditBalance(userId) {
  const { rows } = await query(`SELECT COALESCE(SUM(delta), 0)::int AS balance FROM credit_ledger WHERE user_id = $1`, [
    userId,
  ]);
  return rows[0].balance;
}

async function getCreditLedger(userId, limit = 50) {
  const { rows } = await query(
    `SELECT id, delta, kind, job_id, note, created_at FROM credit_ledger
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function grantCredits(userId, amount, kind, note) {
  await query(`INSERT INTO credit_ledger (id, user_id, delta, kind, note) VALUES ($1, $2, $3, $4, $5)`, [
    newId(),
    userId,
    amount,
    kind,
    note || null,
  ]);
}

// Transactional: lock the user row, check balance, insert the negative row.
// Returns { ok: true } or { ok: false, balance }. Idempotent per job via the
// partial unique index on (job_id, kind).
async function chargeForJob(userId, jobId, amount) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    const already = await client.query(`SELECT id FROM credit_ledger WHERE job_id = $1 AND kind = 'charge'`, [jobId]);
    if (already.rows.length) {
      await client.query("COMMIT");
      return { ok: true, alreadyCharged: true };
    }
    const bal = await client.query(`SELECT COALESCE(SUM(delta), 0)::int AS balance FROM credit_ledger WHERE user_id = $1`, [
      userId,
    ]);
    const balance = bal.rows[0].balance;
    if (balance < amount) {
      await client.query("ROLLBACK");
      return { ok: false, balance };
    }
    await client.query(
      `INSERT INTO credit_ledger (id, user_id, delta, kind, job_id, note) VALUES ($1, $2, $3, 'charge', $4, $5)`,
      [newId(), userId, -amount, jobId, `translation charge`]
    );
    await client.query(`UPDATE jobs SET credits_charged = $2, updated_at = now() WHERE id = $1`, [jobId, amount]);
    await client.query("COMMIT");
    return { ok: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Refund exactly what the job charged; no-op if nothing was charged or already refunded.
async function refundForJob(jobId) {
  const { rows } = await query(`SELECT user_id, credits_charged FROM jobs WHERE id = $1`, [jobId]);
  const job = rows[0];
  if (!job || !job.user_id || !job.credits_charged) return false;
  const res = await query(
    `INSERT INTO credit_ledger (id, user_id, delta, kind, job_id, note)
     VALUES ($1, $2, $3, 'refund', $4, 'refund: job failed or cancelled')
     ON CONFLICT (job_id, kind) WHERE job_id IS NOT NULL DO NOTHING`,
    [newId(), job.user_id, job.credits_charged, jobId]
  );
  return res.rowCount > 0;
}

// --- jobs ---

async function createJob({ userId, anonCookieId, tier, sourceLocale, targetLocales, orgUnitUuid }) {
  const id = newJobId();
  const { rows } = await query(
    `INSERT INTO jobs (id, user_id, anon_cookie_id, tier, status, source_locale, target_locales, org_unit_uuid, timeline)
     VALUES ($1, $2, $3, $4, 'created', $5, $6, $7, $8) RETURNING *`,
    [
      id,
      userId || null,
      anonCookieId || null,
      tier,
      sourceLocale,
      JSON.stringify(targetLocales),
      orgUnitUuid,
      JSON.stringify([{ at: new Date().toISOString(), event: "created" }]),
    ]
  );
  return rows[0];
}

async function getJob(id) {
  const { rows } = await query(`SELECT * FROM jobs WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function listJobsForUser(userId, limit = 50) {
  const { rows } = await query(
    `SELECT id, tier, status, source_locale, target_locales, analyzed_words, credits_charged, error, created_at, updated_at
     FROM jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function listActiveJobs() {
  const { rows } = await query(`SELECT * FROM jobs WHERE status IN ('approving', 'translating')`);
  return rows;
}

async function updateJob(id, fields) {
  const allowed = ["status", "wxrks_project_uuid", "analyzed_words", "credits_charged", "error"];
  const sets = [];
  const params = [id];
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k)) throw new Error(`updateJob: field ${k} not allowed`);
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  sets.push(`updated_at = now()`);
  const { rows } = await query(`UPDATE jobs SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  return rows[0];
}

async function appendJobEvent(id, event, detail) {
  const entry = { at: new Date().toISOString(), event, ...(detail ? { detail } : {}) };
  await query(`UPDATE jobs SET timeline = timeline || $2::jsonb, updated_at = now() WHERE id = $1`, [
    id,
    JSON.stringify([entry]),
  ]);
}

// --- job files ---

async function createJobFile({ jobId, originalFilename, wxrksFilename, sizeBytes, contentType, content }) {
  const { rows } = await query(
    `INSERT INTO job_files (id, job_id, original_filename, wxrks_filename, size_bytes, content_type, source_content)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, job_id, original_filename, wxrks_filename, size_bytes, status`,
    [newId(), jobId, originalFilename, wxrksFilename, sizeBytes, contentType || null, content]
  );
  return rows[0];
}

async function listJobFiles(jobId, { withContent = false } = {}) {
  const cols = withContent
    ? "*"
    : "id, job_id, original_filename, wxrks_filename, resource_uuid, size_bytes, content_type, status";
  const { rows } = await query(`SELECT ${cols} FROM job_files WHERE job_id = $1 ORDER BY original_filename`, [jobId]);
  return rows;
}

async function getJobFileContent(id) {
  const { rows } = await query(`SELECT source_content FROM job_files WHERE id = $1`, [id]);
  return rows[0]?.source_content || null;
}

function updateJobFile(id, { resourceUuid, status }) {
  return query(
    `UPDATE job_files SET resource_uuid = COALESCE($2, resource_uuid), status = COALESCE($3, status) WHERE id = $1`,
    [id, resourceUuid || null, status || null]
  );
}

// --- deliverables + dedupe ---

// Stores a deliverable and marks its (project, filename, locale) triple
// processed in one transaction, so poller/webhook overlap can't double-store.
async function storeDeliverable({ jobId, jobFileId, locale, filename, content, projectUuid, wxrksFilename }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const dedupe = await client.query(
      `INSERT INTO processed_work_units (wxrks_project_uuid, wxrks_filename, locale)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING wxrks_project_uuid`,
      [projectUuid, wxrksFilename, locale]
    );
    if (!dedupe.rows.length) {
      await client.query("ROLLBACK");
      return false; // already processed by a concurrent worker
    }
    await client.query(
      `INSERT INTO deliverables (id, job_id, job_file_id, locale, filename, content, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (job_file_id, locale) DO NOTHING`,
      [newId(), jobId, jobFileId, locale, filename, content, content.length]
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function isProcessed(projectUuid, wxrksFilename, locale) {
  const { rows } = await query(
    `SELECT 1 FROM processed_work_units WHERE wxrks_project_uuid = $1 AND wxrks_filename = $2 AND locale = $3`,
    [projectUuid, wxrksFilename, locale]
  );
  return rows.length > 0;
}

async function listDeliverables(jobId, { withContent = false } = {}) {
  const cols = withContent ? "*" : "id, job_id, job_file_id, locale, filename, size_bytes, created_at";
  const { rows } = await query(`SELECT ${cols} FROM deliverables WHERE job_id = $1 ORDER BY locale, filename`, [jobId]);
  return rows;
}

async function getDeliverable(id) {
  const { rows } = await query(`SELECT * FROM deliverables WHERE id = $1`, [id]);
  return rows[0] || null;
}

// --- free tier ---

async function findFreeTierUsageToday({ ip, cookieId }) {
  const { rows } = await query(
    `SELECT * FROM free_tier_usage
     WHERE used_on = (now() AT TIME ZONE 'utc')::date AND (ip = $1 OR (cookie_id IS NOT NULL AND cookie_id = $2))
     LIMIT 1`,
    [ip, cookieId || null]
  );
  return rows[0] || null;
}

async function recordFreeTierUsage({ ip, cookieId, jobId }) {
  await query(
    `INSERT INTO free_tier_usage (id, ip, cookie_id, used_on, job_id) VALUES ($1, $2, $3, (now() AT TIME ZONE 'utc')::date, $4)`,
    [newId(), ip, cookieId || null, jobId]
  );
}

function setFreeTierUsageWords(jobId, words) {
  return query(`UPDATE free_tier_usage SET words = $2 WHERE job_id = $1`, [jobId, words]);
}

// --- retention ---

async function sweepOldBlobs(retentionDays) {
  const { rowCount: d } = await query(
    `UPDATE deliverables SET content = ''::bytea
     WHERE created_at < now() - ($1 || ' days')::interval AND length(content) > 0`,
    [retentionDays]
  );
  const { rowCount: f } = await query(
    `UPDATE job_files SET source_content = NULL
     WHERE source_content IS NOT NULL AND job_id IN (SELECT id FROM jobs WHERE created_at < now() - ($1 || ' days')::interval)`,
    [retentionDays]
  );
  return { deliverables: d, jobFiles: f };
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
  updateJobFile,
  storeDeliverable,
  isProcessed,
  listDeliverables,
  getDeliverable,
  findFreeTierUsageToday,
  recordFreeTierUsage,
  setFreeTierUsageWords,
  sweepOldBlobs,
};
