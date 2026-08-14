// Minimal standalone wxrks client for the phase-0 spikes.
// Auth: POST /auth {accessKey, secret} → token in the X-AUTH-TOKEN *response header*.
// All calls send X-AUTH-TOKEN; 401/403 → re-auth once and retry.
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const axios = require("axios");
const FormData = require("form-data");
const AdmZip = require("adm-zip");

const BASE = process.env.WXRKS_API_URL || "https://app.wxrks.com/api/v3";
const ACCESS_KEY = process.env.WXRKS_ACCESS_KEY;
const SECRET = process.env.WXRKS_SECRET;
const ORG_UNIT = process.env.WXRKS_PAID_ORG_UNIT_UUID;

if (!ACCESS_KEY || !SECRET) {
  console.error("Missing WXRKS_ACCESS_KEY / WXRKS_SECRET in .env");
  process.exit(1);
}

let token = null;

async function authenticate() {
  const res = await axios.post(`${BASE}/auth`, { accessKey: ACCESS_KEY, secret: SECRET });
  token = res.headers["x-auth-token"];
  if (!token) throw new Error("No X-AUTH-TOKEN header in /auth response");
  return token;
}

async function request(opts, { retried = false } = {}) {
  if (!token) await authenticate();
  try {
    return await axios({
      ...opts,
      url: opts.url.startsWith("http") ? opts.url : `${BASE}${opts.url}`,
      headers: { "X-AUTH-TOKEN": token, ...(opts.headers || {}) },
      validateStatus: (s) => s < 400,
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

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...args) => console.log(`[${ts()}]`, ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function errInfo(err) {
  return err.response
    ? `HTTP ${err.response.status} ${JSON.stringify(err.response.data)}`
    : err.message;
}

function isRetryableConflict(err) {
  const status = err.response?.status;
  if (status === 423) return true;
  return status === 422 && JSON.stringify(err.response?.data || {}).includes("BWX-002");
}

// --- API calls ---

const createProject = async ({ reference, sourceLocale, orgUnitUUID = ORG_UNIT, tags }) =>
  (
    await request({
      method: "POST",
      url: "/project?inferDefaultSettings=true",
      data: { reference, orgUnitUUID, sourceLocale, ...(tags ? { tags } : {}) },
    })
  ).data;

const getProject = async (uuid) => (await request({ method: "GET", url: `/project/${uuid}` })).data;

const createResource = async (projectUuid, name) =>
  (
    await request({
      method: "POST",
      url: `/project/${projectUuid}/resource`,
      data: { name, path: name, notes: "" },
    })
  ).data;

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

const listResources = async (projectUuid) =>
  (await request({ method: "GET", url: `/project/${projectUuid}/resource/simple` })).data;

const createWorkUnitsBulk = async (projectUuid, units) =>
  (await request({ method: "POST", url: `/project/${projectUuid}/work-unit?bulk=true`, data: units })).data;

const listWorkUnits = async (projectUuid, params = {}) => {
  const qs = new URLSearchParams({ size: "100", ...params }).toString();
  return (await request({ method: "GET", url: `/project/${projectUuid}/work-unit?${qs}` })).data;
};

const updateStatus = async (projectUuid, newStatus, reason) =>
  (
    await request({
      method: "POST",
      url: `/project/${projectUuid}/status`,
      data: { newStatus, ...(reason ? { reason } : {}) },
    })
  ).data;

// Poll actual project state until it reaches `to` (transitions are eventually consistent).
async function waitForStatus(projectUuid, to, { timeoutMs = 90000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = (await getProject(projectUuid)).status;
    if (last === to) return last;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${projectUuid} to reach ${to} (last: ${last})`);
}

// Drive a status transition, tolerating 423 / 422 BWX-002 (autopilot or async job racing us).
async function transition(projectUuid, to, opts = {}) {
  const deadline = Date.now() + (opts.timeoutMs || 90000);
  for (;;) {
    try {
      await updateStatus(projectUuid, to);
      break;
    } catch (err) {
      const current = (await getProject(projectUuid)).status;
      if (current === to) return to; // someone else (autopilot) got there
      if (isRetryableConflict(err) && Date.now() < deadline) {
        log(`  transition to ${to}: retryable conflict (${errInfo(err)}), waiting…`);
        await sleep(3000);
        continue;
      }
      throw err;
    }
  }
  return waitForStatus(projectUuid, to, opts);
}

const createPreAnalysis = async (projectUuid) =>
  (await request({ method: "POST", url: `/project/${projectUuid}/logfile?pre-analysis=true` })).data;

const listLogfiles = async (projectUuid) =>
  (await request({ method: "GET", url: `/project/${projectUuid}/logfile?page=0&pageSize=50` })).data;

const logfileSummary = async (projectUuid, logfileId) =>
  (await request({ method: "GET", url: `/project/${projectUuid}/logfile/${logfileId}/summary` })).data;

const getClientWorkflows = async (orgUnitUuid) =>
  await request({ method: "GET", url: `/client/${orgUnitUuid}/workflows` }); // returns full response (status quirk: 201)

const listLanguages = async () => (await request({ method: "GET", url: "/language" })).data;

async function downloadZip(projectUuid, { resources, locales }) {
  const qs = new URLSearchParams({ resources: resources.join(","), locales: locales.join(",") });
  const res = await request({
    method: "GET",
    url: `/project/${projectUuid}/download?${qs}`,
    responseType: "arraybuffer",
  });
  const zip = new AdmZip(Buffer.from(res.data));
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory)
    .map((e) => ({ entryName: e.entryName, buffer: e.getData() }));
}

const startDownload = async (projectUuid, { resources, locales }) => {
  const qs = new URLSearchParams({ resources: resources.join(","), locales: locales.join(",") });
  return (await request({ method: "POST", url: `/project/${projectUuid}/download?${qs}` })).data;
};

const getDownloadStatus = async (projectUuid, requestUuid) =>
  (await request({ method: "GET", url: `/project/${projectUuid}/download/${requestUuid}/status` })).data;

async function cancelProject(projectUuid) {
  try {
    await updateStatus(projectUuid, "CANCELLED", "spike cleanup");
    log(`  cancelled project ${projectUuid}`);
  } catch (err) {
    log(`  cancel ${projectUuid} failed (may already be terminal): ${errInfo(err)}`);
  }
}

module.exports = {
  BASE,
  ORG_UNIT,
  authenticate,
  request,
  log,
  sleep,
  errInfo,
  isRetryableConflict,
  createProject,
  getProject,
  createResource,
  uploadResourceContent,
  listResources,
  createWorkUnitsBulk,
  listWorkUnits,
  updateStatus,
  waitForStatus,
  transition,
  createPreAnalysis,
  listLogfiles,
  logfileSummary,
  getClientWorkflows,
  listLanguages,
  downloadZip,
  startDownload,
  getDownloadStatus,
  cancelProject,
};
