// Spike 6 — does the public API now convert PDF→DOCX at upload, like the dashboard?
// The API's PDF conversion reached
// production 2026-10-07. Upload a raw PDF (no app-side LibreOffice), then check:
//   - does the resource land as "<name>.pdf.docx"?
//   - which workflows do the work units carry (the dashboard adds ICR for PDFs)?
//   - is the delivered file a real DOCX (ZIP with word/document.xml), not extracted text?
//
// VERDICT (run 2026-11-03, new "wxrks pdf" account, org unit "Default" <uuid>):
//   convertedAtUpload=<name>.pdf.docx deliverable=undelivered
//   - the platform change is live: a raw PDF uploaded through PUT …/resource/{uuid}/content was renamed
//     "<name>.pdf.docx" within 5s, the same as the dashboard. The work unit was created on the
//     .docx. App-side LibreOffice is no longer needed for conversion.
//   - Delivery not verified: "Default" has no task automation, so the one TRANSLATION task sat
//     PENDING with no assignee for 6 min (the August failure mode, README). Re-run on a unit with
//     automatic translation to confirm the deliverable is a real DOCX.
//   - Re-run 2026-11-03 on "Online PDF Translator" (<uuid>, augmented actions
//     on): converted again in 5s; the task still sat PENDING/unassigned. AI on is not enough —
//     hands-free delivery needs a Pipeline or the confidence gate (help article 17271804).
//   - PASS 2026-11-03 19:14, after turning on the unit's Translation & Editor Settings →
//     Pre-translation: Context Sensitive + Machine translation (TM was already on), and Confirm &
//     lock → "Auto confirm pre-translated segments" ("Complete task once all segments are
//     confirmed" was already on). No Pipeline needed. VERDICT: convertedAtUpload=<name>.pdf.docx
//     deliverable=docx deliveredSec=27 — a real DOCX (word/document.xml) with pt-BR text. One
//     artifact seen: a word split by the PDF's line break ("su porte").
//   - Explicit workflows:["TRANSLATION"] was honored; whether the API adds ICR on its own (as the
//     dashboard does) is untested.
const w = require("./lib/wxrksMin.js");
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const FIXTURES = path.join(__dirname, "fixtures");
const TARGET = "pt_br";
const CONVERT_TIMEOUT_MS = 3 * 60 * 1000;
const DELIVERY_TIMEOUT_MS = Number(process.env.DELIVERY_TIMEOUT_MS) || 15 * 60 * 1000;
const OUT_DIR = process.argv[2] || path.join(__dirname, "out");

function sniff(buffer) {
  if (buffer.slice(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (buffer.slice(0, 2).toString("latin1") !== "PK") return "text-or-other";
  const names = new AdmZip(buffer).getEntries().map((e) => e.entryName);
  if (names.includes("word/document.xml")) return "docx";
  return `zip(${names.slice(0, 5).join(",")})`;
}

function docxText(buffer) {
  const xml = new AdmZip(buffer).readAsText("word/document.xml");
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

(async () => {
  const stamp = Date.now().toString(36);
  const name = `s6${stamp}-small.pdf`;
  const project = await w.createProject({ reference: `spike6-${stamp}`, sourceLocale: "en", tags: ["spike"] });
  w.log(`project ${project.uuid}`);

  try {
    const res = await w.createResource(project.uuid, name);
    await w.uploadResourceContent(project.uuid, res.uuid, name, fs.readFileSync(path.join(FIXTURES, "small.pdf")));
    w.log(`uploaded raw small.pdf as "${name}" → ${res.uuid}`);

    // Conversion may be async: watch the resource list until the name settles.
    let resources = [];
    const deadline = Date.now() + CONVERT_TIMEOUT_MS;
    let lastNames = "";
    for (;;) {
      resources = await w.listResources(project.uuid);
      const names = JSON.stringify(resources.map((r) => r.name));
      if (names !== lastNames) w.log(`  resources: ${names}`);
      lastNames = names;
      if (resources.some((r) => r.name.endsWith(".docx")) || Date.now() > deadline) break;
      await w.sleep(5000);
    }
    const converted = resources.find((r) => r.name.endsWith(".docx"));
    w.log(converted ? `CONVERTED at upload → "${converted.name}"` : "NOT converted: resource is still the raw PDF");

    const units = resources.map((r) => ({ projectResourceUuid: r.uuid, workflows: ["TRANSLATION"], targetLocales: [TARGET] }));
    await w.createWorkUnitsBulk(project.uuid, units);
    const created = (await w.listWorkUnits(project.uuid)).content || [];
    w.log(`work units: ${JSON.stringify(created.map((u) => ({ filename: u.filename, workflow: u.workflow || u.workflows, status: u.workStatus })))}`);

    const t0 = Date.now();
    await w.transition(project.uuid, "PENDING");
    await w.transition(project.uuid, "APPROVED");
    w.log(`APPROVED after ${Math.round((Date.now() - t0) / 1000)}s; waiting for delivery…`);

    let wus = [];
    const deliveryDeadline = Date.now() + DELIVERY_TIMEOUT_MS;
    for (;;) {
      wus = (await w.listWorkUnits(project.uuid)).content || [];
      if (wus.length && wus.every((u) => u.workStatus === "DELIVERED")) break;
      if (Date.now() > deliveryDeadline) break;
      await w.sleep(10000);
    }
    const deliveredSec = Math.round((Date.now() - t0) / 1000);
    w.log(`work-unit status after ${deliveredSec}s: ${JSON.stringify(wus.map((u) => `${u.filename}:${u.workStatus}`))}`);

    let deliverable = "undelivered";
    if (!wus.length || !wus.every((u) => u.workStatus === "DELIVERED")) {
      // Unassigned PENDING tasks mean the org unit has no task automation (see README).
      const tasks = (await w.request({ method: "GET", url: `/task?projectUuid=${project.uuid}` })).data;
      const list = Array.isArray(tasks) ? tasks : tasks.content || [];
      w.log(`  tasks: ${JSON.stringify(list.map((t) => ({ type: t.type || t.workflow, status: t.status, assignee: t.assignee?.name || t.assigneeName || null })))}`);
    }
    if (wus.length && wus.every((u) => u.workStatus === "DELIVERED")) {
      const entries = await w.downloadZip(project.uuid, { resources: resources.map((r) => r.uuid), locales: [TARGET] });
      fs.mkdirSync(OUT_DIR, { recursive: true });
      for (const e of entries) {
        const kind = sniff(e.buffer);
        const file = path.join(OUT_DIR, path.basename(e.entryName));
        fs.writeFileSync(file, e.buffer);
        w.log(`  zip entry: ${e.entryName} (${e.buffer.length} bytes) → really ${kind}; saved ${file}`);
        if (kind === "docx") w.log(`  translated text (first 400 chars):\n${docxText(e.buffer).slice(0, 400)}`);
        deliverable = kind;
      }
    }

    console.log(
      `VERDICT: convertedAtUpload=${converted ? converted.name : "no"} deliverable=${deliverable} deliveredSec=${deliveredSec}`
    );
  } finally {
    await w.cancelProject(project.uuid);
  }
})().catch((e) => {
  console.error("SPIKE 6 FAILED:", w.errInfo(e));
  process.exit(1);
});
