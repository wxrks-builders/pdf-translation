/**
 * Primary completion mechanism (the wxrks webhook, configured manually in
 * the dashboard, is only a latency hint that pokes this loop). Every tick,
 * for each active job: list work units, and for each newly-DELIVERED
 * (file × locale) download + store the deliverable. Each (file, locale) is
 * wrapped in its own try/catch so one unfinished language never blocks the
 * rest; a too-early download (422 BWX-002) is retried next tick.
 */
const path = require("path");
const store = require("../store");
const wxrks = require("./wxrks");
const layout = require("./layout");
const pipeline = require("./pipeline");
const leads = require("./leads");
const tone = require("./tone");
const crm = require("./crm");
const confidence = require("./confidence");
const docx = require("./docx");
const reminders = require("./reminders");
const { matchJobFile } = require("./filenames");
const { normalize } = require("./locales");

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "60000", 10);
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || "30", 10);
const APPROVING_RETRY_AGE_MS = 2 * 60 * 1000;
const TRANSLATING_TIMEOUT_MS = 24 * 60 * 60 * 1000;
// A design-kept PDF never holds the DOCX hostage: past this age the job delivers without it
// (unless it is a reader_only file's only translation).
const LAYOUT_WAIT_MS = 20 * 60 * 1000;
// Ticks in a row a download may fail the same permanent way before the job fails. Live
// 2026-11-12: a 422 "Invalid work units" was retried every minute for 24 hours.
const PERMANENT_TRIES = 3;

let timer = null;
let running = false;
const pokedProjects = new Set();
const permanentErrors = new Map(); // "project|filename|locale" → permanent failures in a row
let lastSweepDay = null;

// An answer no retry changes: a 4xx other than wxrks's "not ready yet" (422 BWX-002, 423, and
// the auth codes request() already retries), and "Invalid work units" under any code.
function isPermanent(err) {
  const info = err.response ? wxrks.errInfo(err) : String(err.message || "");
  if (/invalid work units?/i.test(info)) return true;
  if (err.retryLater) return false;
  return [400, 404, 410, 422].includes(err.response?.status);
}

// Counts a failed (file × locale); true once it has failed the same permanent way
// PERMANENT_TRIES ticks in a row. A transient error or a success starts the count over.
function givesUp(key, err) {
  if (!err || !isPermanent(err)) {
    permanentErrors.delete(key);
    return false;
  }
  const n = (permanentErrors.get(key) || 0) + 1;
  if (n < PERMANENT_TRIES) {
    permanentErrors.set(key, n);
    return false;
  }
  permanentErrors.delete(key);
  return true;
}

// wxrks's translated-file container formats disagree with entry names at
// times; trust the magic bytes over the claimed extension.
function sniffExtension(buffer, claimedExt) {
  const head = buffer.slice(0, 5).toString("latin1");
  if (head.startsWith("%PDF")) return ".pdf";
  if (head.startsWith("PK")) {
    // OOXML (docx/xlsx/pptx) and other zip-based formats: keep a zip-based
    // claimed extension, otherwise assume the documented PDF→DOCX conversion.
    return [".docx", ".xlsx", ".pptx", ".zip", ".odt"].includes(claimedExt) ? claimedExt : ".docx";
  }
  if (claimedExt === ".pdf" || claimedExt === ".docx") return ".txt"; // plain text under a doc name
  return claimedExt;
}

async function fetchDeliverable(job, jobFiles, wu) {
  const file = matchJobFile(jobFiles, wu.filename);
  if (!file) {
    console.warn(`[poller] job ${job.id}: no job file matches work-unit filename "${wu.filename}"`);
    return;
  }
  // wxrks counted no words in it: its translation comes from the design-kept path (processLayout).
  if (file.reader_only) return;
  const locale = wu.targetLanguage;
  if (await store.isProcessed(job.wxrks_project_uuid, wu.filename, normalize(locale))) return;

  const entries = await wxrks.downloadZipSync(job.wxrks_project_uuid, {
    resources: [file.resource_uuid],
    locales: [locale],
  });
  // Entries come back as {locale}/{resourceFileName}; with one resource + one
  // locale requested, every file entry belongs to this (file, locale).
  const entry = entries.find((e) => !e.entryName.endsWith("/"));
  if (!entry) throw new wxrks.RetryLaterError("empty ZIP");

  // Deliverable keeps the user's original name but wxrks's output extension —
  // corrected by sniffing the bytes: the project download can keep the source
  // extension on content of a different type (observed live: translated PDF
  // text under a ".pdf" entry name).
  const claimedExt = path.extname(entry.entryName) || path.extname(file.original_filename);
  const outExt = sniffExtension(entry.buffer, claimedExt);
  const base = path.basename(file.original_filename, path.extname(file.original_filename));
  const stored = await store.storeDeliverable({
    jobId: job.id,
    jobFileId: file.id,
    locale: normalize(locale),
    filename: `${base}${outExt}`,
    content: entry.buffer,
    projectUuid: job.wxrks_project_uuid,
    wxrksFilename: wu.filename,
  });
  if (stored) await store.appendJobEvent(job.id, "deliverable_stored", { file: file.original_filename, locale });
}

