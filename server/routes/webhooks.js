/**
 * The URL is configured in the wxrks dashboard (events "Work Unit Status
 * Changed" / "Work Unit Translation File Ready"). This app does not verify
 * the sender, so the payload is treated purely as an untrusted latency hint:
 * acknowledge immediately, and if the referenced project belongs to an active
 * job, poke the poller —
 * which re-reads the truth from wxrks itself. No state is ever written from
 * webhook data.
 */
const express = require("express");
const store = require("../store");
const poller = require("../services/poller");

const router = express.Router();

router.post("/wxrks", express.json({ limit: "256kb" }), async (req, res) => {
  res.json({ ok: true }); // ack fast — includes wxrks's WEBHOOK_VALIDATION ping

  try {
    const body = req.body || {};
    const projectUuid = body.project_uuid || body.projectUuid || body.project?.uuid;
    if (!projectUuid) return;
    const active = await store.listActiveJobs();
    if (active.some((j) => j.wxrks_project_uuid === projectUuid)) {
      poller.pokeProject(projectUuid);
    }
  } catch (err) {
    console.error("[webhook] hint processing failed:", err.message);
  }
});

module.exports = router;
