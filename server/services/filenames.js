/**
 * wxrks reportedly truncates long resource filenames (basename cut, extension
 * kept) without echoing the original — not reproduced live at 56-char
 * basenames (spike 2), but every later identification (work units, webhooks,
 * downloads) is by filename, so uploads are defensively prefixed with the
 * short job id and matched back by unique-prefix, never plain equality.
 */
const path = require("path");

const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".doc", ".txt", ".csv", ".json", ".yml", ".yaml", ".xlsx", ".pptx", ".md", ".html", ".xml", ".srt"];

function sanitizeBasename(name) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase();
}

// "Q3 Report Final.PDF" + job j8f3k2 → "j8f3k2-q3-report-final.pdf"
function buildWxrksFilename(jobId, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const base = sanitizeBasename(path.basename(originalName, path.extname(originalName))) || "file";
  return `${jobId}-${base}${ext}`;
}

function extensionAllowed(originalName) {
  return ALLOWED_EXTENSIONS.includes(path.extname(originalName).toLowerCase());
}

// wxrks reports a possibly-truncated filename; find the ONE job file whose
// sent name starts with the truncated basename. 0 or >1 matches → error
// rather than delivering the wrong file.
function matchJobFile(jobFiles, reportedName) {
  const reportedBase = path.basename(reportedName, path.extname(reportedName));
  const matches = jobFiles.filter((f) => {
    const sentBase = path.basename(f.wxrks_filename, path.extname(f.wxrks_filename));
    return sentBase === reportedBase || sentBase.startsWith(reportedBase);
  });
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) return null;
  throw new Error(`Ambiguous filename match for "${reportedName}": ${matches.map((f) => f.wxrks_filename).join(", ")}`);
}

// Reject a job up-front if two of its files would truncate to the same
// basename prefix and become indistinguishable in wxrks's reporting.
function findTruncationCollision(wxrksNames, truncateAt = 31) {
  const seen = new Map();
  for (const name of wxrksNames) {
    const base = path.basename(name, path.extname(name)).slice(0, truncateAt);
    const key = `${base}${path.extname(name)}`;
    if (seen.has(key)) return [seen.get(key), name];
    seen.set(key, name);
  }
  return null;
}

module.exports = {
  ALLOWED_EXTENSIONS,
  sanitizeBasename,
  buildWxrksFilename,
  extensionAllowed,
  matchJobFile,
  findTruncationCollision,
};
