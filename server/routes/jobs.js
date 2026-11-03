const express = require("express");
const multer = require("multer");
const store = require("../store");
const pipeline = require("../services/pipeline");
const freeTier = require("../services/freeTier");
const locales = require("../services/locales");
const layout = require("../services/layout");
const leads = require("../services/leads");
const email = require("../services/email");
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

function orgUnitFor(tier) {
  const paid = process.env.WXRKS_PAID_ORG_UNIT_UUID;
  const free = process.env.WXRKS_FREE_ORG_UNIT_UUID || paid;
  return tier === "free" ? free : paid;
}

const unlockLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

async function serializeJob(job, req) {
  const files = await store.listJobFiles(job.id);
  const deliverables = await store.listDeliverables(job.id);
  // One page-1 preview per language: the first design-kept PDF.
  const previews = [];
  for (const d of deliverables) {
    if (d.variant === "pdf-design" && !previews.some((p) => p.locale === d.locale)) {
      previews.push({ locale: d.locale, deliverableId: d.id });
    }
  }
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
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    files: files.map((f) => ({ id: f.id, name: f.original_filename, sizeBytes: f.size_bytes, status: f.status })),
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
    if (targetLocales.length > 1) {
      return res.status(400).json({ error: "free_tier_one_language", message: "The free translator does one language a day. Sign in for more." });
    }
    const used = await freeTier.findUsageToday(req);
    if (used) return res.status(429).json({ error: "free_limit_reached", message: "Free tier allows 1 document per day." });
  }

  const job = await store.createJob({
    userId: req.user?.id,
    anonCookieId: tier === "free" ? req.anonId : null,
    tier,
    sourceLocale,
    targetLocales,
    orgUnitUuid: orgUnitFor(tier),
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
  const address = leads.normalizeEmail(req.body?.email);
  if (!address) return res.status(400).json({ error: "invalid_email", message: "Check the email address." });
  const updated = job.tier === "free" ? await leads.unlock(req, job, { address, marketingOptIn: req.body?.marketingOptIn === true }) : job;
  res.json(await serializeJob(updated, req));
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
