# DocTranslate

Upload documents (PDF, DOCX, TXT, CSV, JSON, …), pick target languages, download translations. Built on the [wxrks](https://wxrks.com) API.

- **Free tier** (anonymous): 1 document/day, up to 1,000 source words. When a job delivers, the page shows page 1 of the original and of the design-kept translation side by side, and the downloads open once the visitor leaves an email (`POST /api/jobs/:id/unlock`). The app then emails the links once (`?k=` per-job key, so they work on any device). Product news needs its own unticked box. A document that is never translated (over the word limit, or no text) doesn't use up the day, up to 3 tries a day. The email step's guards (headless-browser check, per-address and daily send caps) and the optional `LEAD_WEBHOOK_URL` are described in `server/services/leads.js`. Leads are kept in the `leads` table.
- **Over the free limit**: a PDF's page 1 is translated anyway, as a child job (`jobs.excerpt_of`, `server/services/excerpt.js`) that shows a preview and never downloads, next to the price of the pack that covers the whole file. After buying, the visitor translates that file without uploading it again (`POST /api/jobs/:id/rerun`).
- **Scanned PDFs**: a PDF page that is only a picture is read with Tesseract (built into PyMuPDF; the Docker image ships the tessdata_fast models for 29 languages in `TESSDATA_PREFIX`). The text goes invisibly over each page's own picture, so wxrks can convert and translate it (`pdf_layout.py ocr`, `readScannedPages` in `server/services/pipeline.js`). A scan gets the Word file only: `pdf_layout.py extract` refuses a design-kept PDF for an OCR layer, which would draw over words still in the picture. A source language without a model ends as `no_text`, with the reason on the job page.
- **Confidence Score**: once a job is delivered, Smells (the wxrks check for meaning problems) scores every translated segment, and the job page and files email show the score per language, how many sentences are worth a second look, and the worst five (`server/services/confidence.js`, wxrks genesis QA routes). It runs once and is stored in `jobs.confidence`, because scores change between runs. The files email waits for it. `CONFIDENCE_SCORE=off` turns it off.
- **Reviewers**: the delivered page and the files email suggest up to three translators from the wxrks marketplace for each target language, Premium Partners first, then Pro, shuffled each time (`server/services/marketplace.js`, which reads marketplace.wxrks.com's directory; `MARKETPLACE_URL` overrides it).
- **Admin and the daily digest**: people listed in `ADMIN_EMAILS` see every job and `/admin` (every upload, its result, score and email) once signed in. Every day at `DIGEST_HOUR` (8) in `DIGEST_TZ` (America/Toronto) the server sends them the last day's uploads with a link to each job: a Slack DM to `SLACK_DIGEST_USER` with `SLACK_DIGEST_TOKEN` (a token with `chat:write`), or else an email to `ADMIN_EMAILS` (`server/services/digest.js`).
- **Buying funnel**: every price on screen (over the free limit, not enough credits, free document used, /pricing, /account), every Checkout opened, cancelled or paid, and every upload stopped by the free limit is an `events` row (`server/services/events.js`). /admin and the digest add them up per place, next to Stripe's own list of Checkout Sessions.
- **Did it work?**: thumbs up or down on the delivered page, and one email `FEEDBACK_EMAIL_DAYS` (3) after delivery with a link per answer, never to a job already answered (`server/services/feedback.js`; `FEEDBACK_EMAIL_DAYS=0` turns the email off). Answers and notes show on /admin and in the digest.
- **Tone (Sous-Chef)**: the upload form offers Automatic, Formal, Friendly, Marketing, Legal or Technical, plus a free-text note. Each job with a tone gets its own Sous-Chef agent in wxrks (`/api/v3/agent`), the default of both of its projects, deleted when the job ends (`server/services/tone.js`). Automatic sends no agent, and wxrks works the tone out from the file.
- **CRM**: every account, free-tier email, delivered translation (file, words, languages, tone) and word-pack purchase becomes an event in the `crm_outbox` table and is sent to the Twenty CRM (`CRM_EVENTS_URL`, `CRM_EVENTS_SECRET`), which registers the person by email and shows translations and purchases on their timeline (`server/services/crm.js`; the receiving side is `~/twenty-crm/TRANSLATE.md`). Unsent events wait in the outbox and retry on every poller tick; on startup, anything from before is backfilled once.
- **Paid tier**: accounts (magic-link sign-in) with word credits, sold as one-time packs: $9 = 5,000, $29 = 30,000, $99 = 200,000 (`client/src/pricing.js` and `server/services/payments.js`); 1 credit = 1 source word into 1 language. Packs are bought through Stripe Checkout once `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set (DEPLOY.md); the webhook grants the words to the buyer's email, making the account if needed. Without the keys, a pack opens an email, and you grant credits with `node scripts/grant-credits.js <email> <amount>`.

PDFs are uploaded as-is and **wxrks converts them to DOCX** — the same conversion the dashboard uses, on the API since 2026-10-07: a few seconds after upload the resource is renamed in place to `<name>.pdf.docx`, and the pipeline waits for that before creating work units. Translations come back as DOCX. If a PDF isn't converted within 3 minutes the job goes on with the raw PDF (`pdf_conversion_skipped`, text-only output). The poller sniffs each deliverable's real format and names it honestly. Limits: 25 MB/file (app), 400 pages per PDF; scanned (image-only) PDFs have no extractable text — no OCR — so the job stops as `no_text` and nothing is charged.

### Design-kept PDFs (beta)

Each PDF also comes back as **"<name> (design kept).pdf"** and **"<name> (page images).pdf"**. The DOCX rebuilds the page in Word and loses the design. Here the original pages stay as they are, and only the text is swapped (`server/layout/pdf_layout.py`, PyMuPDF):

1. At upload, the PDF's text is read as units: lines grouped by paragraph, style, and position. It is stored on the job file as `layout_units`.
2. Once the job is approved, the units go to wxrks as a JSON resource in a **second project** (`doctranslate-<job>-layout`). That project isn't metered again: the job is charged once, for whichever is higher, wxrks's word count or the words sent here.
3. When it delivers, the poller removes the source text from each page, leaving images and vector art untouched. It draws the translation back on the original baselines and colors, in a substitute font (`server/layout/fonts/`, all OFL), shrunk to fit. "Page images" is the same result flattened to one picture per page.

This path is soft. If a PDF can't be read, needs a script the bundled fonts don't cover (CJK, Arabic, …), or has more than `LAYOUT_MAX_PAGES` (100) pages, it gets no PDF. Its DOCX still delivers, and a job never waits more than 20 minutes for its PDFs. Known limits are in `spikes/07-inplace-pdf.py`: phrases split across design elements translate piecewise, inline bold is lost, dense cards cramp, and text inside images stays untranslated.

## Stack

Express 4 + SQLite (better-sqlite3, WAL, idempotent migrate at boot — `./data/` locally, `/var/data/` in production) + React 18/Vite/Tailwind client. Single wxrks service account; org units pinned via env. Deliverables and uploads live in the database as BLOBs, swept after `RETENTION_DAYS`. No external database service.

## Run locally

```bash
npm run install:all
cp .env.example .env   # fill in WXRKS_* and COOKIE_SECRET
npm run dev            # server on :3000
npm run client:dev     # vite on :5173 (proxies /api)
```

Without Mailgun configured, login links are logged to stdout and returned as `devLoginUrl` (non-production only).

## How a job flows

`POST /api/jobs` (multipart) → background pipeline: create wxrks project (tagged with the user id or `free`) → upload resources (filenames prefixed with the job id — wxrks truncates long names and reports everything by filename) → create `TRANSLATION` work units per target locale → pre-analysis logfile for word counts (**requires work units to exist** — verified live) → gate (free word limit / transactional credit charge on the higher of wxrks's count and the design-kept PDFs' words; a job still at zero words after retries stops as `no_text`; failures cancel the wxrks project and refund) → approve (`DRAFT→PENDING→APPROVED`, retrying `422 BWX-002`/`423` races; never passes `calculateCosts`) → the poller (`POLL_INTERVAL_MS`) watches work units, downloads each `DELIVERED` (file × locale) as a ZIP, stores deliverables, and flips the job to `delivered`.

The wxrks webhook (set `APP_BASE_URL/api/webhooks/wxrks` in the wxrks dashboard) is only a latency hint that pokes the poller; the poller alone is sufficient.

## ⚠ Operational prerequisite: task automation on the org unit

Approving a project makes wxrks create one *task* per work unit. Tasks run on the org unit's own settings, so the org unit that `WXRKS_PAID_ORG_UNIT_UUID` points at must be configured (wxrks dashboard) to run TRANSLATION tasks automatically. Verified both ways live: on a unit without automation, work units sit at `workStatus=NEW` with `PENDING` unassigned tasks forever and jobs stall at `translating`.

The settings that work, in the unit's **Translation & Editor Settings**: Pre-translation from **Context Sensitive**, **Machine translation** and **Translation memory**; **Auto confirm pre-translated segments** on; **Complete task once all segments are confirmed** on. With that, a raw PDF went from upload to `DELIVERED` DOCX in 27s with no pipeline and no person (spike 6). Turning AI on alone is not enough — without auto-confirm the task still waits for a linguist. If jobs ever stall, diagnose with `GET /api/v3/task?projectUuid=…` — unassigned PENDING tasks mean org-unit config, not app code.

## Spikes

`spikes/` holds the live verification scripts run before the app was built (`node spikes/01-….js`). Each file's header comment records its verdict. `spikes/lib/wxrksMin.js` is a standalone client for experiments.

## License

AGPL-3.0 ([LICENSE](LICENSE)). The design-kept PDFs run on PyMuPDF, which is AGPL-3.0, so this whole service is too. Anyone using the running site is entitled to this source, and the site links to it in its footer. The fonts in `server/layout/fonts/` are under the SIL Open Font License; their `OFL-*.txt` files sit beside them.

## Deploy

See **[DEPLOY.md](DEPLOY.md)** — the env-var table, the `/var/data` persistent volume, a verification checklist, and first-deploy troubleshooting. Short version: build the root `Dockerfile`, mount a volume at `/var/data`, set the env vars; all state lives in SQLite on the volume.
