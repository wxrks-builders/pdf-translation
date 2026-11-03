# DocTranslate

Upload documents (PDF, DOCX, TXT, CSV, JSON, …), pick target languages, download translations. Built on the [wxrks](https://wxrks.com) API.

- **Free tier** (anonymous): 1 document/day, up to 1,000 source words.
- **Paid tier**: accounts (magic-link sign-in) with word credits — $99/year = 100,000 credits; 1 credit = 1 source word into 1 language. Payments aren't wired yet; grant credits with `node scripts/grant-credits.js <email> <amount>`.

PDFs are uploaded as-is and **wxrks converts them to DOCX** — the dashboard's own conversion, on the public API since BW-8262 (2026-10-07): a few seconds after upload the resource is renamed in place to `<name>.pdf.docx`, and the pipeline waits for that before creating work units. Translations come back as DOCX. If a PDF isn't converted within 3 minutes the job goes on with the raw PDF (`pdf_conversion_skipped`, text-only output). The poller sniffs each deliverable's real format and names it honestly. Limits: 25 MB/file (app), 400 pages per PDF; scanned (image-only) PDFs have no extractable text — no OCR — and deliver an empty stub.

### Design-kept PDFs (beta)

Each PDF also comes back as **"<name> (design kept).pdf"** and **"<name> (page images).pdf"**. The DOCX rebuilds the page in Word and loses the design. Here the original pages stay as they are, and only the text is swapped (`server/layout/pdf_layout.py`, PyMuPDF):

1. At upload, the PDF's text is read as units: lines grouped by paragraph, style, and position. It is stored on the job file as `layout_units`.
2. Once the job is approved, the units go to wxrks as a JSON resource in a **second project** (`doctranslate-<job>-layout`). That project is never metered, so the user pays for the words once.
3. When it delivers, the poller removes the source text from each page, leaving images and vector art untouched. It draws the translation back on the original baselines and colors, in a substitute font (`server/layout/fonts/`, all OFL), shrunk to fit. "Page images" is the same result flattened to one picture per page.

This path is soft. If a PDF can't be read, needs a script the bundled fonts don't cover (CJK, Arabic, …), or has more than `LAYOUT_MAX_PAGES` (100) pages, it gets no PDF. Its DOCX still delivers, and a job never waits more than 20 minutes for its PDFs. Known limits are in `spikes/07-inplace-pdf.py`: phrases split across design elements translate piecewise, inline bold is lost, dense cards cramp, and text inside images stays untranslated.

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

The wxrks webhook (configure `APP_BASE_URL/api/webhooks/wxrks` manually in the wxrks dashboard — there is no webhook API) is only a latency hint that pokes the poller; the poller alone is sufficient.

## ⚠ Operational prerequisite: task automation on the org unit

Approving a project makes wxrks create one *task* per work unit — and nothing in the public API executes them, so the org unit must be configured (wxrks dashboard) to run TRANSLATION tasks automatically. Verified both ways live: on a unit without automation, work units sit at `workStatus=NEW` with `PENDING` unassigned tasks forever and jobs stall at `translating`.

The app's unit is **"Online PDF Translator"** (`0ae2ce8f-96e3-4ce4-913d-4586b63b6af3`) on the dedicated "wxrks pdf" account (Quantum plan, 100%-off coupon, augmented actions on). In its **Translation & Editor Settings**: Pre-translation from **Context Sensitive**, **Machine translation** and **Translation memory**; **Auto confirm pre-translated segments** on; **Complete task once all segments are confirmed** on. With that, a raw PDF went from upload to `DELIVERED` DOCX in 27s with no pipeline and no person (spike 6). Turning AI on alone is not enough — without auto-confirm the task still waits for a linguist. (The August unit `6e429e88…` lived on the old demo account, whose key is gone.) If jobs ever stall, diagnose with `GET /api/v3/task?projectUuid=…` — unassigned PENDING tasks mean org-unit config, not app code. (Image-only/scanned PDFs parse to zero segments and auto-deliver a stub instantly, which is also a handy plumbing test.)

## Spikes

`spikes/` holds the live verification scripts run before the app was built (`node spikes/01-….js`). Each file's header comment records its verdict. `spikes/lib/wxrksMin.js` is a standalone client for experiments.

## License

AGPL-3.0 ([LICENSE](LICENSE)). The design-kept PDFs run on PyMuPDF, which is AGPL-3.0, so this whole service is too. Anyone using the running site is entitled to this source, and the site links to it in its footer. The fonts in `server/layout/fonts/` are under the SIL Open Font License; their `OFL-*.txt` files sit beside them.

## Deploy

See **[DEPLOY.md](DEPLOY.md)** — full step-by-step for the wxrks agent hub (Deploy Hub + Coolify): create the app, mount the `/var/data` persistent volume, the exact env-var table, verification checklist, and first-deploy troubleshooting. Short version: root `Dockerfile`, push to `main` auto-deploys, all state lives in SQLite on the volume.
