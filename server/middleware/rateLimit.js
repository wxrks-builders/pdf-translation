/**
 * Small in-memory sliding-window limiter. Process-local and best-effort:
 * fine for a single Render instance; a shared store (Redis) would be needed
 * to scale out. Requires app.set("trust proxy", 1) upstream so req.ip
 * reflects the real client behind Render's proxy.
 */
function createRateLimiter({ windowMs, max }) {
  const hitsByKey = new Map();

  return function rateLimiter(req, res, next) {
    const key = req.ip;
    const now = Date.now();
    const recent = (hitsByKey.get(key) || []).filter((t) => now - t < windowMs);

    if (recent.length >= max) {
      hitsByKey.set(key, recent);
      return res.status(429).json({ error: "rate_limited", message: "Too many attempts. Please try again later." });
    }

    recent.push(now);
    hitsByKey.set(key, recent);
    next();
  };
}

module.exports = { createRateLimiter };
