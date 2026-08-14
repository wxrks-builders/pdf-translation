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
const pipeline = require("./pipeline");
const { matchJobFile } = require("./filenames");
const { normalize } = require("./locales");

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "60000", 10);
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || "30", 10);
const APPROVING_RETRY_AGE_MS = 2 * 60 * 1000;
const TRANSLATING_TIMEOUT_MS = 24 * 60 * 60 * 1000;

let timer = null;
let running = false;
const pokedProjects = new Set();
let lastSweepDay = null;

async function fetchDeliverable(job, jobFiles, wu) {
  const file = matchJobFile(jobFiles, wu.filename);
  if (!file) {
    console.warn(`[poller] job ${job.id}: no job file matches work-unit filename "${wu.filename}"`);
    return;
  }
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

  // Deliverable keeps the user's original name but wxrks's output extension
  // (a PDF source comes back as .docx after wxrks's conversion).
  const outExt = path.extname(entry.entryName) || path.extname(file.original_filename);
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
  const page = await wxrks.listWorkUnits(job.wxrks_project_uuid);
  const wus = page.content || [];
  if (!wus.length) return;

  const jobFiles = await store.listJobFiles(job.id);
  for (const wu of wus) {
    if (wu.workStatus !== "DELIVERED") continue;
    try {
      await fetchDeliverable(job, jobFiles, wu);
    } catch (err) {
      if (err.retryLater) continue; // not ready yet — next tick
      console.error(`[poller] job ${job.id} (${wu.filename} → ${wu.targetLanguage}): ${wxrks.errInfo(err)}`);
    }
  }

  // Job is done when every (file × target locale) has a stored deliverable.
  const expected = jobFiles.length * job.target_locales.length;
  const deliverables = await store.listDeliverables(job.id);
  if (deliverables.length >= expected && expected > 0) {
    await store.updateJob(job.id, { status: "delivered" });
    await store.appendJobEvent(job.id, "delivered");
    console.log(`[poller] job ${job.id} delivered (${deliverables.length} files)`);
  } else if (Date.now() - new Date(job.created_at).getTime() > TRANSLATING_TIMEOUT_MS) {
    await pipeline.markJobFailed(job.id, new Error("translation timed out after 24h"));
  }
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
