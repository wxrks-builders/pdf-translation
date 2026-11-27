import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { api, trackCancelledCheckout } from "../api";
import { useAuth } from "../context/AuthContext";
import { TrustStrip } from "./Upload";
import { PackGrid } from "./Pricing";
import OfferForm, { useSignupOffer, StickyOffer } from "./SignupOffer";
import { progressSteps, ProgressChecklist } from "./ProgressSteps";
import RecentActivity from "../RecentActivity";
import { FREE_WORDS, PACKS, SIGNUP_CREDIT, packFor, packLabel, pagesFor, wordsAndPages, aboutPages } from "../pricing";
import { toneLine } from "../tone";
import { errorText } from "../i18n";
import { formatList, formatMoney, formatNumber, formatPercent, isolate, languageLabel, languageName } from "../i18n/format";
import { Link, useNavigate } from "../i18n/routing";

const ACTIVE = ["created", "uploading", "analyzing", "approving", "translating"];

// The sample's progress bar is honest about stages, not seconds: wxrks doesn't report a percentage.
const PROGRESS = { created: 5, uploading: 15, analyzing: 35, approving: 50, translating: 75 };

const VARIANT_NOTE = { "pdf-design": "job.variant.design", "pdf-images": "job.variant.images" };
const VARIANT_ORDER = { "pdf-design": 0, translation: 1, "pdf-images": 2 };

const DEMO_URL =
  "https://wxrks.com/demo?utm_source=translate.wxrks.com&utm_medium=referral&utm_campaign=free-translator&utm_content=over-limit";
const TEAM_URL =
  "https://wxrks.com/?utm_source=translate.wxrks.com&utm_medium=referral&utm_campaign=free-translator&utm_content=delivered";

const norm = (code) => String(code || "").toLowerCase().replace(/[-_]/g, "");

// A sentence's separator between independent facts ("file · languages · words").
const Dot = () => <span aria-hidden="true"> · </span>;

// Why a job found nothing to translate, from the pipeline's OCR step (server/services/pipeline.js).
function noTextReason(job, t) {
  const ocr = [...job.timeline].reverse().find((e) => e.event === "ocr_skipped" || e.event === "ocr_done");
  if (ocr?.event === "ocr_skipped" && ocr.detail?.reason === "language") return t("job.noText.language");
  if (ocr) return t("job.noText.scanned");
  return t("job.noText.generic");
}

// Over the free limit, a sample of a PDF is translated as a preview (server/services/excerpt.js);
// keep asking while it runs, and for a moment before it has started.
// A file just stopped at the free limit whose sample is still being cut (services/excerpt.js
// picks its pages before the sample's job exists): a few seconds the page treats as the sample
// being made, so the form doesn't show alone and then jump. A PDF only; given up after 30 s.
function pickingSample(j) {
  if (j.status !== "over_free_limit" || j.excerpt || !/\.pdf$/i.test(j.files?.[0]?.name || "")) return false;
  if (j.timeline?.some((e) => e.event === "excerpt_skipped")) return false;
  return Date.now() - new Date(j.updatedAt).getTime() < 30000;
}
const PICKING = { status: "created", timeline: [] };

function stillWorking(j) {
  if (ACTIVE.includes(j.status)) return true;
  if (j.status === "delivered") return j.confidence?.status === "pending"; // Smells is still reading it
  if (j.status !== "over_free_limit") return false;
  return j.excerpt ? ACTIVE.includes(j.excerpt.status) : Date.now() - new Date(j.updatedAt).getTime() < 30000;
}

// The file's name, or how many files: in the bar and the headings' fine print.
function FilesLabel({ job }) {
  const { t } = useTranslation();
  if (job.files.length > 1) return t("job.fileCount", { count: job.files.length });
  return <bdi>{job.files[0]?.name || t("job.yourDocument")}</bdi>;
}

