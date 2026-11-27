import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api, track, trackCancelledCheckout } from "../api";
import { useAuth } from "../context/AuthContext";
import { PACKS, BUY_EMAIL, FREE_WORDS, SIGNUP_CREDIT, buy, aboutPages, perThousand, wordsAndPages } from "../pricing";
import { formatMoney } from "../i18n/format";
import { Link } from "../i18n/routing";
import { TrustStrip } from "./Upload";

// The three packs as cards with a buy button each. `fits`: the smallest pack that covers the
// file in hand, marked so the visitor doesn't have to do the math. `place` names where the
// prices are shown, and `words` the credits the file needs, for the buying funnel.
export function PackGrid({ jobId, fits, place, words }) {
  const { t } = useTranslation();
  const [checkout, setCheckout] = useState(null);
  const [busy, setBusy] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.checkoutConfig().then((c) => setCheckout(c.enabled)).catch(() => setCheckout(false));
  }, []);

  useEffect(() => {
    if (place) track("offer_shown", place, { jobId, words: words ?? undefined, fits: fits?.words });
  }, [place, jobId, words, fits?.words]);

  async function onBuy(pack) {
    setBusy(pack.words);
    setFailed(false);
    try {
      await buy(pack, jobId, place);
    } catch {
      setFailed(true);
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
              {marked && <span className="wx-badge wx-badge--success mb-2 self-start">{t("packs.covers")}</span>}
              <span className="text-[26px] font-medium leading-none tracking-[-0.4px]">{formatMoney(pack.price)}</span>
              <span className="mt-2 text-[13px] font-medium">{t("units.words", { words: pack.words })}</span>
              <span className="text-[11px] text-brand-500">{t("packs.pages", { about: aboutPages(pack.words) })}</span>
              <span className="mt-1 text-[11px] text-brand-500">{perThousand(pack)}</span>
              <button
                type="button"
                onClick={() => onBuy(pack)}
                disabled={busy != null}
                className={`wx-button mt-4 w-full ${marked || (!fits && pack.words === PACKS[1].words) ? "wx-button--primary" : ""}`}
              >
                {busy === pack.words ? t("packs.opening") : t("packs.buyFor", { price: formatMoney(pack.price) })}
              </button>
            </li>
          );
        })}
      </ul>
      {failed && <p className="wx-error mt-2 text-xs">{t("common.checkoutFailed")}</p>}
      <p className="mt-3 text-[11px] leading-relaxed text-brand-500">
        {t("packs.howCredits", { file: 2000, languages: 2, credits: 4000 })}
        {checkout === false && (
          <>
            {" "}
            <Trans i18nKey="packs.byEmail" values={{ email: BUY_EMAIL }} components={{ a: <a href={`mailto:${BUY_EMAIL}`} className="underline" dir="ltr" /> }} />
          </>
        )}
      </p>
    </div>
  );
}

export default function Pricing() {
  const { t } = useTranslation();
  const { user, creditBalance } = useAuth();
  useEffect(() => trackCancelledCheckout(), []);
  return (
    <section className="mx-auto max-w-2xl">
      <div className="rounded-[10px] border border-brand-200 bg-white p-6 sm:p-8">
        <h1 className="text-[29px] font-medium leading-tight tracking-[-0.4px]">{t("pricing.title")}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-brand-500">{t("pricing.intro")}</p>
        {user ? (
          creditBalance != null && (
            <p className="mt-5 rounded-[7px] bg-[#f5f7f9] px-4 py-3 text-[13px]">
              <Trans
                i18nKey="pricing.balance"
                values={{ words: creditBalance, about: creditBalance > 0 ? aboutPages(creditBalance) : "", hasPages: creditBalance > 0 ? "yes" : "no" }}
                components={{ b: <span className="font-medium" />, muted: <span className="text-brand-500" /> }}
              />
            </p>
          )
        ) : (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[7px] bg-[#e7f5ec] px-4 py-3.5">
            <div className="min-w-0 flex-1 basis-[260px]">
              <p className="text-[13px] font-medium text-[#176b45]">{t("common.newHere", { amount: formatMoney(SIGNUP_CREDIT.dollars) })}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[#24543a]">{t("pricing.newHereBody", { amount: wordsAndPages(SIGNUP_CREDIT.words) })}</p>
            </div>
            <Link to="/login" className="wx-button wx-button--primary wx-button--compact shrink-0">
              {t("pricing.signUp")}
            </Link>
          </div>
        )}
        <div className="mt-6">
          <PackGrid place="pricing" />
        </div>
        <p className="mt-2 text-[11px] text-brand-500">{t("pricing.freeDaily", { amount: wordsAndPages(FREE_WORDS) })}</p>
      </div>
      <TrustStrip />
    </section>
  );
}
