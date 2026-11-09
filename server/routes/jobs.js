const express = require("express");
const multer = require("multer");
const AdmZip = require("adm-zip");
const store = require("../store");
const pipeline = require("../services/pipeline");
const freeTier = require("../services/freeTier");
const locales = require("../services/locales");
const layout = require("../services/layout");
const leads = require("../services/leads");
const email = require("../services/email");
const tone = require("../services/tone");
const marketplace = require("../services/marketplace");
const events = require("../services/events");
const feedback = require("../services/feedback");
const { canSeeJob, isUnlocked } = require("../services/access");
const { createRateLimiter } = require("../middleware/rateLimit");
const { buildWxrksFilename, extensionAllowed, findTruncationCollision, ALLOWED_EXTENSIONS } = require("../services/filenames");
const { optionalSession } = require("../middleware/auth");

const router = express.Router();

const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || "25", 10);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 10 },
});

// Up to three languages per document, free or paid; more is a job for the wxrks platform,
// which the picker points to. Keep in step with MAX_TARGETS in client/src/pages/Upload.jsx.
const MAX_TARGETS = 3;

function orgUnitFor(tier) {
  const paid = process.env.WXRKS_PAID_ORG_UNIT_UUID;
  const free = process.env.WXRKS_FREE_ORG_UNIT_UUID || paid;
  return tier === "free" ? free : paid;
}

const unlockLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

// One page-1 preview per language: the first design-kept PDF.
function previewsOf(deliverables) {
  const previews = [];
  for (const d of deliverables) {
    if (d.variant === "pdf-design" && !previews.some((p) => p.locale === d.locale)) {
      previews.push({ locale: d.locale, deliverableId: d.id });
    }
  }
  return previews;
}

// The page-1 preview of a file stopped at a price (services/excerpt.js), if one was started.
// Without a design-kept page to show (a scan, a script the fonts lack), the page asks for the
// text of both sides instead (preview-text below).
async function excerptOf(job) {
  if (!["over_free_limit", "needs_credits"].includes(job.status)) return null;
  const child = await store.getExcerptFor(job.id);
  if (!child) return null;
  const deliverables = await store.listDeliverables(child.id);
  return {
    jobId: child.id,
    status: child.status,
    totalPages: child.excerpt_total_pages,
    previews: previewsOf(deliverables),
    textPreview: child.status === "delivered" && deliverables.some((d) => d.variant === "translation"),
  };
}

