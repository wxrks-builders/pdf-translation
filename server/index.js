const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const express = require("express");
const cors = require("cors");
const db = require("./db");
const poller = require("./services/poller");
const seo = require("./seo");

const app = express();
const PORT = process.env.PORT || 3000;

// Render terminates TLS at its proxy; req.ip must be the real client for
// rate limiting and the free tier's IP key.
app.set("trust proxy", 1);
app.use(seo.legacyRedirect);
app.use(cors());
// Stripe signs the raw body, so its webhook is read before the JSON parser.
const checkout = require("./routes/checkout");
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), checkout.webhook);
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", require("./routes/auth"));
app.use("/api/languages", require("./routes/languages"));
app.use("/api/jobs", require("./routes/jobs"));
app.use("/api/jobs", require("./routes/downloads"));
app.use("/api/credits", require("./routes/credits"));
app.use("/api/allowance", require("./routes/allowance"));
app.use("/api/checkout", checkout.router);
app.use("/api/webhooks", require("./routes/webhooks"));

app.get("/robots.txt", seo.robots);
app.get("/sitemap.xml", seo.sitemap);

// Production: serve the built client; every non-API route falls through to
// the SPA entry point, with that page's title/description/canonical written in
// (index: false, so "/" goes through the same path).
const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist, { index: false }));
app.get(/^(?!\/api\/).*/, (req, res) => {
  try {
    res.type("html").send(seo.render(clientDist, req.path));
  } catch {
    res.status(404).send("Client not built. Run: npm run client:build");
  }
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "file_too_large", maxMb: parseInt(process.env.MAX_UPLOAD_MB || "25", 10) });
  }
  console.error("[server] unhandled error:", err);
  res.status(500).json({ error: "internal_error" });
});

async function main() {
  await db.migrate();
  poller.startPoller();
  app.listen(PORT, () => console.log(`DocTranslate listening on :${PORT}`));
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