export default function Job() {
  const { t } = useTranslation();
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
        setError(err.status === 404 ? t("job.notFound") : errorText(err));
      }
    }
    load();
    return () => clearTimeout(timer);
  }, [id, k]); // eslint-disable-line react-hooks/exhaustive-deps

  // The header's balance is read at sign-in; the charge lands seconds later (a file continued
  // after the email link is paid once its project is taken over), so read it again then.
  const { refresh } = useAuth();
  const charged = Boolean(job?.timeline?.some((e) => e.event === "credits_charged"));
  useEffect(() => {
    if (charged) refresh();
  }, [charged, refresh]);

  if (error) return <Screen><p className="text-[15px]">{error}</p></Screen>;
  if (!job) return <Screen><p className="text-brand-500">{t("common.loading")}</p></Screen>;

  // Language names in the reader's language: inside a sentence, and standing alone (tabs, captions).
  // Deliverables, previews and the tabs carry the normalized code ("ptbr", server/services/poller.js),
  // which Intl can't read, so each code is named by the job's own spelling of it ("pt_br").
  const codeOf = (loc) => job.targetLocales.find((c) => norm(c) === norm(loc)) || loc;
  const nameOf = (loc) => languageName(codeOf(loc), names[norm(loc)]);
  const labelOf = (loc) => languageLabel(codeOf(loc), names[norm(loc)]);
  const delivered = job.status === "delivered";
  const gated = job.tier === "free" && !job.unlocked;
  const byLocale = {};
  for (const d of job.deliverables) (byLocale[d.locale] ||= []).push(d);
  for (const list of Object.values(byLocale)) list.sort((a, b) => (VARIANT_ORDER[a.variant] ?? 9) - (VARIANT_ORDER[b.variant] ?? 9));
  const preview = job.previews?.[0];
  const tone = toneLine(job.tone);
  const bar = (
    <>
      <span className="min-w-0 truncate">
        <FilesLabel job={job} />
      </span>
      <StatusBadge status={job.status} excerpt={job.excerpt} job={job} />
    </>
  );

  if (ACTIVE.includes(job.status)) {
    // The steps on the left and a card beside them from the first second, the same layout as a
    // file over the free limit (Rodrigo, 2026-11-22: "where is the lateral form here?").
    const asks = !job.unlockedEmail && job.emailDelivery;
    return (
      <Screen bar={bar} wide>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className={`${asks ? "order-2" : "order-1"} min-w-0 lg:order-1`}>
            <ProgressPanel job={job} nameOf={nameOf} tone={tone} />
            <p className="mt-4 text-[11px] text-brand-500">{t("job.privacy")}</p>
            <button onClick={async () => setJob(await api.cancelJob(job.id))} className="mt-4 text-xs text-brand-500 underline hover:text-brand-600">
              {t("job.cancel")}
            </button>
          </div>
          <div className={`${asks ? "order-1" : "order-2"} lg:sticky lg:top-6 lg:order-2`}>
            <WorkingCard job={job} k={k} onDone={setJob} />
          </div>
        </div>
      </Screen>
    );
  }

  if (job.status === "over_free_limit") return <OverLimit job={job} bar={bar} nameOf={nameOf} labelOf={labelOf} tone={tone} />;
  if (job.status === "needs_credits") return <NeedsCredits job={job} bar={bar} nameOf={nameOf} labelOf={labelOf} tone={tone} />;

  if (!delivered) {
    return (
      <Screen bar={bar}>
        <h1 className="text-[22px] font-medium tracking-[-0.3px]">
          {job.status === "no_text" ? t("job.stopped.noTextTitle") : job.status === "cancelled" ? t("job.stopped.cancelledTitle") : t("job.stopped.failedTitle")}
        </h1>
        <p className="mt-2 text-[13px] text-brand-500">
          {job.status === "no_text"
            ? t("job.stopped.noTextBody", { reason: noTextReason(job, t) })
            : job.status === "cancelled"
              ? t("job.stopped.cancelledBody")
              : t("job.stopped.failedBody")}
        </p>
        <Link to="/" className="wx-button wx-button--primary mt-5" style={{ minHeight: 40 }}>
          {t("common.translateAnother")}
        </Link>
      </Screen>
    );
  }

  // Delivered, before the email: page 1, then where to send the files.
  if (gated) {
    return (
      <Screen bar={bar} wide>
        {preview && <Preview job={job} preview={preview} language={nameOf(preview.locale)} label={labelOf(preview.locale)} q={q} />}
        <div className="max-w-2xl">
          <h1 className={`${preview ? "mt-5" : ""} text-[22px] font-medium tracking-[-0.3px]`}>
            {preview ? t("job.gated.titlePreview") : t("job.gated.title")}
          </h1>
          <ScoreLine confidence={job.confidence} locale={norm(job.targetLocales[0])} />
          <p className="mt-1 text-[13px] text-brand-500">{job.emailDelivery ? t("job.gated.bodyEmail") : t("job.gated.body")}</p>
          <ul className="mt-3 space-y-1 text-xs text-brand-500">
            {job.targetLocales.map((loc) => (
              <li key={loc}>
                <span className="font-medium text-brand-600">{labelOf(loc)}</span>
                <Dot />
                <bdi>{formatList((byLocale[norm(loc)] || []).map((d) => d.filename))}</bdi>
              </li>
            ))}
          </ul>
          <div className="mt-5">
            <EmailForm job={job} k={k} onDone={setJob} cta={t("job.email.sendFiles")} />
          </div>
          <p className="mt-4 flex items-center gap-2 text-[11px] text-brand-500">
            <img src="/badges/soc2.svg" alt="" className="h-3.5 w-auto" />
            <span>{t("job.gated.footnote")}</span>
          </p>
        </div>
      </Screen>
    );
  }

  // Delivered and open: use it now, or have a person check it.
  return <Delivered job={job} bar={bar} byLocale={byLocale} preview={preview} nameOf={nameOf} labelOf={labelOf} tone={tone} q={q} k={k} />;
}

function Delivered({ job, bar, byLocale, preview, nameOf, labelOf, tone, q, k }) {
  const { t } = useTranslation();
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-medium tracking-[-0.3px]">{t("job.delivered.title")}</h1>
          <p className="mt-1 text-[13px] text-brand-500">
            <FilesLabel job={job} />
            <Dot />
            {formatList(job.targetLocales.map(labelOf))}
            {job.analyzedWords != null && (
              <>
                <Dot />
                {t("units.words", { words: job.analyzedWords })}
              </>
            )}
            {tone && (
              <>
                <Dot />
                {t("job.delivered.tone", { tone })}
              </>
            )}
          </p>
          {job.tier === "free" && job.unlockedEmail && job.emailDelivery && (
            <p className="mt-1 text-[13px] text-brand-500">{t("job.delivered.alsoSent", { email: isolate(job.unlockedEmail) })}</p>
          )}
        </div>
        <DownloadAll job={job} q={q} />
      </div>
      {scanned > 0 && (
        <div className="wx-alert mt-4">
          <span>{t("job.delivered.scanned", { pages: scanned })}</span>
        </div>
      )}
      {shown && (
        <div className="mt-5">
          <Preview job={job} preview={shown} language={nameOf(shown.locale)} label={labelOf(shown.locale)} q={q} />
        </div>
      )}

      {locales.length > 1 && (
        <div className="wx-tabs mt-6" role="tablist" aria-label={t("job.delivered.languagesTabs")}>
          {locales.map((l) => (
            <button key={l} type="button" role="tab" aria-selected={l === loc} className="wx-tab" onClick={() => setPicked(l)}>
              {labelOf(l)}
            </button>
          ))}
        </div>
      )}

      <div className={`${locales.length > 1 ? "mt-4" : "mt-6"} grid grid-cols-1 items-stretch gap-4 md:grid-cols-2`}>
        <section className="flex min-w-0 flex-col gap-4 rounded-[10px] border border-brand-200 p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-brand-500">{t("job.delivered.useNow")}</p>
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
                    <span className="block truncate text-[13px] font-medium" title={d.filename}>
                      <bdi>{d.filename}</bdi>
                    </span>
                    <span className="block text-[11px] text-brand-500">
                      {t(VARIANT_NOTE[d.variant] || (/\.docx$/i.test(d.filename) ? "job.variant.word" : "job.variant.same"))}
                    </span>
                  </span>
                </a>
              ))
            ) : (
              <p className="text-[13px] text-brand-500">{t("job.delivered.nothing")}</p>
            )}
            {items.length > 1 && (
              <a href={`/api/jobs/${job.id}/download/${loc}${q}`} className="wx-button">
                {t("job.delivered.downloadLanguage", { language: labelOf(loc) })}
              </a>
            )}
          </div>
          {conf?.top?.length > 0 && (
            <div>
              <button type="button" className="text-xs underline" aria-expanded={showFlags} onClick={() => setShowFlags(!showFlags)}>
                {showFlags ? t("job.delivered.hideFlags") : t("job.delivered.showFlags", { count: conf.flagged })}
              </button>
              {showFlags && <Flagged entry={conf} />}
            </div>
          )}
        </section>

        <Reviewers language={language} entry={reviewers?.[loc]} loading={!reviewers} flagged={conf?.flagged} />
      </div>

      <Thumbs job={job} k={k} />

      {job.deliverables.some((d) => d.variant?.startsWith("pdf-")) && (
        <p className="mt-4 text-[11px] leading-relaxed text-brand-500">{t("job.delivered.beta")}</p>
      )}
      {job.tier === "free" && <NextFile freeLimit={job.freeLimit || FREE_WORDS} />}
    </Screen>
  );
}

