import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";

export default function Login() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState(null);
  const [error, setError] = useState(params.get("error") === "expired" ? "That link expired or was already used. Request a new one." : null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestLoginLink(email);
      setSent(true);
      if (res.devLoginUrl) setDevLink(res.devLoginUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-slate-600">No password — we'll email you a sign-in link. New here? The same link creates your account.</p>
      </div>

      {sent ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
          <p className="font-medium">Check your inbox</p>
          <p className="mt-1 text-sm text-slate-600">We sent a sign-in link to {email}. It expires in 15 minutes.</p>
          {devLink && (
            <p className="mt-3 text-xs text-slate-400">
              Dev mode:{" "}
              <a className="text-brand-600 underline" href={devLink}>
                sign in now
              </a>
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
          <label className="block">
            <span className="text-sm font-medium">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button disabled={busy} className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {busy ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
      )}
    </div>
  );
}
