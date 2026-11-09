import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { aboutPages } from "../pricing";
import { PackGrid } from "./Pricing";

const KIND = { purchase: "Purchase", charge: "Translation", refund: "Refund", grant: "Added by wxrks", signup: "Sign-up credit" };
const day = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function Account() {
  const { user, loading } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (user) api.credits().then(setData);
  }, [user]);

  if (loading) return <p className="text-brand-500">Loading…</p>;
  if (!user)
    return (
      <p>
        <Link to="/login" className="underline">
          Sign in
        </Link>{" "}
        to see your account.
      </p>
    );

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-[22px] font-medium tracking-[-0.3px]">Account</h1>
        <p className="mt-1 text-[13px] text-brand-500">{user.email}</p>
      </div>

      <div className="rounded-[10px] border border-brand-200 bg-white px-6 py-5">
        <p className="text-xs text-brand-500">Words in your account</p>
        <p className="mt-1 text-[29px] font-medium leading-tight tracking-[-0.4px]">
          {data ? data.balance.toLocaleString("en-US") : "…"}
          {data?.balance > 0 && <span className="ml-2 text-[15px] font-normal tracking-normal text-brand-500">({aboutPages(data.balance)})</span>}
        </p>
        <p className="mt-2 text-xs text-brand-500">One credit is one source word into one language.</p>
      </div>

      {data?.ledger?.length > 0 && (
        <div className="overflow-hidden rounded-[10px] border border-brand-200 bg-white">
          <h2 className="border-b border-brand-200 px-5 py-3 text-xs font-medium text-brand-500">History</h2>
          <ul className="divide-y divide-brand-200 text-[13px]">
            {data.ledger.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="font-medium">{row.kind === "signup" ? row.note || KIND.signup : KIND[row.kind] || row.kind}</span>
                  {row.kind !== "signup" && row.note && <span className="text-brand-500"> · {row.note}</span>}
                  {row.job_id && (
                    <Link to={`/jobs/${row.job_id}`} className="ml-2 text-brand-500 underline">
                      #{row.job_id}
                    </Link>
                  )}
                  <span className="text-brand-500"> · {day(row.created_at)}</span>
                </span>
                <span className={`shrink-0 font-medium ${row.delta > 0 ? "text-[#176b45]" : ""}`}>
                  {row.delta > 0 ? "+" : ""}
                  {row.delta.toLocaleString("en-US")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div id="buy" className="rounded-[10px] border border-brand-200 bg-white px-6 py-5">
        <h2 className="mb-3 text-[13px] font-medium">Buy words</h2>
        <PackGrid place="account" />
      </div>
    </section>
  );
}
