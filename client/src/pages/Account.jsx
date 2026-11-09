import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { pagesFor } from "../pricing";
import { PackGrid } from "./Pricing";

export default function Account() {
  const { user, loading } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (user) api.credits().then(setData);
  }, [user]);

  if (loading) return <p className="text-slate-500">Loading…</p>;
  if (!user)
    return (
      <p>
        <Link to="/login" className="text-brand-600 underline">
          Sign in
        </Link>{" "}
        to see your account.
      </p>
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="mt-1 text-sm text-slate-600">{user.email}</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-500">Credit balance</p>
        <p className="text-3xl font-semibold">{data ? data.balance.toLocaleString() : "…"}</p>
        <p className="mt-2 text-sm text-slate-600">
          1 credit = 1 source word into 1 language
          {data?.balance > 0 ? `, so about ${pagesFor(data.balance).toLocaleString("en-US")} pages into one language.` : "."}
        </p>
      </div>

      <div id="buy" className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-medium">Buy words</h2>
        <PackGrid place="account" />
      </div>

      {data?.ledger?.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-slate-500">History</h2>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
            {data.ledger.map((row) => (
              <li key={row.id} className="flex items-center justify-between px-4 py-2">
                <span>
                  <span className="capitalize">{row.kind}</span>
                  {row.job_id && (
                    <Link to={`/jobs/${row.job_id}`} className="ml-2 text-brand-600 hover:underline">
                      #{row.job_id}
                    </Link>
                  )}
                  {row.note && <span className="ml-2 text-slate-400">{row.note}</span>}
                </span>
                <span className={row.delta > 0 ? "text-green-600" : "text-slate-700"}>
                  {row.delta > 0 ? "+" : ""}
                  {row.delta.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
