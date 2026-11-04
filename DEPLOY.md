# Deploying DocTranslate

The repo is self-contained: the root `Dockerfile` builds the client and runs the server on port 3000 (PDF→DOCX conversion happens on the wxrks side — nothing to install). Storage is SQLite on the `/var/data` volume, and the schema creates itself on first boot — there are no database services or migration commands, ever. Any Docker host with a persistent volume and HTTPS in front works.

## One-time setup

### 1. Build and run the image
Build the root `Dockerfile` and expose port 3000 behind your HTTPS proxy. The app runs `app.set("trust proxy", 1)`, so it expects exactly one proxy in front: the rate limiter and the free tier key on the client IP that proxy forwards.

### 2. Persistent volume
Mount a **persistent volume at `/var/data`**. The database file is created there on first boot (`/var/data/doctranslate.db`, WAL mode). All state lives in it, including uploaded files and translated deliverables (BLOBs, swept after `RETENTION_DAYS`). Backups = backing up the volume.

Without the volume the app still boots and works, but **all data is lost on every redeploy** — don't skip it.

### 3. Environment variables

Required:

| Variable | Value |
|---|---|
| `WXRKS_ACCESS_KEY` / `WXRKS_SECRET` | the API key pair of the wxrks account the service runs on |
| `WXRKS_PAID_ORG_UNIT_UUID` | an org unit with automatic translation configured. Do not point at an org unit without task automation: jobs will stall at `translating` forever (see README's operational-prerequisite section). |
| `COOKIE_SECRET` | any long random string (`openssl rand -hex 32`) |
| `APP_BASE_URL` | the public URL, e.g. `https://translate.example.com` |

Required for sign-in (the container runs `NODE_ENV=production`, so there is no dev fallback — **without these, magic-link login errors and only the anonymous free tier works**):

| Variable | Value |
|---|---|
| `MAILGUN_API_KEY` / `MAILGUN_DOMAIN` / `EMAIL_FROM` | Mailgun HTTP-API credentials + sender address |

Optional tuning: `SQLITE_PATH` (defaults to `/var/data/doctranslate.db` in production), `FREE_TIER_MAX_WORDS` (1000), `POLL_INTERVAL_MS` (60000), `RETENTION_DAYS` (30), `MAX_UPLOAD_MB` (25), `WXRKS_FREE_ORG_UNIT_UUID` (separate org unit for free-tier jobs; falls back to the paid one), `LAYOUT_MAX_PAGES` (100; larger PDFs get no design-kept PDF), `LEAD_WEBHOOK_URL` (receives each free-tier email as JSON; unset = kept in the `leads` table only), `FILES_EMAIL_DAILY_CAP` (300) and `FILES_EMAIL_PER_ADDRESS_DAILY` (3) for the files email, `EMAIL_REPLY_TO` (help@wxrks.com). `LAYOUT_PYTHON` is set by the Dockerfile (`/opt/layout/bin/python`, with PyMuPDF); without PyMuPDF the app runs normally and skips design-kept PDFs.

Optional, for buying word packs online (without them, a pack opens an email to demetrio@wxrks.com):

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | A Stripe secret key (`sk_live_…`), or a restricted key with write access to Checkout Sessions |
| `STRIPE_WEBHOOK_SECRET` | The signing secret (`whsec_…`) of the webhook below |

In the Stripe dashboard, add a webhook endpoint at `<APP_BASE_URL>/api/stripe/webhook` for the events `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and copy its signing secret into `STRIPE_WEBHOOK_SECRET`. Prices are sent inline with each Checkout Session (`server/services/payments.js`), so there are no products or prices to create in Stripe. Checkout offers Apple Pay, Google Pay and Link where they are switched on in the dashboard's payment-method settings.

Optional, for the CRM (without them, events wait in the `crm_outbox` table and go out once these are set):

| Variable | Value |
|---|---|
| `CRM_EVENTS_URL` | `https://crm.wxrks.app/s/translate/events` |
| `CRM_EVENTS_SECRET` | A long random string; the same value goes in the CRM app's `TRANSLATE_EVENTS_SECRET` variable |

Optional, with their defaults: `CONFIDENCE_SCORE` (on; `off` skips the Smells run after delivery), `MARKETPLACE_URL` (`https://marketplace.wxrks.com`, where reviewer suggestions come from), `TESSDATA_PREFIX` (`/opt/tessdata` in the image, the OCR models for scanned PDFs).

### 4. Restart and verify
Restart the app after setting the vars. Then:

- Container log ends with `DocTranslate listening on :3000`.
- `<APP_BASE_URL>/api/health` → `{"ok":true}`.
- The home page renders the upload screen with language pickers populated (they're fed live from the wxrks `/language` API — if they're empty, the `WXRKS_*` credentials are wrong).
- Full smoke test: upload a small `.txt` anonymously → the job page should reach **delivered** in well under a minute → download the translation.
- PDF smoke test: a text PDF should come back as three files, the DOCX plus "(design kept).pdf" and "(page images).pdf". The job timeline shows `layout_started` and then `layout_pdf_stored`. `layout_skipped` or `layout_pdf_skipped` give the reason when there is no PDF.

### 5. wxrks dashboard webhook (optional)
In the wxrks dashboard, add a webhook pointing at `<APP_BASE_URL>/api/webhooks/wxrks` for events "Work Unit Status Changed" and "Work Unit Translation File Ready". This only shaves delivery latency — the built-in poller delivers everything on its own.

## Day-2 operations

- **Grant credits** (payments aren't wired yet): open a shell in the app container and run `node scripts/grant-credits.js <email> <amount> "note"`. Balance = sum of the append-only ledger.
- **Jobs stuck at `translating`?** Check the wxrks side first: `GET /api/v3/task?projectUuid=…` — unassigned `PENDING` tasks mean the org unit lost its automation config; it's not app code. Jobs auto-fail and refund after 24h.
- **Logs to trust**: `[pipeline]` lines for per-job failures, `[poller]` for delivery issues, `[wxrks]` for cancel/API problems.

## Troubleshooting first deploy

| Symptom | Cause |
|---|---|
| Proxy returns 502/503 | No healthy container — the Docker build failed or the app is crash-looping. Read the container log. |
| Data gone after redeploy | The `/var/data` persistent volume isn't mounted — the SQLite file lived in the container layer. |
| Login returns an error | Mailgun vars not set (production has no dev fallback). |
| Language pickers empty | Bad `WXRKS_ACCESS_KEY`/`WXRKS_SECRET`. |
| Upload rejected at 413 | File over `MAX_UPLOAD_MB` (25 default). |