// After a guest's free document: tomorrow's, or the sign-up credit to keep going today.
function NextFile({ freeLimit }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <div className="mt-6 rounded-md bg-[#f5f7f9] p-4">
      <p className="text-[13px] font-medium">{t("job.next.title")}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-brand-500">
        {t("job.next.body", {
          account: user ? "user" : "guest",
          amount: wordsAndPages(freeLimit),
          credit: formatMoney(SIGNUP_CREDIT.dollars),
          creditAmount: wordsAndPages(SIGNUP_CREDIT.words),
        })}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {user ? (
          <Link to="/pricing" className="wx-button wx-button--primary wx-button--compact">
            {t("common.buyWords")}
          </Link>
        ) : (
          <Link to="/login" className="wx-button wx-button--primary wx-button--compact">
            {t("common.getCredits", { amount: formatMoney(SIGNUP_CREDIT.dollars) })}
          </Link>
        )}
        <a href={TEAM_URL} className="text-xs underline">
          {t("job.next.teams")}
        </a>
      </div>
    </div>
  );
}

function Tick() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#176b45" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

// The card beside the steps while a file is translated: where the files go (or an email field to
// send them, for a guest), and what pays for it.
function WorkingCard({ job, k, onDone }) {
  const { t } = useTranslation();
  const { creditBalance } = useAuth();
  const charged = job.timeline.find((e) => e.event === "credits_charged");
  const isPdf = /\.pdf$/i.test(job.files[0]?.name || "");
  const ticks = [
    job.timeline.some((e) => e.event === "first_document_free")
      ? t("job.card.firstFree") // jobs from the first-document-free days (2026-11-09)
      : job.tier === "free"
        ? t("job.card.freeToday", { amount: wordsAndPages(job.freeLimit || FREE_WORDS) })
        : charged
          ? t("job.card.paid", { credits: job.creditsCharged ?? charged.detail?.amount ?? 0 })
          : t("job.card.paidLater"),
    job.tier !== "free" && creditBalance != null ? t("job.card.balance", { amount: wordsAndPages(creditBalance) }) : null,
    isPdf ? t("common.pdfFiles") : null,
    t("job.card.deleted"),
  ].filter(Boolean);
  return (
    <aside className="wx-offer-card">
      {job.unlockedEmail ? (
        <>
          <h2 className="text-[22px] font-bold leading-7 tracking-[-0.3px]">{t("job.card.byEmailTitle")}</h2>
          <p className="mt-2 text-[14px] leading-[21px] text-[#3d4650]">{t("job.card.byEmailBody", { email: isolate(job.unlockedEmail) })}</p>
        </>
      ) : job.emailDelivery ? (
        <>
          <h2 className="text-[22px] font-bold leading-7 tracking-[-0.3px]">{t("job.card.askTitle")}</h2>
          <p className="mt-2 text-[14px] leading-[21px] text-[#3d4650]">{t("job.card.askBody")}</p>
          <div className="mt-4">
            <EmailForm job={job} k={k} onDone={onDone} cta={t("job.card.askCta")} />
          </div>
        </>
      ) : (
        <>
          <h2 className="text-[22px] font-bold leading-7 tracking-[-0.3px]">{t("job.card.hereTitle")}</h2>
          <p className="mt-2 text-[14px] leading-[21px] text-[#3d4650]">{t("job.card.hereBody")}</p>
        </>
      )}
      <ul className="mt-4 space-y-2 text-[13px] text-[#3d4650]">
        {ticks.map((x) => (
          <li key={x} className="flex items-center gap-2">
            <Tick />
            {x}
          </li>
        ))}
      </ul>
    </aside>
  );
}

// Every step stays on screen once done, with what it found (pages/ProgressSteps.jsx). Over the
// free limit while its sample is made, the sample's steps follow the file's (sample: job.excerpt),
// beside the email card (OverLimit), and the title is a heading under the card's.
function ProgressPanel({ job, nameOf, tone, sample = null }) {
  const { t } = useTranslation();
  const progress = progressSteps(job, nameOf, tone ? t("job.toneBySousChef", { tone }) : null, { sample });
  const pct = progress.pct;
  const Title = sample ? "h2" : "h1";
  return (
    <>
      <Title className="text-[22px] font-medium tracking-[-0.3px]">{progress.title}</Title>
      {progress.sub && <p className="mt-1 text-[13px] text-brand-500">{progress.sub}</p>}
      {job.timeline.some((e) => e.event === "continued") && (
        // After the email link: the steps marked "earlier" were not done again (routes/jobs.js rerun).
        <p className="mt-3 rounded-md bg-[#f3faf6] px-3 py-2 text-[13px] leading-5 text-[#24543a]">{t("job.progress.continued")}</p>
      )}
      <div className="mt-5">
        <div className="mb-1.5 flex justify-between gap-3 text-xs">
          <span className="font-medium">{t("job.progress.steps", { done: progress.done, total: progress.total })}</span>
          <span className="text-brand-500">{formatPercent(pct / 100)}</span>
        </div>
        <div className="wx-progress" role="progressbar" aria-label={t("job.progress.label")} aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ProgressChecklist steps={progress.steps} />
    </>
  );
}

function Screen({ bar, children, wide }) {
  return (
    <section className={`mx-auto ${wide ? "max-w-6xl" : "max-w-xl"}`}>
      <div className="overflow-hidden rounded-[10px] border border-brand-200 bg-white">
        {bar && <div className="flex min-h-11 items-center justify-between gap-3 border-b border-brand-200 px-5 py-2 text-xs text-brand-500">{bar}</div>}
        <div className="p-6 sm:p-8">{children}</div>
      </div>
    </section>
  );
}

