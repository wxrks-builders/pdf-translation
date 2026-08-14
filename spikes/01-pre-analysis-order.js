// Spike 1 — does POST /project/:uuid/logfile?pre-analysis=true work on a DRAFT
// project BEFORE any work units exist? How long does it take on a real PDF?
// What shape does the summary have (per-language rows vs single source row)?
//
// VERDICT (run 2026-08-13): preAnalysisOnDraft=no-needs-work-units runtimeSec=4 summaryShape=1rows:pt_br
//   Pre-WU analysis "COMPLETES" in ~4s but the summary is EMPTY — work units must exist first.
//   With WUs: summary = one row per TARGET language, totalWords = full source word count for that pair
//   (109 words for small.pdf+tiny.txt). → pipeline order: upload → WUs → analyze → gate → approve/cancel;
//   charge = sum of per-target totalWords. ANALYZE_BEFORE_WORK_UNITS=false.
const w = require("./lib/wxrksMin.js");
const fs = require("fs");
const path = require("path");

const FIXTURES = path.join(__dirname, "fixtures");

async function pollPreAnalysis(projectUuid, timeoutMs, targetId) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  while (Date.now() < deadline) {
    const page = await w.listLogfiles(projectUuid);
    const items = Array.isArray(page) ? page : page.content || [];
    const pre = items.filter(
      (l) => (l.type || "").includes("PRE") && (!targetId || (l.id ?? l.uuid) === targetId)
    );
    if (pre.length) {
      const lf = pre[0];
      w.log(`  logfile ${lf.id ?? lf.uuid} type=${lf.type} status=${lf.status}`);
      const st = (lf.status || "").toUpperCase();
      if (["DONE", "FINISHED", "COMPLETED", "SUCCESS", "OK"].some((s) => st.includes(s))) {
        return { logfile: lf, seconds: Math.round((Date.now() - started) / 1000) };
      }
      if (st.includes("ERROR") || st.includes("FAIL")) {
        return { logfile: lf, error: true, seconds: Math.round((Date.now() - started) / 1000) };
      }
    }
    await w.sleep(4000);
  }
  return { timeout: true, seconds: Math.round((Date.now() - started) / 1000) };
}

(async () => {
  const stamp = Date.now().toString(36);
  const project = await w.createProject({
    reference: `spike1-${stamp}`,
    sourceLocale: "en",
    tags: ["spike"],
  });
  w.log(`project ${project.uuid} (${project.reference}) status=${project.status}`);

  try {
    for (const f of ["small.pdf", "tiny.txt"]) {
      const res = await w.createResource(project.uuid, `s1${stamp}-${f}`);
      await w.uploadResourceContent(project.uuid, res.uuid, `s1${stamp}-${f}`, fs.readFileSync(path.join(FIXTURES, f)));
      w.log(`uploaded ${f} as resource ${res.uuid}`);
    }

    // --- Attempt A: pre-analysis on DRAFT, zero work units ---
    let preAnalysisOnDraft = "no";
    let runtimeSec = null;
    let summaryShape = "n/a";
    w.log("Attempt A: pre-analysis with NO work units, project DRAFT…");
    try {
      const created = await w.createPreAnalysis(project.uuid);
      w.log(`  created logfile: ${JSON.stringify(created).slice(0, 300)}`);
      const result = await pollPreAnalysis(project.uuid, 5 * 60 * 1000, created.id ?? created.uuid);
      if (result.logfile && !result.error) {
        const summary = await w.logfileSummary(project.uuid, result.logfile.id ?? result.logfile.uuid);
        w.log(`  summary: ${JSON.stringify(summary)}`);
        if (Array.isArray(summary) && summary.length === 0) {
          w.log("  pre-WU analysis COMPLETED but summary is EMPTY → needs work units for real numbers");
        } else {
          preAnalysisOnDraft = "yes";
          runtimeSec = result.seconds;
          summaryShape = Array.isArray(summary) ? `${summary.length}rows:${summary.map((r) => r.language).join(",")}` : typeof summary;
        }
      } else {
        w.log(`  Attempt A did not complete: ${JSON.stringify(result)}`);
      }
    } catch (err) {
      w.log(`  Attempt A failed: ${w.errInfo(err)}`);
    }

    // --- Attempt B (only if A failed): create work units first, then analyze ---
    if (preAnalysisOnDraft === "no") {
      w.log("Attempt B: creating work units (TRANSLATION → pt_br), then pre-analysis…");
      const resources = await w.listResources(project.uuid);
      const units = resources.map((r) => ({
        projectResourceUuid: r.uuid,
        workflows: ["TRANSLATION"],
        targetLocales: ["pt_br"],
      }));
      const wus = await w.createWorkUnitsBulk(project.uuid, units);
      w.log(`  created ${Array.isArray(wus) ? wus.length : "?"} work units`);
      const created = await w.createPreAnalysis(project.uuid);
      w.log(`  created logfile: ${JSON.stringify(created).slice(0, 300)}`);
      const result = await pollPreAnalysis(project.uuid, 5 * 60 * 1000, created.id ?? created.uuid);
      if (result.logfile && !result.error) {
        preAnalysisOnDraft = "no-needs-work-units";
        runtimeSec = result.seconds;
        const summary = await w.logfileSummary(project.uuid, result.logfile.id ?? result.logfile.uuid);
        w.log(`  summary: ${JSON.stringify(summary)}`);
        summaryShape = Array.isArray(summary) ? `${summary.length}rows:${summary.map((r) => r.language).join(",")}` : typeof summary;
      } else {
        w.log(`  Attempt B did not complete either: ${JSON.stringify(result)}`);
        preAnalysisOnDraft = "broken";
      }
    }

    console.log(`VERDICT: preAnalysisOnDraft=${preAnalysisOnDraft} runtimeSec=${runtimeSec} summaryShape=${summaryShape}`);
  } finally {
    await w.cancelProject(project.uuid);
  }
})().catch((e) => {
  console.error("SPIKE 1 FAILED:", w.errInfo(e));
  process.exit(1);
});
