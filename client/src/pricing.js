import { api } from "./api";

// The word packs, paid once. One credit is one source word into one language, so a 10,000-word
// pack covers a 5,000-word file into two languages. Buying goes through Stripe Checkout once
// the server has its Stripe keys (server/services/payments.js, same PACKS); until then a pack
// opens an email to BUY_EMAIL and the words are added with scripts/grant-credits.js.
// Rodrigo, 2026-11-09: "$9 per 10,000 words ... 29 per 60,000 words. Then 99 per 400,000 words".
export const PACKS = [
  { words: 10000, price: 9 },
  { words: 60000, price: 29 },
  { words: 400000, price: 99 },
];

// A guest's one free document a day (FREE_TIER_MAX_WORDS in server/services/pipeline.js), and
// what a new account starts with (server/services/signupCredit.js): the smallest pack, for free.
export const FREE_WORDS = 2000;
export const SIGNUP_CREDIT = { words: 10000, dollars: 9 };

export const BUY_EMAIL = "demetrio@wxrks.com";

const n = (x) => x.toLocaleString("en-US");

// A page is about 250 words, the figure translators quote by.
export const pagesFor = (words) => Math.max(1, Math.round(words / 250));

// Every word count the visitor reads carries its pages (Rodrigo, 2026-11-09: "always between
// parentheses an estimation of pages"): "10,000 words (about 40 pages)".
export const aboutPages = (words) => `about ${n(pagesFor(words))} ${pagesFor(words) === 1 ? "page" : "pages"}`;
export const wordsAndPages = (words) => (words > 0 ? `${n(words)} words (${aboutPages(words)})` : `${n(words || 0)} words`);

export const packLabel = (pack) => `$${pack.price} for ${wordsAndPages(pack.words)}`;

// In whole cents, so $99 for 400,000 reads $0.25 and not a float's $0.2475.
export const perThousand = (pack) => `$${(Math.round((pack.price * 100000) / pack.words) / 100).toFixed(2)} per 1,000 words`;

// The smallest pack that covers this many credits, or null when none does.
export const packFor = (credits) => PACKS.find((p) => p.words >= credits) || null;

export function buyHref(pack) {
  const subject = `Buy the ${n(pack.words)}-word pack ($${pack.price})`;
  return `mailto:${BUY_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

// Stripe Checkout, or the email when checkout isn't switched on. jobId: the file over the free
// limit this pack is for, so the thank-you page can offer to translate it. place: where the
// button was, for the buying funnel (server/services/events.js).
export async function buy(pack, jobId, place) {
  try {
    const { url } = await api.checkout({ words: pack.words, jobId, place });
    window.location.assign(url);
  } catch (err) {
    if (err.code !== "checkout_unavailable") throw err;
    window.location.assign(buyHref(pack));
  }
}
