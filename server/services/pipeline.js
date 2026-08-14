/**
 * Per-job orchestration against wxrks. Runs entirely in the background
 * relative to HTTP responses (approval transition polling alone can take
 * ~45s per phase). The poller (services/poller.js) takes over once a job
 * reaches 'translating', and also re-runs stalled 'approving' jobs, so a
 * crash mid-pipeline is recovered from the DB, not from process state.
 *
 * Step order (verified live, spike 1): pre-analysis only produces numbers
 * once work units exist — upload → work units → analyze → gate → approve.
 * A job that fails its gate cancels the wxrks project before any approval,
 * which is what starts real translation work/cost.
 */
const store = require("../store");
const wxrks = require("./wxrks");
const convert = require("./convert");
const { buildWxrksFilename } = require("./filenames");

const FREE_TIER_MAX_WORDS = parseInt(process.env.FREE_TIER_MAX_WORDS || "1000", 10);

async function setStatus(jobId, status, event, detail) {
  await store.updateJob(jobId, { status });
  await store.appendJobEvent(jobId, event || status, detail);
}

async function runPipeline(jobId) {
  const job = await store.getJob(jobId);
  if (!job) throw new Error(`job ${jobId} not found`);
  const targets = job.target_locales;

  // 1. Project
  const project = await wxrks.createProject({
    reference: `doctranslate-${jobId}`,
    sourceLocale: job.source_locale,
    orgUnitUUID: job.org_unit_uuid,
    tags: [job.user_id || "free"],
  });
  await store.updateJob(jobId, { wxrks_project_uuid: project.uuid });
  await setStatus(jobId, "uploading", "project_created", { projectUuid: project.uuid });

  // 2. Resources + content. PDFs are converted to DOCX first, replicating the
  // wxrks dashboard's upload behavior (the public API has no conversion — a
  // raw PDF gets parsed as plain text and its translation loses all layout).
  // The converted upload is named `<name>.pdf.docx`, the dashboard's own
  // convention; job_files.wxrks_filename is updated to match so the poller's
  // filename matching sees what wxrks will echo back.
  const files = await store.listJobFiles(jobId);
  for (const file of files) {
    let uploadName = file.wxrks_filename;
    let content = await store.getJobFileContent(file.id);
    if (/\.pdf$/i.test(file.wxrks_filename)) {
      if (await convert.isAvailable()) {
        content = await convert.pdfToDocx(content, file.original_filename);
        uploadName = `${file.wxrks_filename}.docx`;
        await store.updateJobFile(file.id, { wxrksFilename: uploadName });
        await store.appendJobEvent(jobId, "pdf_converted", { file: file.original_filename });
      } else {
        console.warn(`[pipeline] LibreOffice unavailable — uploading ${file.original_filename} as raw PDF (text-only output)`);
        await store.appendJobEvent(jobId, "pdf_conversion_skipped", { file: file.original_filename });
      }
    }
    const resource = await wxrks.createResource(project.uuid, uploadName);
    await wxrks.uploadResourceContent(project.uuid, resource.uuid, uploadName, content);
    await store.updateJobFile(file.id, { resourceUuid: resource.uuid, status: "uploaded" });
  }
  await store.appendJobEvent(jobId, "files_uploaded", { count: files.length });

  // 3. Work units (must exist before pre-analysis returns real numbers)
  const uploaded = await store.listJobFiles(jobId);
  await wxrks.createWorkUnitsBulk(
    project.uuid,
    uploaded.map((f) => ({ projectResourceUuid: f.resource_uuid, workflows: ["TRANSLATION"], targetLocales: targets }))
  );

  // 4. Analyze. A zero-word summary can be a race with wxrks's still-running
  // file conversion (observed live on a 1.5MB PDF: analysis "completed" at 0
  // words, then the document translated anyway — an unmetered job). Retry
  // with backoff before trusting a zero; genuinely empty docs stay 0.
  await setStatus(jobId, "analyzing");
  let summary;
  for (let attempt = 1; ; attempt++) {
    summary = await wxrks.runPreAnalysis(project.uuid);
    if (summary.some((r) => r.totalWords > 0) || attempt >= 5) break;
    await store.appendJobEvent(jobId, "analysis_empty_retry", { attempt });
    await new Promise((r) => setTimeout(r, attempt * 15000));
  }
  // One row per target language, each with the full source word count.
  const analyzedWords = Math.max(0, ...summary.map((r) => r.totalWords || 0));
  const charge = summary.reduce((sum, r) => sum + (r.totalWords || 0), 0);
  await store.updateJob(jobId, { analyzed_words: analyzedWords });
  await store.appendJobEvent(jobId, "analyzed", { words: analyzedWords, charge, targets: targets.length });

  // 5. Gate
  if (job.tier === "free") {
    await store.setFreeTierUsageWords(jobId, analyzedWords);
    if (analyzedWords > FREE_TIER_MAX_WORDS) {
      await wxrks.cancelProject(project.uuid, "free tier word limit exceeded");
      await setStatus(jobId, "over_free_limit", "over_free_limit", { words: analyzedWords, limit: FREE_TIER_MAX_WORDS });
      return;
    }
  } else if (charge > 0) {
    const result = await store.chargeForJob(job.user_id, jobId, charge);
    if (!result.ok) {
      await wxrks.cancelProject(project.uuid, "insufficient credits");
      await setStatus(jobId, "needs_credits", "needs_credits", { required: charge, balance: result.balance });
      return;
    }
    await store.appendJobEvent(jobId, "credits_charged", { amount: charge });
  }

  // 6. Approve — anything failing from here on refunds (markJobFailed)
  await setStatus(jobId, "approving");
  await wxrks.approveProject(project.uuid);
  await setStatus(jobId, "translating", "approved");
}

// Re-entered by the poller for jobs stuck in 'approving' (crash recovery):
// approveProject is idempotent against the real project state.
async function resumeApproval(job) {
  await wxrks.approveProject(job.wxrks_project_uuid);
  await setStatus(job.id, "translating", "approved");
}

async function markJobFailed(jobId, err) {
  const message = err?.response ? wxrks.errInfo(err) : err?.message || String(err);
  console.error(`[pipeline] job ${jobId} failed: ${message}`);
  try {
    const job = await store.getJob(jobId);
    await store.updateJob(jobId, { status: "failed", error: message.slice(0, 500) });
    await store.appendJobEvent(jobId, "failed", { error: message.slice(0, 200) });
    const refunded = await store.refundForJob(jobId);
    if (refunded) await store.appendJobEvent(jobId, "credits_refunded");
    if (job?.wxrks_project_uuid) await wxrks.cancelProject(job.wxrks_project_uuid, "job failed");
  } catch (inner) {
    console.error(`[pipeline] cleanup for ${jobId} also failed:`, inner.message);
  }
}

async function cancelJob(jobId) {
  const job = await store.getJob(jobId);
  if (!job) return null;
  if (["delivered", "failed", "cancelled"].includes(job.status)) return job;
  await store.updateJob(jobId, { status: "cancelled" });
  await store.appendJobEvent(jobId, "cancelled");
  const refunded = await store.refundForJob(jobId);
  if (refunded) await store.appendJobEvent(jobId, "credits_refunded");
  if (job.wxrks_project_uuid) await wxrks.cancelProject(job.wxrks_project_uuid, "cancelled by user");
  return store.getJob(jobId);
}

function startPipeline(jobId) {
  runPipeline(jobId).catch((err) => markJobFailed(jobId, err));
}

module.exports = { runPipeline, startPipeline, resumeApproval, markJobFailed, cancelJob, FREE_TIER_MAX_WORDS };