// The words of a .docx, paragraph by paragraph, at most maxWords.
function docxText(buffer, maxWords) {
  const xml = new AdmZip(buffer).readAsText("word/document.xml");
  const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const out = [];
  let count = 0;
  for (const p of xml.split("</w:p>")) {
    const words = decode([...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("")).split(/\s+/).filter(Boolean);
    const take = words.slice(0, Math.max(0, maxWords - count));
    if (take.length) out.push(take.join(" "));
    count += take.length;
    if (count >= maxWords) break;
  }
  return out.join("\n\n");
}

// The paid job a stopped job was translated as (POST /:id/rerun), unless that one stopped too.
async function rerunOf(job) {
  const last = [...job.timeline].reverse().find((e) => e.event === "rerun_paid");
  if (!last?.detail?.job) return null;
  const paid = await store.getJob(last.detail.job);
  return paid && !["failed", "cancelled"].includes(paid.status) ? paid : null;
}

async function serializeJob(job, req) {
  const files = await store.listJobFiles(job.id);
  const deliverables = await store.listDeliverables(job.id);
  const previews = previewsOf(deliverables);
  return {
    id: job.id,
    tier: job.tier,
    status: job.status,
    sourceLocale: job.source_locale,
    targetLocales: job.target_locales,
    analyzedWords: job.analyzed_words,
    creditsCharged: job.credits_charged,
    error: job.error,
    timeline: job.timeline,
    unlocked: isUnlocked(req, job),
    unlockedEmail: job.unlocked_email,
    emailDelivery: email.isConfigured(),
    previews,
    tone: job.tone,
    confidence: job.confidence_status ? { status: job.confidence_status, byLocale: job.confidence?.byLocale || {} } : null,
    feedback: (await store.getFeedback(job.id)).find((f) => f.source === "page")?.rating || null,
    // The free words this job was measured against.
    freeLimit: [...job.timeline].reverse().find((e) => e.event === "over_free_limit")?.detail?.limit || pipeline.FREE_TIER_MAX_WORDS,
    excerpt: await excerptOf(job),
    rerunJobId: (await rerunOf(job))?.id || null,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    files: files.map((f) => ({ id: f.id, name: f.original_filename, sizeBytes: f.size_bytes, status: f.status, scannedPages: f.ocr_pages || 0 })),
    deliverables: deliverables.map((d) => ({
      id: d.id,
      fileId: d.job_file_id,
      locale: d.locale,
      variant: d.variant,
      filename: d.filename,
      sizeBytes: d.size_bytes,
    })),
  };
}

router.post("/", optionalSession, freeTier.anonCookie, upload.array("files"), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: "no_files" });

  const sourceLocale = await locales.toCanonical(req.body.sourceLocale);
  let targetsRaw = req.body.targetLocales;
  if (typeof targetsRaw === "string") targetsRaw = targetsRaw.split(",").filter(Boolean);
  const targetLocales = [];
  for (const t of targetsRaw || []) {
    const canonical = await locales.toCanonical(t);
    if (!canonical) return res.status(400).json({ error: "invalid_target_locale", locale: t });
    if (!targetLocales.includes(canonical)) targetLocales.push(canonical);
  }
  if (!sourceLocale) return res.status(400).json({ error: "invalid_source_locale" });
  if (!targetLocales.length) return res.status(400).json({ error: "no_target_locales" });
  if (targetLocales.length > MAX_TARGETS) {
    return res.status(400).json({
      error: "too_many_languages",
      max: MAX_TARGETS,
      message: `Up to ${MAX_TARGETS} languages per document. For more, use the wxrks platform.`,
    });
  }
  if (targetLocales.some((t) => locales.sameLocale(t, sourceLocale))) {
    return res.status(400).json({ error: "target_equals_source" });
  }

  for (const f of files) {
    if (!extensionAllowed(f.originalname)) {
      return res.status(400).json({ error: "unsupported_file_type", file: f.originalname, allowed: ALLOWED_EXTENSIONS });
    }
  }

  const tier = req.user ? "paid" : "free";
  if (tier === "free") {
    if (files.length > 1) return res.status(400).json({ error: "free_tier_one_file" });
    const used = await freeTier.findUsageToday(req);
    if (used) {
      await events.record(req, "free_limit_hit", { place: "free_used" });
      return res.status(429).json({ error: "free_limit_reached", message: "Free tier allows 1 document per day." });
    }
  }

  const job = await store.createJob({
    userId: req.user?.id,
    anonCookieId: tier === "free" ? req.anonId : null,
    tier,
    sourceLocale,
    targetLocales,
    orgUnitUuid: orgUnitFor(tier),
    tone: tone.parse(req.body),
    clientIp: req.ip,
  });

  const wxrksNames = files.map((f) => buildWxrksFilename(job.id, f.originalname));
  const collision = findTruncationCollision(wxrksNames);
  if (collision) {
    await store.updateJob(job.id, { status: "failed", error: "filename_collision" });
    return res.status(400).json({
      error: "filename_collision",
      message: `These file names are too similar to tell apart after upload: ${collision.join(" / ")}. Please rename one.`,
    });
  }

  for (let i = 0; i < files.length; i++) {
    await store.createJobFile({
      jobId: job.id,
      originalFilename: files[i].originalname,
      wxrksFilename: wxrksNames[i],
      sizeBytes: files[i].size,
      contentType: files[i].mimetype,
      content: files[i].buffer,
    });
  }

  if (tier === "free") await freeTier.reserveSlot(req, job.id);

  pipeline.startPipeline(job.id);
  res.status(202).json({ jobId: job.id });
});

router.get("/", optionalSession, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "not_authenticated" });
  const jobs = await store.listJobsForUser(req.user.id);
  res.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      status: j.status,
      sourceLocale: j.source_locale,
      targetLocales: j.target_locales,
      analyzedWords: j.analyzed_words,
      creditsCharged: j.credits_charged,
      createdAt: j.created_at,
    })),
  });
});

// The text of a translated sample next to its original, when there is no page image to show:
// the first words of the source PDF and of the translated Word file, first language.
router.get("/:id/preview-text", optionalSession, freeTier.anonCookie, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || !canSeeJob(req, job) || job.status !== "delivered") return res.status(404).json({ error: "not_found" });
  const [file] = await store.listJobFiles(job.id);
  const translation = (await store.listDeliverables(job.id, { withContent: true })).find(
    (d) => d.variant === "translation" && /\.docx$/i.test(d.filename) && d.content?.length
  );
  if (!file || !translation) return res.status(404).json({ error: "not_found" });
  try {
    const source = /\.pdf$/i.test(file.original_filename) ? await layout.text(await store.getJobFileContent(file.id), 250) : null;
    res.json({ locale: translation.locale, source, target: docxText(translation.content, 250) });
  } catch (err) {
    console.error(`[preview-text] job ${job.id}: ${err.message}`);
    res.status(500).json({ error: "preview_failed" });
  }
});

const REVIEWER_UTM ="?utm_source=translate.wxrks.com&utm_medium=referral&utm_campaign=free-translator&utm_content=reviewer";

// Who could check this translation: marketplace partners for each target language, paid ones
// first (services/marketplace.js).
router.get("/:id/reviewers", optionalSession, freeTier.anonCookie, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || !canSeeJob(req, job)) return res.status(404).json({ error: "not_found" });
  const names = Object.fromEntries((await locales.listLanguages().catch(() => [])).map((l) => [locales.normalize(l.code), l.name]));
  const byLocale = {};
  for (const loc of job.target_locales) {
    const key = locales.normalize(loc);
    byLocale[key] = await marketplace.reviewersFor(names[key] || loc, { utm: REVIEWER_UTM });
  }
  res.json({ byLocale });
});

