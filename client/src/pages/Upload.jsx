import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

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
  const [targetQuery, setTargetQuery] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    api.languages().then((d) => setLanguages(d.languages)).catch(() => setError("Could not load languages."));
  }, []);

  // wxrks spells English "en_us" or "en"; start on whichever the catalog has.
  useEffect(() => {
    if (!languages.length || languages.some((l) => l.code === sourceLocale)) return;
    const en = languages.find((l) => /^en([-_]us)?$/i.test(l.code)) || languages[0];
    setSourceLocale(en.code);
  }, [languages, sourceLocale]);

  const targetMatches = useMemo(() => {
    const q = targetQuery.trim().toLowerCase();
    if (!q) return [];
    return languages
      .filter((l) => !targetLocales.includes(l.code) && l.code !== sourceLocale)
      .filter((l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q))
      .slice(0, 8);
  }, [targetQuery, languages, targetLocales, sourceLocale]);

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
    if (!targetLocales.length) return setError("Pick the language to translate into.");
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      form.append("sourceLocale", sourceLocale);
      form.append("targetLocales", targetLocales.join(","));
      const { jobId } = await api.createJob(form);
      navigate(`/jobs/${jobId}`);
    } catch (err) {
      setError(
        err.code === "free_limit_reached"
          ? "You've used today's free document. Come back tomorrow, or sign in to translate with credits."
          : err.message
      );
      setSubmitting(false);
    }
  }

  const nameOf = (code) => languages.find((l) => l.code === code)?.name || code;
  const sorted = useMemo(() => [...languages].sort((a, b) => a.name.localeCompare(b.name)), [languages]);

  return (
    <section className="mx-auto max-w-xl">
      <div className="rounded-[10px] border border-brand-200 bg-white p-6 sm:p-8">
        <h1 className="text-[29px] font-medium leading-tight tracking-[-0.4px]">{landing.h1}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-brand-500">{landing.sub}</p>

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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="wx-field">
              <label className="wx-label" htmlFor="source">
                From
              </label>
              <select id="source" className="wx-select" value={sourceLocale} onChange={(e) => setSourceLocale(e.target.value)}>
                {sorted.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            {user ? (
              <div className="wx-field">
                <label className="wx-label" htmlFor="targets">
                  Translate into
                </label>
                <div className="relative">
                  <input
                    id="targets"
                    className="wx-input w-full"
                    value={targetQuery}
                    onChange={(e) => setTargetQuery(e.target.value)}
                    placeholder="Type a language, e.g. Portuguese"
                  />
                  {targetMatches.length > 0 && (
                    <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-brand-200 bg-white shadow-lg">
                      {targetMatches.map((l) => (
                        <li key={l.code}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-[13px] hover:bg-brand-50"
                            onClick={() => {
                              setTargetLocales([...targetLocales, l.code]);
                              setTargetQuery("");
                            }}
                          >
                            {l.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {targetLocales.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {targetLocales.map((code) => (
                      <span key={code} className="inline-flex items-center gap-1.5 rounded-md border border-[#757d88] px-2 py-1 text-xs">
                        {nameOf(code)}
                        <button
                          type="button"
                          aria-label={`Remove ${nameOf(code)}`}
                          onClick={() => setTargetLocales(targetLocales.filter((c) => c !== code))}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="wx-field">
                <label className="wx-label" htmlFor="target">
                  Translate into
                </label>
                <select
                  id="target"
                  className="wx-select"
                  value={targetLocales[0] || ""}
                  onChange={(e) => setTargetLocales(e.target.value ? [e.target.value] : [])}
                >
                  <option value="">Choose a language</option>
                  {sorted
                    .filter((l) => l.code !== sourceLocale)
                    .map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>

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
              Free: one document a day, up to 1,000 words. No card, no account.{" "}
              <Link to="/login" className="underline">
                Sign in
              </Link>{" "}
              for longer documents and more languages. Scanned PDFs (pictures of pages) can't be translated yet.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
