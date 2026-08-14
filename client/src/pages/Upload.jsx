import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

const ACCEPT = ".pdf,.docx,.doc,.txt,.csv,.json,.yml,.yaml,.xlsx,.pptx,.md,.html,.xml,.srt";

export default function Upload() {
  const { user } = useAuth();
  const navigate = useNavigate();
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
      const next = [...prev];
      for (const f of incoming) if (!next.some((p) => p.name === f.name && p.size === f.size)) next.push(f);
      return user ? next : next.slice(0, 1);
    });
    setError(null);
  }

  async function submit() {
    if (!files.length) return setError("Add at least one document.");
    if (!targetLocales.length) return setError("Pick at least one target language.");
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
          ? "You've used today's free document. Sign in for unlimited translations."
          : err.message
      );
      setSubmitting(false);
    }
  }

  const nameOf = (code) => languages.find((l) => l.code === code)?.name || code;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Translate a document</h1>
        <p className="mt-1 text-sm text-slate-600">
          PDF, DOCX, TXT, CSV, JSON and more. Up to 25&nbsp;MB per file; PDFs up to 400 pages.
          PDF translations are delivered as editable text — scanned (image-only) PDFs can't be translated.
        </p>
        {!user && (
          <p className="mt-2 rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-700">
            Free tier: 1 document per day, up to 1,000 words.{" "}
            <Link to="/login" className="underline">
              Sign in
            </Link>{" "}
            for more.
          </p>
        )}
      </div>

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
        className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition ${
          dragOver ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-white hover:border-brand-500"
        }`}
      >
        <input ref={inputRef} type="file" accept={ACCEPT} multiple={Boolean(user)} className="hidden" onChange={(e) => addFiles(e.target.files)} />
        <p className="font-medium">Drop documents here or click to browse</p>
        <p className="mt-1 text-sm text-slate-500">{user ? "Up to 10 files per job" : "1 file on the free tier"}</p>
      </div>

      {files.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {files.map((f) => (
            <li key={f.name} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="truncate">{f.name}</span>
              <span className="flex items-center gap-3">
                <span className="text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
                <button onClick={() => setFiles(files.filter((x) => x !== f))} className="text-slate-400 hover:text-red-500">
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">Source language</span>
          <select
            value={sourceLocale}
            onChange={(e) => setSourceLocale(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name} ({l.code})
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="text-sm font-medium">Target languages</span>
          <div className="relative mt-1">
            <input
              value={targetQuery}
              onChange={(e) => setTargetQuery(e.target.value)}
              placeholder="Type to search… e.g. Portuguese"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            {targetMatches.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
                {targetMatches.map((l) => (
                  <li key={l.code}>
                    <button
                      className="w-full px-3 py-2 text-left text-sm hover:bg-brand-50"
                      onClick={() => {
                        setTargetLocales([...targetLocales, l.code]);
                        setTargetQuery("");
                      }}
                    >
                      {l.name} <span className="text-slate-400">({l.code})</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {targetLocales.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {targetLocales.map((code) => (
                <span key={code} className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-700">
                  {nameOf(code)}
                  <button onClick={() => setTargetLocales(targetLocales.filter((c) => c !== code))}>✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button
        onClick={submit}
        disabled={submitting}
        className="rounded-lg bg-brand-600 px-6 py-3 font-medium text-white shadow-card hover:bg-brand-700 disabled:opacity-50"
      >
        {submitting ? "Uploading…" : "Translate"}
      </button>
    </div>
  );
}
