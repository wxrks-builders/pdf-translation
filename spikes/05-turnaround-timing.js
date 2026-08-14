// Spike 5 — turnaround timing for UI copy: tiny.txt into TWO target locales,
// timestamps per phase (upload → analyzed → approved → delivered per locale).
// PDF timing comes from spike 2's verdict; txt single-locale from spike 3.
//
// VERDICT (run 2026-08-13, org unit "Online PDF Translator" <uuid>):
//   uploadSec=1 analyzeSec=4 approveSec=4 deliverSecByLocale={es:8, pt_br:8}
//   ~17s end-to-end for a small .txt into TWO languages on the automated org unit. Also confirms
//   the multi-target summary shape: one row per target language, each carrying the full source
//   word count (53+53) — charge = sum of rows = words × targets. UI copy can honestly say
//   "usually a few minutes"; the poller's 24h safety timeout is generous.
//   (On the unautomated "Main Organizational Unit" this spike would never complete — see spike 3.)
const w = require("./lib/wxrksMin.js");
const fs = require("fs");
const path = require("path");

const TARGETS = ["pt_br", "es"];
const DELIVERY_TIMEOUT_MS = 20 * 60 * 1000;

(async () => {
  const stamp = Date.now().toString(36);
  const t = { start: Date.now() };
  const project = await w.createProject({ reference: `spike5-${stamp}`, sourceLocale: "en", tags: ["spike"] });

  try {
    const name = `s5${stamp}-tiny.txt`;
    const res = await w.createResource(project.uuid, name);
    await w.uploadResourceContent(project.uuid, res.uuid, name, fs.readFileSync(path.join(__dirname, "fixtures", "tiny.txt")));
    t.uploaded = Date.now();

    await w.createWorkUnitsBulk(project.uuid, [
      { projectResourceUuid: res.uuid, workflows: ["TRANSLATION"], targetLocales: TARGETS },
    ]);

    const lf = await w.createPreAnalysis(project.uuid);
    const lfId = lf.id ?? lf.uuid;
    for (;;) {
      const page = await w.listLogfiles(project.uuid);
      const items = Array.isArray(page) ? page : page.content || [];
      const mine = items.find((l) => (l.id ?? l.uuid) === lfId);
      if (mine && (mine.status || "").toUpperCase().includes("COMPLETED")) break;
      if (mine && /(ERROR|FAIL)/.test((mine.status || "").toUpperCase())) throw new Error(`analysis failed: ${mine.status}`);
      await w.sleep(3000);
    }
    t.analyzed = Date.now();
    const summary = await w.logfileSummary(project.uuid, lfId);
    w.log(`summary: ${JSON.stringify(summary)}`);

    await w.transition(project.uuid, "PENDING");
    await w.transition(project.uuid, "APPROVED");
    t.approved = Date.now();

    const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
    const deliveredAt = {};
    while (Date.now() < deadline) {
      const page = await w.listWorkUnits(project.uuid);
      const list = page.content || [];
      for (const u of list) {
        if (u.workStatus === "DELIVERED" && !deliveredAt[u.targetLanguage]) {
          deliveredAt[u.targetLanguage] = Date.now();
          w.log(`  ${u.targetLanguage} DELIVERED`);
        }
      }
      if (list.length && Object.keys(deliveredAt).length === list.length) break;
      await w.sleep(8000);
    }

    const sec = (a, b) => (t[a] && t[b] ? Math.round((t[b] - t[a]) / 1000) : null);
    const perLocale = Object.fromEntries(
      Object.entries(deliveredAt).map(([loc, ts]) => [loc, Math.round((ts - t.approved) / 1000)])
    );
    console.log(
      `VERDICT: uploadSec=${sec("start", "uploaded")} analyzeSec=${sec("uploaded", "analyzed")} approveSec=${sec(
        "analyzed",
        "approved"
      )} deliverSecByLocale=${JSON.stringify(perLocale)} summary=${JSON.stringify(summary)}`
    );
  } finally {
    await w.cancelProject(project.uuid);
  }
})().catch((e) => {
  console.error("SPIKE 5 FAILED:", w.errInfo(e));
  process.exit(1);
});
