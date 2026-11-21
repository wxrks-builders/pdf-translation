/**
 * Design-kept PDFs (beta): wraps server/layout/pdf_layout.py (PyMuPDF). extract() turns a PDF
 * into translatable segments plus the layout needed to put them back; rebuild() draws a
 * translation into the original pages. The pipeline sends the segments through a second,
 * unmetered wxrks project; the poller rebuilds when it delivers. Every failure here is soft —
 * the DOCX deliverable never depends on it — except for a PDF wxrks can't read (job_files
 * .reader_only): this path is then its whole translation, and services/docx.js builds its Word
 * file from the same translated segments.
 */
const { execFile } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const PYTHON = process.env.LAYOUT_PYTHON || "python3";
const SCRIPT = path.join(__dirname, "..", "layout", "pdf_layout.py");
const TIMEOUT_MS = 5 * 60 * 1000;
// Pages a design-kept PDF is made for, next to wxrks's DOCX (pdf_layout.py reads the same env).
const LAYOUT_MAX_PAGES = parseInt(process.env.LAYOUT_MAX_PAGES || "100", 10);
// Pages read when wxrks can't read a PDF at all: this path is then its only translation, so it
// takes long documents too (a 400-page rebuild runs in about 30 s). Past LAYOUT_MAX_PAGES such a
// file gets no page-image PDF, which would run to tens of MB.
const READER_MAX_PAGES = parseInt(process.env.LAYOUT_READER_MAX_PAGES || "1000", 10);

let available = null;

class LayoutError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // 3 = script not covered by the bundled fonts, 4 = too many pages, 5 = a scan
    this.soft = code === 3 || code === 4 || code === 5;
  }
}

// Tesseract's model for a wxrks locale ("pt_br" → "por"). The Docker image installs these
// (TESSDATA_LANGS in the Dockerfile); a language left out here is read as not supported.
const TESSERACT = {
  en: "eng", es: "spa", pt: "por", fr: "fra", de: "deu", it: "ita", nl: "nld", pl: "pol", ru: "rus", uk: "ukr",
  tr: "tur", sv: "swe", da: "dan", nb: "nor", nn: "nor", no: "nor", fi: "fin", cs: "ces", ro: "ron", hu: "hun",
  el: "ell", ja: "jpn", ko: "kor", ar: "ara", he: "heb", iw: "heb", hi: "hin", vi: "vie", id: "ind", th: "tha",
};

// "por+eng": the source language first, English second for the English words most documents carry.
function ocrLanguages(locale) {
  const [base, region = ""] = String(locale || "").toLowerCase().split(/[-_]/);
  const lang = base === "zh" ? (/^(tw|hk|mo|hant)/.test(region) ? "chi_tra" : "chi_sim") : TESSERACT[base];
  if (!lang) return "";
  return lang === "eng" ? "eng" : `${lang}+eng`;
}

function run(args, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    execFile(PYTHON, [SCRIPT, ...args], { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
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

// → { units (object, kept for rebuild), segments ({id: text}, sent to wxrks), words, pages }.
// maxPages: LAYOUT_MAX_PAGES unless wxrks can't read the file (READER_MAX_PAGES).
async function extract(pdfBuffer, { maxPages = LAYOUT_MAX_PAGES } = {}) {
  return withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "in.pdf"), pdfBuffer);
    const summary = JSON.parse(await run(["extract", path.join(dir, "in.pdf"), dir, String(maxPages)]));
    return {
      units: JSON.parse(await fs.readFile(path.join(dir, "units.json"), "utf8")),
      segments: JSON.parse(await fs.readFile(path.join(dir, "segments.json"), "utf8")),
      words: summary.words,
      pages: summary.pages,
    };
  });
}

// → { design (Buffer, live text), images (Buffer, one picture per page; null past LAYOUT_MAX_PAGES) }
async function rebuild(pdfBuffer, units, translated) {
  const pages = units.pages || 0; // units extracted before pages were stored: short files
  const images = pages <= LAYOUT_MAX_PAGES;
  return withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "in.pdf"), pdfBuffer);
    await fs.writeFile(path.join(dir, "units.json"), JSON.stringify(units));
    await fs.writeFile(path.join(dir, "translated.json"), JSON.stringify(translated));
    const args = ["rebuild", path.join(dir, "in.pdf"), path.join(dir, "units.json"), path.join(dir, "translated.json"), dir];
    await run(images ? args : [...args, "--no-images"], TIMEOUT_MS + pages * 1000);
    return {
      design: await fs.readFile(path.join(dir, "design.pdf")),
      images: images ? await fs.readFile(path.join(dir, "images.pdf")) : null,
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

// → { pdf (Buffer, page 1 alone) or null when page 1 has more than maxWords, words, totalPages }
async function excerpt(pdfBuffer, maxWords) {
  return withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "in.pdf"), pdfBuffer);
    const summary = JSON.parse(await run(["excerpt", path.join(dir, "in.pdf"), path.join(dir, "page1.pdf"), String(maxWords)]));
    return {
      pdf: summary.pages ? await fs.readFile(path.join(dir, "page1.pdf")) : null,
      words: summary.words,
      totalPages: summary.total_pages,
    };
  });
}

// → the PDF's text in reading order, at most maxWords words (paragraphs split by blank lines).
async function text(pdfBuffer, maxWords) {
  return withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "in.pdf"), pdfBuffer);
    return JSON.parse(await run(["text", path.join(dir, "in.pdf"), String(maxWords)])).text;
  });
}

// A scanned PDF with its text read off the pictures and laid invisibly on top.
// → { pdf (Buffer) or null when nothing was read, scanned (pages that were pictures), pages, words, reason }
async function ocr(pdfBuffer, locale) {
  return withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "in.pdf"), pdfBuffer);
    const summary = JSON.parse(await run(["ocr", path.join(dir, "in.pdf"), path.join(dir, "out.pdf"), ocrLanguages(locale)]));
    return {
      pdf: summary.pages && summary.words ? await fs.readFile(path.join(dir, "out.pdf")) : null,
      scanned: summary.scanned,
      pages: summary.pages,
      words: summary.words,
      reason: summary.reason,
    };
  });
}

module.exports = { isAvailable, extract, rebuild, preview, excerpt, text, ocr, ocrLanguages, LayoutError, LAYOUT_MAX_PAGES, READER_MAX_PAGES };
