import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

// Who used the translator, for the people who run it (ADMIN_EMAILS on the server). Everyone
// else gets a 404 from the API and sees "Not found".
const RANGES = [1, 7, 30, 90];
const n = (x) => Number(x || 0).toLocaleString("en-US");
const when = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const PLACE = {
  over_limit: "Over the free limit",
  needs_credits: "Not enough credits",
  free_used: "Free document used",
  pricing: "Pricing page",
  account: "Account page",
  signup: "Sign-up credit offer",
  unknown: "Elsewhere",
};

const TONE = {
  Delivered: "wx-badge--success",
  "Over the free limit": "wx-badge--info",
  Failed: "wx-badge--danger",
  "No text found": "wx-badge--pending",
  "Needed more credits": "wx-badge--pending",
};

export default function Admin() {
  const { user, loading } = useAuth();
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);

  useEffect(() => {
    if (!user) return;
    setData(null);
    api.adminActivity(days).then(setData).catch((err) => setError(err.status === 404 ? "Not found." : err.message));
  }, [user, days]);

  if (loading) return <p className="text-brand-500">Loading…</p>;
  if (!user) {
    return (
      <p>
        <Link to="/login" className="underline">
          Sign in
        </Link>{" "}
        with an admin email.
      </p>
    );
  }
  if (error) return <p>{error}</p>;

  const t = data?.totals;
  return (
    <section className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-medium tracking-[-0.3px]">Who used the translator</h1>
          {t && (
            <p className="mt-1 text-[13px] text-brand-500">
              {t.uploads} uploads · {t.delivered} delivered · {t.overLimit} stopped at a price · {t.failed} failed · {t.signupCredits} sign-up credits given · {t.purchases} purchases
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={`wx-button wx-button--compact ${days === d ? "wx-button--primary" : ""}`}
            >
              {d === 1 ? "Last day" : `Last ${d} days`}
            </button>
          ))}
          <button
            type="button"
            className="wx-button wx-button--compact"
            onClick={async () => setSent((await api.adminSendDigest()).sent)}
          >
            Send the digest now
          </button>
        </div>
      </div>
      {sent && <p className="text-xs text-brand-500">Digest sent by {sent}.</p>}

      {data && (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[10px] border border-brand-200 bg-white p-4">
            <h2 className="text-[13px] font-medium">Prices shown</h2>
            {data.funnel.places.length ? (
              <table className="mt-2 w-full text-[12px]">
                <thead className="text-left text-[11px] text-brand-500">
                  <tr>
                    <th className="font-normal">Where</th>
                    <th className="font-normal">Saw it</th>
                    <th className="font-normal">Checkout</th>
                    <th className="font-normal">Back</th>
                    <th className="font-normal">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {data.funnel.places.map((p) => (
                    <tr key={p.place}>
                      <td>{PLACE[p.place] || p.place}</td>
                      <td>{p.shown}</td>
                      <td>{p.started}</td>
                      <td>{p.cancelled}</td>
                      <td>{p.paid}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-xs text-brand-500">Nothing recorded yet (counting since this page was added).</p>
            )}
            <p className="mt-2 text-[11px] text-brand-500">
              {data.funnel.freeLimitHits} uploads stopped by the day's free document.
              {data.checkouts && ` Stripe: ${data.checkouts.length} Checkouts opened, ${data.checkouts.filter((c) => c.paid).length} paid.`}
            </p>
          </div>
          <div className="rounded-[10px] border border-brand-200 bg-white p-4">
            <h2 className="text-[13px] font-medium">Emails</h2>
            <p className="mt-2 text-[12px]">
              {data.emails.leadPeople} left at the email step ({data.emails.newsOptIns} want product news)
              <br />
              {data.emails.accounts} accounts made
              <br />
              {data.totals.purchases} purchases
            </p>
          </div>
          <div className="rounded-[10px] border border-brand-200 bg-white p-4">
            <h2 className="text-[13px] font-medium">Did it work?</h2>
            <p className="mt-2 text-[12px]">
              {data.totals.thumbsUp} yes · {data.totals.thumbsDown} not really
            </p>
            <ul className="mt-2 space-y-1 text-[11px] text-brand-500">
              {data.feedback
                .filter((f) => f.comment)
                .slice(0, 6)
                .map((f) => (
                  <li key={f.jobId + f.source}>
                    {f.rating === "up" ? "Yes" : "Not really"} ·{" "}
                    <Link to={`/jobs/${f.jobId}`} className="underline">
                      {f.file || f.jobId}
                    </Link>
                    : “{f.comment}”
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}

      {!data ? (
        <p className="text-brand-500">Loading…</p>
      ) : !data.jobs.length ? (
        <p className="text-brand-500">Nobody uploaded anything in this period.</p>
      ) : (
        <div className="wx-table-wrap rounded-[10px] border border-brand-200 bg-white">
          <table className="wx-table">
            <thead>
              <tr>
                <th>When</th>
                <th>File</th>
                <th>Languages</th>
                <th className="wx-numeric">Words</th>
                <th>Result</th>
                <th>Score</th>
                <th>Who</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j.id}>
                  <td className="whitespace-nowrap text-brand-500">{when(j.at)}</td>
                  <td className="max-w-[16rem]">
                    <Link to={`/jobs/${j.id}`} className="block truncate underline" title={j.file}>
                      {j.file}
                    </Link>
                    {j.scannedPages > 0 && <span className="text-[11px] text-brand-500">Scan, {j.scannedPages} pages</span>}
                  </td>
                  <td className="text-brand-500">
                    {j.from} → {j.to.join(", ")}
                  </td>
                  <td className="wx-numeric">{j.words != null ? n(j.words) : "–"}</td>
                  <td>
                    <span className={`wx-badge ${TONE[j.status] || ""}`}>{j.status}</span>
                    {j.problem && <span className="mt-1 block max-w-[14rem] truncate text-[11px] text-brand-500" title={j.problem}>{j.problem}</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    {j.scores.map((s) => `${Math.round(s.score * 100)}%`).join(", ") || "–"}
                  </td>
                  <td className="text-brand-500">
                    {j.email || "No email yet"}
                    <span className="block text-[11px]">{j.tier}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.purchases?.length > 0 && (
        <div className="rounded-[10px] border border-brand-200 bg-white p-4">
          <h2 className="text-[15px] font-medium">Purchases</h2>
          <ul className="mt-2 space-y-1 text-[13px]">
            {data.purchases.map((p) => (
              <li key={p.at + p.email}>
                {when(p.at)} · {n(p.words)} words{p.amount ? ` for ${p.amount}` : ""} · {p.email}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
