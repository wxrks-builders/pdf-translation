import { useEffect, useState } from "react";
import { api, track, trackCancelledCheckout } from "../api";
import { PACKS, BUY_EMAIL, buy, pagesFor, perThousand } from "../pricing";
import { TrustStrip } from "./Upload";

// The three packs as cards with a buy button each. `fits`: the smallest pack that covers the
// file in hand, marked so the visitor doesn't have to do the math. `place` names where the
// prices are shown, and `words` the credits the file needs, for the buying funnel.
export function PackGrid({ jobId, fits, place, words }) {
  const [checkout, setCheckout] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.checkoutConfig().then((c) => setCheckout(c.enabled)).catch(() => setCheckout(false));
  }, []);

  useEffect(() => {
    if (place) track("offer_shown", place, { jobId, words: words ?? undefined, fits: fits?.words });
  }, [place, jobId, words, fits?.words]);

  async function onBuy(pack) {
    setBusy(pack.words);
    setError(null);
    try {
      await buy(pack, jobId, place);
    } catch {
      setError("Checkout didn't open. Try again in a moment.");
      setBusy(null);
    }
  }

  return (
    <div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {PACKS.map((pack) => {
          const marked = fits?.words === pack.words;
          return (
            <li key={pack.words} className={`flex flex-col rounded-md border px-4 py-4 ${marked ? "border-brand-600" : "border-brand-200"}`}>
              {marked && <span className="wx-badge wx-badge--success mb-2 self-start">Covers this file</span>}
              <span className="text-[26px] font-medium leading-none tracking-[-0.4px]">${pack.price}</span>
              <span className="mt-2 text-[13px] font-medium">{pack.words.toLocaleString("en-US")} words</span>
              <span className="text-[11px] text-brand-500">About {pagesFor(pack.words).toLocaleString("en-US")} pages</span>
              <span className="mt-1 text-[11px] text-brand-500">{perThousand(pack)}</span>
              <button
                type="button"
                onClick={() => onBuy(pack)}
                disabled={busy != null}
                className={`wx-button mt-4 w-full ${marked || (!fits && pack.words === PACKS[1].words) ? "wx-button--primary" : ""}`}
              >
                {busy === pack.words ? "Opening…" : `Buy for $${pack.price}`}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="wx-error mt-2 text-xs">{error}</p>}
      <p className="mt-3 text-[11px] leading-relaxed text-brand-500">
        Paid once, no subscription. One credit is one source word into one language, so a 2,000-word file into two
        languages uses 4,000.
        {checkout === false && (
          <>
            {" "}
            Online checkout is coming soon. Until then, a pack opens an email to{" "}
            <a href={`mailto:${BUY_EMAIL}`} className="underline">
              {BUY_EMAIL}
            </a>
            , and we add the words to your account.
          </>
        )}
      </p>
    </div>
  );
}

export default function Pricing() {
  useEffect(() => trackCancelledCheckout(), []);
  return (
    <section className="mx-auto max-w-2xl">
      <div className="rounded-[10px] border border-brand-200 bg-white p-6 sm:p-8">
        <h1 className="text-[29px] font-medium leading-tight tracking-[-0.4px]">Buy words</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-brand-500">
          Translate whole documents, into as many languages as you need. You keep the design-kept PDF, the Word file,
          and the tone you pick.
        </p>
        <div className="mt-6">
          <PackGrid place="pricing" />
        </div>
      </div>
      <TrustStrip />
    </section>
  );
}
