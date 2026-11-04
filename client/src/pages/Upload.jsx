import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { PACKS, pagesFor } from "../pricing";
import { TONES, TONE_NOTE_MAX } from "../tone";

const ACCEPT = ".pdf,.docx,.doc,.txt,.csv,.json,.yml,.yaml,.xlsx,.pptx,.md,.html,.xml,.srt";

// Landing pages share this upload screen; keep the headings in step with PAGES in server/seo.js.
const LANDING = {
  "/": { h1: "Translate a document", sub: "See the first page in your language before you download." },
  "/pdf": {
    h1: "Translate a PDF and keep its design",
    sub: "Get an editable Word file and a PDF that looks like your original. See page 1 before you download.",
  },
  "/documents": {
    h1: "Translate Word, PowerPoint, Excel and more",
    sub: "Your file comes back in the format you uploaded. See it before you download.",
  },
};

export function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

export default function Upload() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const landing = LANDING[pathname] || LANDING["/"];
  const [languages, setLanguages] = useState([]);
  const [files, setFiles] = useState([]);
  const [sourceLocale, setSourceLocale] = useState("en");
  const [targetLocales, setTargetLocales] = useState([]);
  const [tonePreset, setTonePreset] = useState("auto");
  const [toneNote, setToneNote] = useState("");
  const [allowance, setAllowance] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    api.languages().then((d) => setLanguages(d.languages)).catch(() => setError("Could not load languages."));
  }, []);

  useEffect(() => {
    api.allowance().then(setAllowance).catch(() => setAllowance(null));
  }, [user]);

  // wxrks spells English "en_us" or "en"; start on whichever the catalog has.
  useEffect(() => {
    if (!languages.length || languages.some((l) => l.code === sourceLocale)) return;
    const en = languages.find((l) => /^en([-_]us)?$/i.test(l.code)) || languages[0];
    setSourceLocale(en.code);
  }, [languages, sourceLocale]);

  function addFiles(list) {
    const incoming = Array.from(list);
    setFiles((prev) => {
      const next = user ? [...prev] : [];
      for (const f of incoming) if (!next.some((p) => p.name === f.name && p.size === f.size)) next.push(f);
      return user ? next : next.slice(0, 1);
    });
    setError(null);
  }

  async function submit() {
    if (!files.length) return setError("Add a document first.");
    const targets = targetLocales.filter((c) => c !== sourceLocale);
    if (!targets.length) return setError("Pick the language to translate into.");
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      form.append("sourceLocale", sourceLocale);
      form.append("targetLocales", targets.join(","));
      form.append("tonePreset", tonePreset);
      form.append("toneNote", toneNote);
      const { jobId } = await api.createJob(form);
      navigate(`/jobs/${jobId}`);
    } catch (err) {
      setError(
        err.code === "free_limit_reached"
          ? "You've used today's free document. Come back tomorrow, or buy words to translate it now."
          : err.message
      );
      setSubmitting(false);
    }
  }


  return (
    <section className="mx-auto max-w-xl">
      <div className="rounded-[10px] border border-brand-200 bg-white p-6 sm:p-8">
        <h1 className="text-[29px] font-medium leading-tight tracking-[-0.4px]">{landing.h1}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-brand-500">{landing.sub}</p>
        <Allowance allowance={allowance} />

        <div className="mt-6 space-y-5">
          {files.length === 0 || user ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
              className={`cursor-pointer rounded-[10px] border border-dashed px-6 py-10 text-center transition ${
                dragOver ? "border-brand-600 bg-brand-50" : "border-[#757d88] hover:bg-[#f7f8fa]"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple={Boolean(user)}
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
              />
              <p className="text-[15px] font-medium">Drop a document here, or choose a file</p>
              <p className="mt-1 text-xs text-brand-500">
                PDF, Word, PowerPoint, Excel and more. Up to 25&nbsp;MB{user ? ", 10 files per job" : ""}.
              </p>
            </div>
          ) : null}

          {files.length > 0 && (
            <ul className="space-y-2">
              {files.map((f) => (
                <li key={f.name} className="flex items-center gap-3 rounded-md border border-brand-200 px-3 py-2.5">
                  <span className="text-brand-500">
                    <FileIcon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{f.name}</span>
                    <span className="block text-[11px] text-brand-500">{(f.size / 1024).toFixed(0)} KB</span>
                  </span>
                  <button
                    type="button"
                    className="wx-button wx-button--ghost wx-button--compact"
                    onClick={() => setFiles(files.filter((x) => x !== f))}
                  >
                    {user ? "Remove" : "Change"}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* items-start: chips under "Translate into" must not stretch the "From" field */}
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <LanguagePicker
              id="source"
              label="From"
              languages={languages}
              selected={[sourceLocale]}
              onChange={(codes) => setSourceLocale(codes[0])}
              placeholder="Type a language"
            />
            <LanguagePicker
              id="target"
              label="Translate into"
              languages={languages}
              selected={targetLocales}
              onChange={setTargetLocales}
              exclude={[sourceLocale]}
              multiple={Boolean(user)}
              placeholder="Type a language, e.g. Portuguese"
            />
          </div>

          <TonePicker preset={tonePreset} note={toneNote} onPreset={setTonePreset} onNote={setToneNote} />

          <PlatformFeatures />

          {error && <div className="wx-alert wx-alert--danger"><span>{error}</span></div>}

          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="wx-button wx-button--primary w-full"
            style={{ minHeight: 40 }}
          >
            {submitting ? "Uploading…" : "Translate"}
          </button>

          {!user && (
            <p className="text-[11px] leading-relaxed text-brand-500">
              Free: one document a day, up to 1,000 words, into one language. No card, no account. For longer documents
              and more languages,{" "}
              <Link to="/pricing" className="underline">
                buy words
              </Link>{" "}
              from ${PACKS[0].price} or{" "}
              <Link to="/login" className="underline">
                sign in
              </Link>
              . Scanned PDFs (pictures of pages) can't be translated yet.
            </p>
          )}
        </div>
      </div>
      <TrustStrip />
    </section>
  );
}

// What's left, as a meter: today's free document, or the credit balance once signed in.
function Allowance({ allowance }) {
  if (!allowance) return null;
  if (allowance.signedIn) {
    const { balance } = allowance;
    return (
      <div className="mt-5 flex items-center justify-between gap-3 rounded-md bg-[#f5f7f9] px-4 py-3 text-xs">
        <span>
          <span className="font-medium">{balance.toLocaleString("en-US")} credits</span>
          <span className="text-brand-500">
            {balance > 0 ? ` · about ${pagesFor(balance).toLocaleString("en-US")} pages into one language` : " · buy words to start"}
          </span>
        </span>
        <Link to="/pricing" className="wx-button wx-button--compact shrink-0">
          Buy words
        </Link>
      </div>
    );
  }
  const hours = Math.max(1, Math.ceil((new Date(allowance.resetsAt) - Date.now()) / 3600000));
  return (
    <div className="mt-5 rounded-md bg-[#f5f7f9] px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">Free today</span>
        <span className="text-brand-500">
          {allowance.freeAvailable
            ? `1 document, up to ${allowance.maxWords.toLocaleString("en-US")} words`
            : `Used. Your next free document is in ${hours} h`}
        </span>
      </div>
      <div className="wx-progress" role="meter" aria-label="Free documents left today" aria-valuemin="0" aria-valuemax="1" aria-valuenow={allowance.freeAvailable ? 1 : 0}>
        <span style={{ width: allowance.freeAvailable ? "100%" : "0%" }} />
      </div>
      {!allowance.freeAvailable && (
        <p className="mt-2 text-[11px] text-brand-500">
          Need it today?{" "}
          <Link to="/pricing" className="underline">
            Words from ${PACKS[0].price}
          </Link>
          , paid once.
        </p>
      )}
    </div>
  );
}

// The tone, through a Sous-Chef agent: a preset, plus anything the visitor wants to add.
function TonePicker({ preset, note, onPreset, onNote }) {
  const hint = TONES.find((t) => t.key === preset)?.hint;
  return (
    <fieldset className="wx-field">
      <legend className="wx-label mb-1.5 flex w-full items-baseline justify-between gap-3">
        <span>How should it sound?</span>
        <span className="text-[11px] font-normal text-brand-500">Sous-Chef, the wxrks tone agent</span>
      </legend>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tone">
        {TONES.map((t) => (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={preset === t.key}
            onClick={() => onPreset(t.key)}
            className={`rounded-md border px-3 py-1.5 text-xs ${
              preset === t.key ? "border-brand-600 bg-brand-50 font-medium" : "border-brand-200 hover:bg-[#f7f8fa]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-brand-500">{hint}</p>
      <input
        className="wx-input mt-2 w-full"
        value={note}
        maxLength={TONE_NOTE_MAX}
        onChange={(e) => onNote(e.target.value)}
        aria-label="Anything else Sous-Chef should know"
        placeholder="Anything else? For example: “for teenagers”"
      />
    </fieldset>
  );
}

const PLATFORM_URL =
  "https://wxrks.com/pricing?utm_source=translate.wxrks.com&utm_medium=referral&utm_campaign=free-translator&utm_content=platform-features";

const PLATFORM_FEATURES = [
  ["Translation memory", "Reuse your past translations, sentence by sentence"],
  ["Glossary", "Keep your terms the same in every file"],
  ["Past translations", "Every file you translated, in one place"],
];

// What the wxrks platform adds, shown switched off: the visitor sees it exists and where to get it.
function PlatformFeatures() {
  return (
    <div className="rounded-md border border-dashed border-brand-200 px-4 py-2">
      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-xs font-medium text-brand-500">In the wxrks platform</p>
        <a href={PLATFORM_URL} className="text-[11px] underline">
          Start free in wxrks
        </a>
      </div>
      <ul>
        {PLATFORM_FEATURES.map(([title, note]) => (
          <li key={title}>
            <label className="wx-switch w-full cursor-not-allowed" title="Available in the wxrks platform">
              <input type="checkbox" role="switch" disabled className="cursor-not-allowed opacity-50" />
              <span className="min-w-0 flex-1 opacity-60">
                <span className="block text-[13px]">{title}</span>
                <span className="block text-[11px] text-brand-500">{note}</span>
              </span>
              <LockIcon />
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-brand-500" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

const UTM = "utm_source=translate.wxrks.com&utm_medium=referral&utm_campaign=free-translator&utm_content=trust";

// Who is behind the translator. The badges are wxrks's own, the same ones wxrks.com shows.
export function TrustStrip() {
  return (
    <div className="mt-4 flex items-center gap-5 rounded-[10px] border border-brand-200 bg-white px-5 py-4">
      <img src="/badges/g2-leader-fall-2026.svg" alt="G2 Leader, Fall 2026" className="h-[72px] w-auto shrink-0" />
      <div className="min-w-0">
        <p className="text-[13px] font-medium">
          Made by{" "}
          <a href={`https://wxrks.com/?${UTM}`} className="underline">
            wxrks
          </a>
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-brand-500">
          20 years in translation. Our translation platform is a G2 Leader and is audited for SOC 2 Type 2.
        </p>
        <p className="mt-2 flex items-center gap-2 text-[11px] text-brand-500">
          <img src="/badges/soc2.svg" alt="" className="h-3.5 w-auto" />
          <span>
            SOC 2 Type 2 ·{" "}
            <a href={`https://wxrks.com/security?${UTM}`} className="underline">
              How we protect your files
            </a>
          </span>
        </p>
      </div>
    </div>
  );
}

// Type a few letters, then click a match or press Enter. There are 100+ languages, so typing
// beats scrolling a list. Single mode shows the chosen name in the box; multiple mode adds chips.
function LanguagePicker({ id, label, languages, selected, onChange, exclude = [], multiple = false, placeholder }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const nameOf = (code) => languages.find((l) => l.code === code)?.name || code;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return languages
      .filter((l) => !exclude.includes(l.code) && !(multiple && selected.includes(l.code)))
      .filter((l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [query, languages, exclude, multiple, selected]);

  function pick(l) {
    onChange(multiple ? [...selected, l.code] : [l.code]);
    setQuery("");
    setActive(0);
    if (!multiple) document.getElementById(id)?.blur();
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && matches[active]) {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === "Escape") {
      setQuery("");
    }
  }

  const shown = !multiple && !focused && selected[0] ? nameOf(selected[0]) : query;
  const open = focused && matches.length > 0;

  return (
    <div className="wx-field">
      <label className="wx-label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className="wx-input w-full"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          autoComplete="off"
          value={shown}
          placeholder={!multiple && selected[0] ? nameOf(selected[0]) : multiple && selected.length ? "Add another language" : placeholder}
          onFocus={() => {
            setFocused(true);
            setQuery("");
          }}
          onBlur={() => {
            setFocused(false);
            setQuery("");
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {open && (
          <ul id={`${id}-list`} role="listbox" className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-brand-200 bg-white shadow-lg">
            {matches.map((l, i) => (
              <li key={l.code} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={`w-full px-3 py-2 text-left text-[13px] ${i === active ? "bg-brand-50" : ""} hover:bg-brand-50`}
                  onMouseDown={(e) => e.preventDefault()} // keep focus so the click lands before blur
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(l)}
                >
                  {l.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {multiple && selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((code) => (
            <span key={code} className="inline-flex items-center gap-1.5 rounded-md border border-[#757d88] px-2 py-1 text-xs">
              {nameOf(code)}
              <button type="button" aria-label={`Remove ${nameOf(code)}`} onClick={() => onChange(selected.filter((c) => c !== code))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
