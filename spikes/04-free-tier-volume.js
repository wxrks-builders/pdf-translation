// Spike 4 — free-tier volume hygiene: 5 tiny one-file projects back-to-back on one
// org unit. Watch for throttling, 423/422 races (autopilot), and time each to APPROVED.
//
// VERDICT (run 2026-08-13): tinyProjectsOk=yes avgApproveSecs=36 times=[36,36,36,36,36]
//   5/5 back-to-back tiny projects created, uploaded, WU'd, and approved with zero failures and
//   no throttling. The 36s is almost entirely the approval retry dance: wxrks returns transient
//   422 BWX-002 variants ("can't change to PENDING during some running process", "costs are not
//   calculated", and a stale-read "Unsupported transition: Draft -> Approved") that the retry
//   loop absorbs. Volume hygiene is fine for the free tier; no need for Continuous Projects yet.
const w = require("./lib/wxrksMin.js");
const fs = require("fs");
const path = require("path");

const N = 5;
const tinyBuf = fs.readFileSync(path.join(__dirname, "fixtures", "tiny.txt"));

(async () => {
  const created = [];
  const times = [];
  let failures = 0;
  try {
    for (let i = 0; i < N; i++) {
      const t0 = Date.now();
      const stamp = `${Date.now().toString(36)}${i}`;
      try {
        const project = await w.createProject({ reference: `spike4-${i}-${stamp}`, sourceLocale: "en", tags: ["spike"] });
        created.push(project.uuid);
        const name = `s4${stamp}-tiny.txt`;
        const res = await w.createResource(project.uuid, name);
        await w.uploadResourceContent(project.uuid, res.uuid, name, tinyBuf);
        await w.createWorkUnitsBulk(project.uuid, [
          { projectResourceUuid: res.uuid, workflows: ["TRANSLATION"], targetLocales: ["pt_br"] },
        ]);
        await w.transition(project.uuid, "PENDING");
        await w.transition(project.uuid, "APPROVED");
        const secs = Math.round((Date.now() - t0) / 1000);
        times.push(secs);
        w.log(`project ${i + 1}/${N} APPROVED in ${secs}s (${project.uuid})`);
      } catch (err) {
        failures++;
        w.log(`project ${i + 1}/${N} FAILED: ${w.errInfo(err)}`);
      }
    }
    const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
    console.log(`VERDICT: tinyProjectsOk=${failures === 0 ? "yes" : `no(${failures}fail)`} avgApproveSecs=${avg} times=${JSON.stringify(times)}`);
  } finally {
    for (const uuid of created) await w.cancelProject(uuid);
  }
})().catch((e) => {
  console.error("SPIKE 4 FAILED:", w.errInfo(e));
  process.exit(1);
});
