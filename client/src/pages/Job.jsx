import { useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { api } from "../api";

const ACTIVE = ["created", "uploading", "analyzing", "approving", "translating"];

const STATUS_COPY = {
  created: "Preparing…",
  uploading: "Uploading your documents…",
  analyzing: "Counting words…",
  approving: "Starting translation…",
  translating: "Translating, usually just a few minutes…",
  delivered: "Done! Download your translations below.",
  failed: "Something went wrong.",
  cancelled: "Cancelled.",
  over_free_limit: "Over the free-tier word limit.",
  needs_credits: "Not enough credits.",
  no_text: "We couldn't find any text to translate.",
};

const STEPS = ["uploading", "analyzing", "translating", "delivered"];

const DEMO_URL =
  "https://wxrks.com/demo?utm_source=translate.wxrks.com&utm_medium=referral&utm_campaign=free-translator&utm_content=over-limit";

const norm = (code) => String(code || "").toLowerCase().replace(/[-_]/g, "");

export default function Job() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const k = params.get("k"); // from the files email: works on any device
  const q = k ? `?k=${encodeURIComponent(k)}` : "";
  const [job, setJob] = useState(null);
  const [names, setNames] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .languages()
      .then((d) => setNames(Object.fromEntries(d.languages.map((l) => [norm(l.code), l.name]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let timer;
    async function load() {
      try {
        const j = await api.getJob(id, k);
        setJob(j);
        if (ACTIVE.includes(j.status)) timer = setTimeout(load, 3000);
      } catch (err) {
        setError(err.status === 404 ? "Job not found." : err.message);
      }
    }
    load();
    return () => clearTimeout(timer);
  }, [id, k]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!job) return <p className="text-slate-500">Loading…</p>;

  const nameOf = (loc) => names[norm(loc)] || loc;
  const stepIndex =
    job.status === "delivered" ? STEPS.length : Math.max(0, STEPS.indexOf(job.status));
  const byLocale = {};
  for (const d of job.deliverables) (byLocale[d.locale] ||= []).push(d);
  const hasDesignPdf = job.deliverables.some((d) => d.variant?.startsWith("pdf-"));
  const delivered = job.status === "delivered";
  const gated = job.tier === "free" && !job.unlocked;

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

      {job.status === "over_free_limit" ? (
        <OverLimit words={job.analyzedWords} />
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-medium">{delivered && gated ? "Done! Your translation is ready." : STATUS_COPY[job.status] || job.status}</p>
          {job.analyzedWords != null && (
            <p className="mt-1 text-sm text-slate-600">
              {job.analyzedWords.toLocaleString()} source words × {job.targetLocales.length} language
              {job.targetLocales.length > 1 ? "s" : ""}
              {job.creditsCharged ? ` = ${job.creditsCharged.toLocaleString()} credits` : ""}
            </p>
          )}
          {job.error && <p className="mt-1 text-sm text-red-600">{job.error}</p>}

          {job.status === "no_text" && (
            <p className="mt-2 text-sm text-slate-600">
              Scanned pages are pictures of text, and we can't read those yet. Try a file where you can select the
              text. This one doesn't count as your free document.
            </p>
          )}
          {job.status === "needs_credits" && (
            <div className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              This job needs {job.timeline?.findLast?.((e) => e.event === "needs_credits")?.detail?.required?.toLocaleString?.() || "more"}{" "}
              credits. Plans start at $99/year for 100,000 words.{" "}
              <Link to="/account" className="underline">
                See your account
              </Link>
              .
            </div>
          )}

          {ACTIVE.includes(job.status) && job.tier === "free" && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              {job.unlockedEmail ? (
                <p className="text-sm text-slate-600">
                  {job.emailDelivery
                    ? `We'll email the files to ${job.unlockedEmail} when they're ready. You can close this tab.`
                    : "Your downloads will appear here when the files are ready."}
                </p>
              ) : (
                job.emailDelivery && (
                  <EmailForm
                    job={job}
                    k={k}
                    onDone={setJob}
                    intro="Want the files by email? Leave your address and we'll send the links when they're ready."
                    cta="Email me the files"
                  />
                )
              )}
            </div>
          )}
        </div>
      )}

      {job.previews?.length > 0 && (
        <div className="space-y-3">
          {job.previews.slice(0, 1).map((p) => (
            <Preview key={p.deliverableId} job={job} preview={p} language={nameOf(p.locale)} q={q} />
          ))}
        </div>
      )}

      {delivered && gated && (
        <div className="rounded-lg border border-brand-200 bg-white p-5 shadow-card">
          <h2 className="text-lg font-semibold">
            {job.previews?.length ? "That's page 1. Where should we send the files?" : "Where should we send the files?"}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {job.emailDelivery
              ? "Your downloads open right away, and we email you the links so you can find them later."
              : "Your downloads open right away."}
          </p>
          <ul className="mt-3 space-y-1 text-sm text-slate-500">
            {job.targetLocales.map((loc) => (
              <li key={loc}>
                <span className="font-medium text-slate-700">{nameOf(loc)}</span> ·{" "}
                {(byLocale[norm(loc)] || []).map((d) => d.filename).join(", ")}
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <EmailForm job={job} k={k} onDone={setJob} cta="Get my files" />
          </div>
        </div>
      )}

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

      {!gated && Object.keys(byLocale).length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-slate-500">Downloads</h2>
          {delivered && job.tier === "free" && job.unlockedEmail && job.emailDelivery && (
            <p className="mb-3 text-sm text-slate-600">We also sent the links to {job.unlockedEmail}.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {job.targetLocales.map((loc) => {
              const items = byLocale[norm(loc)] || byLocale[loc] || [];
              return (
                <div key={loc} className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="font-medium">{nameOf(loc)}</p>
                  {items.length ? (
                    <>
                      <ul className="mt-2 space-y-1 text-sm">
                        {items.map((d) => (
                          <li key={d.id}>
                            <a href={`/api/jobs/${job.id}/files/${d.id}${q}`} className="text-brand-600 hover:underline">
                              {d.filename}
                            </a>
                          </li>
                        ))}
                      </ul>
                      {items.length > 1 && (
                        <a
                          href={`/api/jobs/${job.id}/download/${norm(loc)}${q}`}
                          className="mt-3 inline-block rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
                        >
                          Download all ({nameOf(loc)})
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

function Preview({ job, preview, language, q }) {
  const src = (side) => `/api/jobs/${job.id}/preview/${preview.deliverableId}/${side}${q}`;
  return (
    <div className="grid grid-cols-2 gap-3">
      {[
        ["original", "Original"],
        ["translated", language],
      ].map(([side, label]) => (
        <figure key={side} className="rounded-lg border border-slate-200 bg-white p-2">
          {/* full width, cropped at the bottom: the top of page 1 is enough to judge it */}
          <div className="max-h-56 overflow-hidden rounded border border-slate-100 sm:max-h-72">
            <img
              src={src(side)}
              alt={side === "original" ? "Page 1 of your original document" : `Page 1 translated into ${language}`}
              className="block w-full"
            />
          </div>
          <figcaption className="mt-2 text-center text-xs text-slate-500">
            {label}, page 1
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function EmailForm({ job, k, onDone, intro, cta }) {
  const [email, setEmail] = useState("");
  const [news, setNews] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await api.unlockJob(job.id, { email, marketingOptIn: news }, k));
    } catch (err) {
      setError(err.code === "invalid_email" ? "Check the email address." : err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {intro && <p className="text-sm text-slate-600">{intro}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor={`email-${job.id}`}>
          Email
        </label>
        <input
          id={`email-${job.id}`}
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm sm:flex-1"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "One moment…" : cta}
        </button>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={news} onChange={(e) => setNews(e.target.checked)} className="mt-0.5" />
        <span>Also send me wxrks product news, about once a month.</span>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-slate-400">We use your email to send these files. Product news only if you tick the box.</p>
    </form>
  );
}

function OverLimit({ words }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">
          This document has {words != null ? words.toLocaleString() : "more than 1,000"} words
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          The free translator covers documents up to 1,000 words. Nothing was translated, so this one doesn't count as
          your free document.
        </p>
        <Link
          to="/"
          className="mt-4 inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Translate a shorter document
        </Link>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
        <p className="font-medium">Translating long documents for a team?</p>
        <p className="mt-1 text-sm text-slate-600">
          wxrks translates whole documents with your glossary, your translation memory, and your reviewers.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <a href={DEMO_URL} className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium hover:border-brand-500">
            Book a demo
          </a>
          <Link to="/login" className="text-brand-600 underline">
            Or sign in to use credits ($99 a year for 100,000 words)
          </Link>
        </div>
      </div>
    </div>
  );
}
