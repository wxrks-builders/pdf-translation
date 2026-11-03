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
<body style="margin:0;padding:0;background-color:#f5f6fb;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background-color:#f5f6fb;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="border-collapse:collapse;width:600px;max-width:600px;">
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #dee2ee;border-radius:12px;padding:40px 40px 36px;font-family:helvetica,'helvetica neue',arial,sans-serif;">
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

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 10px;">
              <tr>
                <td align="center" bgcolor="#3b5bfd" style="background-color:#3b5bfd;border-radius:6px;">
                  <a href="${href}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:helvetica,'helvetica neue',arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;">${label}</a>
                </td>
              </tr>
            </table>`;
}

// groups: [{ language, files: [{ filename, url }] }]
function renderFilesEmail({ documentName, groups, jobUrl }) {
  const sections = groups
    .filter((g) => g.files.length)
    .map(
      (g) => `            <p style="Margin:20px 0 10px;font-size:15px;line-height:22px;color:#1a1d2c;font-weight:600;">${escapeHtml(g.language)}</p>
            ${g.files.map((f) => button(f.url, `Download ${escapeHtml(f.filename)}`)).join("\n            ")}`
    )
    .join("\n");
  return layoutEmail(`            <h1 style="Margin:0 0 12px;font-size:22px;line-height:30px;color:#1a1d2c;font-weight:600;">Your translation is ready</h1>
            <p style="Margin:0;font-size:15px;line-height:23px;color:#5b6178;">Here is ${escapeHtml(documentName)}, translated. The links work for 30 days, and then the files are deleted.</p>
${sections}
            <p style="Margin:24px 0 0;font-size:14px;line-height:21px;color:#5b6178;">You can also <a href="${jobUrl}" style="color:#3b5bfd;">open the translation page</a> on any device. Tomorrow you can translate another document for free.</p>
            <p style="Margin:24px 0 0;font-size:14px;line-height:21px;color:#5b6178;">Translating for a team? In <a href="https://wxrks.com/?utm_source=translate.wxrks.com&amp;utm_medium=email&amp;utm_campaign=free-translator&amp;utm_content=files-email" style="color:#3b5bfd;">wxrks</a>, your glossary and reviewers shape every file.</p>
            <p style="Margin:28px 0 0;font-size:12px;line-height:18px;color:#8b90a6;">You got this email because you asked for these files on translate.wxrks.com. Reply if something looks wrong; a person reads it.</p>`);
}

async function sendFilesEmail(to, details) {
  await sendEmail({ to, subject: `Your translation of ${details.documentName} is ready`, html: renderFilesEmail(details) });
}

function renderLoginEmail(loginUrl) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f5f6fb;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background-color:#f5f6fb;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="border-collapse:collapse;width:600px;max-width:600px;">
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #dee2ee;border-radius:12px;padding:40px 40px 36px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
              <tr>
                <td align="center" style="font-family:helvetica,'helvetica neue',arial,sans-serif;">
                  <h1 style="Margin:0 0 12px;font-size:22px;line-height:30px;color:#1a1d2c;font-weight:600;">Sign in to wxrks Translate</h1>
                  <p style="Margin:0 0 28px;font-size:15px;line-height:23px;color:#5b6178;">Click the button below to sign in. No password needed.</p>
                  <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="border-collapse:collapse;margin:0 auto 28px;">
                    <tr>
                      <td align="center" bgcolor="#3b5bfd" style="background-color:#3b5bfd;border-radius:6px;">
                        <a href="${loginUrl}" target="_blank" style="display:inline-block;padding:16px 34px;font-family:helvetica,'helvetica neue',arial,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;">Sign in</a>
                      </td>
                    </tr>
                  </table>
                  <p style="Margin:0;font-size:13px;line-height:20px;color:#8b90a6;">This link expires in 15 minutes and can only be used once. Didn't request this? You can safely ignore this email.</p>
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
