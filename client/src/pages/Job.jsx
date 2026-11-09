import { useEffect, useState } from "react";
import { useParams, Link, useSearchParams, useNavigate } from "react-router-dom";
import { api, trackCancelledCheckout } from "../api";
import { useAuth } from "../context/AuthContext";
import { TrustStrip } from "./Upload";
import { PackGrid } from "./Pricing";
import SignupOffer from "./SignupOffer";
import { FREE_WORDS, SIGNUP_CREDIT, packFor, packLabel, wordsAndPages, aboutPages } from "../pricing";
import { toneLine } from "../tone";

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

// Why a job found nothing to translate, from the pipeline's OCR step (server/services/pipeline.js).
function noTextReason(job) {
  const ocr = [...job.timeline].reverse().find((e) => e.event === "ocr_skipped" || e.event === "ocr_done");
  if (ocr?.event === "ocr_skipped" && ocr.detail?.reason === "language") {
    return "This PDF is scanned, and we can't read scanned pages in its language yet. Try a file where you can select the text.";
  }
  if (ocr) return "This PDF is scanned, and we couldn't read any text on its pages. Try a sharper scan, or a file where you can select the text.";
  return "We couldn't find text in this file. Try a file where you can select the text.";
}

// Over the free limit, a PDF's page 1 is translated as a preview (server/services/excerpt.js);
// keep asking while it runs, and for a moment before it has started.
function stillWorking(j) {
  if (ACTIVE.includes(j.status)) return true;
  if (j.status === "delivered") return j.confidence?.status === "pending"; // Smells is still reading it
  if (j.status !== "over_free_limit") return false;
  return j.excerpt ? ACTIVE.includes(j.excerpt.status) : Date.now() - new Date(j.updatedAt).getTime() < 30000;
}

export default function Job() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const k = params.get("k"); // from the files email: works on any device
  const q = k ? `?k=${encodeURIComponent(k)}` : "";
  const [job, setJob] = useState(null);
  const [names, setNames] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => trackCancelledCheckout(id), [id]);

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
        if (stillWorking(j)) timer = setTimeout(load, 3000);
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
  const tone = toneLine(job.tone);
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
        {tone && <p className="mt-1 text-[11px] text-brand-500">Tone: {tone}, by Sous-Chef</p>}
        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="font-medium">
              {job.analyzedWords != null ? wordsAndPages(job.analyzedWords) : STAGE_COPY[job.status]}
            </span>
            <span className="text-brand-500">{pct}%</span>
          </div>
          <div className="wx-progress" role="progressbar" aria-label="Translation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}>
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
        {job.analyzedWords != null && (
          <p className={`mt-3 text-xs ${job.tier === "free" ? "text-[#176b45]" : "text-brand-500"}`}>
            {job.timeline.some((e) => e.event === "first_document_free")
              ? "Free: your first document." // jobs from the first-document-free days (2026-11-09)
              : job.tier === "free"
                ? `Free: your document for today, up to ${wordsAndPages(job.freeLimit || FREE_WORDS)}.`
                : `Uses ${(job.creditsCharged ?? job.analyzedWords * job.targetLocales.length).toLocaleString()} credits.`}
          </p>
        )}
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

  if (job.status === "over_free_limit") return <OverLimit job={job} bar={bar} nameOf={nameOf} tone={tone} />;
  if (job.status === "needs_credits") return <NeedsCredits job={job} bar={bar} nameOf={nameOf} tone={tone} />;

  if (!delivered) {
    return (
      <Screen bar={bar}>
        <h1 className="text-[22px] font-medium tracking-[-0.3px]">
          {job.status === "no_text" ? "We couldn't find any text to translate" : job.status === "cancelled" ? "Cancelled" : "Something went wrong"}
        </h1>
        <p className="mt-2 text-[13px] text-brand-500">
          {job.status === "no_text"
            ? `${noTextReason(job)} This one doesn't count as your free document.`
            : job.status === "cancelled"
              ? "Nothing more will be translated for this job."
              : "The translation didn't finish. Try again, or reply to any of our emails and a person will look at it."}
        </p>
        <Link to="/" className="wx-button wx-button--primary mt-5" style={{ minHeight: 40 }}>
          Translate another document
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
        <ScoreLine confidence={job.confidence} locale={norm(job.targetLocales[0])} />
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
        <p className="mt-4 flex items-center gap-2 text-[11px] text-brand-500">
          <img src="/badges/soc2.svg" alt="" className="h-3.5 w-auto" />
          <span>Free: one document a day. No card, no subscription. wxrks is SOC 2 Type 2 audited, and your file is deleted after 30 days.</span>
        </p>
      </Screen>
    );
  }

  // Delivered and open: use it now, or have a person check it.
  return <Delivered job={job} bar={bar} byLocale={byLocale} preview={preview} nameOf={nameOf} tone={tone} q={q} k={k} />;
}

