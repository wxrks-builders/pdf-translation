# DocTranslate

Upload documents (PDF, DOCX, TXT, CSV, JSON, …), pick target languages, download translations. Built on the [wxrks](https://wxrks.com) API.

- **Free tier** (anonymous): 1 document/day, up to 1,000 source words.
- **Paid tier**: accounts (magic-link sign-in) with word credits — $99/year = 100,000 credits; 1 credit = 1 source word into 1 language. Payments aren't wired yet; grant credits with `node scripts/grant-credits.js <email> <amount>`.

PDFs are auto-converted by wxrks on upload; on the current org unit the translated deliverable is the document's **extracted text** (a `.txt`), not a re-laid-out PDF/DOCX — the poller sniffs each deliverable's real format and names it honestly. Limits: 25 MB/file (app), 400 pages per PDF, 150 pages for scanned PDFs (image-only PDFs have no extractable text and deliver an empty stub).

## Stack

Express 4 + Postgres (raw `pg`, idempotent migrate at boot) + React 18/Vite/Tailwind client. Single wxrks service account; org units pinned via env. Deliverables and uploads live in Postgres `bytea` behind `server/services/storage`-style seams, swept after `RETENTION_DAYS`.

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

The wxrks webhook (configure `APP_BASE_URL/api/webhooks/wxrks` manually in the wxrks dashboard — there is no webhook API) is only a latency hint that pokes the poller; the poller alone is sufficient.

## ⚠ Operational prerequisite: task automation on the org unit

Approving a project makes wxrks create one *task* per work unit — and nothing in the public API executes them, so the org unit must be configured (wxrks dashboard) to run TRANSLATION tasks automatically. Verified both ways live: on a unit without automation, work units sit at `workStatus=NEW` with `PENDING` unassigned tasks forever and jobs stall at `translating`; on the purpose-made **"Online PDF Translator"** unit (`6e429e88-2e42-4bec-89f1-cdce5625e001`, the one pinned in env), autopilot advances the project on its own and a `.txt` work unit delivered 10s after approval. If jobs ever stall, diagnose with `GET /api/v3/task?projectUuid=…` — unassigned PENDING tasks mean org-unit config, not app code. (Image-only/scanned PDFs parse to zero segments and auto-deliver a stub instantly, which is also a handy plumbing test.)

## Spikes

`spikes/` holds the live verification scripts run before the app was built (`node spikes/01-….js`). Each file's header comment records its verdict. `spikes/lib/wxrksMin.js` is a standalone client for experiments.

## Deploy

`render.yaml` provisions the web service + Postgres on Render. After first deploy set `APP_BASE_URL` and the wxrks dashboard webhook.
