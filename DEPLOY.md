# Deploying DocTranslate to the wxrks agent hub

The app deploys at `<name>.agents.wxrks.app` via the Deploy Hub, with secrets and the database handled in Coolify. The repo is self-contained: the root `Dockerfile` builds the client and runs the server on port 3000, and the Postgres schema creates itself on first boot — there are no migration commands to run, ever.

## One-time setup

### 1. Repo location
The repo must live in the **wxrks-builders** GitHub org (it does: `wxrks-builders/pdf-translation`). The org-wide GitHub install gives the platform access and enables auto-deploys.

### 2. Create the app in the Deploy Hub
1. Go to **deploy.agents.wxrks.app**, log in with your `@wxrks.com` Google account.
2. Pick the `pdf-translation` repo (auto-inspected; the root Dockerfile removes any guesswork).
3. Size preset: **S** is plenty (Express server + a 60-second poller).
4. Deploy. The app comes up at `<name>.agents.wxrks.app`. Wildcard DNS + TLS are automatic — the certificate takes ~2 minutes on first deploy, and since `.app` is HTTPS-only, don't panic if the very first hit fails while the cert issues.

The hub is create-and-deploy only. After this, **updates are just `git push` to `main`** — auto-deploys, no hub visit needed.

### 3. Database (Coolify)
Create a **PostgreSQL** service in Coolify on the same server/network as the app and copy its **internal** connection string (`postgres://user:pass@host:5432/db`). No persistent volume on the app itself — all state, including uploaded files and translated deliverables, lives in Postgres (`bytea` columns, swept after `RETENTION_DAYS`).

### 4. Environment variables (Coolify → app → Environment Variables)

Required — the app **exits at boot** without a reachable `DATABASE_URL`:

| Variable | Value |
|---|---|
| `DATABASE_URL` | connection string from step 3 |
| `WXRKS_ACCESS_KEY` / `WXRKS_SECRET` | the wxrks service-account API credentials |
| `WXRKS_PAID_ORG_UNIT_UUID` | `6e429e88-2e42-4bec-89f1-cdce5625e001` — the **"Online PDF Translator"** org unit, which has automatic translation configured. Do not point at an org unit without task automation: jobs will stall at `translating` forever (see README's operational-prerequisite section). |
| `COOKIE_SECRET` | any long random string (`openssl rand -hex 32`) |
| `APP_BASE_URL` | `https://<name>.agents.wxrks.app` |

Required for sign-in (the container runs `NODE_ENV=production`, so there is no dev fallback — **without these, magic-link login errors and only the anonymous free tier works**):

| Variable | Value |
|---|---|
| `MAILGUN_API_KEY` / `MAILGUN_DOMAIN` / `EMAIL_FROM` | Mailgun HTTP-API credentials + sender address |

Optional tuning: `DATABASE_SSL=true` (only for a remote/managed Postgres over TLS — not needed for a Coolify-internal one), `FREE_TIER_MAX_WORDS` (1000), `POLL_INTERVAL_MS` (60000), `RETENTION_DAYS` (30), `MAX_UPLOAD_MB` (25), `WXRKS_FREE_ORG_UNIT_UUID` (separate org unit for free-tier jobs; falls back to the paid one).

### 5. Restart and verify
Restart the app in Coolify after setting the vars. Then:

- Container log ends with `DocTranslate listening on :3000`.
- `https://<name>.agents.wxrks.app/api/health` → `{"ok":true}`.
- The home page renders the upload screen with language pickers populated (they're fed live from the wxrks `/language` API — if they're empty, the `WXRKS_*` credentials are wrong).
- Full smoke test: upload a small `.txt` anonymously → the job page should reach **delivered** in well under a minute → download the translation.

### 6. wxrks dashboard webhook (optional)
In the wxrks dashboard (no API for this), add a webhook pointing at `https://<name>.agents.wxrks.app/api/webhooks/wxrks` for events "Work Unit Status Changed" and "Work Unit Translation File Ready". This only shaves delivery latency — the built-in poller delivers everything on its own.

## Day-2 operations

- **Grant credits** (payments aren't wired yet): open a terminal in the app container (Coolify) and run `node scripts/grant-credits.js <email> <amount> "note"`. Balance = sum of the append-only ledger.
- **Jobs stuck at `translating`?** Check the wxrks side first: `GET /api/v3/task?projectUuid=…` — unassigned `PENDING` tasks mean the org unit lost its automation config; it's not app code. Jobs auto-fail and refund after 24h.
- **Logs to trust**: `[pipeline]` lines for per-job failures, `[poller]` for delivery issues, `[wxrks]` for cancel/API problems.

## Troubleshooting first deploy

| Symptom | Cause |
|---|---|
| `503 no available server` | No healthy container — almost always a crash-loop from missing/unreachable `DATABASE_URL`, or the Docker build failed. Read the Coolify log. |
| First page load fails | TLS cert still issuing (~2 min on first deploy). |
| Login returns an error | Mailgun vars not set (production has no dev fallback). |
| Language pickers empty | Bad `WXRKS_ACCESS_KEY`/`WXRKS_SECRET`. |
| Upload rejected at 413 | File over `MAX_UPLOAD_MB` (25 default). |
