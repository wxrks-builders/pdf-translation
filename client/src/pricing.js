import { api } from "./api";
import i18n from "./i18n";
import { formatMoney } from "./i18n/format";

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
// what a new account starts with (server/services/signupCredit.js): 20,000 words, two of the
// smallest pack (Rodrigo, 2026-11-21: a bigger first file after sign-up, since the email lets us
// follow up). Most files stopped at a price fit in it whole.
export const FREE_WORDS = 2000;
export const SIGNUP_CREDIT = { words: 20000, dollars: 18 };

export const BUY_EMAIL = "demetrio@wxrks.com";

// A page is about 250 words, the figure translators quote by.
export const pagesFor = (words) => Math.max(1, Math.round(words / 250));

// Every word count the visitor reads carries its pages (Rodrigo, 2026-11-09: "always between
// parentheses an estimation of pages"): "10,000 words (about 40 pages)". The phrases live in the
// messages (units.*) so each language writes its own plurals; prices are US dollars everywhere.
export const aboutPages = (words) => i18n.t("units.aboutPages", { pages: pagesFor(words) });
export const wordsAndPages = (words) =>
  words > 0 ? i18n.t("units.wordsAndPages", { words, pages: pagesFor(words) }) : i18n.t("units.words", { words: words || 0 });

export const packLabel = (pack) => i18n.t("units.packLabel", { price: formatMoney(pack.price), amount: wordsAndPages(pack.words) });

// In whole cents, so $99 for 400,000 reads $0.25 and not a float's $0.2475.
export const perThousand = (pack) =>
  i18n.t("units.perThousand", { price: formatMoney(Math.round((pack.price * 100000) / pack.words) / 100, { cents: true }), words: 1000 });

// The smallest pack that covers this many credits, or null when none does.
export const packFor = (credits) => PACKS.find((p) => p.words >= credits) || null;

// The request goes to the wxrks team, who grant the words by hand, so its subject stays in
// English in every language (LOCALIZATION.md).
export function buyHref(pack) {
  const subject = `Buy the ${pack.words.toLocaleString("en-US")}-word pack ($${pack.price})`;
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
