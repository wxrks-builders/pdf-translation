// Spike 2 — PDF round trip: PDF up → translated deliverable down (expect DOCX).
// Also: scanned-PDF behavior, and the exact filename-truncation length (~31 chars claimed).
//
// VERDICT (run 2026-08-13): pdfDeliverable=none scannedMode=delivered-as-.pdf-1b truncatedTo=56chars
//                            approveSec=10 deliveredCount=1/2
//   - The text PDF's work unit never delivered on "Main Organizational Unit" — no task execution
//     there (spike 3). RESOLVED on "Online PDF Translator" (6e429e88…): PDFs translate and deliver
//     hands-free, but the deliverable is the extracted TRANSLATED TEXT under a ".pdf"-named ZIP
//     entry — NOT a PDF and NOT the help center's promised DOCX (verified twice: fixture PDF and a
//     real 1.5MB PDF; the translation-kit-job endpoint returns the same content honestly named
//     .txt). The app's poller sniffs magic bytes and renames deliverables accordingly.
//   - Metering race: pre-analysis on a 1.5MB PDF can "complete" at 0 words while wxrks is still
//     converting the file — the job then translates unmetered. The pipeline retries zero-word
//     analyses with backoff (pipeline.js).
//   - ROOT CAUSE FOUND (2026-08-14, via dashboard project 57a6e736-8915-4c46-8832-91ed44dba773):
//     the wxrks DASHBOARD converts PDF→DOCX at upload (resource lands as "<name>.pdf.docx",
//     Adobe tooling) and translates the DOCX with full layout; the public API has no conversion
//     endpoint at all, so API-uploaded raw PDFs go through a plain-text extractor. Fix: the app
//     now converts PDF→DOCX itself (headless LibreOffice, services/convert.js) and uploads
//     "<name>.pdf.docx" exactly like the dashboard.
//   - Scanned (image-only) PDF parses to zero segments and auto-DELIVERS instantly; the "translated"
//     file is a 1-byte stub named like the source. Treat zero-word docs as a UX case (warn user).
//   - Filename truncation did NOT reproduce: a 56-char basename came back full-length in
//     resource/simple, work-unit filenames, and the ZIP entry. Keep the defensive prefix matching
//     (costs nothing), but truncation may only bite at longer lengths than the blueprint's ~31.
//   - Approval took 10s here (transient 422 "costs are not calculated" absorbed by retries).
const w = require("./lib/wxrksMin.js");
const fs = require("fs");
const path = require("path");

const FIXTURES = path.join(__dirname, "fixtures");
const TARGET = "pt_br";
const DELIVERY_TIMEOUT_MS = 25 * 60 * 1000;

async function waitDelivered(projectUuid, timeoutMs) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  const delivered = new Map();
  for (;;) {
    const page = await w.listWorkUnits(projectUuid);
    const wus = page.content || [];
    for (const wu of wus) {
      const key = `${wu.filename}|${wu.targetLanguage}`;
      if (!delivered.has(key) && wu.workStatus === "DELIVERED") {
        delivered.set(key, Math.round((Date.now() - started) / 1000));
        w.log(`  DELIVERED ${key} after ${delivered.get(key)}s`);
      }
    }
    if (wus.length && delivered.size === wus.length) return { delivered, wus, all: true };
    if (Date.now() > deadline) return { delivered, wus, all: false };
    await w.sleep(10000);
  }
}

(async () => {
  const stamp = Date.now().toString(36);
  const project = await w.createProject({ reference: `spike2-${stamp}`, sourceLocale: "en", tags: ["spike"] });
  w.log(`project ${project.uuid}`);

  try {
    // Long basename to measure truncation (60 chars before ".pdf")
    const longBase = `s2${stamp}-` + "abcdefghijklmnopqrstuvwxyz0123456789".repeat(2).slice(0, 60 - 7 - stamp.length);
    const longName = `${longBase}.pdf`;
    const scannedName = `s2${stamp}-scan.pdf`;

    const uploads = [
      { name: longName, file: "small.pdf" },
      { name: scannedName, file: "scanned.pdf" },
    ];
    const resourceByName = {};
    for (const u of uploads) {
      const res = await w.createResource(project.uuid, u.name);
      await w.uploadResourceContent(project.uuid, res.uuid, u.name, fs.readFileSync(path.join(FIXTURES, u.file)));
      resourceByName[u.name] = res.uuid;
      w.log(`uploaded ${u.file} as "${u.name}" (${u.name.length} chars) → ${res.uuid}`);
    }

    const echoed = await w.listResources(project.uuid);
    w.log(`resource/simple echoes: ${JSON.stringify(echoed.map((r) => r.name))}`);
    const echoedLong = echoed.find((r) => r.name.startsWith(longName.slice(0, 10)));
    const truncatedTo = echoedLong ? path.parse(echoedLong.name).name.length : null;
    w.log(`sent basename ${longBase.length} chars; echoed basename ${truncatedTo} chars`);

    const units = echoed.map((r) => ({ projectResourceUuid: r.uuid, workflows: ["TRANSLATION"], targetLocales: [TARGET] }));
    await w.createWorkUnitsBulk(project.uuid, units);
    w.log("work units created; approving…");

    const t0 = Date.now();
    await w.transition(project.uuid, "PENDING");
    await w.transition(project.uuid, "APPROVED");
    w.log(`APPROVED after ${Math.round((Date.now() - t0) / 1000)}s; waiting for delivery…`);

    const { delivered, wus, all } = await waitDelivered(project.uuid, DELIVERY_TIMEOUT_MS);
    w.log(`delivered ${delivered.size}/${wus.length} work units (all=${all})`);
    w.log(`work-unit filenames as wxrks reports them: ${JSON.stringify(wus.map((u) => u.filename))}`);

    let pdfDeliverable = "none";
    let scannedMode = "undelivered";
    for (const wu of wus) {
      if (wu.workStatus !== "DELIVERED") continue;
      try {
        const entries = await w.downloadZip(project.uuid, {
          resources: [wu.projectResourceUuid?.uuid || wu.projectResourceUuid || resourceByName[wu.filename] || Object.values(resourceByName)].flat(),
          locales: [TARGET],
        });
        for (const e of entries) {
          w.log(`  zip entry: ${e.entryName} (${e.buffer.length} bytes)`);
          const ext = path.extname(e.entryName).toLowerCase();
          const isScanned = e.entryName.includes("scan");
          if (isScanned) scannedMode = `delivered-as-${ext}-${e.buffer.length}b`;
          else pdfDeliverable = ext.replace(".", "") || "noext";
        }
      } catch (err) {
        w.log(`  download failed for ${wu.filename}: ${w.errInfo(err)}`);
      }
    }

    console.log(
      `VERDICT: pdfDeliverable=${pdfDeliverable} scannedMode=${scannedMode} truncatedTo=${truncatedTo}chars approveSec=${Math.round(
        (Date.now() - t0) / 1000
      )} deliveredCount=${delivered.size}/${wus.length} timings=${JSON.stringify([...delivered.entries()])}`
    );
  } finally {
    await w.cancelProject(project.uuid);
  }
})().catch((e) => {
  console.error("SPIKE 2 FAILED:", w.errInfo(e));
  process.exit(1);
});
