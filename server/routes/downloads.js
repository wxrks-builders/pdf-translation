const express = require("express");
const AdmZip = require("adm-zip");
const store = require("../store");
const freeTier = require("../services/freeTier");
const { optionalSession } = require("../middleware/auth");

const router = express.Router();

function canSeeJob(req, job) {
  if (job.user_id) return req.user && req.user.id === job.user_id;
  return job.anon_cookie_id && job.anon_cookie_id === req.anonId;
}

// One ZIP with every translated file for a language.
router.get("/:id/download/:locale", optionalSession, freeTier.anonCookie, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || !canSeeJob(req, job)) return res.status(404).json({ error: "not_found" });

  const all = await store.listDeliverables(job.id, { withContent: true });
  const matching = all.filter((d) => d.locale === req.params.locale && d.content?.length);
  if (!matching.length) return res.status(404).json({ error: "no_deliverables_for_locale" });

  const zip = new AdmZip();
  for (const d of matching) zip.addFile(d.filename, d.content);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${job.id}-${req.params.locale}.zip"`);
  res.send(zip.toBuffer());
});

// A single translated file.
router.get("/:id/files/:deliverableId", optionalSession, freeTier.anonCookie, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || !canSeeJob(req, job)) return res.status(404).json({ error: "not_found" });

  const d = await store.getDeliverable(req.params.deliverableId);
  if (!d || d.job_id !== job.id || !d.content?.length) return res.status(404).json({ error: "not_found" });
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${d.filename}"`);
  res.send(d.content);
});

module.exports = router;
