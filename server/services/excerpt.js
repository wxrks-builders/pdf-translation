/**
 * A PDF stopped at a price (over the free limit, or not enough credits) still gets something to
 * look at: a sample of it, translated like any free document and shown page by page next to the
 * original, with the price of the whole file. The sample is up to SAMPLE_WORDS words of
 * consecutive pages (about 8, at most 10) from the first page with real text, so a cover or a
 * blank page doesn't stand in for the document (pdf_layout.py excerpt); a scan gives its first
 * pages, read by OCR in the sample's own job. It runs as a child job (jobs.excerpt_of) that never
 * opens downloads and doesn't use the day's free document. The page shows the design-kept pages,
 * or the text of both when there are none (a scan, a script the fonts lack): routes/jobs.js
 * preview-text. Soft: without PyMuPDF, or when the first text page alone is over the limit, the
 * screen shows the offer without a sample.
 */
const store = require("../store");
const layout = require("./layout");
const { buildWxrksFilename } = require("./filenames");

async function start(parentId, maxWords) {
  const parent = await store.getJob(parentId);
  if (!parent || parent.excerpt_of) return;
  const files = await store.listJobFiles(parentId);
  if (files.length !== 1 || !/\.pdf$/i.test(files[0].original_filename)) return;
  if (!(await layout.isAvailable())) return;
  try {
    const cut = await layout.excerpt(await store.getJobFileContent(files[0].id), maxWords);
    if (!cut.pdf) {
      await store.appendJobEvent(parentId, "excerpt_skipped", { firstPage: cut.firstPage, words: cut.words });
      return;
    }
    // Always a free-tier sample, seen by whoever sees the parent (its account, or its device).
    const child = await store.createJob({
      userId: parent.user_id,
      anonCookieId: parent.anon_cookie_id,
      tier: "free",
      sourceLocale: parent.source_locale,
      targetLocales: parent.target_locales,
      orgUnitUuid: parent.org_unit_uuid,
      tone: parent.tone,
      excerptOf: parent.id,
      excerptPages: cut.pages,
      excerptFirstPage: cut.firstPage,
      excerptTotalPages: cut.totalPages,
    });
    await store.createJobFile({
      jobId: child.id,
      originalFilename: files[0].original_filename,
      wxrksFilename: buildWxrksFilename(child.id, files[0].original_filename),
      sizeBytes: cut.pdf.length,
      contentType: "application/pdf",
      content: cut.pdf,
    });
    await store.appendJobEvent(parentId, "excerpt_started", { job: child.id, pages: cut.pages, firstPage: cut.firstPage, totalPages: cut.totalPages });
    require("./pipeline").startPipeline(child.id);
  } catch (err) {
    console.warn(`[excerpt] job ${parentId}: ${err.message}`);
    await store.appendJobEvent(parentId, "excerpt_failed", { error: String(err.message).slice(0, 200) });
  }
}

module.exports = { start };
