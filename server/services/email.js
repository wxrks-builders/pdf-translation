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

function layoutEmail(inner) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f3f5f7;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background-color:#f3f5f7;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="border-collapse:collapse;width:600px;max-width:600px;">
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #dfe3e8;border-radius:10px;padding:40px 40px 36px;font-family:helvetica,'helvetica neue',arial,sans-serif;">
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
function renderFilesEmail({ documentName, groups, jobUrl, confidence, reviewers }) {
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
            <p style="Margin:24px 0 0;font-size:14px;line-height:21px;color:#57616d;">You can also <a href="${jobUrl}" style="color:#252a31;">open the translation page</a> on any device. Tomorrow you can translate another document for free.</p>
            <p style="Margin:24px 0 0;font-size:14px;line-height:21px;color:#57616d;">Translating for a team? In <a href="https://wxrks.com/?utm_source=translate.wxrks.com&amp;utm_medium=email&amp;utm_campaign=free-translator&amp;utm_content=files-email" style="color:#252a31;">wxrks</a>, your glossary and reviewers shape every file.</p>
            <p style="Margin:28px 0 0;font-size:12px;line-height:18px;color:#57616d;">We sent this because you asked for these files on translate.wxrks.com. Reply if something looks wrong; a person reads it.</p>`);
}

async function sendFilesEmail(to, details) {
  const score = details.confidence ? ` (${Math.round(details.confidence.score * 100)}% confidence)` : "";
  await sendEmail({ to, subject: `Your translation of ${details.documentName} is ready${score}`, html: renderFilesEmail(details) });
}

function renderLoginEmail(loginUrl) {
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
                  <p style="Margin:0 0 28px;font-size:15px;line-height:23px;color:#57616d;">Click the button below to sign in. No password needed.</p>
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

async function sendLoginEmail(to, loginUrl) {
  await sendEmail({ to, subject: "Sign in to wxrks Translate", html: renderLoginEmail(loginUrl) });
}

module.exports = { isConfigured, sendEmail, sendLoginEmail, sendFilesEmail, renderFilesEmail };