function StatusBadge({ status, excerpt, job }) {
  const { t } = useTranslation();
  if (status === "delivered") return <span className="wx-badge wx-badge--success">{t("job.status.done")}</span>;
  if (ACTIVE.includes(status)) return <span className="wx-badge wx-badge--pending">{t("job.status.inProgress")}</span>;
  // Not "Over the free limit": on a first visit that reads as a refusal (Rodrigo, 2026-11-21).
  if (status === "over_free_limit") {
    if (excerpt?.status === "delivered") return <span className="wx-badge wx-badge--success">{t("job.status.sampleReady")}</span>;
    if ((excerpt && ACTIVE.includes(excerpt.status)) || pickingSample(job)) return <span className="wx-badge wx-badge--pending">{t("job.status.inProgress")}</span>;
    return <span className="wx-badge wx-badge--info">{t("job.status.ready")}</span>;
  }
  return <span className="wx-badge">{status === "cancelled" ? t("job.status.cancelled") : t("job.status.stopped")}</span>;
}

// The Confidence Score: Smells, the wxrks check for meaning problems, scores every sentence by
// the most serious problem it finds (server/services/confidence.js). Severities as wxrks names them.
const SEVERITY = {
  BLOCKER: { label: "job.severity.critical", badge: "wx-badge--danger", bar: "#a52b36" },
  CRITICAL: { label: "job.severity.critical", badge: "wx-badge--danger", bar: "#a52b36" },
  MAJOR: { label: "job.severity.major", badge: "wx-badge--pending", bar: "#d9a23a" },
  MINOR: { label: "job.severity.minor", badge: "wx-badge--info", bar: "#6b9cc4" },
};
const pct = (score) => Math.round(score * 100);
const scoreInk = (score) => (score >= 0.95 ? "#176b45" : score >= 0.85 ? "#785000" : "#a52b36");

