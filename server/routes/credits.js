const express = require("express");
const store = require("../store");
const { requireSession } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireSession, async (req, res) => {
  const [balance, ledger] = await Promise.all([
    store.getCreditBalance(req.user.id),
    store.getCreditLedger(req.user.id),
  ]);
  res.json({ balance, ledger });
});

module.exports = router;
