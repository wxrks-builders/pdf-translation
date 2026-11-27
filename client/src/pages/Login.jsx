import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { SIGNUP_CREDIT, wordsAndPages } from "../pricing";
import { errorText } from "../i18n";
import { formatMoney, isolate } from "../i18n/format";

// Sign in or sign up: one email link does both. A new account starts with the sign-up credit
// (server/services/signupCredit.js), so the page says so while today's credits last.
export default function Login() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState(null);
  // A message key, so it follows a language switch; or a sentence already in the reader's language.
  const [error, setError] = useState(params.get("error") === "expired" ? { key: "login.expired" } : null);
  const [busy, setBusy] = useState(false);
  const [credit, setCredit] = useState(0);

  useEffect(() => {
    api.allowance().then((a) => setCredit(a.signupCredit || 0)).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestLoginLink(email, params.get("next") || undefined);
      setSent(true);
      if (res.devLoginUrl) setDevLink(res.devLoginUrl);
    } catch (err) {
      setError({ text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  const amount = formatMoney(SIGNUP_CREDIT.dollars);
  return (
    <section className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="text-[22px] font-medium tracking-[-0.3px]">{t("login.title")}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-brand-500">{t("login.intro")}</p>
      </div>

      {credit > 0 && !sent && (
        <div className="rounded-[7px] bg-[#e7f5ec] px-4 py-3.5">
          <p className="text-[13px] font-medium text-[#176b45]">{t("common.newHere", { amount })}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-[#24543a]">{t("login.newHereBody", { words: wordsAndPages(credit) })}</p>
        </div>
      )}

      {sent ? (
        <div className="rounded-[10px] border border-brand-200 bg-white p-6 text-center">
          <p className="text-[15px] font-medium">{t("offer.sentTitle")}</p>
          <p className="mt-1.5 text-[13px] text-brand-500">{t("login.sentBody", { email: isolate(email), minutes: 15 })}</p>
          {credit > 0 && <p className="mt-3 text-[13px] text-[#176b45]">{t("login.sentCredit", { amount, words: wordsAndPages(credit) })}</p>}
          {devLink && (
            <p className="mt-3 text-xs text-brand-500" lang="en" dir="ltr">
              Dev mode:{" "}
              <a className="underline" href={devLink}>
                sign in now
              </a>
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3.5 rounded-[10px] border border-brand-200 bg-white p-5">
          <label className="flex flex-col gap-1 text-xs font-medium">
            {t("common.emailLabel")}
            <input
              type="email"
              required
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("common.emailPlaceholder")}
              autoComplete="email"
              className="min-h-[38px] rounded-md border border-[#757d88] px-2.5 text-[13px] font-normal"
            />
          </label>
          {error && <p className="wx-error text-xs">{error.key ? t(error.key) : error.text}</p>}
          <button disabled={busy} className="wx-button wx-button--primary w-full" style={{ minHeight: 40 }}>
            {busy ? t("common.sending") : t("login.submit")}
          </button>
        </form>
      )}
    </section>
  );
}
