/**
 * Single-tenant wxrks (Bureau Works) API client. Credentials come from env
 * only; the session token arrives in the X-AUTH-TOKEN *response header* of
 * POST /auth and must be echoed back as an X-AUTH-TOKEN request header on
 * every call. An expired token surfaces as 403 (Spring Security), not 401,
 * so the request wrapper re-authenticates once and retries on either.
 *
 * Deliberate divergence from the older Webflow-connector client this is
 * modeled on: status transitions here NEVER pass calculateCosts — that
 * starts an async costing job that 423-locks the project for tens of
 * seconds, and this app meters its own credits instead.
 */
const axios = require("axios");
const FormData = require("form-data");
const AdmZip = require("adm-zip");

const BASE = process.env.WXRKS_API_URL || "https://app.wxrks.com/api/v3";
const TOKEN_TTL_MS = 50 * 60 * 1000; // wxrks documents no TTL; 50 min proven in production
// Every call has a deadline: the poller runs one tick at a time, so a single request that never
// answers would silently stop delivery for every job (seen locally, 2026-11-03).
const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

let session = null; // { token, obtainedAt }

class RetryLaterError extends Error {
  constructor(message) {
    super(message);
    this.name = "RetryLaterError";
    this.retryLater = true;
  }
}

async function authenticate() {
  const accessKey = process.env.WXRKS_ACCESS_KEY;
  const secret = process.env.WXRKS_SECRET;
  if (!accessKey || !secret) throw new Error("WXRKS_ACCESS_KEY and WXRKS_SECRET must be configured");
  const res = await axios.post(`${BASE}/auth`, { accessKey, secret }, { timeout: REQUEST_TIMEOUT_MS });
  const token = res.headers["x-auth-token"];
  if (!token) throw new Error("wxrks /auth response had no X-AUTH-TOKEN header");
  session = { token, obtainedAt: Date.now() };
  return token;
}

async function getToken() {
  if (session && Date.now() - session.obtainedAt < TOKEN_TTL_MS) return session.token;
  return authenticate();
}

