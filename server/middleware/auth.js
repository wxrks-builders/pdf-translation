const store = require("../store");

const SESSION_COOKIE_NAME = "session_id";

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    cookies[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return cookies;
}

function isProd() {
  return process.env.NODE_ENV === "production";
}

function setSessionCookie(res, sessionId) {
  const maxAge = Math.floor(store.SESSION_MAX_AGE_MS / 1000);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isProd() ? "; Secure" : ""}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

// Issuing a fresh session while the browser already holds one must kill the
// old row first, or it lingers valid in Postgres with nothing able to log it
// out. Best-effort.
async function deleteSessionFromRequestCookie(req) {
  const sessionId = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (sessionId) await store.deleteSession(sessionId).catch(() => {});
}

async function loadSession(req) {
  const sessionId = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (!sessionId) return null;
  const session = await store.getSessionWithUser(sessionId);
  if (!session) return null;
  store.touchSession(sessionId).catch(() => {});
  return session;
}

async function requireSession(req, res, next) {
  const session = await loadSession(req);
  if (!session) return res.status(401).json({ error: "not_authenticated" });
  req.user = session.user;
  req.sessionId = session.sessionId;
  next();
}

// Job creation is open to anonymous free-tier users: attach the user if a
// valid session exists, continue either way.
async function optionalSession(req, res, next) {
  const session = await loadSession(req);
  if (session) {
    req.user = session.user;
    req.sessionId = session.sessionId;
  }
  next();
}

module.exports = {
  SESSION_COOKIE_NAME,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  deleteSessionFromRequestCookie,
  requireSession,
  optionalSession,
};
