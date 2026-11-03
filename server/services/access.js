/**
 * Who may see a job and download its files. A job belongs to its user, or, for an anonymous
 * job, to the browser carrying the anon cookie it was created under. The files email carries
 * a per-job key (?k=) instead, so its links work on another device.
 *
 * Free-tier downloads also need the email step (routes/jobs.js unlock); the page-1 preview
 * doesn't.
 */
const crypto = require("crypto");

function accessKey(jobId) {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) throw new Error("COOKIE_SECRET must be configured");
  return crypto.createHmac("sha256", secret).update(`job:${jobId}`).digest("hex").slice(0, 32);
}

function hasAccessKey(req, job) {
  const given = String(req.query?.k || "");
  const expected = accessKey(job.id);
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

function canSeeJob(req, job) {
  if (hasAccessKey(req, job)) return true;
  if (job.user_id) return Boolean(req.user && req.user.id === job.user_id);
  return Boolean(job.anon_cookie_id && job.anon_cookie_id === req.anonId);
}

function isUnlocked(req, job) {
  return job.tier !== "free" || Boolean(job.unlocked_at) || hasAccessKey(req, job);
}

module.exports = { accessKey, canSeeJob, isUnlocked };
