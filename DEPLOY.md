# Deploying DocTranslate to the wxrks agent hub

The app deploys at `<name>.agents.wxrks.app` via the Deploy Hub, with secrets and the persistent volume handled in Coolify. The repo is self-contained: the root `Dockerfile` builds the client and runs the server on port 3000, storage is SQLite on the `/var/data` volume, and the schema creates itself on first boot — there are no database services or migration commands, ever.

## One-time setup

### 1. Repo location
The repo must live in the **wxrks-builders** GitHub org (it does: `wxrks-builders/pdf-translation`). The org-wide GitHub install gives the platform access and enables auto-deploys.

### 2. Create the app in the Deploy Hub
1. Go to **the deploy hub**, log in with your `@wxrks.com` Google account.
2. Pick the `pdf-translation` repo (auto-inspected; the root Dockerfile removes any guesswork).
3. Size preset: **S** is plenty (Express server + a 60-second poller).
4. Deploy. The app comes up at `<name>.agents.wxrks.app`. Wildcard DNS + TLS are automatic — the certificate takes ~2 minutes on first deploy, and since `.app` is HTTPS-only, don't panic if the very first hit fails while the cert issues.

The hub is create-and-deploy only. After this, **updates are just `git push` to `main`** — auto-deploys, no hub visit needed.

### 3. Persistent volume (Coolify)
Storage is **SQLite** — no database service to provision. In Coolify, give the app a **persistent volume mounted at `/var/data`** (the platform's standard pattern, same as word-counter). The database file is created there automatically on first boot (`/var/data/doctranslate.db`, WAL mode). All state lives in it, including uploaded files and translated deliverables (BLOBs, swept after `RETENTION_DAYS`). Backups = backing up the volume.

Without the volume the app still boots and works, but **all data is lost on every redeploy** — don't skip it.

### 4. Environment variables (Coolify → app → Environment Variables)

Required:

| Variable | Value |
|---|---|
| `WXRKS_ACCESS_KEY` / `WXRKS_SECRET` | the wxrks service-account API credentials |
| `WXRKS_PAID_ORG_UNIT_UUID` | `<org-unit-uuid>` — the **"Online PDF Translator"** org unit, which has automatic translation configured. Do not point at an org unit without task automation: jobs will stall at `translating` forever (see README's operational-prerequisite section). |
| `COOKIE_SECRET` | any long random string (`openssl rand -hex 32`) |
| `APP_BASE_URL` | `https://<name>.agents.wxrks.app` |

Required for sign-in (the container runs `NODE_ENV=production`, so there is no dev fallback — **without these, magic-link login errors and only the anonymous free tier works**):

| Variable | Value |
|---|---|
| `MAILGUN_API_KEY` / `MAILGUN_DOMAIN` / `EMAIL_FROM` | Mailgun HTTP-API credentials + sender address |

Optional tuning: `SQLITE_PATH` (defaults to `/var/data/doctranslate.db` in production), `FREE_TIER_MAX_WORDS` (1000), `POLL_INTERVAL_MS` (60000), `RETENTION_DAYS` (30), `MAX_UPLOAD_MB` (25), `WXRKS_FREE_ORG_UNIT_UUID` (separate org unit for free-tier jobs; falls back to the paid one).

### 5. Restart and verify
Restart the app in Coolify after setting the vars. Then:

- Container log ends with `DocTranslate listening on :3000`.
- `https://<name>.agents.wxrks.app/api/health` → `{"ok":true}`.
- The home page renders the upload screen with language pickers populated (they're fed live from the wxrks `/language` API — if they're empty, the `WXRKS_*` credentials are wrong).
- Full smoke test: upload a small `.txt` anonymously → the job page should reach **delivered** in well under a minute → download the translation.

### 6. wxrks dashboard webhook (optional)
In the wxrks dashboard, add a webhook pointing at `https://<name>.agents.wxrks.app/api/webhooks/wxrks` for events "Work Unit Status Changed" and "Work Unit Translation File Ready". This only shaves delivery latency — the built-in poller delivers everything on its own.

## Day-2 operations

- **Grant credits** (payments aren't wired yet): open a terminal in the app container (Coolify) and run `node scripts/grant-credits.js <email> <amount> "note"`. Balance = sum of the append-only ledger.
- **Jobs stuck at `translating`?** Check the wxrks side first: `GET /api/v3/task?projectUuid=…` — unassigned `PENDING` tasks mean the org unit lost its automation config; it's not app code. Jobs auto-fail and refund after 24h.
- **Logs to trust**: `[pipeline]` lines for per-job failures, `[poller]` for delivery issues, `[wxrks]` for cancel/API problems.

## Troubleshooting first deploy

| Symptom | Cause |
|---|---|
| `503 no available server` | No healthy container — the Docker build failed or the app is crash-looping. Read the Coolify log. |
| Data gone after redeploy | The `/var/data` persistent volume isn't mounted — the SQLite file lived in the container layer. |
| First page load fails | TLS cert still issuing (~2 min on first deploy). |
| Login returns an error | Mailgun vars not set (production has no dev fallback). |
| Language pickers empty | Bad `WXRKS_ACCESS_KEY`/`WXRKS_SECRET`. |
| Upload rejected at 413 | File over `MAX_UPLOAD_MB` (25 default). |
