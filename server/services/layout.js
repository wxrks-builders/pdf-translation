/**
 * Design-kept PDFs (beta): wraps server/layout/pdf_layout.py (PyMuPDF). extract() turns a PDF
 * into translatable segments plus the layout needed to put them back; rebuild() draws a
 * translation into the original pages. The pipeline sends the segments through a second,
 * unmetered wxrks project; the poller rebuilds when it delivers. Every failure here is soft —
 * the DOCX deliverable never depends on it.
 */
const { execFile } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const PYTHON = process.env.LAYOUT_PYTHON || "python3";
const SCRIPT = path.join(__dirname, "..", "layout", "pdf_layout.py");
const TIMEOUT_MS = 5 * 60 * 1000;

let available = null;

class LayoutError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // 3 = script not covered by the bundled fonts, 4 = too many pages
    this.soft = code === 3 || code === 4;
  }
}

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(PYTHON, [SCRIPT, ...args], { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new LayoutError((stderr || err.message).trim().slice(0, 300), err.code));
      resolve(stdout);
    });
  });
}

async function isAvailable() {
  if (available === null) {
    available = await new Promise((resolve) =>
      execFile(PYTHON, ["-c", "import pymupdf"], { timeout: 20000 }, (err) => resolve(!err))
    );
    if (!available) console.warn(`[layout] ${PYTHON} has no PyMuPDF — design-kept PDFs are off`);
  }
  return available;
}

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "layout-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// → { units (object, kept for rebuild), segments ({id: text}, sent to wxrks), words }
async function extract(pdfBuffer) {
  return withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "in.pdf"), pdfBuffer);
    const summary = JSON.parse(await run(["extract", path.join(dir, "in.pdf"), dir]));
    return {
      units: JSON.parse(await fs.readFile(path.join(dir, "units.json"), "utf8")),
      segments: JSON.parse(await fs.readFile(path.join(dir, "segments.json"), "utf8")),
      words: summary.words,
    };
  });
}

// → { design (Buffer, live text), images (Buffer, one picture per page) }
async function rebuild(pdfBuffer, units, translated) {
  return withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "in.pdf"), pdfBuffer);
    await fs.writeFile(path.join(dir, "units.json"), JSON.stringify(units));
    await fs.writeFile(path.join(dir, "translated.json"), JSON.stringify(translated));
    await run(["rebuild", path.join(dir, "in.pdf"), path.join(dir, "units.json"), path.join(dir, "translated.json"), dir]);
    return {
      design: await fs.readFile(path.join(dir, "design.pdf")),
      images: await fs.readFile(path.join(dir, "images.pdf")),
    };
  });
}

// → page 1 of a PDF as a JPEG Buffer
async function preview(pdfBuffer) {
  return withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "in.pdf"), pdfBuffer);
    await run(["preview", path.join(dir, "in.pdf"), path.join(dir, "page1.jpg")]);
    return fs.readFile(path.join(dir, "page1.jpg"));
  });
}

module.exports = { isAvailable, extract, rebuild, preview, LayoutError };
