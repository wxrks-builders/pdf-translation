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
const layout = require("./layout");
const tone = require("./tone");
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

  // 2. Resources + content. wxrks converts each PDF to DOCX itself, renaming
  // the resource in place to `<name>.pdf.docx`; job_files.wxrks_filename
  // follows the rename so the poller's filename matching sees what wxrks will
  // echo back. Work units must wait for it, or they'd target the raw PDF.
  const files = await store.listJobFiles(jobId);
  for (const file of files) {
    const resource = await wxrks.createResource(project.uuid, file.wxrks_filename);
    let content = await store.getJobFileContent(file.id);
    if (/\.pdf$/i.test(file.original_filename)) content = await readScannedPages(job, file, content);
    await wxrks.uploadResourceContent(project.uuid, resource.uuid, file.wxrks_filename, content);
    await store.updateJobFile(file.id, { resourceUuid: resource.uuid, status: "uploaded" });
    if (/\.pdf$/i.test(file.wxrks_filename)) {
      // A book takes wxrks minutes to convert: 3 minutes, plus one per MB, up to 20. Live
      // 2026-11-05: a 521-page and a 219-page PDF ran out of the old flat 3 and then failed.
      const timeoutMs = Math.min(20, 3 + Math.ceil(content.length / (1024 * 1024))) * 60 * 1000;
      const convertedName = await wxrks.waitForPdfConversion(project.uuid, resource.uuid, { timeoutMs });
      if (convertedName) {
        await store.updateJobFile(file.id, { wxrksFilename: convertedName });
        await store.appendJobEvent(jobId, "pdf_converted", { file: file.original_filename });
      } else {
        console.warn(`[pipeline] wxrks did not convert ${file.original_filename} to DOCX — translating it as a raw PDF (text-only output)`);
        await store.appendJobEvent(jobId, "pdf_conversion_skipped", { file: file.original_filename });
      }
    }
  }
  await store.appendJobEvent(jobId, "files_uploaded", { count: files.length });

  // 2b. Design-kept PDFs (beta): read each PDF's text and layout now, so the poller knows from
  // the start which files also get a rebuilt PDF. Soft — a PDF that can't be read just goes
  // without one; the DOCX never depends on it. Returns the words those PDFs will send to
  // wxrks, which the gate charges for when wxrks counts fewer.
  const layoutWords = await prepareLayout(jobId, files);

  // 3. Work units (must exist before pre-analysis returns real numbers)
  const uploaded = await store.listJobFiles(jobId);
  await whileConverting(() =>
    wxrks.createWorkUnitsBulk(
      project.uuid,
      uploaded.map((f) => ({ projectResourceUuid: f.resource_uuid, workflows: ["TRANSLATION"], targetLocales: targets }))
    )
  );

  // 4. Analyze. A zero-word summary can come back while a PDF is still being
  // converted, so retry with backoff before trusting a zero.
  await setStatus(jobId, "analyzing");
  let summary;
  for (let attempt = 1; ; attempt++) {
    summary = await whileConverting(() => wxrks.runPreAnalysis(project.uuid));
    if (summary.some((r) => r.totalWords > 0) || attempt >= 5) break;
    await store.appendJobEvent(jobId, "analysis_empty_retry", { attempt });
    await new Promise((r) => setTimeout(r, attempt * 15000));
  }
  // One row per target language, each with the full source word count. The
  // design-kept project translates every word layoutWords counted, so the job
  // pays for whichever count is higher.
  const wxrksWords = Math.max(0, ...summary.map((r) => r.totalWords || 0));
  const analyzedWords = Math.max(wxrksWords, layoutWords);
  const charge = Math.max(summary.reduce((sum, r) => sum + (r.totalWords || 0), 0), layoutWords * targets.length);
  await store.updateJob(jobId, { analyzed_words: analyzedWords });
  await store.appendJobEvent(jobId, "analyzed", { words: analyzedWords, wxrksWords, layoutWords, charge, targets: targets.length });

  // Still zero: a scan OCR couldn't read (or in a language it has no model for), or a
  // conversion that never finished. Approving would translate whatever wxrks reads later
  // without charging for it, so the job stops here.
  if (analyzedWords === 0) {
    if (job.tier === "free") await store.releaseFreeTierUsage(jobId);
    await wxrks.cancelProject(project.uuid, "no text found");
    await setStatus(jobId, "no_text");
    return;
  }

  // 5. Gate
  if (job.tier === "free") {
    await store.setFreeTierUsageWords(jobId, analyzedWords);
    if (analyzedWords > FREE_TIER_MAX_WORDS) {
      // Nothing gets translated, so the day's free document is still theirs (store.js caps this).
      await store.releaseFreeTierUsage(jobId);
      await wxrks.cancelProject(project.uuid, "free tier word limit exceeded");
      await setStatus(jobId, "over_free_limit", "over_free_limit", { words: analyzedWords, limit: FREE_TIER_MAX_WORDS });
      // Page 1 as a preview of what the whole file would get (a PDF's excerpt never gets one).
      if (!job.excerpt_of) await require("./excerpt").start(jobId, FREE_TIER_MAX_WORDS);
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

  // 6. Approve — anything failing from here on refunds (markJobFailed). The tone's agent goes
  // on first: AI pre-translation starts with approval.
  await tone.apply(jobId, project);
  await setStatus(jobId, "approving");
  await wxrks.approveProject(project.uuid);
  await setStatus(jobId, "translating", "approved");

  // 7. The design-kept PDFs' text goes through its own wxrks project, created only once the
  // job is paid for and not metered again (the charge above already covers its words).
  await startLayout(jobId);
}

// wxrks answers 422 BWX-002 ("still being converted from PDF to DOCX") while a big PDF converts:
// wait and ask again, for up to 20 minutes, instead of failing the job.
async function whileConverting(fn) {
  const deadline = Date.now() + 20 * 60 * 1000;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const converting = err.response?.status === 422 && err.response?.data?.code === "BWX-002";
      if (!converting || Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
}

// A scanned PDF is pictures of pages: read the text off them first (OCR), so wxrks has words to
// translate. Each page keeps its picture, with the text laid invisibly on top. The file then gets
// the Word file only: pdf_layout.py refuses a design-kept PDF for a scan. Soft: when OCR can't
// read it, the file goes as it is and the job ends as no_text, as it did before OCR.
async function readScannedPages(job, file, content) {
  if (!(await layout.isAvailable())) return content;
  try {
    const read = await layout.ocr(content, job.source_locale);
    if (!read.scanned) return content;
    if (!read.pdf) {
      await store.appendJobEvent(job.id, "ocr_skipped", { file: file.original_filename, pages: read.scanned, reason: read.reason });
      return content;
    }
    await store.replaceScannedFileContent(file.id, read.pdf, read.pages);
    await store.appendJobEvent(job.id, "ocr_done", { file: file.original_filename, pages: read.pages, words: read.words });
    return read.pdf;
  } catch (err) {
    console.warn(`[pipeline] job ${job.id}: OCR failed for ${file.original_filename}: ${err.message}`);
    await store.appendJobEvent(job.id, "ocr_skipped", { file: file.original_filename, reason: "failed" });
    return content;
  }
}

async function prepareLayout(jobId, files) {
  let words = 0;
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.original_filename));
  if (!pdfs.length || !(await layout.isAvailable())) return words;
  for (const [i, file] of pdfs.entries()) {
    try {
      const extracted = await layout.extract(await store.getJobFileContent(file.id));
      if (!Object.keys(extracted.segments).length) {
        await store.updateJobFile(file.id, { layoutStatus: "skipped" });
        continue;
      }
      await store.updateJobFile(file.id, { layoutStatus: "pending", layoutFilename: `${jobId}-${i + 1}.layout.json`, layoutUnits: extracted.units });
      words += extracted.words;
    } catch (err) {
      console.warn(`[pipeline] job ${jobId}: no design-kept PDF for ${file.original_filename}: ${err.message}`);
      await store.updateJobFile(file.id, { layoutStatus: err.soft ? "skipped" : "failed" });
      await store.appendJobEvent(jobId, "layout_skipped", { file: file.original_filename, reason: err.message.slice(0, 160) });
    }
  }
  return words;
}