function Score({ confidence, entry }) {
  const { t } = useTranslation();
  if (confidence?.status === "pending") {
    return (
      <div className="rounded-md bg-[#f5f7f9] px-4 py-3">
        <p className="text-[13px] font-medium">{t("job.score.checking")}</p>
        <p className="mt-0.5 text-xs text-brand-500">{t("job.score.reading")}</p>
      </div>
    );
  }
  if (!entry) return null;
  const counts = entry.counts || {};
  const critical = (counts.BLOCKER || 0) + (counts.CRITICAL || 0);
  const parts = [
    ["clean", entry.sentences - entry.flagged, "#2f8f5b"],
    ["minor", counts.MINOR || 0, SEVERITY.MINOR.bar],
    ["major", counts.MAJOR || 0, SEVERITY.MAJOR.bar],
    ["critical", critical, SEVERITY.CRITICAL.bar],
  ]
    .filter(([, n]) => n > 0)
    .map(([key, n, color]) => [key, n, color, t(`job.score.part.${key}`, { count: n })]);
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[44px] font-medium leading-none tracking-[-1px]" style={{ color: scoreInk(entry.score) }}>
          {formatPercent(pct(entry.score) / 100)}
        </span>
        <span className="text-[15px] font-medium">{t("job.score.name")}</span>
      </div>
      <p className="mt-2 text-xs text-brand-500">{t("job.score.summary", { sentences: entry.sentences, flagged: entry.flagged || 0 })}</p>
      {entry.sentences > 0 && (
        <>
          <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={formatList(parts.map(([, , , label]) => label))}>
            {parts.map(([key, n, color]) => (
              <span key={key} style={{ width: `${(n / entry.sentences) * 100}%`, background: color }} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-brand-500">
            {parts.map(([key, , color, label]) => (
              <span key={key} className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: color }} />
                {label}
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
  const { t } = useTranslation();
  const entry = confidence?.byLocale?.[locale];
  if (!entry) return null;
  return (
    <p className="mt-1 text-[13px]">
      <span className="font-medium" style={{ color: scoreInk(entry.score) }}>
        {t("job.score.line", { score: formatPercent(pct(entry.score) / 100) })}
      </span>
      <span className="text-brand-500">
        <Dot />
        {t("job.score.lineFlagged", { count: entry.flagged || 0 })}
      </span>
    </p>
  );
}

function Flagged({ entry }) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 space-y-2">
      {entry.top.map((f, i) => {
        const sev = SEVERITY[f.severity] || SEVERITY.MINOR;
        return (
          <div key={i} className="space-y-1 rounded-md border border-brand-200 px-3 py-2.5">
            <span className={`wx-badge ${sev.badge}`}>
              {t(sev.label)}
              {f.type && (
                <>
                  <Dot />
                  <bdi>{f.type}</bdi>
                </>
              )}
            </span>
            {f.target && (
              <p className="text-[13px]" dir="auto">
                {f.target}
              </p>
            )}
            {f.source && (
              <p className="text-xs text-brand-500">
                <Trans i18nKey="job.flagged.original" components={{ text: <bdi>{f.source}</bdi> }} />
              </p>
            )}
            {f.note && (
              <p className="text-xs" dir="auto">
                {f.note}
              </p>
            )}
          </div>
        );
      })}
      {entry.flagged > entry.top.length && <p className="text-[11px] text-brand-500">{t("job.flagged.showing", { shown: entry.top.length, count: entry.flagged })}</p>}
      <p className="text-[11px] text-brand-500">{t("job.flagged.disclaimer")}</p>
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
  const { t } = useTranslation();
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
      setError(errorText(err));
    }
  }

  async function send(e) {
    e.preventDefault();
    try {
      await api.jobFeedback(job.id, { rating, comment }, k);
      setSent(true);
    } catch (err) {
      setError(errorText(err));
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
      <p className="text-[13px] font-medium">{t("job.thumbs.question")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {choice("up", t("job.thumbs.yes"))}
        {choice("down", t("job.thumbs.no"))}
      </div>
      {rating && !sent && (
        <form onSubmit={send} className="mt-3 space-y-2">
          <label className="wx-label" htmlFor={`fb-${job.id}`}>
            {rating === "up" ? t("job.thumbs.upLabel") : t("job.thumbs.downLabel")}
          </label>
          <textarea
            id={`fb-${job.id}`}
            className="wx-input w-full"
            rows={3}
            dir="auto"
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={{ height: "auto", paddingTop: 8, paddingBottom: 8 }}
          />
          <button type="submit" className="wx-button wx-button--compact" disabled={!comment.trim()}>
            {t("common.send")}
          </button>
        </form>
      )}
      {sent && <p className="mt-2 text-xs text-brand-500">{t("job.thumbs.thanks")}</p>}
      {error && <p className="wx-error mt-2 text-xs">{error}</p>}
    </div>
  );
}

// Marketplace partners for the language (server/services/marketplace.js), paid listings only.
// Partner names, places and their badges ("Premium Partner", "Pro") are the marketplace's own.
function Reviewers({ language, entry, loading, flagged }) {
  const { t } = useTranslation();
  const partners = entry?.partners || [];
  const all = entry?.url || "https://marketplace.wxrks.com/";
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-[10px] border border-brand-600 p-5">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-brand-500">{t("job.review.eyebrow")}</p>
        <h2 className="mt-2 text-[17px] font-medium leading-snug">{t("job.review.title", { count: flagged || 0 })}</h2>
        <p className="mt-1.5 text-xs text-brand-500">{t("job.review.intro", { partners: partners.length ? "yes" : "no", language })}</p>
      </div>
      {loading ? (
        <p className="text-xs text-brand-500">{t("job.review.finding", { language })}</p>
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
                  <bdi className="text-[13px] font-medium">{p.name}</bdi>
                  <span className={`wx-badge ${p.badge === "Premium Partner" ? "wx-badge--success" : ""}`} lang="en">
                    {p.badge}
                  </span>
                </span>
                {p.place && (
                  <span className="mt-0.5 block truncate text-[11px] text-brand-500">
                    <bdi>{p.place}</bdi>
                  </span>
                )}
              </span>
              <a href={p.url} className="wx-button wx-button--compact shrink-0">
                {t("job.review.ask")}
              </a>
            </div>
          ))}
        </div>
      ) : (
        <a href={all} className="wx-button self-start">
          {t("job.review.find", { language })}
        </a>
      )}
      <p className="mt-auto text-[11px] text-brand-500">
        <Trans i18nKey="job.review.footer" components={{ a: <a href={all} className="underline" /> }} />
      </p>
    </section>
  );
}

// Every file at once, at the top (Rodrigo, 2026-11-22): one ZIP, a folder per language
// (routes/downloads.js); a single file downloads as itself.
function DownloadAll({ job, q }) {
  const { t } = useTranslation();
  const files = job.deliverables || [];
  if (!files.length) return null;
  const several = job.targetLocales.length > 1;
  return (
    <div className="shrink-0 sm:text-end">
      <a
        href={files.length > 1 ? `/api/jobs/${job.id}/download${q}` : `/api/jobs/${job.id}/files/${files[0].id}${q}`}
        className="wx-button wx-button--primary w-full gap-2 px-5 text-[15px] font-medium no-underline sm:w-auto"
        style={{ minHeight: 46 }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 15V3" />
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="m7 10 5 5 5-5" />
        </svg>
        {files.length > 1 ? t("job.download.all", { count: files.length }) : t("job.download.one")}
      </a>
      {files.length > 1 && <p className="mt-1.5 text-[11px] text-brand-500">{t("job.download.zip", { several: several ? "yes" : "no" })}</p>}
    </div>
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

// language: the name inside the alt text; label: the same name standing alone, as the caption.
function Preview({ job, preview, language, label, q, page = 0, tall = false, only = false }) {
  const { t } = useTranslation();
  const src = (side) => `/api/jobs/${job.id}/preview/${preview.deliverableId}/${side}${q}${page ? `${q ? "&" : "?"}page=${page}` : ""}`;
  return (
    <div className={`grid grid-cols-1 gap-4 ${only ? "" : "sm:grid-cols-2"}`}>
      {[
        ["original", t("job.preview.original")],
        ["translated", label || language],
      ]
        .filter(([side]) => !only || side === "translated")
        .map(([side, caption]) => (
          <figure key={side} className="m-0">
            {/* Big enough to read: side by side on a computer, one above the other on a phone,
                cropped at the bottom on the delivered page (a sample's pages show whole); a click
                opens the page full size. */}
            <a
              href={src(side)}
              target="_blank"
              rel="noopener noreferrer"
              className={`block overflow-hidden rounded border border-brand-200 bg-white ${tall ? "" : "max-h-[420px] sm:max-h-[640px]"}`}
            >
              <img
                src={src(side)}
                alt={side === "original" ? t("job.preview.altOriginal", { page: page + 1 }) : t("job.preview.altTranslated", { page: page + 1, language })}
                className="block w-full"
              />
            </a>
            <figcaption className="mt-1.5 flex justify-between gap-3 text-[11px] text-brand-500">
              <span>{caption}</span>
              <a href={src(side)} target="_blank" rel="noopener noreferrer" className="underline">
                {t("job.preview.fullSize")}
              </a>
            </figcaption>
          </figure>
        ))}
    </div>
  );
}

function EmailForm({ job, k, onDone, intro, cta, compact }) {
  const { t } = useTranslation();
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
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {intro && <p className="text-[13px]">{intro}</p>}
      <div className="wx-field">
        <label className="wx-label" htmlFor={`email-${job.id}`}>
          {t("common.emailLabel")}
        </label>
        <div className={compact ? "flex flex-col gap-2 sm:flex-row" : "space-y-3"}>
          <input
            id={`email-${job.id}`}
            type="email"
            required
            dir="ltr"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("common.emailPlaceholder")}
            className="wx-input w-full sm:flex-1"
          />
          <button type="submit" disabled={busy} className={`wx-button wx-button--primary ${compact ? "" : "w-full"}`} style={{ minHeight: 40 }}>
            {busy ? t("common.oneMoment") : cta}
          </button>
        </div>
      </div>
      <label className="flex items-start gap-2 text-xs text-brand-500">
        <input type="checkbox" checked={news} onChange={(e) => setNews(e.target.checked)} className="mt-0.5" />
        <span>{t("job.email.news")}</span>
      </label>
      {error && <p className="wx-error text-xs">{error}</p>}
      <p className="text-[11px] text-brand-500">{t("job.email.privacy")}</p>
    </form>
  );
}

// The sample of a file stopped at a price, translated free (server/services/excerpt.js): its
// design-kept pages next to the originals, one page at a time, or the text of both when there are
// none. "Pages 3–9 of 252": the sample skips covers and blank pages.
function sampleRange(excerpt, t) {
  const first = excerpt.firstPage || 1;
  const last = first + (excerpt.pages || 1) - 1;
  const total = excerpt.totalPages > last ? excerpt.totalPages : 0;
  return t("job.sample.range", { span: last > first ? "yes" : "no", hasTotal: total ? "yes" : "no", first, last, total });
}

function ExcerptPreview({ excerpt, nameOf, labelOf, tone, defaultOnly = false }) {
  const { t } = useTranslation();
  const [text, setText] = useState(null);
  const [page, setPage] = useState(0);
  const [only, setOnly] = useState(defaultOnly);
  const image = excerpt?.previews?.[0];
  useEffect(() => {
    if (excerpt?.textPreview && !image) api.previewText(excerpt.jobId).then(setText).catch(() => {});
  }, [excerpt?.textPreview, excerpt?.jobId, image]);
  if (!excerpt) return null;
  const pages = excerpt.pages || 1;
  if (ACTIVE.includes(excerpt.status) && !image) {
    return (
      <div className="mt-5 rounded-md bg-[#f5f7f9] p-4">
        <p className="text-[13px]">{t("job.sample.translating", { pages })}</p>
        <div className="wx-progress" role="progressbar" aria-label={t("job.sample.progressLabel")}>
          <span style={{ width: `${PROGRESS[excerpt.status] ?? 10}%` }} />
        </div>
      </div>
    );
  }
  const caption = (
    <p className="mt-2 text-[11px] text-brand-500">
      {t("job.sample.caption", { range: sampleRange(excerpt, t), hasTone: tone ? "yes" : "no", tone: tone || "" })}
    </p>
  );
  if (image) {
    const first = excerpt.firstPage || 1;
    return (
      <div className="mt-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-[12px]">
          <span className="text-brand-500">
            {t("job.sample.page", { page: first + page, hasTotal: excerpt.totalPages ? "yes" : "no", total: excerpt.totalPages || 0 })}
          </span>
          <span className="flex flex-wrap gap-2">
            <span className="hidden rounded-md border border-brand-200 p-0.5 sm:inline-flex" role="group" aria-label={t("job.sample.viewLabel")}>
              <button type="button" aria-pressed={!only} onClick={() => setOnly(false)} className={`rounded px-2.5 py-1 ${only ? "text-brand-500" : "bg-brand-600 text-white"}`}>
                {t("job.sample.sideBySide")}
              </button>
              <button type="button" aria-pressed={only} onClick={() => setOnly(true)} className={`rounded px-2.5 py-1 ${only ? "bg-brand-600 text-white" : "text-brand-500"}`}>
                {t("job.sample.only", { language: labelOf(image.locale) })}
              </button>
            </span>
            {pages > 1 && (
              <>
                <button type="button" className="wx-button" style={{ minHeight: 30 }} disabled={page === 0} onClick={() => setPage(page - 1)}>
                  <span aria-hidden="true" className="inline-block rtl:-scale-x-100">
                    ←
                  </span>
                  {t("job.sample.previous")}
                </button>
                <button type="button" className="wx-button" style={{ minHeight: 30 }} disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                  {t("job.sample.next")}
                  <span aria-hidden="true" className="inline-block rtl:-scale-x-100">
                    →
                  </span>
                </button>
              </>
            )}
          </span>
        </div>
        <Preview job={{ id: excerpt.jobId }} preview={image} language={nameOf(image.locale)} label={labelOf(image.locale)} q="" page={page} tall={pages > 1} only={only} />
        {caption}
      </div>
    );
  }
  if (!text?.target) return null;
  return (
    <div className="mt-5">
      <div className={`grid gap-3 ${text.source ? "sm:grid-cols-2" : ""}`}>
        {[
          ["original", t("job.preview.original"), text.source],
          ["translated", labelOf(text.locale), text.target],
        ]
          .filter(([, , body]) => body)
          .map(([side, label, body]) => (
            <figure key={side} className="m-0">
              <div
                dir={side === "translated" && /^(ar|he|iw|fa|ur)/i.test(text.locale) ? "rtl" : "auto"}
                className="max-h-96 overflow-y-auto whitespace-pre-line rounded border border-brand-200 bg-white p-4 text-[13px] leading-relaxed"
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
      setError(errorText(err));
      setBusy(false);
    }
  }
  return { rerun, busy, error };
}

// A file over the free limit (Rodrigo, 2026-11-09; 2026-11-21: "give a straight line to the
// visitor", versions 3 and 4 of https://claude.ai/artifact/DJecEvPSpxZbwscREcUUKG). A guest sees
// how far the free sample got and one action: an email that signs them up, after which the
// sign-up credit translates the file. Everything else is one quiet line. Signed in (the link
// brings them back here), one button translates it, or packs cover what the balance doesn't.
function PagesBar({ total, first, done }) {
  const { t } = useTranslation();
  if (!total || !done) return null;
  const from = Math.max(0, (first || 1) - 1);
  return (
    <div>
      {total <= 30 ? (
        <div className="flex gap-1" role="img" aria-label={t("job.pages.translated", { done, total })}>
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`wx-seg h-9 flex-1 rounded ${i >= from && i < from + done ? "wx-seg--done" : "wx-seg--todo"}`}
              style={{ animationDelay: `${(i - from) * 0.05}s` }}
            />
          ))}
        </div>
      ) : (
        <div className="wx-progress" role="progressbar" aria-label={t("job.pages.barLabel")} aria-valuemin="0" aria-valuemax={total} aria-valuenow={done}>
          <span style={{ width: `${Math.max(2, (done / total) * 100)}%`, background: "#00742c" }} />
        </div>
      )}
      <div className="mt-2 flex flex-wrap justify-between gap-x-3 text-[13px]">
        <span className="font-medium text-[#176b45]">{t("job.pages.translated", { done, total })}</span>
        <span className="text-brand-500">{t("job.pages.toGo", { count: total - done })}</span>
      </div>
    </div>
  );
}

