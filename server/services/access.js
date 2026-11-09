/**
 * Who may see a job and download its files. A job belongs to its user, or, for an anonymous
 * job, to the browser carrying the anon cookie it was created under. The files email carries
 * a per-job key (?k=) instead, so its links work on another device.
 *
 * Free-tier downloads also need the email step (routes/jobs.js unlock); the page-1 preview
 * doesn't. An excerpt job (the page-1 preview of a file over the free limit) never downloads.
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

// The people who run the translator (ADMIN_EMAILS, comma-separated) see every job, to follow
// up on what visitors upload (/admin, the daily digest). Signed in like anyone else.
function isAdmin(req) {
  const admins = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(req.user && admins.includes(String(req.user.email).toLowerCase()));
}

function canSeeJob(req, job) {
  if (hasAccessKey(req, job) || isAdmin(req)) return true;
  if (job.user_id) return Boolean(req.user && req.user.id === job.user_id);
  return Boolean(job.anon_cookie_id && job.anon_cookie_id === req.anonId);
}

// A page-1 preview of a file over the free limit (jobs.excerpt_of) never opens: it's a sample.
function isUnlocked(req, job) {
  if (job.excerpt_of) return false;
  return job.tier !== "free" || Boolean(job.unlocked_at) || hasAccessKey(req, job) || isAdmin(req);
}

module.exports = { accessKey, canSeeJob, isUnlocked, isAdmin };
