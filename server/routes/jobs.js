const express = require("express");
const multer = require("multer");
const store = require("../store");
const pipeline = require("../services/pipeline");
const freeTier = require("../services/freeTier");
const locales = require("../services/locales");
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

// A job is visible to its owning user, or — for anonymous jobs — to the
// browser carrying the anon cookie it was created under.
function canSeeJob(req, job) {
  if (job.user_id) return req.user && req.user.id === job.user_id;
  return job.anon_cookie_id && job.anon_cookie_id === req.anonId;
}

async function serializeJob(job) {
  const files = await store.listJobFiles(job.id);
  const deliverables = await store.listDeliverables(job.id);
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
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    files: files.map((f) => ({ id: f.id, name: f.original_filename, sizeBytes: f.size_bytes, status: f.status })),
    deliverables: deliverables.map((d) => ({
      id: d.id,
      fileId: d.job_file_id,
      locale: d.locale,
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
  res.json(await serializeJob(job));
});

router.post("/:id/cancel", optionalSession, freeTier.anonCookie, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || !canSeeJob(req, job)) return res.status(404).json({ error: "not_found" });
  const updated = await pipeline.cancelJob(job.id);
  res.json(await serializeJob(updated));
});

module.exports = router;