function OverLimit({ job, bar, nameOf, labelOf, tone }) {
  const { t } = useTranslation();
  const { user, creditBalance } = useAuth();
  const { rerun, busy, error } = useRerun(job);
  const [showPacks, setShowPacks] = useState(false);
  const formRef = useRef(null);
  const words = job.analyzedWords;
  const credits = words != null ? words * job.targetLocales.length : null;
  const balance = creditBalance ?? 0;
  const canRunNow = Boolean(user && credits != null && balance >= credits);
  // The words still to buy: all of them for a guest, what the balance doesn't cover once signed in.
  const toBuy = credits != null ? (user ? credits - balance : credits) : null;
  const fits = toBuy != null ? packFor(toBuy) : null;
  const excerpt = job.excerpt;
  const offer = useSignupOffer({ jobId: job.id, next: `/jobs/${job.id}?finish=1`, words: credits, enabled: !user && !job.rerunJobId });
  // Back from the offer's link (?finish=1), signed in: the whole file starts on its own when the
  // account covers it, so "type your email to download the complete file" needs no second click.
  const navigate = useNavigate();
  const finish = new URLSearchParams(window.location.search).get("finish") === "1";
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!finish || autoStarted.current) return;
    if (job.rerunJobId) {
      autoStarted.current = true;
      navigate(`/jobs/${job.rerunJobId}`);
    } else if (canRunNow) {
      autoStarted.current = true;
      rerun();
    }
  }, [finish, canRunNow, job.rerunJobId]); // eslint-disable-line react-hooks/exhaustive-deps
  const languages = formatList(job.targetLocales.map(nameOf));
  const isPdf = /\.pdf$/i.test(job.files[0]?.name || "");

  // Pages: the PDF's own count when the sample read it, else from the words (250 a page).
  const total = excerpt?.totalPages || (words != null ? pagesFor(words) : null);
  const sampled = excerpt?.status === "delivered" ? excerpt.pages || 1 : 0;
  const picking = pickingSample(job);
  const sampling = Boolean(excerpt && ACTIVE.includes(excerpt.status)) || picking;
  const left = total != null ? Math.max(0, total - sampled) : null;
  // "all 12 pages" or "the whole file", chosen inside each message.
  const whole = { hasTotal: total != null ? "yes" : "no", total: total ?? 0 };

  const quiet = (
    <p className="mt-8 flex flex-wrap justify-center gap-x-1.5 text-center text-[13px] leading-5 text-brand-500">
      <span>{t("job.over.notNow")}</span>
      <Link to="/" className="underline">
        {t("job.over.shorter")}
      </Link>
      {!showPacks && (
        <>
          <span aria-hidden="true">·</span>
          <button type="button" onClick={() => setShowPacks(true)} className="underline">
            {t("job.over.buyFrom", { price: formatMoney(PACKS[0].price) })}
          </button>
        </>
      )}
      <span aria-hidden="true">·</span>
      <a href={DEMO_URL} className="underline">
        {t("job.over.team")}
      </a>
    </p>
  );
  // While the sample is made, its steps stand where it will be, so the email card is beside them
  // from the first minute (Rodrigo, 2026-11-22: "this page would have to have the form on the side").
  const steps = sampling ? (
    <div>
      <ProgressPanel job={job} nameOf={nameOf} tone={tone} sample={excerpt || PICKING} />
      <p className="mt-3 text-xs text-brand-500">{t("job.over.nextSample")}</p>
    </div>
  ) : null;
  const sample = steps || (
    <div id="sample">
      <ExcerptPreview excerpt={excerpt} nameOf={nameOf} labelOf={labelOf} tone={tone} />
    </div>
  );

  if (job.rerunJobId) {
    return (
      <Screen bar={bar}>
        <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.4px]">{t("job.over.inFull")}</h1>
        <Link to={`/jobs/${job.rerunJobId}`} className="wx-button wx-button--primary mt-6" style={{ minHeight: 44 }}>
          {t("job.over.seeWhole")}
        </Link>
      </Screen>
    );
  }

  if (user) {
    return (
      <Screen bar={bar} wide>
        <div className="max-w-2xl">
          <PagesBar total={total} first={excerpt?.firstPage} done={sampled} />
          <h1 className={`${sampled ? "mt-6" : ""} text-[26px] font-semibold leading-8 tracking-[-0.4px]`}>
            {canRunNow ? t("job.over.readyAll", whole) : t("job.over.needsCredits", { credits: credits ?? 0 })}
          </h1>
          <p className="mt-2 text-[15px] leading-6 text-brand-500">
            {canRunNow
              ? t("job.over.uses", { languages, credits, balance, restWords: balance - credits, rest: wordsAndPages(balance - credits) })
              : t("job.over.short", { amount: wordsAndPages(balance), fits: fits ? "yes" : "no", pack: fits ? packLabel(fits) : "" })}
          </p>
          {canRunNow ? (
            <div className="mt-5">
              <button type="button" onClick={rerun} disabled={busy} className="wx-button wx-button--primary px-6 text-[15px] font-medium" style={{ minHeight: 50 }}>
                {busy ? t("common.starting") : t("job.over.translateAll", whole)}
              </button>
              {error && <p className="wx-error mt-2 text-xs">{error}</p>}
            </div>
          ) : (
            <div className="mt-5">
              <PackGrid jobId={job.id} fits={fits} place="over_limit" words={credits} />
            </div>
          )}
        </div>
        {sample}
        {quiet}
        <TrustStrip />
      </Screen>
    );
  }

  // A guest (version 2 of https://claude.ai/artifact/18xGVkjURBpX9DWTCWCKAG): the sample on the
  // left, big enough to read, and on the right one card that stays in view while they read it:
  // "Type your email to download the complete file". The link it sends signs them in and starts
  // the whole file (?finish=1), and the files are emailed when ready, so the promise holds.
  const covers = credits != null && credits <= SIGNUP_CREDIT.words;
  const rest = credits != null ? Math.max(0, credits - SIGNUP_CREDIT.words) : 0;
  const restPack = rest ? packFor(rest) : null;
  const morePages = covers ? Math.floor((SIGNUP_CREDIT.words - credits) / 250) : 0;
  const headline = covers
    ? t("job.over.typeEmail")
    : restPack
      ? t("job.over.translateAllFor", { ...whole, price: formatMoney(restPack.price) })
      : t("job.over.translateAll", whole);
  const sub = covers
    ? t("job.over.allIn", { ...whole, languages })
    : t("job.over.signupSub", {
        restPack: restPack ? "yes" : "no",
        amount: wordsAndPages(SIGNUP_CREDIT.words),
        price: restPack ? formatMoney(restPack.price) : "",
        rest,
      });
  const cta = covers ? t("job.over.getComplete") : t("job.over.signupFree");
  const hasSample = Boolean(excerpt) || picking;
  // Back from a link that had expired or was used (routes/auth.js verify): ask again here.
  const expired = new URLSearchParams(window.location.search).get("expired") === "1";
  const card = (
    <aside className="wx-offer-card">
      {expired && !offer.sent && (
        <p className="mb-4 rounded-md bg-[#fff2d1] px-3 py-2 text-[13px] leading-[19px] text-[#785000]">{t("job.over.expired")}</p>
      )}
      {sampled > 0 && total != null && (
        <div className="flex items-center gap-3.5">
          <PagesRing done={sampled} total={total} />
          <span className="text-[13px] leading-[19px] text-[#176b45]">
            {t("job.over.sampled", { sampled, total, alsoFree: covers && left > 0 ? "yes" : "no", left: left ?? 0 })}
          </span>
        </div>
      )}
      {sampling && (
        <p className="text-[13px] text-brand-500">{excerpt?.pages ? t("job.sample.translating", { pages: excerpt.pages }) : t("job.over.picking")}</p>
      )}
      <h1 className="mt-3 text-[26px] font-bold leading-8 tracking-[-0.4px]">{headline}</h1>
      <p className="mt-2 text-[14px] leading-[21px] text-[#3d4650]">{sub}</p>
      <div className="mt-4">
        <OfferForm offer={offer} cta={cta} formRef={formRef} stacked />
      </div>
      <ul className="mt-4 space-y-2 text-[13px] text-[#3d4650]">
        {[
          isPdf ? t("common.pdfFiles") : t("job.over.byEmail"),
          covers ? (morePages > 0 ? t("job.over.freeLeft", { pages: morePages }) : t("job.over.free")) : t("job.over.payRest"),
          t("job.over.deleted"),
        ].map((x) => (
          <li key={x} className="flex items-center gap-2">
            <Tick />
            {x}
          </li>
        ))}
      </ul>
      <p className="mt-4 flex flex-wrap gap-x-1.5 border-t border-[#e7ebef] pt-3.5 text-xs text-brand-500">
        <span>{t("job.over.notNow")}</span>
        <Link to="/" className="underline">
          {t("job.over.shorterShort")}
        </Link>
        <span aria-hidden="true">·</span>
        <button type="button" onClick={() => setShowPacks(true)} className="underline">
          {t("common.buyWords")}
        </button>
        <span aria-hidden="true">·</span>
        <a href={DEMO_URL} className="underline">
          {t("job.over.team")}
        </a>
      </p>
    </aside>
  );

  return (
    <Screen bar={bar} wide>
      {hasSample ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="order-2 min-w-0 lg:order-1">
            {steps || (
              <div id="sample" className="-mt-5">
                <ExcerptPreview excerpt={excerpt} nameOf={nameOf} labelOf={labelOf} tone={tone} defaultOnly />
              </div>
            )}
          </div>
          <div className="order-1 lg:sticky lg:top-6 lg:order-2">{card}</div>
        </div>
      ) : (
        <div className="mx-auto max-w-xl">{card}</div>
      )}
      {showPacks && (
        <div className="mt-6">
          <PackGrid jobId={job.id} fits={fits} place="over_limit" words={credits} />
        </div>
      )}
      <TrustStrip />
      <StickyOffer
        offer={offer}
        title={covers ? t("job.over.allFree", whole) : headline}
        note={covers ? t("job.over.stickyNote", { toGo: sampled && left > 0 ? "yes" : "no", left: left ?? 0 }) : t("job.over.stickyNoteRest")}
        cta={cta}
        watchRef={formRef}
      />
    </Screen>
  );
}

