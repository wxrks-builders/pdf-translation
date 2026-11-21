/**
 * The Word file of a PDF wxrks can't read (job_files.reader_only). wxrks then has no DOCX to give
 * back, so this one is built from the design-kept path's translated segments: one paragraph per
 * text block, in reading order, a page break where the PDF's page ends, headings bold and sized as
 * they were. Plain text to edit, not a copy of the design: the design-kept PDF is that.
 *
 * A DOCX is a zip of three XML parts at least; this writes only those (adm-zip is already here).
 */
const AdmZip = require("adm-zip");

// Scripts written right to left: their paragraphs get <w:bidi/> and their runs <w:rtl/>.
const RTL = new Set(["ar", "fa", "he", "iw", "ur", "ps", "sd", "yi", "dv", "ug", "ckb"]);
const isRtl = (locale) => RTL.has(String(locale || "").toLowerCase().split(/[-_]/)[0]);

// XML 1.0 can't carry most control characters, even escaped.
const xml = (s) =>
  String(s)
    .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const BOLD_NAME = /bold|black|heavy/i;

function paragraph(text, unit, rtl) {
  const halfPoints = Math.round(Math.min(36, Math.max(8, unit.size || 11)) * 2);
  const bold = (unit.flags & 16) || BOLD_NAME.test(unit.font || "") ? "<w:b/><w:bCs/>" : "";
  const run = `<w:rPr>${bold}${rtl ? "<w:rtl/>" : ""}<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/></w:rPr>`;
  return `<w:p>${rtl ? "<w:pPr><w:bidi/></w:pPr>" : ""}<w:r>${run}<w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}

// unitsDoc: { units, pages } from pdf_layout.py extract; translated: {unit id: text}.
// Blocks with nothing to translate (numbers, codes) and any the translation missed keep their
// source text, so the document reads through.
function build(unitsDoc, translated, locale) {
  const rtl = isRtl(locale);
  const body = [];
  let page = null;
  for (const u of unitsDoc.units || []) {
    if (page !== null && u.page !== page) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    page = u.page;
    const text = (u.translate && translated[u.id]) || u.text;
    if (text && text.trim()) body.push(paragraph(text.replace(/\s+/g, " ").trim(), u, rtl));
  }
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body.join("") +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
    "</w:body></w:document>";
  const zip = new AdmZip();
  zip.addFile(
    "[Content_Types].xml",
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        "</Types>"
    )
  );
  zip.addFile(
    "_rels/.rels",
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>"
    )
  );
  zip.addFile("word/document.xml", Buffer.from(document, "utf8"));
  return zip.toBuffer();
}

module.exports = { build, isRtl };
