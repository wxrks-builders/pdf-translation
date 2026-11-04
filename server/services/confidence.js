/**
 * The Confidence Score of a delivered translation. Smells, the wxrks check for meaning problems,
 * reads every translated segment and scores it by the most serious problem it finds (the
 * account's weights: Blocker 0, Critical 30, Major 50, Minor 80, nothing 100). A file's score is
 * the plain average of its segments.
 *
 * Run once per job, right after delivery, through the wxrks routes the editor uses (genesis API,
 * same access-key token):
 *   POST /qa/work-unit (Smells only) → GET /qa/status/{run} until FINISHED
 *   POST /qa/summary (the file's score) and /qa/segment/results?category=SMELL (what it found)
 *   POST /work-unit/context + /translation/segment for the text of the worst sentences
 * Scores change from one run to the next, so they are stored (jobs.confidence) and never
 * recomputed when someone looks. Soft: a failure leaves the job delivered without a score.
 * The files email waits for the score (services/leads.js). Off with CONFIDENCE_SCORE=off.
 */
const store = require("../store");
const wxrks = require("./wxrks");
const locales = require("./locales");

const GENESIS = process.env.WXRKS_GENESIS_URL || `${new URL(wxrks.BASE).origin}/genesis/api/v1`;
const RUN_TIMEOUT_MS = 5 * 60 * 1000;
const STALE_MS = 15 * 60 * 1000; // a run the server lost (a restart) gives up after this
const TOP = 5;
const ORDER = { BLOCKER: 0, CRITICAL: 1, MAJOR: 2, MINOR: 3, INFO: 4 };

const isEnabled = () => process.env.CONFIDENCE_SCORE !== "off";
const call = (method, path, data, params) => wxrks.request({ method, url: `${GENESIS}${path}`, data, params });
const scope = (wu) => ({ workUnitIds: [wu], taskIds: [] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n = 300) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || null);
// Segment text carries the editor's inline tags (private-use characters, "{1>", "<1}"): drop them.
const plain = (s) =>
  s == null ? s : String(s).replace(/[-]/g, "").replace(/\{\d+>|<\d+\}|\{\d+\}/g, "").replace(/\s+/g, " ").trim();
