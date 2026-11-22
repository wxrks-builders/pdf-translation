const path = require("path");
const express = require("express");
const AdmZip = require("adm-zip");
const store = require("../store");
const leads = require("../services/leads");
const locales = require("../services/locales");
const freeTier = require("../services/freeTier");
const { canSeeJob, isUnlocked } = require("../services/access");
const { optionalSession } = require("../middleware/auth");

const router = express.Router();

const EMAIL_REQUIRED = { error: "email_required", message: "Leave your email on the job page to download." };

// A download's name, safe in a header: an ASCII stand-in for old clients and the real name
// (RFC 5987) for the rest. Node refuses anything past Latin-1 in a header, so a file named
// "report ②.pdf", "Rodrigo’s notes.pdf" or in Chinese never downloaded: the request hung.
function attachment(name) {
  const ascii = name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "").trim() || "download";
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// Every translated file of a job in one ZIP, a folder per language when there are several
// (the "Download all files" button at the top of the finished page).
router.get("/:id/download", optionalSession, freeTier.anonCookie, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || !canSeeJob(req, job)) return res.status(404).json({ error: "not_found" });
  if (!isUnlocked(req, job)) return res.status(403).json(EMAIL_REQUIRED);

  const all = (await store.listDeliverables(job.id, { withContent: true })).filter((d) => d.content?.length);
  if (!all.length) return res.status(404).json({ error: "no_deliverables" });
  const names = await leads.languageNames();
  const several = new Set(all.map((d) => d.locale)).size > 1;
  const zip = new AdmZip();
  for (const d of all) zip.addFile(several ? `${names[locales.normalize(d.locale)] || d.locale}/${d.filename}` : d.filename, d.content);
  const files = await store.listJobFiles(job.id);
  const base = files.length === 1 ? path.basename(files[0].original_filename, path.extname(files[0].original_filename)) : "translations";
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", attachment(`${base} (translated).zip`));
  res.send(zip.toBuffer());
});

// One ZIP with every translated file for a language.
router.get("/:id/download/:locale", optionalSession, freeTier.anonCookie, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || !canSeeJob(req, job)) return res.status(404).json({ error: "not_found" });
  if (!isUnlocked(req, job)) return res.status(403).json(EMAIL_REQUIRED);

  const all = await store.listDeliverables(job.id, { withContent: true });
  const matching = all.filter((d) => d.locale === req.params.locale && d.content?.length);
  if (!matching.length) return res.status(404).json({ error: "no_deliverables_for_locale" });

  const zip = new AdmZip();
  for (const d of matching) zip.addFile(d.filename, d.content);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", attachment(`${job.id}-${req.params.locale}.zip`));
  res.send(zip.toBuffer());
});

// A single translated file.
router.get("/:id/files/:deliverableId", optionalSession, freeTier.anonCookie, async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job || !canSeeJob(req, job)) return res.status(404).json({ error: "not_found" });
  if (!isUnlocked(req, job)) return res.status(403).json(EMAIL_REQUIRED);

  const d = await store.getDeliverable(req.params.deliverableId);
  if (!d || d.job_id !== job.id || !d.content?.length) return res.status(404).json({ error: "not_found" });
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", attachment(d.filename));
  res.send(d.content);
});

module.exports = router;
