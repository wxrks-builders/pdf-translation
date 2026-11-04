/**
 * SQLite storage (better-sqlite3, WAL mode). The database file lives on the
 * deploy platform's persistent volume (/var/data) in production and in
 * ./data locally; there is no external database service to provision.
 * better-sqlite3 is synchronous and single-process, which matches this
 * app's single-instance design — transactions serialize all writes, so the
 * row-locking the old Postgres layer needed simply isn't required.
 *
 * Timestamps are ISO-8601 UTC strings (lexicographically ordered), JSON
 * columns are TEXT parsed at the store layer, and blobs are BLOB/Buffer.
 */
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH =
  process.env.SQLITE_PATH ||
  (process.env.NODE_ENV === "production"
    ? "/var/data/doctranslate.db"
    : path.join(__dirname, "..", "data", "doctranslate.db"));

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// Idempotent schema setup, run once at server startup.
async function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT ${NOW},
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS login_tokens (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT ${NOW},
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT ${NOW}
    );

    -- Append-only; a user's balance is SUM(delta). job_id is deliberately not
    -- a foreign key: ledger history must outlive job deletion.
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      delta INTEGER NOT NULL,
      kind TEXT NOT NULL,
      job_id TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT ${NOW}
    );
    CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger (user_id, created_at DESC);
    -- At most one charge and one refund per job, making both idempotent under retries.
    CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_job_kind_uq ON credit_ledger (job_id, kind) WHERE job_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      anon_cookie_id TEXT,
      tier TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      wxrks_project_uuid TEXT,
      org_unit_uuid TEXT,
      source_locale TEXT NOT NULL,
      target_locales TEXT NOT NULL,      -- JSON array
      analyzed_words INTEGER,
      credits_charged INTEGER,
      error TEXT,
      timeline TEXT NOT NULL DEFAULT '[]', -- JSON array of {at, event, detail?}
      created_at TEXT NOT NULL DEFAULT ${NOW},
      updated_at TEXT NOT NULL DEFAULT ${NOW}
    );
    CREATE INDEX IF NOT EXISTS jobs_active_idx ON jobs (status) WHERE status IN ('approving', 'translating');
    CREATE INDEX IF NOT EXISTS jobs_user_idx ON jobs (user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS job_files (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      original_filename TEXT NOT NULL,
      wxrks_filename TEXT NOT NULL,
      resource_uuid TEXT,
      size_bytes INTEGER NOT NULL,
      content_type TEXT,
      source_content BLOB,
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS job_files_job_idx ON job_files (job_id);

    -- variant: 'translation' (what wxrks delivers, e.g. the DOCX) or a design-kept PDF
    -- ('pdf-design', 'pdf-images') rebuilt by services/layout.js.
    CREATE TABLE IF NOT EXISTS deliverables (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      job_file_id TEXT NOT NULL REFERENCES job_files(id) ON DELETE CASCADE,
      locale TEXT NOT NULL,
      variant TEXT NOT NULL DEFAULT 'translation',
      filename TEXT NOT NULL,
      content BLOB NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT ${NOW},
      UNIQUE (job_file_id, locale, variant)
    );

    -- Poller/webhook dedupe: one row per delivered-and-stored (project,
    -- filename, locale) triple. wxrks_filename is the name AS WXRKS REPORTS IT.
    CREATE TABLE IF NOT EXISTS processed_work_units (
      wxrks_project_uuid TEXT NOT NULL,
      wxrks_filename TEXT NOT NULL,
      locale TEXT NOT NULL,
      processed_at TEXT NOT NULL DEFAULT ${NOW},
      PRIMARY KEY (wxrks_project_uuid, wxrks_filename, locale)
    );

    CREATE TABLE IF NOT EXISTS free_tier_usage (
      id TEXT PRIMARY KEY,
      ip TEXT NOT NULL,
      cookie_id TEXT,
      used_on TEXT NOT NULL,             -- UTC date 'YYYY-MM-DD'
      job_id TEXT,
      words INTEGER,
      created_at TEXT NOT NULL DEFAULT ${NOW}
    );
    CREATE INDEX IF NOT EXISTS free_usage_ip_idx ON free_tier_usage (ip, used_on);
    CREATE INDEX IF NOT EXISTS free_usage_cookie_idx ON free_tier_usage (cookie_id, used_on);
  `);

  // --- additive migrations for databases created before a column existed ---

  // Design-kept PDFs: the second wxrks project, and per-file layout state.
  addColumn("jobs", "layout_project_uuid", "TEXT");
  addColumn("job_files", "layout_status", "TEXT"); // pending | translating | done | skipped | failed
  addColumn("job_files", "layout_filename", "TEXT");
  addColumn("job_files", "layout_resource_uuid", "TEXT");
  addColumn("job_files", "layout_units", "TEXT"); // JSON from pdf_layout.py extract

  // Free tier: downloads open once the visitor leaves an email (routes/jobs.js unlock). Jobs
  // from before the email step stay open.
  if (addColumn("jobs", "unlocked_at", "TEXT")) db.exec(`UPDATE jobs SET unlocked_at = created_at`);
  addColumn("jobs", "unlocked_email", "TEXT");
  addColumn("jobs", "files_emailed_at", "TEXT");
  // A free document that was never translated (over the word limit, no text) gives the day back.
  addColumn("free_tier_usage", "released", "INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
      marketing_opt_in INTEGER NOT NULL DEFAULT 0,
      suspected_bot INTEGER NOT NULL DEFAULT 0,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT ${NOW}
    );
    CREATE INDEX IF NOT EXISTS leads_email_idx ON leads (email, created_at);
  `);

  // The tone a visitor picked (JSON {preset, note}) and the Sous-Chef agent that carries it
  // out in wxrks, deleted when the job ends (services/tone.js).
  addColumn("jobs", "tone", "TEXT");
  addColumn("jobs", "tone_agent_uuid", "TEXT");
  // A free PDF over the word limit gets its first page(s) translated as a preview: a child job
  // with excerpt_of = the job over the limit (services/excerpt.js). Preview only, no downloads.
  addColumn("jobs", "excerpt_of", "TEXT");
  addColumn("jobs", "excerpt_pages", "INTEGER");
  addColumn("jobs", "excerpt_total_pages", "INTEGER");
  db.exec(`CREATE INDEX IF NOT EXISTS jobs_excerpt_idx ON jobs (excerpt_of) WHERE excerpt_of IS NOT NULL`);

  // Word packs bought through Stripe Checkout (routes/checkout.js). One row per paid Checkout
  // Session, so a webhook delivered twice grants the words once.
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      stripe_session_id TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      email TEXT NOT NULL,
      words INTEGER NOT NULL,
      amount_cents INTEGER,
      currency TEXT,
      job_id TEXT,
      created_user INTEGER NOT NULL DEFAULT 0,
      claimed_at TEXT,
      created_at TEXT NOT NULL DEFAULT ${NOW}
    );
  `);

  // deliverables gained `variant` and a wider UNIQUE; SQLite can't alter a table constraint,
  // so an old table is rebuilt once, keeping every row as the 'translation' variant.
  if (!columns("deliverables").includes("variant")) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE deliverables_v2 (
          id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          job_file_id TEXT NOT NULL REFERENCES job_files(id) ON DELETE CASCADE,
          locale TEXT NOT NULL,
          variant TEXT NOT NULL DEFAULT 'translation',
          filename TEXT NOT NULL,
          content BLOB NOT NULL,
          size_bytes INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT ${NOW},
          UNIQUE (job_file_id, locale, variant)
        );
        INSERT INTO deliverables_v2 (id, job_id, job_file_id, locale, variant, filename, content, size_bytes, created_at)
          SELECT id, job_id, job_file_id, locale, 'translation', filename, content, size_bytes, created_at FROM deliverables;
        DROP TABLE deliverables;
        ALTER TABLE deliverables_v2 RENAME TO deliverables;
      `);
    })();
  }
}

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

// → true when the column was just added
function addColumn(table, column, definition) {
  if (columns(table).includes(column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

function close() {
  db.close();
}

module.exports = { db, migrate, close, DB_PATH };