async function request(opts, { retried = false } = {}) {
  const token = await getToken();
  try {
    const timeout = opts.timeout || REQUEST_TIMEOUT_MS;
    return await axios({
      ...opts,
      url: opts.url.startsWith("http") ? opts.url : `${BASE}${opts.url}`,
      headers: { "X-AUTH-TOKEN": token, ...(opts.headers || {}) },
      timeout,
      signal: AbortSignal.timeout(timeout + 5000), // timeout alone is per-socket-idle in Node
    });
  } catch (err) {
    const status = err.response?.status;
    if (!retried && (status === 401 || status === 403)) {
      await authenticate();
      return request(opts, { retried: true });
    }
    throw err;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function errInfo(err) {
  return err.response ? `HTTP ${err.response.status} ${JSON.stringify(err.response.data)}` : err.message;
}

// 423 Locked (async job holds the project) and 422 BWX-002 ("can't change
// status during some running process", e.g. racing the org unit's autopilot)
// are transient — wait and retry, don't fail the job.
function isRetryableStatusConflict(err) {
  const status = err.response?.status;
  if (status === 423) return true;
  return status === 422 && JSON.stringify(err.response?.data || {}).includes("BWX-002");
}

// --- projects ---

async function createProject({ reference, sourceLocale, orgUnitUUID, tags }) {
  const res = await request({
    method: "POST",
    url: "/project?inferDefaultSettings=true",
    data: { reference, orgUnitUUID, sourceLocale, ...(tags ? { tags } : {}) },
  });
  return res.data;
}

async function getProject(uuid) {
  return (await request({ method: "GET", url: `/project/${uuid}` })).data;
}

async function updateProjectStatus(uuid, newStatus, reason) {
  return (
    await request({
      method: "POST",
      url: `/project/${uuid}/status`,
      data: { newStatus, ...(reason ? { reason } : {}) },
    })
  ).data;
}

// Status changes are eventually consistent: a 200 on the POST does not mean a
// re-fetch shows the new status yet. Poll the real project until it does.
async function waitForStatus(uuid, to, { timeoutMs = 90000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = (await getProject(uuid)).status;
    if (last === to) return last;
    await sleep(intervalMs);
  }
  throw new Error(`wxrks project ${uuid} never reached ${to} (last seen: ${last})`);
}

async function transition(uuid, to, opts = {}) {
  const deadline = Date.now() + (opts.timeoutMs || 90000);
  for (;;) {
    try {
      await updateProjectStatus(uuid, to);
      break;
    } catch (err) {
      const current = (await getProject(uuid)).status;
      if (current === to) return to; // autopilot or a previous attempt got there first
      if (isRetryableStatusConflict(err) && Date.now() < deadline) {
        await sleep(3000);
        continue;
      }
      throw err;
    }
  }
  return waitForStatus(uuid, to, opts);
}

// DRAFT → PENDING → APPROVED. APPROVED is what starts real translation work.
async function approveProject(uuid) {
  const current = (await getProject(uuid)).status;
  if (current === "DRAFT") await transition(uuid, "PENDING");
  if (current !== "APPROVED") await transition(uuid, "APPROVED");
  return "APPROVED";
}

async function cancelProject(uuid, reason = "cancelled by DocTranslate") {
  // A plain POST is not enough: wxrks's own async jobs (auto-costing, org
  // automation) can advance the status right past an accepted CANCELLED
  // (observed live: cancel returned 200, project ended up PENDING). Drive
  // the transition until the project actually reads CANCELLED.
  try {
    const deadline = Date.now() + 90000;
    for (;;) {
      const current = (await getProject(uuid)).status;
      if (current === "CANCELLED" || current === "DELETED") return true;
      try {
        await updateProjectStatus(uuid, "CANCELLED", reason);
      } catch (err) {
        if (!isRetryableStatusConflict(err)) throw err;
      }
      await sleep(3000);
      if (Date.now() > deadline) {
        console.warn(`[wxrks] cancel ${uuid}: still ${(await getProject(uuid)).status} at deadline`);
        return false;
      }
    }
  } catch (err) {
    // Terminal states reject further transitions — cancellation is best-effort.
    console.warn(`[wxrks] cancel ${uuid} failed: ${errInfo(err)}`);
    return false;
  }
}

// --- resources ---

// `name` must carry a real file extension — it selects wxrks's parser.
async function createResource(projectUuid, name) {
  return (
    await request({
      method: "POST",
      url: `/project/${projectUuid}/resource`,
      data: { name, path: name, notes: "" },
    })
  ).data;
}

async function uploadResourceContent(projectUuid, resourceUuid, filename, buffer) {
  const form = new FormData();
  form.append("file", buffer, { filename });
  return (
    await request({
      method: "PUT",
      url: `/project/${projectUuid}/resource/${resourceUuid}/content`,
      data: form,
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
    })
  ).data;
}

async function listResources(projectUuid) {
  return (await request({ method: "GET", url: `/project/${projectUuid}/resource/simple` })).data;
}

// wxrks converts an uploaded PDF to DOCX itself (the dashboard's conversion,
// on the public API since BW-8262, 2026-10-07): a few seconds after upload the
// same resource is renamed in place to "<name>.pdf.docx" (verified live,
// spike 6). Returns the converted name, or null if no rename by the deadline.
async function waitForPdfConversion(projectUuid, resourceUuid, { timeoutMs = 3 * 60 * 1000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const resource = (await listResources(projectUuid)).find((r) => r.uuid === resourceUuid);
    if (resource && /\.docx$/i.test(resource.name)) return resource.name;
    if (Date.now() > deadline) return null;
    await sleep(intervalMs);
  }
}

// --- work units ---

// Body is a plain JSON array; the response is one work unit per
// (resource × targetLocale × workflow).
async function createWorkUnitsBulk(projectUuid, units) {
  return (await request({ method: "POST", url: `/project/${projectUuid}/work-unit?bulk=true`, data: units })).data;
}

async function listWorkUnits(projectUuid, params = {}) {
  const qs = new URLSearchParams({ size: "100", ...params }).toString();
  return (await request({ method: "GET", url: `/project/${projectUuid}/work-unit?${qs}` })).data;
}

// --- pre-analysis (word counts) ---
// Requires work units to exist first (verified live: pre-WU analysis
// "completes" with an EMPTY summary). Summary = one row per target language,
// each carrying the full source word count for that pair.

async function createPreAnalysis(projectUuid) {
  return (await request({ method: "POST", url: `/project/${projectUuid}/logfile?pre-analysis=true` })).data;
}

async function listLogfiles(projectUuid) {
  return (await request({ method: "GET", url: `/project/${projectUuid}/logfile?page=0&pageSize=50` })).data;
}

async function getLogfileSummary(projectUuid, logfileId) {
  return (await request({ method: "GET", url: `/project/${projectUuid}/logfile/${logfileId}/summary` })).data;
}

async function runPreAnalysis(projectUuid, { timeoutMs = 5 * 60 * 1000, intervalMs = 3000 } = {}) {
  const created = await createPreAnalysis(projectUuid);
  const id = created.id ?? created.uuid;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = await listLogfiles(projectUuid);
    const items = Array.isArray(page) ? page : page.content || [];
    const mine = items.find((l) => (l.id ?? l.uuid) === id);
    const st = (mine?.status || "").toUpperCase();
    if (st.includes("COMPLETED")) return getLogfileSummary(projectUuid, id);
    if (st.includes("ERROR") || st.includes("FAIL")) {
      throw new Error(`wxrks pre-analysis failed: ${mine.failureReason || mine.status}`);
    }
    await sleep(intervalMs);
  }
  throw new Error(`wxrks pre-analysis timed out after ${timeoutMs}ms`);
}

// --- downloads ---

// The project download endpoint ALWAYS returns a ZIP (even for one file +
// one locale), entries at {locale}/{resourceFileName}. A too-early request
// (locale not finished) fails 422 BWX-002 → RetryLaterError.
function unzipEntries(buffer) {
  const zip = new AdmZip(Buffer.from(buffer));
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory)
    .map((e) => ({ entryName: e.entryName, buffer: e.getData() }));
}

