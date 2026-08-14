// Spike 3 — hands-free completion: do explicit workflows:["TRANSLATION"] work units
// deliver with zero human/dashboard touches on this org unit? Do the org unit's
// extension-routing rules inject extra steps? Is autopilot active (DRAFT→PENDING on its own)?
//
// VERDICT (run 2026-08-13): handsFree=no autopilot=none observedWorkflows=TRANSLATION txtDeliverSec=null
//   THE BLOCKER FINDING. Routing rules on the org unit are all active:false (nothing injects extra
//   steps) and only TRANSLATION work units were created — but after APPROVED, wxrks creates one
//   task per work unit and NOTHING on this account ever assigns or executes it (task PENDING,
//   assignee null; other projects on this unit stalled the same way).
//   The account has no AI/service translator user and no task automation was set up, so
//   hands-free delivery requires configuring AI/autopilot task execution on the org unit in the
//   wxrks DASHBOARD before launch. Empty documents (zero segments, e.g. image-only PDFs) skip
//   translation and auto-deliver instantly — useful for testing the delivery plumbing.
const w = require("./lib/wxrksMin.js");
const fs = require("fs");
const path = require("path");

const TARGET = "pt_br";
const DELIVERY_TIMEOUT_MS = 20 * 60 * 1000;

(async () => {
  // 1. Org unit routing rules (endpoint quirk: returns HTTP 201 on success)
  try {
    const res = await w.getClientWorkflows(w.ORG_UNIT);
    w.log(`GET /client/:uuid/workflows → HTTP ${res.status}`);
    w.log(`routing rules: ${JSON.stringify(res.data).slice(0, 1500)}`);
  } catch (err) {
    w.log(`routing rules fetch failed: ${w.errInfo(err)}`);
  }

  const stamp = Date.now().toString(36);
  const project = await w.createProject({ reference: `spike3-${stamp}`, sourceLocale: "en", tags: ["spike"] });
  w.log(`project ${project.uuid}`);

  try {
    const name = `s3${stamp}-tiny.txt`;
    const res = await w.createResource(project.uuid, name);
    await w.uploadResourceContent(project.uuid, res.uuid, name, fs.readFileSync(path.join(__dirname, "fixtures", "tiny.txt")));

    const wus = await w.createWorkUnitsBulk(project.uuid, [
      { projectResourceUuid: res.uuid, workflows: ["TRANSLATION"], targetLocales: [TARGET] },
    ]);
    w.log(`created work units: ${JSON.stringify((wus || []).map((u) => ({ workflow: u.workflow, target: u.targetLanguage })))}`);

    // 2. Autopilot observation: does the project advance on its own?
    await w.sleep(15000);
    const after = await w.getProject(project.uuid);
    const autopilot = after.status !== "DRAFT" ? `observed(${after.status})` : "none";
    w.log(`status 15s after WU creation: ${after.status} → autopilot=${autopilot}`);

    const t0 = Date.now();
    if (after.status === "DRAFT" || after.status === "PENDING") {
      if (after.status === "DRAFT") await w.transition(project.uuid, "PENDING");
      await w.transition(project.uuid, "APPROVED");
    }
    w.log(`APPROVED after ${Math.round((Date.now() - t0) / 1000)}s; polling hands-free…`);

    // 3. Poll to DELIVERED with zero dashboard touches; watch for injected workflow steps
    const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
    let handsFree = "no";
    let observedWorkflows = new Set();
    let deliverSec = null;
    while (Date.now() < deadline) {
      const page = await w.listWorkUnits(project.uuid);
      const list = page.content || [];
      list.forEach((u) => observedWorkflows.add(u.workflow?.workflowType || u.workflow));
      const states = list.map((u) => `${u.workflow?.workflowType || u.workflow}:${u.workStatus}`);
      w.log(`  WUs: ${states.join(", ")}`);
      if (list.length && list.every((u) => u.workStatus === "DELIVERED")) {
        handsFree = "yes";
        deliverSec = Math.round((Date.now() - t0) / 1000);
        break;
      }
      await w.sleep(10000);
    }

    console.log(
      `VERDICT: handsFree=${handsFree} autopilot=${autopilot} observedWorkflows=${[...observedWorkflows].join("|")} txtDeliverSec=${deliverSec}`
    );
  } finally {
    await w.cancelProject(project.uuid);
  }
})().catch((e) => {
  console.error("SPIKE 3 FAILED:", w.errInfo(e));
  process.exit(1);
});
