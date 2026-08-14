import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

const BADGE = {
  delivered: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-500",
  over_free_limit: "bg-amber-100 text-amber-700",
  needs_credits: "bg-amber-100 text-amber-700",
};

export default function Jobs() {
  const { user, loading } = useAuth();
  const [jobs, setJobs] = useState(null);

  useEffect(() => {
    if (user) api.listJobs().then((d) => setJobs(d.jobs));
  }, [user]);

  if (loading) return <p className="text-slate-500">Loading…</p>;
  if (!user)
    return (
      <p>
        <Link to="/login" className="text-brand-600 underline">
          Sign in
        </Link>{" "}
        to see your jobs.
      </p>
    );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">My jobs</h1>
      {!jobs ? (
        <p className="text-slate-500">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="text-slate-500">
          No jobs yet.{" "}
          <Link to="/" className="text-brand-600 underline">
            Translate something
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link to={`/jobs/${j.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                <span>
                  <span className="font-medium">#{j.id}</span>{" "}
                  <span className="text-sm text-slate-500">
                    {j.sourceLocale} → {j.targetLocales.join(", ")}
                    {j.analyzedWords ? ` · ${j.analyzedWords.toLocaleString()} words` : ""}
                  </span>
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[j.status] || "bg-brand-100 text-brand-700"}`}>
                  {j.status.replace(/_/g, " ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