async function processTranslatingJob(job) {
  const jobFiles = await store.listJobFiles(job.id);
  // A job whose files are all reader_only has no work units here: its project was cancelled
  // and the design-kept project translates everything.
  const wus = (await wxrks.listWorkUnits(job.wxrks_project_uuid)).content || [];
  if (!wus.length && !jobFiles.some((f) => f.reader_only)) return;

  for (const wu of wus) {
    if (wu.workStatus !== "DELIVERED") continue;
    const key = `${job.wxrks_project_uuid}|${wu.filename}|${wu.targetLanguage}`;
    try {
      await fetchDeliverable(job, jobFiles, wu);
      givesUp(key, null);
    } catch (err) {
      if (givesUp(key, err)) {
        await pipeline.markJobFailed(job.id, new Error(`wxrks can't deliver ${wu.filename} → ${wu.targetLanguage}: ${wxrks.errInfo(err)}`));
        return;
      }
      if (err.retryLater) continue; // not ready yet — next tick
      console.error(`[poller] job ${job.id} (${wu.filename} → ${wu.targetLanguage}): ${wxrks.errInfo(err)}`);
    }
  }

  if (!(await processLayout(job, jobFiles))) return; // the job failed

  // Job is done when every (file × target locale) has its translation, and the design-kept
  // PDFs have either arrived or given up.
  const expected = jobFiles.length * job.target_locales.length;
  const deliverables = await store.listDeliverables(job.id);
  const translations = deliverables.filter((d) => d.variant === "translation").length;
  if (translations >= expected && expected > 0 && (await layoutSettled(job, jobFiles))) {
    const delivered = await store.updateJob(job.id, { status: "delivered" });
    await store.appendJobEvent(job.id, "delivered");
    console.log(`[poller] job ${job.id} delivered (${deliverables.length} files)`);
    // The Confidence Score runs now; an email left while it was translating waits for it.
    if (!(await confidence.start(delivered, leads.sendFilesIfRequested))) await leads.sendFilesIfRequested(delivered);
    await tone.release(job.id); // both projects are done with the agent
    await crm.recordTranslation(delivered);
  } else if (Date.now() - new Date(job.created_at).getTime() > TRANSLATING_TIMEOUT_MS) {
    await pipeline.markJobFailed(job.id, new Error("translation timed out after 24h"));
  }
}

