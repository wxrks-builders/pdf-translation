import { wordsAndPages } from "../pricing";

// The steps of a job while it works, each kept on screen once done (Rodrigo, 2026-11-21: "stack
// everything that was made, to give the idea that it is evolving and checked many things";
// version 1 of https://claude.ai/artifact/3ey74oucQ4sD6WrZ9oLYEP). Every step is an event the
// job already records (job.timeline), so nothing here is staged: a step ticks when its event is
// there, with how long into the job it came and what it found. Steps that may not happen to a
// file (OCR, the design-kept PDF) show only once they do.

const norm = (code) => String(code || "").toLowerCase().replace(/[-_]/g, "");

function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function size(bytes) {
  if (!bytes) return null;
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// → { steps: [{ key, label, detail, time, state: done|active|todo }], title, sub, done, total }
export function progressSteps(job, nameOf, tone) {
  const t = job.timeline || [];
  const start = new Date(job.createdAt || t[0]?.at || Date.now()).getTime();
  const find = (name) => t.find((e) => e.event === name);
  const when = (e) => (e ? clock(new Date(e.at).getTime() - start) : null);
  const file = job.files[0];
  const isPdf = /\.pdf$/i.test(file?.name || "");
  const steps = [];

  steps.push({
    key: "received",
    label: job.files.length > 1 ? `${job.files.length} files received` : "File received",
    activeLabel: "Receiving your file",
    detail: job.files.length > 1 ? null : size(file?.sizeBytes),
    done: true,
    at: t[0],
  });

  const ocr = find("ocr_done");
  if (ocr) {
    steps.push({
      key: "ocr",
      label: "Text read from your scanned pages",
      detail: `${ocr.detail?.pages ?? file?.scannedPages} ${ocr.detail?.pages === 1 ? "page" : "pages"} read`,
      done: true,
      at: ocr,
    });
  }

  if (isPdf) {
    const converted = find("pdf_converted");
    const reader = find("reader_only");
    steps.push({
      key: "convert",
      label: reader ? "Read by our own reader" : "Editable Word version made",
      activeLabel: "Making a Word version of your PDF",
      todoLabel: "A Word version of your PDF",
      sub: "A version you can edit in Word.",
      detail: reader?.detail?.pages ? `${reader.detail.pages} pages` : converted ? "Converted from the PDF" : null,
      done: Boolean(converted || reader || find("files_uploaded")),
      at: converted || reader || find("files_uploaded"),
    });
  }

  const analyzed = find("analyzed");
  steps.push({
    key: "count",
    label: "Words counted",
    activeLabel: "Counting words",
    todoLabel: "Word count",
    sub: "Usually under a minute for a short document.",
    detail: analyzed ? wordsAndPages(analyzed.detail?.words ?? job.analyzedWords ?? 0) : null,
    done: Boolean(analyzed),
    at: analyzed,
  });

  if (tone) {
    const applied = find("tone_applied");
    if (!find("tone_failed")) {
      steps.push({ key: "tone", label: "Your tone set", activeLabel: "Setting your tone", todoLabel: "Your tone", detail: tone, done: Boolean(applied), at: applied });
    }
  }

  for (const loc of job.targetLocales) {
    const stored = t.find((e) => e.event === "deliverable_stored" && norm(e.detail?.locale) === norm(loc));
    steps.push({
      key: `translate-${loc}`,
      label: `Translated into ${nameOf(loc)}`,
      activeLabel: `Translating into ${nameOf(loc)}`,
      todoLabel: `Translation into ${nameOf(loc)}`,
      sub: "The longest step. You can leave your email and close the tab.",
      detail: stored ? "The whole document as context" : null,
      done: Boolean(stored),
      at: stored,
    });
  }

  if (find("layout_started")) {
    const ends = t.filter((e) => ["layout_pdf_stored", "layout_pdf_skipped"].includes(e.event));
    const kept = ends.some((e) => e.event === "layout_pdf_stored");
    steps.push({
      key: "layout",
      label: kept || !ends.length ? "Translation put back on your pages" : "Word file only for this one",
      activeLabel: "Putting the translation back on your pages",
      todoLabel: "The PDF that looks like your original",
      sub: "Drawing the translation onto your original pages.",
      detail: kept ? "The PDF that looks like your original" : ends.length ? "Its design couldn't be rebuilt" : null,
      done: ends.length >= job.targetLocales.length || Boolean(find("layout_timeout")),
      at: ends[ends.length - 1],
    });
  }

  steps.push({ key: "ready", label: "Files ready", activeLabel: "Getting your files ready", todoLabel: "Your files, ready to download", done: job.status === "delivered" });

  let activeSeen = false;
  const out = steps.map((s) => {
    let state = "todo";
    if (s.done) state = "done";
    else if (!activeSeen) {
      state = "active";
      activeSeen = true;
    }
    return { ...s, state, time: s.done ? when(s.at) : null };
  });
  const active = out.find((s) => s.state === "active");
  const done = out.filter((s) => s.state === "done").length;
  return {
    steps: out,
    title: active?.activeLabel || "Almost done",
    sub: active?.sub || "",
    done,
    total: out.length,
    pct: Math.min(95, Math.max(5, Math.round((done / out.length) * 100))),
  };
}

export function ProgressChecklist({ steps }) {
  return (
    <ol className="mt-5 space-y-0.5" aria-label="What has been done">
      {steps.map((s) => (
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
              <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "active" ? " (in progress)" : ""}</span>
            </span>
            {s.state === "done" && s.detail && <span className="text-xs leading-4 text-brand-500">{s.detail}</span>}
          </span>
          {s.time && <span className="text-xs leading-5 tabular-nums text-brand-500">{s.time}</span>}
        </li>
      ))}
    </ol>
  );
}
