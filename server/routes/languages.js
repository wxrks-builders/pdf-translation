const express = require("express");
const locales = require("../services/locales");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const list = await locales.listLanguages();
    res.json({ languages: list.map((l) => ({ code: l.code, name: l.name })) });
  } catch (err) {
    res.status(502).json({ error: "languages_unavailable" });
  }
});

module.exports = router;
