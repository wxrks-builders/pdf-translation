import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

// Where Stripe Checkout sends the buyer back. The words arrive with Stripe's webhook, usually
// within seconds, so this page asks until they're there.
const WAIT_MS = 60 * 1000;

export default function Thanks() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [purchase, setPurchase] = useState(null);
  const [late, setLate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId) return;
    const started = Date.now();
    let timer;
    async function load() {
      try {
        const p = await api.checkoutSession(sessionId);
        if (p.status === "paid") {
          setPurchase(p);
          if (p.signedIn) refresh();
          return;
        }
      } catch {
        // keep asking
      }
      if (Date.now() - started > WAIT_MS) setLate(true);
      else timer = setTimeout(load, 2000);
    }
    load();
    return () => clearTimeout(timer);
  }, [sessionId, refresh]);

  async function translateNow() {
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await api.rerunJob(purchase.jobId);
      navigate(`/jobs/${jobId}`);
    } catch (err) {
      setError(err.status === 404 ? "Upload the file again to translate it." : err.message);
      setBusy(false);
    }
  }

  async function sendLink() {
    setBusy(true);
    try {
      await api.requestLoginLink(purchase.email);
      setLinkSent(true);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  let body;
  if (!sessionId) body = <p className="text-[15px]">We couldn't find this payment.</p>;
  else if (!purchase && late) {
    body = (
      <>
        <h1 className="text-[22px] font-medium tracking-[-0.3px]">Your payment went through</h1>
        <p className="mt-2 text-[13px] text-brand-500">
          The words are taking longer than usual to reach your account. Reply to the receipt email and a person will
          add them.
        </p>
      </>
    );
  } else if (!purchase) {
    body = (
      <>
        <h1 className="text-[22px] font-medium tracking-[-0.3px]">Adding your words…</h1>
        <div className="wx-progress mt-4" role="progressbar" aria-label="Adding your words">
          <span style={{ width: "60%" }} />
        </div>
      </>
    );
  } else {
    const words = `${purchase.words.toLocaleString("en-US")} words`;
    body = (
      <>
        <span className="wx-badge wx-badge--success">Paid</span>
        <h1 className="mt-3 text-[22px] font-medium tracking-[-0.3px]">{words} are in your account</h1>
        {purchase.signedIn ? (
          <>
            <p className="mt-2 text-[13px] text-brand-500">Signed in as {purchase.email}.</p>
            {purchase.jobId ? (
              <button type="button" onClick={translateNow} disabled={busy} className="wx-button wx-button--primary mt-5" style={{ minHeight: 40 }}>
                {busy ? "Starting…" : "Translate my file now"}
              </button>
            ) : (
              <Link to="/" className="wx-button wx-button--primary mt-5" style={{ minHeight: 40 }}>
                Translate a document
              </Link>
            )}
          </>
        ) : (
          <>
            <p className="mt-2 text-[13px] text-brand-500">
              {purchase.email} already has an account, so sign in with it to use the words.
            </p>
            {linkSent ? (
              <p className="mt-5 text-[13px]">We sent a sign-in link to {purchase.email}.</p>
            ) : (
              <button type="button" onClick={sendLink} disabled={busy} className="wx-button wx-button--primary mt-5" style={{ minHeight: 40 }}>
                Email me a sign-in link
              </button>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <section className="mx-auto max-w-xl">
      <div className="rounded-[10px] border border-brand-200 bg-white p-6 sm:p-8">
        {body}
        {error && <p className="wx-error mt-3 text-xs">{error}</p>}
      </div>
    </section>
  );
}