function Delivered({ job, bar, byLocale, preview, nameOf, tone, q, k }) {
  const [picked, setPicked] = useState(norm(job.targetLocales[0]));
  const [reviewers, setReviewers] = useState(null);
  const [showFlags, setShowFlags] = useState(false);
  useEffect(() => {
    api.reviewers(job.id, k).then((r) => setReviewers(r.byLocale)).catch(() => setReviewers({}));
  }, [job.id, k]);
  const locales = job.targetLocales.map(norm);
  const loc = locales.includes(picked) ? picked : locales[0];
  const language = nameOf(loc);
  const items = byLocale[loc] || [];
  const conf = job.confidence?.byLocale?.[loc];
  const scanned = job.files.reduce((n, f) => n + (f.scannedPages || 0), 0);
  const shown = job.previews?.find((p) => p.locale === loc) || preview;
  return (
    <Screen bar={bar} wide>
      <h1 className="text-[22px] font-medium tracking-[-0.3px]">Your translation is ready</h1>
      <p className="mt-1 text-[13px] text-brand-500">
        {job.files.length > 1 ? `${job.files.length} files` : job.files[0]?.name} · {job.targetLocales.map(nameOf).join(", ")}
        {job.analyzedWords != null ? ` · ${job.analyzedWords.toLocaleString("en-US")} words` : ""}
        {tone ? ` · Tone: ${tone}` : ""}
      </p>
      {job.tier === "free" && job.unlockedEmail && job.emailDelivery && (
        <p className="mt-1 text-[13px] text-brand-500">We also sent the links to {job.unlockedEmail}.</p>
      )}
      {scanned > 0 && (
        <div className="wx-alert mt-4">
          <span>
            This PDF was scanned, so we read the text off its {scanned === 1 ? "page" : `${scanned} pages`} first. You get a
            Word file; a PDF with the design kept isn't made from scans yet.
          </span>
        </div>
      )}
      {shown && (
        <div className="mt-5">
          <Preview job={job} preview={shown} language={nameOf(shown.locale)} q={q} />
        </div>
      )}

      {locales.length > 1 && (
        <div className="wx-tabs mt-6" role="tablist" aria-label="Languages">
          {locales.map((l) => (
            <button key={l} type="button" role="tab" aria-selected={l === loc} className="wx-tab" onClick={() => setPicked(l)}>
              {nameOf(l)}
            </button>
          ))}
        </div>
      )}

      <div className={`${locales.length > 1 ? "mt-4" : "mt-6"} grid grid-cols-1 items-stretch gap-4 md:grid-cols-2`}>
        <section className="flex min-w-0 flex-col gap-4 rounded-[10px] border border-brand-200 p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-brand-500">Use it now</p>
          <Score confidence={job.confidence} entry={conf} />
          <div className="space-y-2">
            {items.length ? (
              items.map((d) => (
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
              ))
            ) : (
              <p className="text-[13px] text-brand-500">Nothing came back for this language.</p>
            )}
            {items.length > 1 && (
              <a href={`/api/jobs/${job.id}/download/${loc}${q}`} className="wx-button">
                Download all ({language}, ZIP)
              </a>
            )}
          </div>
          {conf?.top?.length > 0 && (
            <div>
              <button type="button" className="text-xs underline" aria-expanded={showFlags} onClick={() => setShowFlags(!showFlags)}>
                {showFlags ? "Hide them" : `See the ${conf.flagged === 1 ? "sentence" : `${conf.flagged.toLocaleString("en-US")} sentences`} to check`}
              </button>
              {showFlags && <Flagged entry={conf} />}
            </div>
          )}
        </section>

        <Reviewers language={language} entry={reviewers?.[loc]} loading={!reviewers} flagged={conf?.flagged} />
      </div>

      <Thumbs job={job} k={k} />

      {job.deliverables.some((d) => d.variant?.startsWith("pdf-")) && (
        <p className="mt-4 text-[11px] leading-relaxed text-brand-500">
          Beta: the design-kept PDF redraws the translation into your original pages in a similar font. Check it before
          you share; the Word file is the version to edit.
        </p>
      )}
      {job.tier === "free" && <NextFile freeLimit={job.freeLimit || FREE_WORDS} />}
    </Screen>
  );
}

