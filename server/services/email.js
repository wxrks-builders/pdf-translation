/**
 * Transactional email via Mailgun's HTTP API (plain axios POST, no SDK).
 * When Mailgun isn't configured (local dev), sendLoginEmail throws
 * EMAIL_NOT_CONFIGURED and the auth route falls back to logging the link.
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
  await axios.post(
    `https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`,
    new URLSearchParams({ from: process.env.EMAIL_FROM, to, subject, html }),
    { auth: { username: "api", password: process.env.MAILGUN_API_KEY } }
  );
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
                  <h1 style="Margin:0 0 12px;font-size:22px;line-height:30px;color:#1a1d2c;font-weight:600;">Sign in to DocTranslate</h1>
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
  await sendEmail({ to, subject: "Sign in to DocTranslate", html: renderLoginEmail(loginUrl) });
}

module.exports = { isConfigured, sendEmail, sendLoginEmail };
