/**
 * The sign-up credit: a new account starts with $9 in credits, the smallest pack's 10,000 words
 * (Rodrigo, 2026-11-09: "we inject in their wallet 10K credits ... would you like to win $9 in
 * credit for signing up"). It replaced the free first document up to 20,000 words.
 *
 * Given once per account, to accounts that are new: made by a sign-in link (routes/auth.js) or
 * by a purchase (routes/checkout.js). Accounts made before this get nothing. The daily cap bounds
 * what a wave of throwaway addresses can cost. SIGNUP_CREDIT_WORDS=0 turns it off.
 */
const store = require("../store");
const events = require("./events");

// Keep in step with SIGNUP_CREDIT in client/src/pricing.js, which the copy quotes.
const WORDS = parseInt(process.env.SIGNUP_CREDIT_WORDS ?? "10000", 10);
const DAILY_CAP = parseInt(process.env.SIGNUP_CREDIT_DAILY_CAP || "50", 10);

const startOfTodayUtc = () => `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;

async function available() {
  return WORDS > 0 && (await store.countSignupCreditsSince(startOfTodayUtc())) < DAILY_CAP;
}

// → the words granted, or 0 (switched off, already given, or today's cap reached).
async function grant(user, how) {
  if (!WORDS) return 0;
  const granted = await store.grantSignupCredit(user.id, WORDS, "Sign-up credit, $9", DAILY_CAP, startOfTodayUtc());
  if (!granted) return 0;
  console.log(`[signup-credit] ${WORDS} words for ${user.id} (${how})`);
  await events.record({ user }, "signup_credit", { detail: { words: WORDS, how } });
  return WORDS;
}

module.exports = { WORDS, available, grant };
