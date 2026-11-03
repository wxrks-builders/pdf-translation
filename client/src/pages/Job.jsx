import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

const ACTIVE = ["created", "uploading", "analyzing", "approving", "translating"];

const STATUS_COPY = {
  created: "Preparing…",
  uploading: "Uploading your documents…",
  analyzing: "Counting words…",
  approving: "Starting translation…",
  translating: "Translating — usually just a few minutes…",
  delivered: "Done! Download your translations below.",
  failed: "Something went wrong.",
  cancelled: "Cancelled.",
  over_free_limit: "Over the free-tier word limit.",
  needs_credits: "Not enough credits.",
};

const STEPS = ["uploading", "analyzing", "translating", "delivered"];

export default function Job() {
  const { id } = useParams();
  const { user } = useAuth();
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let timer;
    async function load() {
      try {
        const j = await api.getJob(id);
        setJob(j);
        if (ACTIVE.includes(j.status)) timer = setTimeout(load, 3000);
      } catch (err) {
        setError(err.status === 404 ? "Job not found." : err.message);
      }
    }
    load();
    return () => clearTimeout(timer);
  }, [id]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!job) return <p className="text-slate-500">Loading…</p>;

  const stepIndex =
    job.status === "delivered" ? STEPS.length : Math.max(0, STEPS.indexOf(job.status));
  const byLocale = {};
  for (const d of job.deliverables) (byLocale[d.locale] ||= []).push(d);
  const hasDesignPdf = job.deliverables.some((d) => d.variant?.startsWith("pdf-"));

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Translation job</h1>
        <span className="text-sm text-slate-400">#{job.id}</span>
      </div>

      {/* progress steps */}
      <ol className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                i < stepIndex ? "bg-brand-600 text-white" : i === stepIndex && ACTIVE.includes(job.status) ? "animate-pulse bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-400"
              }`}
            >
              {i < stepIndex ? "✓" : i + 1}
            </span>
            <span className="hidden text-xs capitalize text-slate-500 sm:block">{s}</span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-slate-200" />}
          </li>
        ))}
      </ol>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="font-medium">{STATUS_COPY[job.status] || job.status}</p>
        {job.analyzedWords != null && (
          <p className="mt-1 text-sm text-slate-600">
            {job.analyzedWords.toLocaleString()} source words × {job.targetLocales.length} language
            {job.targetLocales.length > 1 ? "s" : ""}
            {job.creditsCharged ? ` = ${job.creditsCharged.toLocaleString()} credits` : ""}
          </p>
        )}
        {job.error && <p className="mt-1 text-sm text-red-600">{job.error}</p>}

        {job.status === "over_free_limit" && (
          <p className="mt-2 text-sm text-slate-600">
            Free documents are limited to 1,000 words.{" "}
            <Link to="/login" className="text-brand-600 underline">
              Sign in
            </Link>{" "}
            to translate longer documents with credits.
          </p>
        )}
        {job.status === "needs_credits" && (
          <div className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            This job needs {job.timeline?.findLast?.((e) => e.event === "needs_credits")?.detail?.required?.toLocaleString?.() || "more"}{" "}
            credits. Plans start at $99/year for 100,000 words —{" "}
            <Link to="/account" className="underline">
              see your account
            </Link>
            .
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-slate-500">Files</h2>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {job.files.map((f) => (
            <li key={f.id} className="px-4 py-2 text-sm">
              {f.name} <span className="text-slate-400">({(f.sizeBytes / 1024).toFixed(0)} KB)</span>
            </li>
          ))}
        </ul>
      </div>

      {Object.keys(byLocale).length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-slate-500">Downloads</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {job.targetLocales.map((loc) => {
              const norm = loc.toLowerCase().replace(/[-_]/g, "");
              const items = byLocale[norm] || byLocale[loc] || [];
              return (
                <div key={loc} className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="font-medium">{loc}</p>
                  {items.length ? (
                    <>
                      <ul className="mt-2 space-y-1 text-sm">
                        {items.map((d) => (
                          <li key={d.id}>
                            <a href={`/api/jobs/${job.id}/files/${d.id}`} className="text-brand-600 hover:underline">
                              {d.filename}
                            </a>
                          </li>
                        ))}
                      </ul>
                      {items.length > 1 && (
                        <a
                          href={`/api/jobs/${job.id}/download/${norm}`}
                          className="mt-3 inline-block rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
                        >
                          Download all ({loc})
                        </a>
                      )}
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">Still translating…</p>
                  )}
                </div>
              );
            })}
          </div>
          {hasDesignPdf && (
            <p className="mt-3 text-xs text-slate-500">
              Beta: the “design kept” PDF redraws the translation into your original pages in a similar
              font, and “page images” is the same thing as one picture per page. Check them before you
              share; the DOCX is the version to edit.
            </p>
          )}
        </div>
      )}

      {ACTIVE.includes(job.status) && (
        <button
          onClick={async () => setJob(await api.cancelJob(job.id))}
          className="text-sm text-slate-400 hover:text-red-500"
        >
          Cancel this job
        </button>
      )}
    </div>
  );
}