async function startDownload(projectUuid, { resources, locales }) {
  const qs = new URLSearchParams({ resources: resources.join(","), locales: locales.join(",") });
  return (await request({ method: "POST", url: `/project/${projectUuid}/download?${qs}` })).data;
}

async function getDownloadStatus(projectUuid, requestUuid) {
  return (await request({ method: "GET", url: `/project/${projectUuid}/download/${requestUuid}/status` })).data;
}

async function downloadZipSync(projectUuid, { resources, locales }) {
  try {
    const res = await request({
      method: "GET",
      url: `/project/${projectUuid}/download?${new URLSearchParams({
        resources: resources.join(","),
        locales: locales.join(","),
      })}`,
      responseType: "arraybuffer",
      timeout: DOWNLOAD_TIMEOUT_MS,
    });
    return unzipEntries(res.data);
  } catch (err) {
    if (isRetryableStatusConflict(err)) throw new RetryLaterError(errInfo(err));
    throw err;
  }
}

// --- misc ---

async function listLanguages() {
  return (await request({ method: "GET", url: "/language" })).data;
}

module.exports = {
  BASE,
  RetryLaterError,
  authenticate,
  request,
  errInfo,
  isRetryableStatusConflict,
  createProject,
  getProject,
  updateProjectStatus,
  waitForStatus,
  transition,
  approveProject,
  cancelProject,
  createResource,
  uploadResourceContent,
  listResources,
  waitForPdfConversion,
  createWorkUnitsBulk,
  listWorkUnits,
  createPreAnalysis,
  listLogfiles,
  getLogfileSummary,
  runPreAnalysis,
  startDownload,
  getDownloadStatus,
  downloadZipSync,
  unzipEntries,
  listLanguages,
};
