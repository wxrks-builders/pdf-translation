# DocTranslate

Upload documents (PDF, DOCX, TXT, CSV, JSON, …), pick target languages, download translations. Built on the [wxrks](https://wxrks.com) API.

- **Free tier** (anonymous): 1 document/day, up to 1,000 source words.
- **Paid tier**: accounts (magic-link sign-in) with word credits — $99/year = 100,000 credits; 1 credit = 1 source word into 1 language. Payments aren't wired yet; grant credits with `node scripts/grant-credits.js <email> <amount>`.

PDFs are uploaded as-is and **wxrks converts them to DOCX** — the dashboard's own conversion, on the public API since the platform change (2026-10-07): a few seconds after upload the resource is renamed in place to `<name>.pdf.docx`, and the pipeline waits for that before creating work units. Translations come back as DOCX. If a PDF isn't converted within 3 minutes the job goes on with the raw PDF (`pdf_conversion_skipped`, text-only output). The poller sniffs each deliverable's real format and names it honestly. Limits: 25 MB/file (app), 400 pages per PDF; scanned (image-only) PDFs have no extractable text — no OCR — and deliver an empty stub.

## Stack

Express 4 + SQLite (better-sqlite3, WAL, idempotent migrate at boot — `./data/` locally, `/var/data/` in production) + React 18/Vite/Tailwind client. Single wxrks service account; org units pinned via env. Deliverables and uploads live in the database as BLOBs, swept after `RETENTION_DAYS`. No external database service.

## Run locally

```bash
npm run install:all
createdb doctranslate
cp .env.example .env   # fill in WXRKS_* and COOKIE_SECRET
npm run dev            # server on :3000
npm run client:dev     # vite on :5173 (proxies /api)
```

Without Mailgun configured, login links are logged to stdout and returned as `devLoginUrl` (non-production only).

## How a job flows

`POST /api/jobs` (multipart) → background pipeline: create wxrks project (tagged with the user id or `free`) → upload resources (filenames prefixed with the job id — wxrks truncates long names and reports everything by filename) → create `TRANSLATION` work units per target locale → pre-analysis logfile for word counts (**requires work units to exist** — verified live) → gate (free word limit / transactional credit charge; failures cancel the wxrks project and refund) → approve (`DRAFT→PENDING→APPROVED`, retrying `422 BWX-002`/`423` races; never passes `calculateCosts`) → the poller (`POLL_INTERVAL_MS`) watches work units, downloads each `DELIVERED` (file × locale) as a ZIP, stores deliverables, and flips the job to `delivered`.

The wxrks webhook (configure `APP_BASE_URL/api/webhooks/wxrks` in the wxrks dashboard) is only a latency hint that pokes the poller; the poller alone is sufficient.

## ⚠ Operational prerequisite: task automation on the org unit

Approving a project makes wxrks create one *task* per work unit — and they run on the org unit's own settings, so the org unit must be configured (wxrks dashboard) to run TRANSLATION tasks automatically. Verified both ways live: on a unit without automation, work units sit at `workStatus=NEW` with `PENDING` unassigned tasks forever and jobs stall at `translating`.

The app's unit is **"Online PDF Translator"** (`<org-unit-uuid>`) on the dedicated "wxrks pdf" account (augmented actions on). In its **Translation & Editor Settings**: Pre-translation from **Context Sensitive**, **Machine translation** and **Translation memory**; **Auto confirm pre-translated segments** on; **Complete task once all segments are confirmed** on. With that, a raw PDF went from upload to `DELIVERED` DOCX in 27s with no pipeline and no person (spike 6). Turning AI on alone is not enough — without auto-confirm the task still waits for a linguist. (The August unit `<uuid>` lived on the old demo account, whose key is gone.) If jobs ever stall, diagnose with `GET /api/v3/task?projectUuid=…` — unassigned PENDING tasks mean org-unit config, not app code. (Image-only/scanned PDFs parse to zero segments and auto-deliver a stub instantly, which is also a handy plumbing test.)

## Spikes

`spikes/` holds the live verification scripts run before the app was built (`node spikes/01-….js`). Each file's header comment records its verdict. `spikes/lib/wxrksMin.js` is a standalone client for experiments.

## Deploy

See **[DEPLOY.md](DEPLOY.md)** — full step-by-step for the wxrks agent hub (Deploy Hub + Coolify): create the app, mount the `/var/data` persistent volume, the exact env-var table, verification checklist, and first-deploy troubleshooting. Short version: root `Dockerfile`, push to `main` auto-deploys, all state lives in SQLite on the volume.
