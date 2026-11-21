/**
 * For the people who run the translator (access.isAdmin: @wxrks.com or ADMIN_EMAILS): every
 * upload, and the digest on demand. Anyone else gets a 404, as if the route didn't exist.
 */
const express = require("express");
const digest = require("../services/digest");
const reminders = require("../services/reminders");
const { isAdmin } = require("../services/access");
const { optionalSession } = require("../middleware/auth");

const router = express.Router();

router.use(optionalSession, (req, res, next) => (isAdmin(req) ? next() : res.status(404).json({ error: "not_found" })));

// ?days=7 (up to 90)
router.get("/activity", async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
  res.json(await digest.activity(new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()));
});

// The files due a reminder now (services/reminders.js), sent or not: REMINDER_EMAILS says.
router.get("/reminders", async (req, res) => {
  const jobs = await reminders.due();
  res.json({
    sending: reminders.isEnabled(),
    due: await Promise.all(
      jobs.map(async (j) => ({ id: j.id, at: j.created_at, status: j.status, words: j.analyzed_words, to: reminders.addressOf(j), subject: (await reminders.render(j)).subject }))
    ),
  });
});

// One reminder exactly as it would go out.
router.get("/reminders/:id", async (req, res) => {
  const job = (await reminders.due()).find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "not_due" });
  const message = await reminders.render(job);
  res.type("html").send(message.html);
});

// Sends the last day's digest now, wherever the daily one goes.
router.post("/digest", async (req, res) => {
  const via = await digest.send(new Date(Date.now() - 24 * 3600 * 1000).toISOString(), "the last day (sent by hand)");
  res.json({ sent: via });
});

module.exports = router;
