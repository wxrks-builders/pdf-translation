/**
 * A free PDF over the word limit still gets something to look at: its first page, translated
 * like any free document and shown next to the original, with the price of the whole file. It
 * runs as a child job (jobs.excerpt_of) that never opens downloads and doesn't use the day's
 * free document. Soft: without PyMuPDF, or when page 1 alone is over the limit, the screen
 * shows the offer without a preview.
 */
const store = require("../store");
const layout = require("./layout");
const { buildWxrksFilename } = require("./filenames");

async function start(parentId, maxWords) {
  const parent = await store.getJob(parentId);
  if (!parent || parent.tier !== "free" || parent.excerpt_of) return;
  const files = await store.listJobFiles(parentId);
  // A scan gets no design-kept PDF, so its page 1 would have nothing to show.
  if (files.length !== 1 || !/\.pdf$/i.test(files[0].original_filename) || files[0].ocr_pages) return;
  if (!(await layout.isAvailable())) return;
  try {
    const cut = await layout.excerpt(await store.getJobFileContent(files[0].id), maxWords);
    if (!cut.pdf) {
      await store.appendJobEvent(parentId, "excerpt_skipped", { pageOneWords: cut.words });
      return;
    }
    const child = await store.createJob({
      anonCookieId: parent.anon_cookie_id,
      tier: "free",
      sourceLocale: parent.source_locale,
      targetLocales: parent.target_locales,
      orgUnitUuid: parent.org_unit_uuid,
      tone: parent.tone,
      excerptOf: parent.id,
      excerptPages: 1,
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
    await store.appendJobEvent(parentId, "excerpt_started", { job: child.id, totalPages: cut.totalPages });
    require("./pipeline").startPipeline(child.id);
  } catch (err) {
    console.warn(`[excerpt] job ${parentId}: ${err.message}`);
    await store.appendJobEvent(parentId, "excerpt_failed", { error: String(err.message).slice(0, 200) });
  }
}

module.exports = { start };
