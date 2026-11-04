import { api } from "./api";

// The word packs, paid once. One credit is one source word into one language, so a 5,000-word
// pack covers a 2,500-word file into two languages. Buying goes through Stripe Checkout once
// the server has its Stripe keys (server/services/payments.js, same PACKS); until then a pack
// opens an email to BUY_EMAIL and the words are added with scripts/grant-credits.js.
export const PACKS = [
  { words: 5000, price: 9 },
  { words: 30000, price: 29 },
  { words: 200000, price: 99 },
];

export const BUY_EMAIL = "demetrio@wxrks.com";

const n = (x) => x.toLocaleString("en-US");

export const packLabel = (pack) => `$${pack.price} for ${n(pack.words)} words`;

// In whole cents, so $99 for 200,000 reads $0.50 and not a float's $0.49.
export const perThousand = (pack) => `$${(Math.round((pack.price * 100000) / pack.words) / 100).toFixed(2)} per 1,000 words`;

// The smallest pack that covers this many credits, or null when none does.
export const packFor = (credits) => PACKS.find((p) => p.words >= credits) || null;

export function buyHref(pack) {
  const subject = `Buy the ${n(pack.words)}-word pack ($${pack.price})`;
  return `mailto:${BUY_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

// A page is about 250 words, the figure translators quote by.
export const pagesFor = (words) => Math.max(1, Math.round(words / 250));

// Stripe Checkout, or the email when checkout isn't switched on. jobId: the file over the free
// limit this pack is for, so the thank-you page can offer to translate it.
export async function buy(pack, jobId) {
  try {
    const { url } = await api.checkout({ words: pack.words, jobId });
    window.location.assign(url);
  } catch (err) {
    if (err.code !== "checkout_unavailable") throw err;
    window.location.assign(buyHref(pack));
  }
}
