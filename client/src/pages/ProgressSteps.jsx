import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { formatFileSize } from "../i18n/format";
import { wordsAndPages } from "../pricing";

// The steps of a job while it works, each kept on screen once done (Rodrigo, 2026-11-21: "stack
// everything that was made"; version 1 of https://claude.ai/artifact/3ey74oucQ4sD6WrZ9oLYEP).
// Every step is an event the job records (job.timeline), so nothing is staged: a step ticks when
// its event is there, with how long into the job it came and what it found. Steps a file may not
// need (OCR, the design-kept PDF) show only once they happen.
//
// 2026-11-22 ("use the same page loading for both stages ... break down" the long wait): a file
// over the free limit keeps this page while its sample is made, the sample's own steps following
// the file's; the step at work shows its running time, how long it usually takes (from recent
// jobs of a similar size: routes/jobs.js estimateFor) and a thin bar against that; and a paid job
// that continued a kept project shows the steps it didn't need to redo as done "earlier".
//
// Every label is a whole message (progress.*): the sample's steps choose between "the sample's
// pages", "pages 3 to 9" and "page 3" inside the message, so each language builds its own sentence.

const norm = (code) => String(code || "").toLowerCase().replace(/[-_]/g, "");
const t = (key, values) => i18n.t(key, values);

export function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function usually(secs) {
  if (!secs) return null;
  if (secs < 60) return t("progress.usuallyUnderMinute");
  return t("progress.usuallyMinutes", { minutes: Math.round(secs / 60) });
}

