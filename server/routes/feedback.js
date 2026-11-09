/**
 * The answer from the feedback email's links (/feedback?job=…&r=up|down&t=…): the token is the
 * job's own HMAC, so a link works without signing in and can't be made for another job.
 */
const express = require("express");
const store = require("../store");
const feedback = require("../services/feedback");
const { createRateLimiter } = require("../middleware/rateLimit");

const router = express.Router();
const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });

router.post("/", limiter, async (req, res) => {
  const { job: jobId, t, rating, comment } = req.body || {};
  const job = typeof jobId === "string" ? await store.getJob(jobId) : null;
  if (!job || !feedback.validToken(job.id, t)) return res.status(404).json({ error: "not_found" });
  try {
    await feedback.record({ jobId: job.id, source: "email", rating, comment });
    res.status(204).end();
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