// After a guest's free document: tomorrow's, or the sign-up credit to keep going today.
function NextFile({ freeLimit }) {
  const { user } = useAuth();
  return (
    <div className="mt-6 rounded-md bg-[#f5f7f9] p-4">
      <p className="text-[13px] font-medium">Next file?</p>
      <p className="mt-1 text-[13px] leading-relaxed text-brand-500">
        Your next free document, up to {wordsAndPages(freeLimit)}, is ready tomorrow.
        {user
          ? " To keep going today, buy words, paid once."
          : ` To keep going today, sign up and get $${SIGNUP_CREDIT.dollars} in credits: ${wordsAndPages(SIGNUP_CREDIT.words)}.`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {user ? (
          <Link to="/pricing" className="wx-button wx-button--primary wx-button--compact">
            Buy words
          </Link>
        ) : (
          <Link to="/login" className="wx-button wx-button--primary wx-button--compact">
            Get ${SIGNUP_CREDIT.dollars} in credits
          </Link>
        )}
        <a href={TEAM_URL} className="text-xs underline">
          See what wxrks does for teams
        </a>
      </div>
    </div>
  );
}

function Screen({ bar, children, wide }) {
  return (
    <section className={`mx-auto ${wide ? "max-w-4xl" : "max-w-xl"}`}>
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

// The Confidence Score: Smells, the wxrks check for meaning problems, scores every sentence by
// the most serious problem it finds (server/services/confidence.js). Severities as wxrks names them.
const SEVERITY = {
  BLOCKER: { label: "Critical", badge: "wx-badge--danger", bar: "#a52b36" },
  CRITICAL: { label: "Critical", badge: "wx-badge--danger", bar: "#a52b36" },
  MAJOR: { label: "Major", badge: "wx-badge--pending", bar: "#d9a23a" },
  MINOR: { label: "Minor", badge: "wx-badge--info", bar: "#6b9cc4" },
};
const pct = (score) => Math.round(score * 100);
const scoreInk = (score) => (score >= 0.95 ? "#176b45" : score >= 0.85 ? "#785000" : "#a52b36");

function Score({ confidence, entry }) {
  if (confidence?.status === "pending") {
    return (
      <div className="rounded-md bg-[#f5f7f9] px-4 py-3">
        <p className="text-[13px] font-medium">Checking the translation…</p>
        <p className="mt-0.5 text-xs text-brand-500">Smells, the wxrks check for meaning problems, is reading every sentence.</p>
      </div>
    );
  }
  if (!entry) return null;
  const counts = entry.counts || {};
  const critical = (counts.BLOCKER || 0) + (counts.CRITICAL || 0);
  const parts = [
    ["clean", entry.sentences - entry.flagged, "#2f8f5b", "no problems"],
    ["MINOR", counts.MINOR || 0, SEVERITY.MINOR.bar, "minor"],
    ["MAJOR", counts.MAJOR || 0, SEVERITY.MAJOR.bar, "major"],
    ["CRITICAL", critical, SEVERITY.CRITICAL.bar, "critical"],
  ].filter(([, n]) => n > 0);
  return (
    <div>
      <div className="flex items-baseline gap-2.5">
        <span className="text-[44px] font-medium leading-none tracking-[-1px]" style={{ color: scoreInk(entry.score) }}>
          {pct(entry.score)}%
        </span>
        <span className="text-[15px] font-medium">Confidence Score</span>
      </div>
      <p className="mt-2 text-xs text-brand-500">
        Smells, the wxrks check for meaning problems, read all {entry.sentences.toLocaleString("en-US")} sentences.{" "}
        {entry.flagged
          ? `${entry.flagged.toLocaleString("en-US")} ${entry.flagged === 1 ? "is" : "are"} worth a second look.`
          : "It found nothing to check."}
      </p>
      {entry.sentences > 0 && (
        <>
          <div
            className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full"
            role="img"
            aria-label={parts.map(([, n, , label]) => `${n} ${label}`).join(", ")}
          >
            {parts.map(([key, n, color]) => (
              <span key={key} style={{ width: `${(n / entry.sentences) * 100}%`, background: color }} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-brand-500">
            {parts.map(([key, n, color, label]) => (
              <span key={key} className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: color }} />
                {n.toLocaleString("en-US")} {label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// One line under the heading before the email step.
function ScoreLine({ confidence, locale }) {
  const entry = confidence?.byLocale?.[locale];
  if (!entry) return null;
  return (
    <p className="mt-1 text-[13px]">
      <span className="font-medium" style={{ color: scoreInk(entry.score) }}>
        Confidence Score {pct(entry.score)}%
      </span>
      <span className="text-brand-500">
        {entry.flagged ? ` · ${entry.flagged.toLocaleString("en-US")} sentences worth a second look` : " · nothing to check"}
      </span>
    </p>
  );
}

function Flagged({ entry }) {
  return (
    <div className="mt-3 space-y-2">
      {entry.top.map((f, i) => {
        const sev = SEVERITY[f.severity] || SEVERITY.MINOR;
        return (
          <div key={i} className="space-y-1 rounded-md border border-brand-200 px-3 py-2.5">
            <span className={`wx-badge ${sev.badge}`}>
              {sev.label}
              {f.type ? ` · ${f.type}` : ""}
            </span>
            {f.target && <p className="text-[13px]">{f.target}</p>}
            {f.source && <p className="text-xs text-brand-500">Original: {f.source}</p>}
            {f.note && <p className="text-xs">{f.note}</p>}
          </div>
        );
      })}
      {entry.flagged > entry.top.length && (
        <p className="text-[11px] text-brand-500">
          Showing {entry.top.length} of {entry.flagged.toLocaleString("en-US")}, the most serious first.
        </p>
      )}
      <p className="text-[11px] text-brand-500">A high score is not a guarantee: for contracts, medical or published text, have a person check it.</p>
    </div>
  );
}

// Thumbs up or down on the translation (server/services/feedback.js), then an optional note.
export function ThumbIcon({ down }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={down ? { transform: "scaleY(-1)" } : undefined}>
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}

function Thumbs({ job, k }) {
  const [rating, setRating] = useState(job.feedback);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  async function rate(r) {
    setRating(r);
    setError(null);
    try {
      await api.jobFeedback(job.id, { rating: r }, k);
    } catch (err) {
      setError(err.message);
    }
  }

  async function send(e) {
    e.preventDefault();
    try {
      await api.jobFeedback(job.id, { rating, comment }, k);
      setSent(true);
    } catch (err) {
      setError(err.message);
    }
  }

  const choice = (r, label) => (
    <button
      type="button"
      onClick={() => rate(r)}
      aria-pressed={rating === r}
      className={`wx-button inline-flex items-center gap-2 ${rating === r ? "wx-button--primary" : ""}`}
    >
      <ThumbIcon down={r === "down"} />
      {label}
    </button>
  );

  return (
    <div className="mt-6 rounded-md border border-brand-200 p-4">
      <p className="text-[13px] font-medium">Did this translation work for you?</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {choice("up", "Yes")}
        {choice("down", "Not really")}
      </div>
      {rating && !sent && (
        <form onSubmit={send} className="mt-3 space-y-2">
          <label className="wx-label" htmlFor={`fb-${job.id}`}>
            {rating === "up" ? "Thanks! Anything we should know? (optional)" : "Sorry. What went wrong? (optional)"}
          </label>
          <textarea
            id={`fb-${job.id}`}
            className="wx-input w-full"
            rows={3}
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={{ height: "auto", paddingTop: 8, paddingBottom: 8 }}
          />
          <button type="submit" className="wx-button wx-button--compact" disabled={!comment.trim()}>
            Send
          </button>
        </form>
      )}
      {sent && <p className="mt-2 text-xs text-brand-500">Thank you. A person reads every note.</p>}
      {error && <p className="wx-error mt-2 text-xs">{error}</p>}
    </div>
  );
}

// Marketplace partners for the language (server/services/marketplace.js), paid listings only.
function Reviewers({ language, entry, loading, flagged }) {
  const partners = entry?.partners || [];
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-[10px] border border-brand-600 p-5">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-brand-500">Have a person check it</p>
        <h2 className="mt-2 text-[17px] font-medium leading-snug">
          {flagged === 1
            ? "A translator reviews that sentence, or the whole file"
            : flagged
              ? `A translator reviews the ${flagged.toLocaleString("en-US")} sentences, or the whole file`
              : "A translator reviews the whole file"}
        </h2>
        <p className="mt-1.5 text-xs text-brand-500">
          Best for contracts, medical text, and anything you publish.
          {partners.length ? ` These partners work into ${language} on wxrks.` : ""}
        </p>
      </div>
      {loading ? (
        <p className="text-xs text-brand-500">Finding translators for {language}…</p>
      ) : partners.length ? (
        <div className="space-y-2">
          {partners.map((p) => (
            <div key={p.url} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-brand-200 px-3 py-2.5">
              {p.logo ? (
                <img src={p.logo} alt="" className="size-10 shrink-0 rounded-lg border border-brand-200 object-cover" />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-sm font-medium">{p.name[0]}</span>
              )}
              <span className="min-w-[10rem] flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">{p.name}</span>
                  <span className={`wx-badge ${p.badge === "Premium Partner" ? "wx-badge--success" : ""}`}>{p.badge}</span>
                </span>
                {p.place && <span className="mt-0.5 block truncate text-[11px] text-brand-500">{p.place}</span>}
              </span>
              <a href={p.url} className="wx-button wx-button--compact shrink-0">
                Ask for a review
              </a>
            </div>
          ))}
        </div>
      ) : (
        <a href={entry?.url || "https://marketplace.wxrks.com/"} className="wx-button self-start">
          Find a translator for {language}
        </a>
      )}
      <p className="mt-auto text-[11px] text-brand-500">
        Partners set their own price and reply by email. Premium Partners first, then a new mix each time.{" "}
        <a href={entry?.url || "https://marketplace.wxrks.com/"} className="underline">
          See all partners
        </a>
      </p>
    </section>
  );
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

// The file's words against the free words it was measured by, as a bar: how much free covers.
function WordMeter({ words, free = FREE_WORDS }) {
  const covered = Math.min(100, (free / words) * 100);
  return (
    <div className="mt-4">
      <div className="wx-progress" role="meter" aria-label="Free words against this file" aria-valuemin="0" aria-valuemax={words} aria-valuenow={free}>
        <span style={{ width: `${covered}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-brand-500">
        <span>
          {free.toLocaleString()} free ({aboutPages(free)})
        </span>
        <span>{words.toLocaleString()}</span>
      </div>
    </div>
  );
}

// Page 1 of a file stopped at a price, translated free (server/services/excerpt.js): the
// design-kept page next to the original, or the text of both when there is none.
function ExcerptPreview({ excerpt, nameOf, tone }) {
  const [text, setText] = useState(null);
  const image = excerpt?.previews?.[0];
  useEffect(() => {
    if (excerpt?.textPreview && !image) api.previewText(excerpt.jobId).then(setText).catch(() => {});
  }, [excerpt?.textPreview, excerpt?.jobId, image]);
  if (!excerpt) return null;
  if (ACTIVE.includes(excerpt.status) && !image) {
    return (
      <div className="mt-5 rounded-md bg-[#f5f7f9] p-4">
        <p className="text-[13px]">Translating page 1 so you can see it…</p>
        <div className="wx-progress" role="progressbar" aria-label="Page 1 preview">
          <span style={{ width: `${PROGRESS[excerpt.status] ?? 10}%` }} />
        </div>
      </div>
    );
  }
  const caption = (
    <p className="mt-2 text-[11px] text-brand-500">
      Page 1{excerpt.totalPages > 1 ? ` of ${excerpt.totalPages}` : ""}, translated free{tone ? ` (tone: ${tone})` : ""}. The
      downloads come with the whole file.
    </p>
  );
  if (image) {
    return (
      <div className="mt-5">
        <Preview job={{ id: excerpt.jobId }} preview={image} language={nameOf(image.locale)} q="" />
        {caption}
      </div>
    );
  }
  if (!text?.target) return null;
  return (
    <div className="mt-5">
      <div className={`grid gap-3 ${text.source ? "sm:grid-cols-2" : ""}`}>
        {[
          ["Original", text.source],
          [nameOf(text.locale), text.target],
        ]
          .filter(([, body]) => body)
          .map(([label, body], i) => (
            <figure key={label} className="m-0">
              <div
                dir={i === 1 && /^(ar|he|iw|fa|ur)/i.test(text.locale) ? "rtl" : "auto"}
                className="max-h-72 overflow-hidden whitespace-pre-line rounded border border-brand-200 bg-white p-4 text-[13px] leading-relaxed"
              >
                {body}
              </div>
              <figcaption className="mt-1.5 text-[11px] text-brand-500">{label}</figcaption>
            </figure>
          ))}
      </div>
      {caption}
    </div>
  );
}

// Run the file again as a paid job, without uploading it again (routes/jobs.js rerun).
function useRerun(job) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function rerun() {
    setBusy(true);
    setError(null);
    try {
      // ?k= when the page was opened from an email (the sign-in link back to this file, on any device).
      const { jobId } = await api.rerunJob(job.id, new URLSearchParams(window.location.search).get("k"));
      navigate(`/jobs/${jobId}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return { rerun, busy, error };
}

// A guest's file over the free limit (Rodrigo, 2026-11-09): the sign-up credit first, packs for
// what it doesn't cover. Once signed in (the link brings them back here), credits translate it.
function OverLimit({ job, bar, nameOf, tone }) {
  const { user, creditBalance } = useAuth();
  const { rerun, busy, error } = useRerun(job);
  const [showPacks, setShowPacks] = useState(false);
  const words = job.analyzedWords;
  const n = (x) => x.toLocaleString("en-US");
  const freeLimit = job.freeLimit || FREE_WORDS;
  const credits = words != null ? words * job.targetLocales.length : null;
  const balance = creditBalance ?? 0;
  const canRunNow = Boolean(user && credits != null && balance >= credits);
  // The words still to buy: all of them for a guest, what the balance doesn't cover once signed in.
  const toBuy = credits != null ? (user ? credits - balance : credits) : null;
  const fits = toBuy != null ? packFor(toBuy) : null;
  const excerpt = job.excerpt;
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
      <h1 className="text-[22px] font-medium tracking-[-0.3px]">
        {words != null ? `This file has ${wordsAndPages(words)}` : `This file has more than ${wordsAndPages(freeLimit)}`}
      </h1>
      <p className="mt-1 text-[13px] leading-relaxed text-brand-500">
        Free covers one document a day, up to {wordsAndPages(freeLimit)}.{" "}
        {excerpt ? "We translated page 1 for free, so you can see the result." : "Nothing was translated, so this one doesn't count as your free document."}
      </p>
      {words != null && <WordMeter words={words} free={freeLimit} />}
      <ExcerptPreview excerpt={excerpt} nameOf={nameOf} tone={tone} />

      {job.rerunJobId ? (
        <Link to={`/jobs/${job.rerunJobId}`} className="wx-button wx-button--primary mt-6" style={{ minHeight: 40 }}>
          See the whole translation
        </Link>
      ) : canRunNow ? (
        <div className="mt-6">
          <h2 className="text-[15px] font-medium">Translate the whole file</h2>
          <p className="mt-1 text-[13px] text-brand-500">
            Uses {n(credits)} of your {n(balance)} credits. {wordsAndPages(balance - credits)} stay in your account.
          </p>
          <button type="button" onClick={rerun} disabled={busy} className="wx-button wx-button--primary mt-3" style={{ minHeight: 40 }}>
            {busy ? "Starting…" : `Translate all ${n(words)} words`}
          </button>
          {error && <p className="wx-error mt-2 text-xs">{error}</p>}
        </div>
      ) : user ? (
        <div className="mt-6">
          <h2 className="text-[15px] font-medium">Translate the whole file</h2>
          <p className="mt-1 mb-3 text-[13px] text-brand-500">
            It needs {n(credits ?? 0)} credits and your account has {wordsAndPages(balance)}.{" "}
            {fits ? `${packLabel(fits)} covers it.` : ""} After you pay, you translate this file from here, without uploading it again.
          </p>
          <PackGrid jobId={job.id} fits={fits} place="over_limit" words={credits} />
        </div>
      ) : (
        <>
          <SignupOffer jobId={job.id} words={credits} next={`/jobs/${job.id}`} />
          {credits != null && credits > SIGNUP_CREDIT.words ? (
            <div className="mt-6">
              <h2 className="mb-3 text-[15px] font-medium">Or buy words</h2>
              <PackGrid jobId={job.id} fits={fits} place="over_limit" words={credits} />
            </div>
          ) : showPacks ? (
            <div className="mt-5">
              <PackGrid jobId={job.id} fits={fits} place="over_limit" words={credits} />
            </div>
          ) : (
            <p className="mt-3 text-xs text-brand-500">
              Or buy words: {packLabel(packFor(1))}, paid once.{" "}
              <button type="button" onClick={() => setShowPacks(true)} className="underline">
                See all packs
              </button>
            </p>
          )}
        </>
      )}

      <div className="mt-6 space-y-2">
        <Option to="/" title="Translate a shorter document" note={`Free, up to ${wordsAndPages(freeLimit)} a day`} />
        <Option href={DEMO_URL} title="A team account in wxrks" note="Whole documents, with your glossary, review, and shared projects. Book a demo." />
      </div>
      <TrustStrip />
    </Screen>
  );
}

function NeedsCredits({ job, bar, nameOf, tone }) {
  const { creditBalance } = useAuth();
  const { rerun, busy, error } = useRerun(job);
  const needed = job.analyzedWords != null ? job.analyzedWords * job.targetLocales.length : null;
  const short = needed != null && creditBalance != null ? needed - creditBalance : null;
  return (
    <Screen bar={bar}>
      <h1 className="text-[22px] font-medium tracking-[-0.3px]">Not enough credits</h1>
      <p className="mt-2 text-[13px] text-brand-500">
        {needed != null
          ? `This job needs ${needed.toLocaleString("en-US")} credits (${aboutPages(needed)}) and your account has ${wordsAndPages(creditBalance ?? 0)}.`
          : "This job needs more credits than your account has."}{" "}
        Nothing was charged.
      </p>
      <ExcerptPreview excerpt={job.excerpt} nameOf={nameOf} tone={tone} />
      {job.rerunJobId ? (
        <Link to={`/jobs/${job.rerunJobId}`} className="wx-button wx-button--primary mt-5" style={{ minHeight: 40 }}>
          See the translation
        </Link>
      ) : short != null && short <= 0 ? (
        <button type="button" onClick={rerun} disabled={busy} className="wx-button wx-button--primary mt-5" style={{ minHeight: 40 }}>
          {busy ? "Starting…" : "Translate it now"}
        </button>
      ) : (
        <div className="mt-5">
          <PackGrid jobId={job.id} fits={short != null ? packFor(short) : null} place="needs_credits" words={needed} />
        </div>
      )}
      {error && <p className="wx-error mt-2 text-xs">{error}</p>}
    </Screen>
  );
}
