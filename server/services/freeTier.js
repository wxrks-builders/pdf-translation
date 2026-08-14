/**
 * Anonymous free tier: 1 document/day, enforced on IP + a signed cookie.
 * Deliberately imperfect (cookie clearing / IP rotation evades it) — it's a
 * funnel, not a wall. Requires app.set("trust proxy", 1) so req.ip is the
 * real client behind Render's proxy.
 */
const crypto = require("crypto");
const store = require("../store");

const COOKIE_NAME = "dt_anon";
const ONE_YEAR_S = 365 * 24 * 60 * 60;

function secret() {
  const s = process.env.COOKIE_SECRET;
  if (!s) throw new Error("COOKIE_SECRET must be configured");
  return s;
}

function sign(id) {
  return crypto.createHmac("sha256", secret()).update(id).digest("hex").slice(0, 32);
}

function verifyAnonCookie(raw) {
  if (!raw) return null;
  const [id, sig] = raw.split(".");
  if (!id || !sig) return null;
  const expected = sign(id);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return id;
}

// Middleware: ensures every visitor carries a signed anon id (used both to
// enforce the daily free slot and to let anonymous users see their own jobs).
function anonCookie(req, res, next) {
  const { parseCookies } = require("../middleware/auth");
  let id = verifyAnonCookie(parseCookies(req.headers.cookie)[COOKIE_NAME]);
  if (!id) {
    id = crypto.randomUUID();
    const isProd = process.env.NODE_ENV === "production";
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${id}.${sign(id)}; Path=/; Max-Age=${ONE_YEAR_S}; HttpOnly; SameSite=Lax${isProd ? "; Secure" : ""}`
    );
  }
  req.anonId = id;
  next();
}

// One free document per UTC day per (ip OR cookie). Returns null if the slot
// is free, or the blocking usage row.
function findUsageToday(req) {
  return store.findFreeTierUsageToday({ ip: req.ip, cookieId: req.anonId });
}

function reserveSlot(req, jobId) {
  return store.recordFreeTierUsage({ ip: req.ip, cookieId: req.anonId, jobId });
}

module.exports = { COOKIE_NAME, anonCookie, verifyAnonCookie, findUsageToday, reserveSlot };