const label = (s) => {
  const t = String(s.category || s.typeKey || "").replace(/[_-]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
};
// A smell about tags or placeholders quotes the editor's tag syntax ("{1>27 <1}"), which means
// nothing outside the editor: say it in words.
const TAGGED = /placeholder|tag/i;
const noteOf = (s) => (TAGGED.test(`${s.typeKey} ${s.category}`) ? "The formatting here (bold, links, spacing) differs from the original." : clip(s.message));

async function smells(wu) {
  const runId = String(
    // Notes in the source language: the person reading them wrote the original.
    (await call("POST", "/qa/work-unit", {
      ...scope(wu),
      params: { runQaChecks: { value: false }, runQaSmells: { value: true }, smellsLanguage: { value: "SOURCE" } },
    })).data
  );
  const started = Date.now();
  for (;;) {
    await sleep(2000);
    let s = (await call("GET", `/qa/status/${encodeURIComponent(runId)}`)).data;
    if (typeof s === "string") s = { status: s };
    if (s?.status === "FINISHED") return;
    if (s?.status === "FAILED") throw new Error(`Smells run ${runId} failed`);
    if (Date.now() - started > RUN_TIMEOUT_MS) throw new Error(`Smells run ${runId} timed out`);
  }
}

async function results(wu) {
  const rows = [];
  for (let page = 0; page < 50; page++) {
    const { data } = await call("POST", "/qa/segment/results", scope(wu), { page, pageSize: 100, category: "SMELL" });
    rows.push(...(data?.content || []));
    if (data?.last !== false) break;
  }
  return rows;
}

// Source and target text of a few segments of one work unit (needs an editor session).
async function texts(wu, ids) {
  const { sessionId } = (await call("POST", "/work-unit/context", scope(wu))).data || {};
  if (!sessionId || !ids.length) return new Map();
  const { data } = await call("POST", "/translation/segment", {
    workUnitIds: [wu],
    sessionId,
    beginIndex: 0,
    pageSize: ids.length,
    viewPortSegments: ids,
    thin: false,
  });
  return new Map((data?.content || []).map((r) => [r.id, { source: plain(r.sourceText), target: plain(r.targetText) }]));
}

// One delivered work unit → { score (0–1), sentences, rows: [{ wu, id, score, worst }] }
async function scoreWorkUnit(wu) {
  await smells(wu);
  const [{ data: summary }, rows] = await Promise.all([call("POST", "/qa/summary", scope(wu)), results(wu)]);
  const flagged = [];
  for (const row of rows) {
    const open = (row.smells || []).filter((s) => !s.ignored && (ORDER[s.severity] ?? 9) < ORDER.INFO);
    if (!open.length || row.confidenceScore >= 1) continue;
    const worst = open.sort((a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9))[0];
    flagged.push({ wu, id: row.id, score: row.confidenceScore, worst });
  }
  return { score: summary?.workUnitConfidenceScore == null ? null : summary.workUnitConfidenceScore / 100, sentences: summary?.scoredSegments || 0, flagged };
}

async function run(jobId) {
  const job = await store.getJob(jobId);
  const units = ((await wxrks.listWorkUnits(job.wxrks_project_uuid)).content || []).filter((w) => w.workStatus === "DELIVERED");
  const byLocale = {};
  for (const w of units) {
    const loc = locales.normalize(w.targetLanguage);
    const r = await scoreWorkUnit(w.uuid);
    if (r.score == null || !r.sentences) continue;
    const acc = (byLocale[loc] ||= { sum: 0, sentences: 0, flagged: [] });
    acc.sum += r.score * r.sentences;
    acc.sentences += r.sentences;
    acc.flagged.push(...r.flagged);
  }
  const out = {};
  for (const [loc, acc] of Object.entries(byLocale)) {
    acc.flagged.sort((a, b) => a.score - b.score || (ORDER[a.worst.severity] ?? 9) - (ORDER[b.worst.severity] ?? 9));
    const top = acc.flagged.slice(0, TOP);
    const text = new Map();
    for (const wu of new Set(top.map((f) => f.wu))) {
      for (const [id, t] of await texts(wu, top.filter((f) => f.wu === wu).map((f) => f.id)).catch(() => new Map())) text.set(id, t);
    }
    const counts = {};
    for (const f of acc.flagged) counts[f.worst.severity] = (counts[f.worst.severity] || 0) + 1;
    out[loc] = {
      score: Math.round((acc.sum / acc.sentences) * 1000) / 1000,
      sentences: acc.sentences,
      flagged: acc.flagged.length,
      counts,
      top: top.map((f) => ({
        severity: f.worst.severity,
        type: label(f.worst),
        note: noteOf(f.worst),
        source: clip(text.get(f.id)?.source),
        target: clip(text.get(f.id)?.target),
      })),
    };
  }
  if (!Object.keys(out).length) throw new Error("no segment was scored");
  await store.updateJob(jobId, { confidence_status: "done", confidence: JSON.stringify({ byLocale: out, at: new Date().toISOString() }) });
  await store.appendJobEvent(jobId, "confidence_scored", Object.fromEntries(Object.entries(out).map(([l, e]) => [l, { score: e.score, flagged: e.flagged }])));
}

// Called once the job is delivered. True when scoring started: the files email then goes out
// when it ends (done or failed), with the score in it.
async function start(job, onSettled) {
  if (!isEnabled() || job.excerpt_of || job.confidence_status || !job.wxrks_project_uuid) return false;
  await store.updateJob(job.id, { confidence_status: "pending" });
  run(job.id)
    .catch(async (err) => {
      console.warn(`[confidence] job ${job.id}: ${err.response ? wxrks.errInfo(err) : err.message}`);
      await store.updateJob(job.id, { confidence_status: "failed" });
      await store.appendJobEvent(job.id, "confidence_failed", { reason: String(err.message).slice(0, 160) });
    })
    .then(async () => onSettled?.(await store.getJob(job.id)))
    .catch((err) => console.error(`[confidence] job ${job.id} after scoring: ${err.message}`));
  return true;
}

// A score still pending long after delivery was lost (the server restarted mid-run): give up on
// it, so the files email isn't held forever.
async function sweep(onSettled) {
  for (const job of await store.listJobsWithConfidence("pending")) {
    if (Date.now() - new Date(job.updated_at).getTime() < STALE_MS) continue;
    await store.updateJob(job.id, { confidence_status: "failed" });
    await store.appendJobEvent(job.id, "confidence_failed", { reason: "lost" });
    await onSettled?.(await store.getJob(job.id));
  }
}

module.exports = { isEnabled, start, sweep, run };
