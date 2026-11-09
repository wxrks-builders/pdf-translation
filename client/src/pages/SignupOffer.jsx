import { useEffect, useState } from "react";
import { api, track } from "../api";
import { SIGNUP_CREDIT, wordsAndPages } from "../pricing";

// "Get $9 in credits when you sign up" (Rodrigo, 2026-11-09), on a guest's file over the free
// limit. An email field: the link it sends makes the account, adds the sign-up credit
// (server/services/signupCredit.js) and brings them back to `next`, this file.
// words: the credits the file needs, to say whether the credit covers all of it.
export default function SignupOffer({ jobId, words, next }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const credit = SIGNUP_CREDIT.words;
  const covers = words == null || words <= credit;

  useEffect(() => track("offer_shown", "signup", { jobId, words: words ?? undefined }), [jobId, words]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestLoginLink(email, next);
      setSent(true);
    } catch (err) {
      setError(err.code === "invalid_email" ? "Check the email address." : "The email didn't go out. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 rounded-[7px] bg-[#e7f5ec] px-5 py-4">
      <p className="text-[15px] font-medium text-[#176b45]">Get ${SIGNUP_CREDIT.dollars} in credits when you sign up</p>
      {sent ? (
        <>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#24543a]">
            We sent a link to {email}. It works for 15 minutes. Click it and your ${SIGNUP_CREDIT.dollars} in credits are ready:{" "}
            {wordsAndPages(credit)}.
          </p>
          <p className="mt-2 text-xs text-[#24543a]">The link brings you back to this file.</p>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#24543a]">
            {covers
              ? `That's ${wordsAndPages(credit)}, enough for this whole file. No card, no password: we email you a link.`
              : `That's ${wordsAndPages(credit)} toward this file. For the other ${wordsAndPages(words - credit)}, add a pack once you're in.`}
          </p>
          <form onSubmit={submit} className="mt-3.5 flex flex-wrap items-end gap-2">
            <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-[#24543a]">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                className="h-[38px] rounded-md border border-[#757d88] bg-white px-2.5 text-[13px] font-normal text-[#252a31]"
              />
            </label>
            <button type="submit" disabled={busy} className="wx-button wx-button--primary" style={{ minHeight: 38 }}>
              {busy ? "Sending…" : `Get $${SIGNUP_CREDIT.dollars} in credits`}
            </button>
          </form>
          {error && <p className="wx-error mt-2 text-xs">{error}</p>}
          {covers && words != null && (
            <p className="mt-2.5 text-[11px] leading-relaxed text-[#24543a]">
              Once you click the link, this file translates from your credits: {words.toLocaleString("en-US")} used,{" "}
              {wordsAndPages(credit - words)} left.
            </p>
          )}
        </>
      )}
    </div>
  );
}
