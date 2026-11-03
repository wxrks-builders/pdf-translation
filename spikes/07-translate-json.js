// Spike 7, translation step: send <workdir>/segments.json ({id: source text}) through wxrks as a
// JSON resource and write <workdir>/translated.json ({id: translation}). Same project flow as the
// app (project → resource → TRANSLATION work unit → approve → poll → download), on the org unit
// pinned in .env.
//
//   node spikes/07-translate-json.js <workdir> [targetLocale=pt_br]
const w = require("./lib/wxrksMin.js");
const fs = require("fs");
const path = require("path");

const [workdir, target = "pt_br"] = process.argv.slice(2);
if (!workdir) {
  console.error("usage: node spikes/07-translate-json.js <workdir> [targetLocale]");
  process.exit(1);
}
const DELIVERY_TIMEOUT_MS = 10 * 60 * 1000;

(async () => {
  const stamp = Date.now().toString(36);
  const name = `s7${stamp}-segments.json`;
  const project = await w.createProject({ reference: `spike7-${stamp}`, sourceLocale: "en", tags: ["spike"] });
  w.log(`project ${project.uuid}`);
  try {
    const res = await w.createResource(project.uuid, name);
    await w.uploadResourceContent(project.uuid, res.uuid, name, fs.readFileSync(path.join(workdir, "segments.json")));
    await w.createWorkUnitsBulk(project.uuid, [{ projectResourceUuid: res.uuid, workflows: ["TRANSLATION"], targetLocales: [target] }]);
    await w.transition(project.uuid, "PENDING");
    await w.transition(project.uuid, "APPROVED");
    const t0 = Date.now();
    w.log("approved; waiting for delivery…");
    for (;;) {
      const wus = (await w.listWorkUnits(project.uuid)).content || [];
      if (wus.length && wus.every((u) => u.workStatus === "DELIVERED")) break;
      if (Date.now() - t0 > DELIVERY_TIMEOUT_MS) throw new Error(`not delivered: ${wus.map((u) => u.workStatus)}`);
      await w.sleep(5000);
    }
    w.log(`delivered after ${Math.round((Date.now() - t0) / 1000)}s`);
    const [entry] = await w.downloadZip(project.uuid, { resources: [res.uuid], locales: [target] });
    const translated = JSON.parse(entry.buffer.toString("utf8"));
    fs.writeFileSync(path.join(workdir, "translated.json"), JSON.stringify(translated, null, 1));
    const source = JSON.parse(fs.readFileSync(path.join(workdir, "segments.json"), "utf8"));
    const same = Object.keys(source).filter((k) => translated[k] === source[k]).length;
    w.log(`${Object.keys(translated).length} segments back (${same} unchanged) → translated.json`);
  } finally {
    await w.cancelProject(project.uuid);
  }
})().catch((e) => {
  console.error("SPIKE 7 TRANSLATE FAILED:", w.errInfo(e));
  process.exit(1);
});
