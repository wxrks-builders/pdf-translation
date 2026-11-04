// The word packs, paid once. One credit is one source word into one language, so a 5,000-word
// pack covers a 2,500-word file into two languages. Checkout isn't wired yet: a buyer emails
// BUY_EMAIL and the words are added with scripts/grant-credits.js.
export const PACKS = [
  { words: 5000, price: 9 },
  { words: 30000, price: 29 },
  { words: 200000, price: 99 },
];

export const BUY_EMAIL = "demetrio@wxrks.com";

const n = (x) => x.toLocaleString("en-US");

export const packLabel = (pack) => `$${pack.price} for ${n(pack.words)} words`;

export const perThousand = (pack) => `$${((pack.price * 1000) / pack.words).toFixed(2)} per 1,000 words`;

// The smallest pack that covers this many credits, or null when none does.
export const packFor = (credits) => PACKS.find((p) => p.words >= credits) || null;

export function buyHref(pack) {
  const subject = `Buy the ${n(pack.words)}-word pack ($${pack.price})`;
  return `mailto:${BUY_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
