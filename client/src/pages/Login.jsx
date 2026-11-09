import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { SIGNUP_CREDIT, wordsAndPages } from "../pricing";

// Sign in or sign up: one email link does both. A new account starts with the sign-up credit
// (server/services/signupCredit.js), so the page says so while today's credits last.
export default function Login() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState(null);
  const [error, setError] = useState(params.get("error") === "expired" ? "That link expired or was already used. Request a new one." : null);
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
      setError(err.code === "invalid_email" ? "Check the email address." : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="text-[22px] font-medium tracking-[-0.3px]">Sign in or sign up</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-brand-500">No password. We email you a link that signs you in, or makes your account.</p>
      </div>

      {credit > 0 && !sent && (
        <div className="rounded-[7px] bg-[#e7f5ec] px-4 py-3.5">
          <p className="text-[13px] font-medium text-[#176b45]">New here? Get ${SIGNUP_CREDIT.dollars} in credits when you sign up</p>
          <p className="mt-0.5 text-xs leading-relaxed text-[#24543a]">That's {wordsAndPages(credit)}, in your account as soon as you click the link.</p>
        </div>
      )}

      {sent ? (
        <div className="rounded-[10px] border border-brand-200 bg-white p-6 text-center">
          <p className="text-[15px] font-medium">Check your inbox</p>
          <p className="mt-1.5 text-[13px] text-brand-500">We sent a link to {email}. It works for 15 minutes.</p>
          {credit > 0 && (
            <p className="mt-3 text-[13px] text-[#176b45]">
              New account? Click it and your ${SIGNUP_CREDIT.dollars} in credits are ready: {wordsAndPages(credit)}.
            </p>
          )}
          {devLink && (
            <p className="mt-3 text-xs text-brand-500">
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
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              className="h-[38px] rounded-md border border-[#757d88] px-2.5 text-[13px] font-normal"
            />
          </label>
          {error && <p className="wx-error text-xs">{error}</p>}
          <button disabled={busy} className="wx-button wx-button--primary w-full" style={{ minHeight: 40 }}>
            {busy ? "Sending…" : "Email me a link"}
          </button>
        </form>
      )}
    </section>
  );
}
