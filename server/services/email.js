/**
 * Transactional email via Mailgun's HTTP API (plain axios POST, no SDK).
 * When Mailgun isn't configured (local dev), sendLoginEmail throws
 * EMAIL_NOT_CONFIGURED and the auth route falls back to logging the link.
 * Replies go to EMAIL_REPLY_TO (default help@wxrks.com, read by a person).
 */
const axios = require("axios");

function isConfigured() {
  return Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN && process.env.EMAIL_FROM);
}

async function sendEmail({ to, subject, html }) {
  if (!isConfigured()) {
    const err = new Error("MAILGUN_API_KEY, MAILGUN_DOMAIN, and EMAIL_FROM must be configured to send email");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  const from = process.env.EMAIL_FROM.includes("<") ? process.env.EMAIL_FROM : `wxrks Translate <${process.env.EMAIL_FROM}>`;
  await axios.post(
    `https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`,
    new URLSearchParams({ from, to, subject, html, "h:Reply-To": process.env.EMAIL_REPLY_TO || "help@wxrks.com" }),
    { auth: { username: "api", password: process.env.MAILGUN_API_KEY }, timeout: 15000 }
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// preheader: the line an inbox shows after the subject.
function layoutEmail(inner, preheader = "") {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>@media (max-width:480px){.wx-card{padding:28px 20px 24px !important}}</style></head>
<body style="margin:0;padding:0;background-color:#f3f5f7;">
${preheader ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#f3f5f7;">${escapeHtml(preheader)}</div>` : ""}
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background-color:#f3f5f7;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="border-collapse:collapse;width:100%;max-width:600px;">
        <tr>
          <td class="wx-card" bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #dfe3e8;border-radius:10px;padding:40px 40px 36px;font-family:helvetica,'helvetica neue',arial,sans-serif;">
${inner}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// The platform's graphite button; secondary is the outlined one.
function button(href, label, primary = true) {
  const fill = primary ? "background-color:#252a31;" : "background-color:#ffffff;border:1px solid #757d88;";
  const ink = primary ? "#ffffff" : "#252a31";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 10px;">
              <tr>
                <td align="center" ${primary ? 'bgcolor="#252a31" ' : ""}style="${fill}border-radius:6px;">
                  <a href="${href}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:helvetica,'helvetica neue',arial,sans-serif;font-size:15px;font-weight:500;color:${ink};text-decoration:none;border-radius:6px;">${label}</a>
                </td>
              </tr>
            </table>`;
}

const SEVERITY_EMAIL = {
  BLOCKER: ["Critical", "#fdedef", "#a52b36"],
  CRITICAL: ["Critical", "#fdedef", "#a52b36"],
  MAJOR: ["Major", "#fff2d1", "#785000"],
  MINOR: ["Minor", "#eaf2f8", "#315b7c"],
};

// The Confidence Score of the first language, and its two most serious sentences.
// confidence: { language, score (0–1), sentences, flagged, top: [{ severity, type, note, source, target }] }
function renderScore(confidence) {
  if (!confidence) return "";
  const pct = Math.round(confidence.score * 100);
  const [ink, ground] = confidence.score >= 0.95 ? ["#176b45", "#e7f5ec"] : confidence.score >= 0.85 ? ["#785000", "#fff2d1"] : ["#a52b36", "#fdedef"];
  const summary = confidence.flagged
    ? `${confidence.flagged} ${confidence.flagged === 1 ? "is" : "are"} worth a second look.`
    : "It found nothing to check.";
  const flags = (confidence.top || []).slice(0, 2).map((f) => {
    const [label, bg, fg] = SEVERITY_EMAIL[f.severity] || SEVERITY_EMAIL.MINOR;
    return `            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 8px;"><tr><td style="border:1px solid #dfe3e8;border-radius:6px;padding:12px 14px;">
              <span style="display:inline-block;padding:2px 6px;border-radius:4px;background-color:${bg};color:${fg};font-size:12px;line-height:16px;">${label}${f.type ? ` · ${escapeHtml(f.type)}` : ""}</span>
              ${f.target ? `<p style="Margin:6px 0 0;font-size:14px;line-height:20px;color:#252a31;">${escapeHtml(f.target)}</p>` : ""}
              ${f.note || f.source ? `<p style="Margin:4px 0 0;font-size:13px;line-height:19px;color:#57616d;">${escapeHtml([f.note, f.source && `Original: ${f.source}`].filter(Boolean).join(" "))}</p>` : ""}
            </td></tr></table>`;
  });
  return `            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:20px 0 0;"><tr><td bgcolor="${ground}" style="background-color:${ground};border-radius:8px;padding:18px 20px;">
              <p style="Margin:0;font-size:30px;line-height:34px;font-weight:600;color:${ink};">${pct}% <span style="font-size:15px;line-height:22px;">Confidence Score${confidence.language ? ` · ${escapeHtml(confidence.language)}` : ""}</span></p>
              <p style="Margin:6px 0 0;font-size:14px;line-height:21px;color:#252a31;">Smells, the wxrks check for meaning problems, read all ${confidence.sentences} sentences. ${summary}</p>
            </td></tr></table>
${flags.length ? `            <p style="Margin:16px 0 8px;font-size:14px;line-height:20px;color:#252a31;font-weight:600;">Start with ${flags.length === 1 ? "this one" : "these two"}</p>\n${flags.join("\n")}` : ""}`;
}

// Marketplace partners who could check it. reviewers: { language, url, partners: [{ name, badge, place, logo, url }] }
function renderReviewers(reviewers) {
  if (!reviewers?.partners?.length) return "";
  const rows = reviewers.partners.map(
    (p) => `            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 8px;"><tr>
              <td width="52" style="border:1px solid #dfe3e8;border-right:0;border-radius:6px 0 0 6px;padding:10px 0 10px 12px;">${p.logo ? `<img src="${p.logo}" width="40" height="40" alt="" style="display:block;border-radius:8px;border:1px solid #dfe3e8;">` : ""}</td>
              <td style="border:1px solid #dfe3e8;border-left:0;border-radius:0 6px 6px 0;padding:10px 12px;">
                <a href="${p.url}" target="_blank" style="font-size:14px;line-height:20px;color:#252a31;font-weight:600;text-decoration:none;">${escapeHtml(p.name)}</a>
                <p style="Margin:2px 0 0;font-size:12px;line-height:17px;color:#57616d;"><span style="color:${p.badge === "Premium Partner" ? "#176b45" : "#57616d"};">${escapeHtml(p.badge || "")}</span>${p.place ? ` · ${escapeHtml(p.place)}` : ""} · <a href="${p.url}" target="_blank" style="color:#252a31;">View profile</a></p>
              </td>
            </tr></table>`
  );
  return `            <p style="Margin:28px 0 4px;font-size:16px;line-height:22px;color:#252a31;font-weight:600;">Want a person to check it?</p>
            <p style="Margin:0 0 12px;font-size:14px;line-height:21px;color:#57616d;">These wxrks partners work into ${escapeHtml(reviewers.language)}. They can review the whole file or only the sentences above, and they set their own price.</p>
${rows.join("\n")}
            <p style="Margin:4px 0 0;font-size:12px;line-height:18px;color:#57616d;"><a href="${reviewers.url}" target="_blank" style="color:#57616d;">See all partners</a></p>`;
}

// groups: [{ language, files: [{ filename, url }] }]; confidence and reviewers are optional.
function renderFilesEmail({ documentName, groups, jobUrl, confidence, reviewers, free = true }) {
  const sections = groups
    .filter((g) => g.files.length)
    .map(
      (g) => `            <p style="Margin:20px 0 10px;font-size:15px;line-height:22px;color:#252a31;font-weight:600;">${escapeHtml(g.language)}</p>
            ${g.files.map((f, i) => button(f.url, `Download ${escapeHtml(f.filename)}`, i === 0)).join("\n            ")}`
    )
    .join("\n");
  return layoutEmail(`            <p style="Margin:0 0 20px;font-size:15px;line-height:20px;color:#252a31;font-weight:600;">wxrks <span style="color:#57616d;font-weight:400;">Translate</span></p>
            <h1 style="Margin:0 0 12px;font-size:22px;line-height:30px;color:#252a31;font-weight:600;">Your translation is ready</h1>
            <p style="Margin:0;font-size:15px;line-height:23px;color:#57616d;">Here is ${escapeHtml(documentName)}, translated. The links work for 30 days, and then the files are deleted.</p>
${renderScore(confidence)}
${sections}
${renderReviewers(reviewers)}
            <p style="Margin:24px 0 0;font-size:14px;line-height:21px;color:#57616d;">You can also <a href="${jobUrl}" style="color:#252a31;">open the translation page</a> on any device.${free ? " Tomorrow you can translate another document for free." : ""}</p>
            <p style="Margin:24px 0 0;font-size:14px;line-height:21px;color:#57616d;">Translating for a team? In <a href="https://wxrks.com/?utm_source=translate.wxrks.com&amp;utm_medium=email&amp;utm_campaign=free-translator&amp;utm_content=files-email" style="color:#252a31;">wxrks</a>, your glossary and reviewers shape every file.</p>
            <p style="Margin:28px 0 0;font-size:12px;line-height:18px;color:#57616d;">We sent this because you asked for these files on translate.wxrks.com. Reply if something looks wrong; a person reads it.</p>`);
}

async function sendFilesEmail(to, details) {
  const score = details.confidence ? ` (${Math.round(details.confidence.score * 100)}% confidence)` : "";
  await sendEmail({ to, subject: `Your translation of ${details.documentName} is ready${score}`, html: renderFilesEmail(details) });
}

// Words of credit at the smallest pack's price ($9 per 10,000).
const creditDollars = (words) => Math.round((words * 9) / 10000);

// signupWords: the sign-up credit this link brings when the address has no account yet (0: none).
function renderLoginEmail(loginUrl, { signupWords = 0 } = {}) {
  const credit = signupWords
    ? `<p style="Margin:0 0 28px;font-size:15px;line-height:23px;color:#176b45;">New account? We add $${creditDollars(signupWords)} in credits when you click: ${signupWords.toLocaleString("en-US")} words (about ${Math.round(signupWords / 250).toLocaleString("en-US")} pages).</p>`
    : "";
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f3f5f7;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background-color:#f3f5f7;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="border-collapse:collapse;width:600px;max-width:600px;">
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #dfe3e8;border-radius:10px;padding:40px 40px 36px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
              <tr>
                <td align="center" style="font-family:helvetica,'helvetica neue',arial,sans-serif;">
                  <h1 style="Margin:0 0 12px;font-size:22px;line-height:30px;color:#252a31;font-weight:600;">Sign in to wxrks Translate</h1>
                  <p style="Margin:0 0 ${signupWords ? 12 : 28}px;font-size:15px;line-height:23px;color:#57616d;">Click the button below to sign in. No password needed.</p>
                  ${credit}
                  <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="border-collapse:collapse;margin:0 auto 28px;">
                    <tr>
                      <td align="center" bgcolor="#252a31" style="background-color:#252a31;border-radius:6px;">
                        <a href="${loginUrl}" target="_blank" style="display:inline-block;padding:16px 34px;font-family:helvetica,'helvetica neue',arial,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;">Sign in</a>
                      </td>
                    </tr>
                  </table>
                  <p style="Margin:0;font-size:13px;line-height:20px;color:#57616d;">This link expires in 15 minutes and can only be used once. Didn't request this? You can safely ignore this email.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

const n = (x) => Number(x).toLocaleString("en-US");
const andList = (xs) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`);

// The files a translation brings, one row each, as services/poller.js stores them: a PDF gives
// a Word file and a PDF that keeps its design, per language; any other file comes back in its
// own format.
const FILE_KINDS = {
  docx: ["Word", "#eaf2f8", "#315b7c"],
  doc: ["Word", "#eaf2f8", "#315b7c"],
  pptx: ["PowerPoint", "#fff2d1", "#785000"],
  ppt: ["PowerPoint", "#fff2d1", "#785000"],
  xlsx: ["Excel", "#e7f5ec", "#176b45"],
  xls: ["Excel", "#e7f5ec", "#176b45"],
};
function linkEmailRows(documentName, languages) {
  const ext = (documentName.match(/\.([A-Za-z0-9]+)$/)?.[1] || "").toLowerCase();
  if (ext === "pdf") {
    return {
      summary: "Word and PDF",
      rows: languages.flatMap((l) => [
        { badge: "DOCX", tint: "#eaf2f8", ink: "#315b7c", title: `${l}, Word file`, note: "Edit it in Word or Google Docs" },
        { badge: "PDF", tint: "#fdedef", ink: "#a52b36", title: `${l}, PDF`, note: "Looks like your original" },
      ]),
    };
  }
  const [kind, tint, ink] = FILE_KINDS[ext] || [ext ? ext.toUpperCase() : "Translated", "#f3f5f7", "#57616d"];
  return {
    summary: kind,
    rows: languages.map((l) => ({ badge: (ext || "file").toUpperCase().slice(0, 4), tint, ink, title: `${l}, ${kind} file`, note: "Keeps the formatting of your original" })),
  };
}

const duration = (minutes) =>
  minutes < 90 ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : `${Math.round(minutes / 60)} hours`;

// The sign-in link from the offer on a file over the free limit (version 2 of
// https://claude.ai/artifact/Gu9nTk1CmB6V4h7wCT17Sn, Rodrigo, 2026-11-22): it names the file and
// lists the files it brings, says what pays for them, and says the click starts the whole file
// (true: ?finish=1, client/src/pages/Job.jsx) and the files come by email (services/leads.js).
// file: { documentName, pages, languages, credits, balance, newAccount, signupWords, minutes }
// (routes/auth.js). balance: what the account has after the click (a new one: the sign-up credit).
function renderFileLinkEmail(loginUrl, file) {
  const { summary, rows } = linkEmailRows(file.documentName, file.languages);
  const count = rows.length;
  const files = count === 1 ? "file" : "files";
  const covers = file.credits <= file.balance;
  const langs = andList(file.languages);
  const pageCell = `${n(file.pages)} ${file.pages === 1 ? "page" : "pages"}`;
  const headline = covers
    ? count === 1 ? "Your file, one click away" : `Your ${count} files, one click away`
    : count === 1 ? "Get your file" : `Get your ${count} files`;
  const intro = `${file.pages > 1 ? `All ${n(file.pages)} pages of ` : ""}${escapeHtml(file.documentName)}, in ${escapeHtml(langs)}:`;
  const pay = covers
    ? file.newAccount
      ? `Free: your new account starts with ${n(file.signupWords)} words. No card.`
      : `Uses ${n(file.credits)} of your ${n(file.balance)} credits.`
    : file.newAccount && file.signupWords
      ? `Your new account starts with ${n(file.signupWords)} words free. This file needs ${n(file.credits)}, and a word pack covers the rest, from $9.`
      : file.newAccount
        ? `This file needs ${n(file.credits)} words. A word pack covers it, from $9.`
        : `Your account has ${n(file.balance)} credits. This file needs ${n(file.credits)}, and a word pack covers the rest, from $9.`;
  const soon = file.minutes ? `, usually in about ${duration(file.minutes)}` : "";
  const note = covers
    ? `One click signs you in and starts ${file.pages > 1 ? `all ${n(file.pages)} pages` : "the whole file"}. The ${files} come to this inbox when they're ready${soon}.`
    : `One click signs you in and brings you back to your file. Add the words it needs, and it translates from there; the ${files} come to this inbox.`;
  const list = rows
    .map(
      (r) => `            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 8px;"><tr>
              <td width="46" bgcolor="#f7f8fa" style="background-color:#f7f8fa;border-radius:8px 0 0 8px;padding:10px 0 10px 12px;width:34px;min-width:34px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td width="34" height="40" align="center" valign="bottom" bgcolor="${r.tint}" style="width:34px;min-width:34px;background-color:${r.tint};border-radius:3px;padding:0 0 5px;font-size:9px;line-height:11px;font-weight:700;color:${r.ink};">${r.badge}</td></tr></table>
              </td>
              <td width="100%" bgcolor="#f7f8fa" style="background-color:#f7f8fa;padding:10px 12px;">
                <p style="Margin:0;font-size:14px;line-height:20px;color:#252a31;font-weight:600;">${escapeHtml(r.title)}</p>
                <p style="Margin:2px 0 0;font-size:12px;line-height:17px;color:#57616d;">${escapeHtml(r.note)}</p>
              </td>
              <td align="right" bgcolor="#f7f8fa" style="background-color:#f7f8fa;border-radius:0 8px 8px 0;padding:10px 14px 10px 0;font-size:12px;line-height:17px;color:#57616d;white-space:nowrap;">${pageCell}</td>
            </tr></table>`
    )
    .join("\n");
  const html = layoutEmail(
    `            <p style="Margin:0 0 22px;font-size:15px;line-height:20px;color:#252a31;font-weight:600;">wxrks <span style="color:#57616d;font-weight:400;">Translate</span></p>
            <h1 style="Margin:0;font-size:26px;line-height:32px;color:#252a31;font-weight:700;letter-spacing:-0.4px;">${headline}</h1>
            <p style="Margin:12px 0 18px;font-size:15px;line-height:23px;color:#57616d;">${intro}</p>
${list}
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:12px 0 0;"><tr>
              <td align="center" bgcolor="#252a31" style="background-color:#252a31;border-radius:8px;">
                <a href="${loginUrl}" target="_blank" style="display:block;padding:18px 20px;font-family:helvetica,'helvetica neue',arial,sans-serif;font-size:17px;line-height:22px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${covers ? `Translate and send me my ${files}` : "Finish my translation"}</a>
              </td>
            </tr></table>
            <p style="Margin:10px 0 0;text-align:center;font-size:13px;line-height:19px;color:${covers ? "#176b45" : "#57616d"};">${pay}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:24px 0 0;"><tr>
              <td bgcolor="#f3faf6" style="background-color:#f3faf6;border:1px solid #c8e8d4;border-radius:8px;padding:14px 16px;font-size:13px;line-height:20px;color:#24543a;">${note}</td>
            </tr></table>
            <p style="Margin:26px 0 0;padding-top:18px;border-top:1px solid #e7ebef;font-size:12px;line-height:18px;color:#57616d;">The button works for 15 minutes, once. After that, it takes you back to your file, where you can ask for a new one. Didn't ask for this? Ignore it; nothing happens.</p>`,
    `${summary}, in ${langs}`
  );
  return { subject: `${count} ${files} to download: your translation, complete`, html };
}

// file: the file this link finishes (renderFileLinkEmail); without one, the plain sign-in email.
async function sendLoginEmail(to, loginUrl, { signupWords = 0, file = null } = {}) {
  if (file) return sendEmail({ to, ...renderFileLinkEmail(loginUrl, file) });
  const subject = signupWords ? `Your sign-in link, and $${creditDollars(signupWords)} in credits` : "Sign in to wxrks Translate";
  await sendEmail({ to, subject, html: renderLoginEmail(loginUrl, { signupWords }) });
}

module.exports = { isConfigured, sendEmail, sendLoginEmail, sendFilesEmail, renderFilesEmail, renderLoginEmail, renderFileLinkEmail };