// The sample's pages against the file's, as a small pale ring: progress, not a second button.
function PagesRing({ done, total }) {
  const { t } = useTranslation();
  const c = 2 * Math.PI * 15;
  const part = Math.min(1, done / total) * c;
  return (
    <svg width="54" height="54" viewBox="0 0 36 36" role="img" aria-label={t("job.pages.translated", { done, total })} className="shrink-0" style={{ width: 54, height: 54 }}>
      <circle cx="18" cy="18" r="15" fill="none" stroke="#e7f5ec" strokeWidth="4" />
      <circle
        cx="18"
        cy="18"
        r="15"
        fill="none"
        stroke="#8fcca6"
        strokeWidth="4"
        strokeDasharray={`${part} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 18 18)"
      />
      <text x="18" y="21.5" textAnchor="middle" fontSize="9" fontWeight="600" fill="#176b45" direction="ltr">
        {formatNumber(done)}/{formatNumber(total)}
      </text>
    </svg>
  );
}

function NeedsCredits({ job, bar, nameOf, labelOf, tone }) {
  const { t } = useTranslation();
  const { creditBalance } = useAuth();
  const { rerun, busy, error } = useRerun(job);
  const needed = job.analyzedWords != null ? job.analyzedWords * job.targetLocales.length : null;
  const short = needed != null && creditBalance != null ? needed - creditBalance : null;
  return (
    <Screen bar={bar} wide>
      <h1 className="text-[22px] font-medium tracking-[-0.3px]">{t("job.needs.title")}</h1>
      <p className="mt-2 text-[13px] text-brand-500">
        {t("job.needs.body", {
          known: needed != null ? "yes" : "no",
          credits: needed ?? 0,
          pages: needed != null ? aboutPages(needed) : "",
          amount: wordsAndPages(creditBalance ?? 0),
        })}
      </p>
      <ExcerptPreview excerpt={job.excerpt} nameOf={nameOf} labelOf={labelOf} tone={tone} />
      {job.rerunJobId ? (
        <Link to={`/jobs/${job.rerunJobId}`} className="wx-button wx-button--primary mt-5" style={{ minHeight: 40 }}>
          {t("job.needs.see")}
        </Link>
      ) : short != null && short <= 0 ? (
        <button type="button" onClick={rerun} disabled={busy} className="wx-button wx-button--primary mt-5" style={{ minHeight: 40 }}>
          {busy ? t("common.starting") : t("job.needs.translateNow")}
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
