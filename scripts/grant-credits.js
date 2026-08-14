#!/usr/bin/env node
// Admin credit grant (payments are not wired yet):
//   node scripts/grant-credits.js <email> <amount> ["note"]
// Creates the user if the email has never logged in.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const store = require("../server/store");
const db = require("../server/db");

async function main() {
  const [email, amountArg, note] = process.argv.slice(2);
  const amount = parseInt(amountArg, 10);
  if (!email || !Number.isFinite(amount) || amount === 0) {
    console.error('Usage: node scripts/grant-credits.js <email> <amount> ["note"]');
    process.exit(1);
  }
  await db.migrate();
  const user = await store.upsertUserByEmail(email);
  await store.grantCredits(user.id, amount, amount > 0 ? "grant" : "charge", note || `admin grant`);
  const balance = await store.getCreditBalance(user.id);
  console.log(`${email}: ${amount > 0 ? "+" : ""}${amount} credits → balance ${balance}`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
