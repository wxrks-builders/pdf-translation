import { useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { api } from "../api";

const ACTIVE = ["created", "uploading", "analyzing", "approving", "translating"];

// The progress bar is honest about stages, not seconds: wxrks doesn't report a percentage.
const PROGRESS = { created: 5, uploading: 15, analyzing: 35, approving: 50, translating: 75 };

const STAGE_COPY = {
  created: "Getting your file ready",
  uploading: "Uploading your file",
  analyzing: "Counting words",
  approving: "Starting the translation",
  translating: "Translating",
};

const VARIANT_NOTE = {
  "pdf-design": "Looks like your original",
  "pdf-images": "One picture per page, prints the same everywhere",
};
const VARIANT_ORDER = { "pdf-design": 0, translation: 1, "pdf-images": 2 };

const DEMO_URL =
  "https://wxrks.com/demo?utm_source=translate.wxrks.com&utm_medium=referral&utm_campaign=free-translator&utm_content=over-limit";
const TEAM_URL =
  "https://wxrks.com/?utm_source=translate.wxrks.com&utm_medium=referral&utm_campaign=free-translator&utm_content=delivered";

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
        setError(err.status === 404 ? "We couldn't find this translation." : err.message);
      }
    }
    load();
    return () => clearTimeout(timer);
  }, [id, k]);

  if (error) return <Screen><p className="text-[15px]">{error}</p></Screen>;
  if (!job) return <Screen><p className="text-brand-500">Loading…</p></Screen>;

  const nameOf = (loc) => names[norm(loc)] || loc;
  const languages = job.targetLocales.map(nameOf).join(", ");
  const fileName = job.files[0]?.name || "Your document";
  const delivered = job.status === "delivered";
  const gated = job.tier === "free" && !job.unlocked;
  const byLocale = {};
  for (const d of job.deliverables) (byLocale[d.locale] ||= []).push(d);
  for (const list of Object.values(byLocale)) list.sort((a, b) => (VARIANT_ORDER[a.variant] ?? 9) - (VARIANT_ORDER[b.variant] ?? 9));
  const preview = job.previews?.[0];
  const bar = (
    <>
      <span className="min-w-0 truncate">{job.files.length > 1 ? `${job.files.length} files` : fileName}</span>
      <StatusBadge status={job.status} />
    </>
  );

  if (ACTIVE.includes(job.status)) {
    const pct = PROGRESS[job.status] ?? 10;
    return (
      <Screen bar={bar}>
        <h1 className="text-[22px] font-medium tracking-[-0.3px]">
          {job.status === "translating" ? `Translating into ${languages}` : STAGE_COPY[job.status]}
        </h1>
        <p className="mt-1 text-[13px] text-brand-500">Usually under a minute for a short document.</p>
        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="font-medium">
              {job.analyzedWords != null ? `${job.analyzedWords.toLocaleString()} words` : STAGE_COPY[job.status]}
            </span>
            <span className="text-brand-500">{pct}%</span>
          </div>
          <div className="wx-progress" role="progressbar" aria-label="Translation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}>
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
        <p className="mt-4 text-[11px] text-brand-500">Your file stays private and is deleted after 30 days.</p>

        {job.tier === "free" && job.emailDelivery && (
          <div className="mt-6 rounded-md border border-brand-200 bg-[#f7f8fa] p-4">
            {job.unlockedEmail ? (
              <p className="text-[13px]">We'll email the files to {job.unlockedEmail} when they're ready. You can close this tab.</p>
            ) : (
              <EmailForm
                job={job}
                k={k}
                onDone={setJob}
                intro="Don't want to wait? Leave your email and close the tab. We'll send the files when they're ready."
                cta="Email me the files"
                compact
              />
            )}
          </div>
        )}

        <button onClick={async () => setJob(await api.cancelJob(job.id))} className="mt-5 text-xs text-brand-500 underline hover:text-brand-600">
          Cancel
        </button>
      </Screen>
    );
  }

  if (job.status === "over_free_limit") return <OverLimit bar={bar} words={job.analyzedWords} />;

  if (!delivered) {
    return (
      <Screen bar={bar}>
        <h1 className="text-[22px] font-medium tracking-[-0.3px]">
          {job.status === "no_text" ? "We couldn't find any text to translate" : job.status === "cancelled" ? "Cancelled" : job.status === "needs_credits" ? "Not enough credits" : "Something went wrong"}
        </h1>
        <p className="mt-2 text-[13px] text-brand-500">
          {job.status === "no_text"
            ? "Scanned pages are pictures of text, and we can't read those yet. Try a file where you can select the text. This one doesn't count as your free document."
            : job.status === "needs_credits"
              ? "This job needs more credits than your account has. Plans start at $99 a year for 100,000 words."
              : job.status === "cancelled"
                ? "Nothing more will be translated for this job."
                : "The translation didn't finish. Try again, or reply to any of our emails and a person will look at it."}
        </p>
        <Link to={job.status === "needs_credits" ? "/account" : "/"} className="wx-button wx-button--primary mt-5" style={{ minHeight: 40 }}>
          {job.status === "needs_credits" ? "See your account" : "Translate another document"}
        </Link>
      </Screen>
    );
  }

  // Delivered, before the email: page 1, then where to send the files.
  if (gated) {
    return (
      <Screen bar={bar}>
        {preview && <Preview job={job} preview={preview} language={nameOf(preview.locale)} q={q} />}
        <h1 className={`${preview ? "mt-5" : ""} text-[22px] font-medium tracking-[-0.3px]`}>
          {preview ? "Page 1 is done. Where should we send the files?" : "Your translation is ready. Where should we send it?"}
        </h1>
        <p className="mt-1 text-[13px] text-brand-500">
          {job.emailDelivery
            ? "Your downloads open right away, and we email you the links so you can find them later."
            : "Your downloads open right away."}
        </p>
        <ul className="mt-3 space-y-1 text-xs text-brand-500">
          {job.targetLocales.map((loc) => (
            <li key={loc}>
              <span className="font-medium text-brand-600">{nameOf(loc)}</span> ·{" "}
              {(byLocale[norm(loc)] || []).map((d) => d.filename).join(", ")}
            </li>
          ))}
        </ul>
        <div className="mt-5">
          <EmailForm job={job} k={k} onDone={setJob} cta="Send me the files" />
        </div>
        <p className="mt-4 text-[11px] text-brand-500">Free: one document a day. No card, no subscription.</p>
      </Screen>
    );
  }

  // Delivered and open.
  return (
    <Screen bar={bar}>
      <h1 className="text-[22px] font-medium tracking-[-0.3px]">Your translation is ready</h1>
      {job.tier === "free" && job.unlockedEmail && job.emailDelivery && (
        <p className="mt-1 text-[13px] text-brand-500">We also sent the links to {job.unlockedEmail}.</p>
      )}
      {preview && (
        <div className="mt-5">
          <Preview job={job} preview={preview} language={nameOf(preview.locale)} q={q} />
        </div>
      )}
      <div className="mt-5 space-y-5">
        {job.targetLocales.map((loc) => {
          const items = byLocale[norm(loc)] || [];
          return (
            <div key={loc}>
              {job.targetLocales.length > 1 && <h2 className="mb-2 text-[15px] font-medium">{nameOf(loc)}</h2>}
              {items.length ? (
                <div className="space-y-2">
                  {items.map((d) => (
                    <a
                      key={d.id}
                      href={`/api/jobs/${job.id}/files/${d.id}${q}`}
                      className="flex items-center gap-3 rounded-md border border-brand-200 px-3 py-2.5 no-underline hover:bg-[#f7f8fa]"
                    >
                      <DownloadIcon />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{d.filename}</span>
                        <span className="block text-[11px] text-brand-500">
                          {VARIANT_NOTE[d.variant] || (/\.docx$/i.test(d.filename) ? "Edit it in Word" : "Same format you uploaded")}
                        </span>
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-brand-500">Nothing came back for this language.</p>
              )}
              {items.length > 1 && (
                <a href={`/api/jobs/${job.id}/download/${norm(loc)}${q}`} className="wx-button mt-2">
                  Download all ({nameOf(loc)}, ZIP)
                </a>
              )}
            </div>
          );
        })}
      </div>
      {job.deliverables.some((d) => d.variant?.startsWith("pdf-")) && (
        <p className="mt-4 text-[11px] leading-relaxed text-brand-500">
          Beta: the design-kept PDF redraws the translation into your original pages in a similar font. Check it before
          you share; the Word file is the version to edit.
        </p>
      )}
      {job.tier === "free" && (
        <div className="mt-6 rounded-md bg-[#f5f7f9] p-4">
          <p className="text-[13px] font-medium">Next file?</p>
          <p className="mt-1 text-[13px] text-brand-500">
            You can translate another document for free tomorrow. Translating for a team?{" "}
            <a href={TEAM_URL} className="underline">
              See what wxrks does
            </a>{" "}
            with your glossary and reviewers.
          </p>
        </div>
      )}
    </Screen>
  );
}

function Screen({ bar, children }) {
  return (
    <section className="mx-auto max-w-xl">
      <div className="overflow-hidden rounded-[10px] border border-brand-200 bg-white">
        {bar && <div className="flex h-11 items-center justify-between gap-3 border-b border-brand-200 px-5 text-xs text-brand-500">{bar}</div>}
        <div className="p-6 sm:p-8">{children}</div>
      </div>
    </section>
  );
}

function StatusBadge({ status }) {
  if (status === "delivered") return <span className="wx-badge wx-badge--success">Done</span>;
  if (ACTIVE.includes(status)) return <span className="wx-badge wx-badge--pending">In progress</span>;
  if (status === "over_free_limit") return <span className="wx-badge wx-badge--info">Over the free limit</span>;
  return <span className="wx-badge">{status === "cancelled" ? "Cancelled" : "Stopped"}</span>;
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V3" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
    </svg>
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
        <figure key={side} className="m-0">
          {/* full width, cropped at the bottom: the top of page 1 is enough to judge it */}
          <div className="max-h-56 overflow-hidden rounded border border-brand-200 bg-white sm:max-h-72">
            <img
              src={src(side)}
              alt={side === "original" ? "Page 1 of your original document" : `Page 1 translated into ${language}`}
              className="block w-full"
            />
          </div>
          <figcaption className="mt-1.5 text-[11px] text-brand-500">{label}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function EmailForm({ job, k, onDone, intro, cta, compact }) {
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
      {intro && <p className="text-[13px]">{intro}</p>}
      <div className="wx-field">
        <label className="wx-label" htmlFor={`email-${job.id}`}>
          Email
        </label>
        <div className={compact ? "flex flex-col gap-2 sm:flex-row" : "space-y-3"}>
          <input
            id={`email-${job.id}`}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="wx-input w-full sm:flex-1"
          />
          <button type="submit" disabled={busy} className={`wx-button wx-button--primary ${compact ? "" : "w-full"}`} style={{ minHeight: 40 }}>
            {busy ? "One moment…" : cta}
          </button>
        </div>
      </div>
      <label className="flex items-start gap-2 text-xs text-brand-500">
        <input type="checkbox" checked={news} onChange={(e) => setNews(e.target.checked)} className="mt-0.5" />
        <span>Also send me wxrks product news, about once a month.</span>
      </label>
      {error && <p className="wx-error text-xs">{error}</p>}
      <p className="text-[11px] text-brand-500">We use your email to send these files. Product news only if you tick the box.</p>
    </form>
  );
}

function OverLimit({ bar, words }) {
  const count = words != null ? words.toLocaleString() : "more than 1,000";
  const Option = ({ href, to, title, note }) => {
    const body = (
      <>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium">{title}</span>
          <span className="block text-[11px] text-brand-500">{note}</span>
        </span>
        <span aria-hidden="true" className="text-brand-500">→</span>
      </>
    );
    const cls = "flex items-center gap-3 rounded-md border border-brand-200 px-4 py-3 no-underline hover:bg-[#f7f8fa]";
    return to ? <Link to={to} className={cls}>{body}</Link> : <a href={href} className={cls}>{body}</a>;
  };
  return (
    <Screen bar={bar}>
      <h1 className="text-[22px] font-medium tracking-[-0.3px]">This file has {count} words. Free covers 1,000.</h1>
      <p className="mt-1 text-[13px] text-brand-500">
        Nothing was translated, so this one doesn't count as your free document.
      </p>
      <div className="mt-5 space-y-2">
        <Option to="/" title="Translate a shorter document" note="Free, up to 1,000 words a day" />
        <Option href={DEMO_URL} title="A team account in wxrks" note="Whole documents, with your glossary, review, and shared projects. Book a demo." />
        <Option to="/login" title="Use credits" note="$99 a year for 100,000 words. Sign in to start." />
      </div>
    </Screen>
  );
}