// Design-kept PDFs: each DELIVERED (file × locale) of the layout project is a JSON of
// translated segments; rebuild the PDF from it and store both PDF variants. A reader_only file's
// Word file is built from the same JSON (services/docx.js), and stands as its translation even
// when no PDF can be drawn. → false when the job failed.
async function processLayout(job, jobFiles) {
  const files = jobFiles.filter((f) => f.layout_status === "translating");
  if (!job.layout_project_uuid || !files.length) return true;
  const wus = (await wxrks.listWorkUnits(job.layout_project_uuid)).content || [];
  for (const wu of wus) {
    if (wu.workStatus !== "DELIVERED") continue;
    const file = files.find((f) => f.layout_filename === wu.filename);
    const locale = normalize(wu.targetLanguage);
    if (!file || (await store.isProcessed(job.layout_project_uuid, wu.filename, locale))) continue;
    const base = path.basename(file.original_filename, path.extname(file.original_filename));
    const key = `${job.layout_project_uuid}|${wu.filename}|${locale}`;
    let translated = null;
    let units = null;
    try {
      const entries = await wxrks.downloadZipSync(job.layout_project_uuid, {
        resources: [file.layout_resource_uuid],
        locales: [wu.targetLanguage],
      });
      const entry = entries.find((e) => !e.entryName.endsWith("/"));
      if (!entry) throw new wxrks.RetryLaterError("empty ZIP");
      translated = JSON.parse(entry.buffer.toString("utf8"));
      units = await store.getJobFileLayoutUnits(file.id);
      const { design, images } = await layout.rebuild(await store.getJobFileContent(file.id), units, translated);
      const stored = await store.storeDeliverable({
        jobId: job.id,
        jobFileId: file.id,
        locale,
        projectUuid: job.layout_project_uuid,
        wxrksFilename: wu.filename,
        files: [
          file.reader_only && { variant: "translation", filename: `${base}.docx`, content: docx.build(units, translated, locale) },
          { variant: "pdf-design", filename: `${base} (design kept).pdf`, content: design },
          images && { variant: "pdf-images", filename: `${base} (page images).pdf`, content: images },
        ].filter(Boolean),
      });
      givesUp(key, null);
      if (stored) await store.appendJobEvent(job.id, "layout_pdf_stored", { file: file.original_filename, locale });
    } catch (err) {
      // Download hiccups retry next tick; a rebuild that can't succeed (a script the bundled
      // fonts don't cover, a crash), a garbled JSON, or the same permanent wxrks answer
      // PERMANENT_TRIES times ends this file × locale without a PDF.
      const final = err instanceof layout.LayoutError || err instanceof SyntaxError || givesUp(key, err);
      if (!final) {
        if (!err.retryLater) console.error(`[poller] job ${job.id} layout ${wu.filename} → ${locale}: ${wxrks.errInfo(err)}`);
        continue;
      }
      console.warn(`[poller] job ${job.id}: no design-kept PDF for ${file.original_filename} → ${locale}: ${err.message}`);
      if (file.reader_only) {
        // Its only translation: the Word file alone if the text arrived, or the job fails now.
        if (!translated) {
          await pipeline.markJobFailed(job.id, new Error(`no translation for ${file.original_filename} → ${locale}: ${err.message}`));
          return false;
        }
        await store.storeDeliverable({
          jobId: job.id,
          jobFileId: file.id,
          locale,
          projectUuid: job.layout_project_uuid,
          wxrksFilename: wu.filename,
          files: [{ variant: "translation", filename: `${base}.docx`, content: docx.build(units || (await store.getJobFileLayoutUnits(file.id)), translated, locale) }],
        });
      } else {
        await store.markProcessed(job.layout_project_uuid, wu.filename, locale);
      }
      await store.appendJobEvent(job.id, "layout_pdf_skipped", { file: file.original_filename, locale, reason: err.message.slice(0, 160) });
    }
  }
  return true;
}

async function layoutSettled(job, jobFiles) {
  const waiting = jobFiles.filter((f) => ["pending", "translating"].includes(f.layout_status));
  if (!waiting.length) return true;
  // A reader_only file's PDF path is its translation: it waits as long as any translation does.
  if (Date.now() - new Date(job.created_at).getTime() > LAYOUT_WAIT_MS && !waiting.some((f) => f.reader_only)) {
    await store.appendJobEvent(job.id, "layout_timeout");
    return true;
  }
  // 'pending' = the layout project is still being set up (pipeline step 7)
  if (!job.layout_project_uuid || waiting.some((f) => f.layout_status === "pending")) return false;
  return (await store.countProcessed(job.layout_project_uuid)) >= waiting.length * job.target_locales.length;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const jobs = await store.listActiveJobs();
    pokedProjects.clear();
    for (const job of jobs) {
      try {
        if (job.status === "approving") {
          if (Date.now() - new Date(job.updated_at).getTime() > APPROVING_RETRY_AGE_MS) {
            console.log(`[poller] job ${job.id} stuck approving — resuming`);
            await pipeline.resumeApproval(job);
          }
        } else {
          await processTranslatingJob(job);
        }
      } catch (err) {
        console.error(`[poller] job ${job.id}: ${wxrks.errInfo(err)}`);
      }
    }

    await confidence.sweep(leads.sendFilesIfRequested); // scores lost to a restart
    await crm.flush(); // whatever didn't reach the CRM when it happened
    await reminders.sweep().catch((err) => console.error("[reminders] sweep failed:", err.message));
    const today = new Date().toISOString().slice(0, 10);
    if (lastSweepDay !== today) {
      lastSweepDay = today;
      const swept = await store.sweepOldBlobs(RETENTION_DAYS);
      if (swept.deliverables || swept.jobFiles) console.log(`[poller] retention sweep:`, swept);
    }
  } catch (err) {
    console.error("[poller] tick failed:", err.message);
  } finally {
    running = false;
  }
}

// Webhook latency hint: re-poll soon if the project belongs to an active job.
function pokeProject(projectUuid) {
  if (pokedProjects.has(projectUuid)) return;
  pokedProjects.add(projectUuid);
  setTimeout(tick, 2000);
}

function startPoller() {
  timer = setInterval(tick, POLL_INTERVAL_MS);
  setTimeout(tick, 5000); // first pass shortly after boot (crash recovery)
  console.log(`[poller] started (every ${POLL_INTERVAL_MS}ms)`);
}

function stopPoller() {
  if (timer) clearInterval(timer);
}

module.exports = { startPoller, stopPoller, tick, pokeProject };