// Thumbs up or down from the job page (services/feedback.js); a second post adds the comment.
router.post("/:id/feedback", optionalSession, freeTier.anonCookie, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || !canSeeJob(req, job) || job.status !== "delivered") return res.status(404).json({ error: "not_found" });
  try {
    await feedback.record({ jobId: job.id, source: "page", rating: req.body?.rating, comment: req.body?.comment, visitor: req.user?.id || req.anonId });
    res.status(204).end();
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get("/:id", optionalSession, freeTier.anonCookie, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || !canSeeJob(req, job)) return res.status(404).json({ error: "not_found" });
  res.json(await serializeJob(job, req));
});

router.post("/:id/cancel", optionalSession, freeTier.anonCookie, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || !canSeeJob(req, job)) return res.status(404).json({ error: "not_found" });
  const updated = await pipeline.cancelJob(job.id);
  res.json(await serializeJob(updated, req));
});

// The free tier's email step: leave an address, the downloads open, and the links arrive by
// email once the files are ready (services/leads.js).
router.post("/:id/unlock", unlockLimiter, optionalSession, freeTier.anonCookie, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || !canSeeJob(req, job)) return res.status(404).json({ error: "not_found" });
  if (job.excerpt_of) return res.status(400).json({ error: "preview_only" });
  const address = leads.normalizeEmail(req.body?.email);
  if (!address) return res.status(400).json({ error: "invalid_email", message: "Check the email address." });
  const updated = job.tier === "free" ? await leads.unlock(req, job, { address, marketingOptIn: req.body?.marketingOptIn === true }) : job;
  res.json(await serializeJob(updated, req));
});

// After buying words: translate a file that stopped for lack of words (over the free limit, or
// not enough credits) as a new paid job, without uploading it again. The pipeline charges the
// credits, as for any paid job.
router.post("/:id/rerun", optionalSession, freeTier.anonCookie, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "not_authenticated" });
  const job = await store.getJob(req.params.id);
  if (!job || !canSeeJob(req, job) || !["over_free_limit", "needs_credits"].includes(job.status)) {
    return res.status(404).json({ error: "not_found" });
  }
  const earlier = await rerunOf(job); // a second click goes to the same paid job
  if (earlier) return res.status(200).json({ jobId: earlier.id });
  const files = await store.listJobFiles(job.id);
  const contents = [];
  for (const f of files) {
    const content = await store.getJobFileContent(f.id);
    if (!content?.length) return res.status(410).json({ error: "expired", message: "This file was deleted after 30 days. Upload it again." });
    contents.push(content);
  }
  const paid = await store.createJob({
    userId: req.user.id,
    tier: "paid",
    sourceLocale: job.source_locale,
    targetLocales: job.target_locales,
    orgUnitUuid: orgUnitFor("paid"),
    tone: job.tone,
  });
  for (const [i, f] of files.entries()) {
    await store.createJobFile({
      jobId: paid.id,
      originalFilename: f.original_filename,
      wxrksFilename: buildWxrksFilename(paid.id, f.original_filename),
      sizeBytes: f.size_bytes,
      contentType: f.content_type,
      content: contents[i],
    });
  }
  await store.appendJobEvent(job.id, "rerun_paid", { job: paid.id });
  pipeline.startPipeline(paid.id);
  res.status(202).json({ jobId: paid.id });
});

// Page 1 of the original or of the design-kept translation, as a JPEG. Rendered on demand
// and kept for a while; it's what the free tier shows before the email step.
const previewCache = new Map();
const PREVIEW_CACHE_MAX = 40;

router.get("/:id/preview/:deliverableId/:side", optionalSession, freeTier.anonCookie, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || !canSeeJob(req, job)) return res.status(404).json({ error: "not_found" });
  const d = await store.getDeliverable(req.params.deliverableId);
  if (!d || d.job_id !== job.id || d.variant !== "pdf-design" || !["original", "translated"].includes(req.params.side)) {
    return res.status(404).json({ error: "not_found" });
  }
  const key = `${d.id}:${req.params.side}`;
  try {
    let jpeg = previewCache.get(key);
    if (!jpeg) {
      const pdf = req.params.side === "original" ? await store.getJobFileContent(d.job_file_id) : d.content;
      if (!pdf?.length) return res.status(404).json({ error: "expired" });
      jpeg = await layout.preview(pdf);
      if (previewCache.size >= PREVIEW_CACHE_MAX) previewCache.delete(previewCache.keys().next().value);
      previewCache.set(key, jpeg);
    }
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(jpeg);
  } catch (err) {
    console.error(`[preview] job ${job.id}: ${err.message}`);
    res.status(500).json({ error: "preview_failed" });
  }
});

module.exports = router;
