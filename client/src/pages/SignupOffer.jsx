import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, track } from "../api";
import i18n from "../i18n";
import { isolate } from "../i18n/format";

// The one action on a guest's file over the free limit: an email, which sends the sign-in link
// that makes the account, adds the sign-up credit (server/services/signupCredit.js) and brings
// them back to `next`, this file, where it translates (Rodrigo, 2026-11-21: "give a straight line
// to the visitor"; versions 3 and 4 of https://claude.ai/artifact/DJecEvPSpxZbwscREcUUKG). The
// address is also kept for this file's one reminder (services/reminders.js). The inline form and,
// on a phone, the sticky sheet share one state, so the email typed in one is the one sent.

export function useSignupOffer({ jobId, next, words, enabled = true }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (enabled) track("offer_shown", "signup", { jobId, words: words ?? undefined });
  }, [jobId, words, enabled]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestLoginLink(email, next);
      setSent(true);
    } catch (err) {
      // Stored as a key, so the message follows a language switch.
      setError(err.code === "invalid_email" ? "errors.invalid_email" : "offer.sendFailed");
    } finally {
      setBusy(false);
    }
  }

  return { email, setEmail, busy, sent, error: error && i18n.t(error), submit };
}

export function Sent({ offer }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-[#c8e8d4] bg-[#e7f5ec] px-5 py-4" role="status">
      <p className="text-[15px] font-medium text-[#176b45]">{t("offer.sentTitle")}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-[#24543a]">{t("offer.sentBody", { email: isolate(offer.email), minutes: 15 })}</p>
    </div>
  );
}

// The inline form, under the headline.
export default function OfferForm({ offer, cta, id = "offer-email", formRef, stacked = false }) {
  const { t } = useTranslation();
  if (offer.sent) return <Sent offer={offer} />;
  return (
    <form ref={formRef} onSubmit={offer.submit} className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[13px] font-medium">
        {t("offer.emailLabel")}
      </label>
      <div className={stacked ? "flex flex-col gap-2.5" : "flex flex-wrap gap-2.5"}>
        <input
          id={id}
          type="email"
          required
          dir="ltr"
          value={offer.email}
          onChange={(e) => offer.setEmail(e.target.value)}
          placeholder={t("common.emailPlaceholder")}
          autoComplete="email"
          className={`h-[54px] rounded-[10px] border-2 border-[#252a31] bg-white px-4 text-[16px] ${stacked ? "w-full" : "min-w-[220px] flex-1"}`}
        />
        <button type="submit" disabled={offer.busy} className={`wx-button wx-button--primary w-full px-6 text-[16px] font-semibold ${stacked ? "" : "sm:w-auto"}`} style={{ minHeight: 54, borderRadius: 10 }}>
          {offer.busy ? t("common.sending") : cta}
        </button>
      </div>
      <p className="text-xs text-brand-500">{t("offer.noCard")}</p>
      {offer.error && <p className="wx-error text-xs">{offer.error}</p>}
    </form>
  );
}

// On a phone, the offer stays at the bottom while the inline form is out of sight (scrolled to
// the sample). Hidden on a computer, once sent, and while the inline form is on screen.
export function StickyOffer({ offer, title, note, cta, watchRef }) {
  const { t } = useTranslation();
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = watchRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [watchRef, offer.sent]);
  if (offer.sent || inView) return null;
  return (
    <div className="wx-sticky-offer" role="region" aria-label={t("offer.stickyLabel")}>
      <p className="text-[17px] font-semibold leading-6">{title}</p>
      <p className="mt-0.5 text-[13px] leading-[19px] text-brand-500">{note}</p>
      <form onSubmit={offer.submit} className="mt-3 flex flex-col gap-2">
        <label htmlFor="sticky-email" className="sr-only">
          {t("offer.emailLabel")}
        </label>
        <input
          id="sticky-email"
          type="email"
          required
          dir="ltr"
          value={offer.email}
          onChange={(e) => offer.setEmail(e.target.value)}
          placeholder={t("common.emailPlaceholder")}
          autoComplete="email"
          className="h-12 rounded-lg border border-[#757d88] bg-white px-3 text-base"
        />
        <button type="submit" disabled={offer.busy} className="wx-button wx-button--primary text-[15px] font-medium" style={{ minHeight: 48 }}>
          {offer.busy ? t("common.sending") : cta}
        </button>
        {offer.error && <p className="wx-error text-xs">{offer.error}</p>}
      </form>
    </div>
  );
}
