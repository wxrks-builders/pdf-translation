/**
 * PDF → DOCX conversion via headless LibreOffice, replicating what the wxrks
 * dashboard does at upload time (its Adobe-backed step isn't exposed through
 * the public API — a raw PDF uploaded via API gets parsed as plain text and
 * loses all layout). The Docker image bundles libreoffice-writer; local dev
 * without it degrades gracefully (pipeline falls back to raw-PDF upload).
 */
const { execFile } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const CANDIDATES = [
  "soffice",
  "/usr/bin/soffice",
  "/usr/local/bin/soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
];

let sofficePath; // undefined = not probed yet, null = unavailable

async function findSoffice() {
  if (sofficePath !== undefined) return sofficePath;
  for (const candidate of CANDIDATES) {
    try {
      await new Promise((resolve, reject) => {
        execFile(candidate, ["--version"], { timeout: 15000 }, (err) => (err ? reject(err) : resolve()));
      });
      sofficePath = candidate;
      return sofficePath;
    } catch {
      // try next
    }
  }
  sofficePath = null;
  return null;
}

async function isAvailable() {
  return (await findSoffice()) !== null;
}

// soffice is memory-hungry and flaky under parallel invocations even with
// separate profiles — serialize all conversions through one queue.
let queue = Promise.resolve();

function pdfToDocx(buffer, baseName = "document") {
  const run = queue.then(() => convertOnce(buffer, baseName));
  // keep the chain alive even when a conversion fails
  queue = run.catch(() => {});
  return run;
}

async function convertOnce(buffer, baseName) {
  const soffice = await findSoffice();
  if (!soffice) throw new Error("LibreOffice (soffice) is not available");

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "doctranslate-conv-"));
  try {
    const safeBase = baseName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/\.pdf$/i, "") || "document";
    const inPath = path.join(tmp, `${safeBase}.pdf`);
    await fs.writeFile(inPath, buffer);

    await new Promise((resolve, reject) => {
      execFile(
        soffice,
        [
          // per-run profile so concurrent/leftover profile locks can't break us
          `-env:UserInstallation=file://${path.join(tmp, "profile")}`,
          "--headless",
          "--infilter=writer_pdf_import",
          "--convert-to",
          "docx",
          "--outdir",
          tmp,
          inPath,
        ],
        { timeout: 2 * 60 * 1000 },
        (err, stdout, stderr) => (err ? reject(new Error(`soffice failed: ${err.message} ${stderr || ""}`)) : resolve())
      );
    });

    const outPath = path.join(tmp, `${safeBase}.docx`);
    const out = await fs.readFile(outPath).catch(() => null);
    if (!out || out.length === 0) throw new Error("soffice produced no DOCX output");
    return out;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { isAvailable, pdfToDocx };