async function startLayout(jobId) {
  const job = await store.getJob(jobId);
  const files = (await store.listJobFiles(jobId)).filter((f) => f.layout_status === "pending");
  if (!files.length) return;
  try {
    const project = await wxrks.createProject({
      reference: `doctranslate-${jobId}-layout`,
      sourceLocale: job.source_locale,
      orgUnitUUID: job.org_unit_uuid,
      tags: [job.user_id || "free", "layout"],
    });
    await store.updateJob(jobId, { layout_project_uuid: project.uuid });
    await tone.apply(jobId, project);
    for (const file of files) {
      const { units } = await store.getJobFileLayoutUnits(file.id);
      const segments = Object.fromEntries(units.filter((u) => u.translate).map((u) => [u.id, u.text]));
      const resource = await wxrks.createResource(project.uuid, file.layout_filename);
      await wxrks.uploadResourceContent(project.uuid, resource.uuid, file.layout_filename, Buffer.from(JSON.stringify(segments)));
      await store.updateJobFile(file.id, { layoutResourceUuid: resource.uuid, layoutStatus: "translating" });
    }
    const sent = (await store.listJobFiles(jobId)).filter((f) => f.layout_status === "translating");
    await wxrks.createWorkUnitsBulk(
      project.uuid,
      sent.map((f) => ({ projectResourceUuid: f.layout_resource_uuid, workflows: ["TRANSLATION"], targetLocales: job.target_locales }))
    );
    await wxrks.approveProject(project.uuid);
    await store.appendJobEvent(jobId, "layout_started", { files: sent.length });
  } catch (err) {
    console.warn(`[pipeline] job ${jobId}: design-kept PDFs failed to start: ${wxrks.errInfo(err)}`);
    for (const f of await store.listJobFiles(jobId)) {
      if (["pending", "translating"].includes(f.layout_status)) await store.updateJobFile(f.id, { layoutStatus: "failed" });
    }
    await store.appendJobEvent(jobId, "layout_failed", { error: wxrks.errInfo(err).slice(0, 200) });
    const current = await store.getJob(jobId);
    if (current.layout_project_uuid) await wxrks.cancelProject(current.layout_project_uuid, "design-kept PDFs failed");
  }
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
    if (job?.layout_project_uuid) await wxrks.cancelProject(job.layout_project_uuid, "job failed");
    await tone.release(jobId);
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
  if (job.layout_project_uuid) await wxrks.cancelProject(job.layout_project_uuid, "cancelled by user");
  await tone.release(jobId);
  return store.getJob(jobId);
}

function startPipeline(jobId) {
  runPipeline(jobId).catch((err) => markJobFailed(jobId, err));
}

module.exports = { runPipeline, startPipeline, resumeApproval, markJobFailed, cancelJob, FREE_TIER_MAX_WORDS };