// → { steps: [{ key, label, activeLabel, todoLabel, detail, time, state, since, estimate }], title, sub, done, total, pct }
// opts.sample: the summary of a file's sample while it is made (its timeline, pages, estimate).
export function progressSteps(job, nameOf, tone, { sample = null } = {}) {
  const tl = job.timeline || [];
  const start = new Date(job.createdAt || tl[0]?.at || Date.now()).getTime();
  const find = (name, list = tl) => list.find((e) => e.event === name);
  const file = job.files[0];
  const isPdf = /\.pdf$/i.test(file?.name || "");
  const steps = [];

  steps.push({
    key: "received",
    label: t("progress.received.label", { files: job.files.length }),
    activeLabel: t("progress.received.active"),
    detail: job.files.length > 1 || !file?.sizeBytes ? null : formatFileSize(file.sizeBytes),
    done: true,
    at: find("project_created") && new Date(find("project_created").at).getTime() < start ? find("project_created") : tl[0],
  });

  const ocr = find("ocr_done");
  if (ocr) {
    steps.push({
      key: "ocr",
      label: t("progress.ocr.label"),
      detail: t("progress.ocr.detail", { pages: ocr.detail?.pages ?? file?.scannedPages ?? 0 }),
      done: true,
      at: ocr,
    });
  }

  if (isPdf) {
    const converted = find("pdf_converted");
    const reader = find("reader_only");
    steps.push({
      key: "convert",
      label: reader ? t("progress.convert.reader") : t("progress.convert.label"),
      activeLabel: t("progress.convert.active"),
      todoLabel: t("progress.convert.todo"),
      sub: t("progress.convert.sub"),
      detail: reader?.detail?.pages ? t("progress.convert.pages", { pages: reader.detail.pages }) : converted ? t("progress.convert.converted") : null,
      done: Boolean(converted || reader || find("files_uploaded")),
      at: converted || reader || find("files_uploaded"),
    });
  }

  const analyzed = find("analyzed");
  steps.push({
    key: "count",
    label: t("progress.count.label"),
    activeLabel: t("progress.count.active"),
    todoLabel: t("progress.count.todo"),
    sub: t("progress.count.sub"),
    detail: analyzed ? wordsAndPages(analyzed.detail?.words ?? job.analyzedWords ?? 0) : null,
    done: Boolean(analyzed),
    at: analyzed,
  });

  if (sample) {
    // Over the free limit: the sample's steps continue this page until it is ready.
    const st = sample.timeline || [];
    const first = sample.firstPage || 1;
    const last = first + (sample.pages || 1) - 1;
    // Before its pages are picked (no sample job yet), the steps say "the sample's pages".
    const range = { range: !sample.pages ? "none" : last > first ? "span" : "single", first, last };
    const picked = find("excerpt_started");
    steps.push({
      key: "sample-pick",
      label: t("progress.sample.picked", range),
      activeLabel: t("progress.sample.picking"),
      detail: t("progress.sample.pickedDetail", { amount: wordsAndPages(job.freeLimit || 2000) }),
      done: Boolean(picked),
      at: picked,
    });
    const counted = find("analyzed", st);
    steps.push({
      key: "sample-prep",
      label: t("progress.sample.prepared", range),
      activeLabel: t("progress.sample.preparing", range),
      todoLabel: t("progress.sample.preparing", range),
      sub: t("progress.sample.prepSub"),
      detail: counted?.detail?.words ? wordsAndPages(counted.detail.words) : null,
      done: Boolean(counted),
      at: counted,
    });
    for (const loc of job.targetLocales) {
      const stored = st.find((e) => e.event === "deliverable_stored" && norm(e.detail?.locale) === norm(loc));
      const language = nameOf(loc);
      steps.push({
        key: `sample-${loc}`,
        label: t("progress.sample.translated", { ...range, language }),
        activeLabel: t("progress.sample.translating", { ...range, language }),
        todoLabel: t("progress.translate.todo", { language }),
        sub: t("progress.sample.translateSub"),
        done: Boolean(stored),
        at: stored,
        estimate: sample.estimate?.translate,
      });
    }
    if (find("layout_started", st)) {
      const ends = st.filter((e) => ["layout_pdf_stored", "layout_pdf_skipped"].includes(e.event));
      steps.push({
        key: "sample-layout",
        label: t("progress.sample.layoutLabel"),
        activeLabel: t("progress.layout.active"),
        todoLabel: t("progress.sample.layoutTodo"),
        sub: t("progress.layout.sub"),
        done: ends.length >= job.targetLocales.length || Boolean(find("layout_timeout", st)),
        at: ends[ends.length - 1],
        estimate: sample.estimate?.layout,
      });
    }
    steps.push({
      key: "sample-ready",
      label: t("progress.sample.readyLabel"),
      activeLabel: t("progress.sample.readyActive"),
      todoLabel: t("progress.sample.readyTodo"),
      done: false,
    });
  } else {
    const charged = find("credits_charged");
    if (charged) {
      steps.push({
        key: "credits",
        label: t("progress.credits.label"),
        detail: t("progress.credits.detail", { credits: Number(charged.detail?.amount || 0) }),
        done: true,
        at: charged,
      });
    }

    if (tone && !find("tone_failed")) {
      const applied = find("tone_applied");
      steps.push({
        key: "tone",
        label: t("progress.tone.label"),
        activeLabel: t("progress.tone.active"),
        todoLabel: t("progress.tone.todo"),
        detail: tone,
        done: Boolean(applied),
        at: applied,
      });
    }

    for (const loc of job.targetLocales) {
      const stored = tl.find((e) => e.event === "deliverable_stored" && norm(e.detail?.locale) === norm(loc));
      const language = nameOf(loc);
      steps.push({
        key: `translate-${loc}`,
        label: t("progress.translate.label", { language }),
        activeLabel: t("progress.translate.active", { language }),
        todoLabel: t("progress.translate.todo", { language }),
        sub: t("progress.translate.sub"),
        detail: stored ? t("progress.translate.detail") : null,
        done: Boolean(stored),
        at: stored,
        estimate: job.estimate?.translate,
      });
    }

    if (find("layout_started")) {
      const ends = tl.filter((e) => ["layout_pdf_stored", "layout_pdf_skipped"].includes(e.event));
      const kept = ends.some((e) => e.event === "layout_pdf_stored");
      steps.push({
        key: "layout",
        label: kept || !ends.length ? t("progress.layout.label") : t("progress.layout.wordOnly"),
        activeLabel: t("progress.layout.active"),
        todoLabel: t("progress.layout.todo"),
        sub: t("progress.layout.sub"),
        detail: kept ? t("progress.layout.todo") : ends.length ? t("progress.layout.failed") : null,
        done: ends.length >= job.targetLocales.length || Boolean(find("layout_timeout")),
        at: ends[ends.length - 1],
        estimate: job.estimate?.layout,
      });
    }

    steps.push({
      key: "ready",
      label: t("progress.ready.label"),
      activeLabel: t("progress.ready.active"),
      todoLabel: t("progress.ready.todo"),
      done: job.status === "delivered",
    });
  }

  // The latest moment a done step came in: when the step at work started.
  const lastDone = steps
    .filter((s) => s.done && s.at)
    .map((s) => new Date(s.at.at).getTime())
    .reduce((a, b) => Math.max(a, b), start);
  let activeSeen = false;
  const out = steps.map((s) => {
    let state = "todo";
    if (s.done) state = "done";
    else if (!activeSeen) {
      state = "active";
      activeSeen = true;
    }
    const at = s.at ? new Date(s.at.at).getTime() : null;
    return {
      ...s,
      state,
      time: s.done && at ? (at < start ? t("progress.earlier") : clock(at - start)) : null,
      since: state === "active" ? lastDone : null,
    };
  });
  const active = out.find((s) => s.state === "active");
  const done = out.filter((s) => s.state === "done").length;
  return {
    steps: out,
    title: active?.activeLabel || t("progress.almostDone"),
    sub: active?.sub || "",
    done,
    total: out.length,
    pct: Math.min(95, Math.max(5, Math.round((done / out.length) * 100))),
  };
}

