const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Managed Postgres over the public internet needs SSL (DATABASE_SSL=true);
  // local dev and Coolify-internal-network connections don't.
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

function query(text, params) {
  return pool.query(text, params);
}

// Idempotent schema setup, run once at server startup.
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_tokens (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Append-only; a user's balance is SUM(delta). job_id is deliberately not a
  // foreign key: ledger history must outlive job deletion.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      delta INTEGER NOT NULL,
      kind TEXT NOT NULL,
      job_id TEXT,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger (user_id, created_at DESC)`);
  // At most one charge and one refund per job, making both idempotent under retries.
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_job_kind_uq ON credit_ledger (job_id, kind) WHERE job_id IS NOT NULL`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      anon_cookie_id TEXT,
      tier TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      wxrks_project_uuid TEXT,
      org_unit_uuid TEXT,
      source_locale TEXT NOT NULL,
      target_locales JSONB NOT NULL,
      analyzed_words INTEGER,
      credits_charged INTEGER,
      error TEXT,
      timeline JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS jobs_active_idx ON jobs (status) WHERE status IN ('approving', 'translating')`
  );
  await pool.query(`CREATE INDEX IF NOT EXISTS jobs_user_idx ON jobs (user_id, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_files (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      original_filename TEXT NOT NULL,
      wxrks_filename TEXT NOT NULL,
      resource_uuid TEXT,
      size_bytes INTEGER NOT NULL,
      content_type TEXT,
      source_content BYTEA,
      status TEXT NOT NULL DEFAULT 'pending'
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS job_files_job_idx ON job_files (job_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS deliverables (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      job_file_id TEXT NOT NULL REFERENCES job_files(id) ON DELETE CASCADE,
      locale TEXT NOT NULL,
      filename TEXT NOT NULL,
      content BYTEA NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (job_file_id, locale)
    )
  `);

  // Poller/webhook dedupe: one row per delivered-and-stored (project, filename,
  // locale) triple. wxrks_filename is the name AS WXRKS REPORTS IT (truncated).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_work_units (
      wxrks_project_uuid TEXT NOT NULL,
      wxrks_filename TEXT NOT NULL,
      locale TEXT NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (wxrks_project_uuid, wxrks_filename, locale)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS free_tier_usage (
      id TEXT PRIMARY KEY,
      ip TEXT NOT NULL,
      cookie_id TEXT,
      used_on DATE NOT NULL,
      job_id TEXT,
      words INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS free_usage_ip_idx ON free_tier_usage (ip, used_on)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS free_usage_cookie_idx ON free_tier_usage (cookie_id, used_on)`);
}

module.exports = { pool, query, migrate };