export function ProgressChecklist({ steps }) {
  const { t: tr } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <ol className="mt-5 space-y-0.5" aria-label={tr("progress.listLabel")}>
      {steps.map((s) => {
        const running = s.state === "active" && s.since ? now - s.since : null;
        const fill = running != null && s.estimate ? Math.min(95, (running / 1000 / s.estimate) * 100) : null;
        return (
          <li key={s.key} className={`wx-step wx-step--${s.state} flex items-start gap-3 rounded-md px-2.5 py-2`}>
            <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
              {s.state === "done" ? (
                <span className="wx-step-tick flex h-5 w-5 items-center justify-center rounded-full bg-[#e7f5ec]">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#176b45" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </span>
              ) : s.state === "active" ? (
                <svg className="wx-step-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="#e7ebef" strokeWidth="3" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="#252a31" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : (
                <span className="h-3.5 w-3.5 rounded-full border-2 border-[#c3c9d0]" />
              )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={`wx-step-label text-[13px] leading-5 ${s.state === "active" ? "font-medium" : s.state === "todo" ? "text-brand-500" : ""}`}>
                {s.state === "active" ? s.activeLabel || s.label : s.state === "todo" ? s.todoLabel || s.label : s.label}
                {s.state !== "todo" && <span className="sr-only"> {s.state === "done" ? tr("progress.srDone") : tr("progress.srActive")}</span>}
              </span>
              {s.state === "done" && s.detail && <span className="text-xs leading-4 text-brand-500">{s.detail}</span>}
              {s.state === "active" && s.estimate && <span className="text-xs leading-4 text-brand-500">{usually(s.estimate)}</span>}
              {fill != null && (
                <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-[#e7ebef]" aria-hidden="true">
                  <span className="block h-1 rounded-full bg-[#8fcca6] transition-[width] duration-1000 ease-linear" style={{ width: `${fill}%` }} />
                </span>
              )}
            </span>
            {s.time && <span className="text-xs leading-5 tabular-nums text-brand-500">{s.time}</span>}
            {running != null && (
              <span className="text-xs leading-5 tabular-nums text-brand-500" dir="ltr">
                {clock(running)}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
