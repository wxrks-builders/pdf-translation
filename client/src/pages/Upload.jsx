import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api, track } from "../api";
import { useAuth } from "../context/AuthContext";
import { PACKS, FREE_WORDS, SIGNUP_CREDIT, buy, wordsAndPages } from "../pricing";
import RecentActivity from "../RecentActivity";
import { TONES, TONE_NOTE_MAX, toneHint, toneLabel } from "../tone";
import { errorText } from "../i18n";
import { compareText, formatFileSize, formatMoney, languageLabel } from "../i18n/format";
import { Link, useNavigate, usePagePath } from "../i18n/routing";

const ACCEPT = ".pdf,.docx,.doc,.txt,.csv,.json,.yml,.yaml,.xlsx,.pptx,.md,.html,.xml,.srt";
const MAX_MB = 25;
const MAX_FILES = 10;

// Languages per document, free or paid; past this the picker points to the wxrks platform.
// The server checks the same number (MAX_TARGETS in server/routes/jobs.js).
const MAX_TARGETS = 3;

// Landing pages share this upload screen. Their headings are seo.<page>.heading, the same message
// the server renders before the app loads (server/seo.js).
const LANDING = { "/": "home", "/pdf": "pdf", "/documents": "documents" };

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
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const landing = LANDING[usePagePath()] || "home";
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
  const [onlyFirstFile, setOnlyFirstFile] = useState(false);
  const [freeUsed, setFreeUsed] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    api.languages().then((d) => setLanguages(d.languages)).catch(() => setError(t("upload.errors.languages")));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Free visitors send one file per document: say so instead of dropping the rest quietly.
    setOnlyFirstFile(!user && incoming.length > 1);
    setError(null);
  }

  async function submit() {
    if (!files.length) return setError(t("upload.errors.noFile"));
    const targets = targetLocales.filter((c) => c !== sourceLocale);
    if (!targets.length) return setError(t("upload.errors.noTarget"));
    setSubmitting(true);
    setError(null);
    setFreeUsed(false);
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
      if (err.code === "free_limit_reached") setFreeUsed(true);
      else setError(errorText(err));
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-xl">
      <div className="rounded-[10px] border border-brand-200 bg-white p-6 sm:p-8">
        <h1 className="text-[29px] font-medium leading-tight tracking-[-0.4px] [text-wrap:balance]">{t(`seo.${landing}.heading`)}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-brand-500">{t(`upload.landing.${landing}`)}</p>
        {/* No limits box (Rodrigo, 2026-11-09): the free limit and prices show after the upload. */}

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
              onKeyDown={(e) => !e.nativeEvent.isComposing && (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
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
              <p className="text-[15px] font-medium">{t("upload.drop.title")}</p>
              <p className="mt-1 text-xs text-brand-500">
                {user
                  ? t("upload.drop.hintSignedIn", { size: formatFileSize(MAX_MB * 1024 * 1024), files: MAX_FILES })
                  : t("upload.drop.hint", { size: formatFileSize(MAX_MB * 1024 * 1024) })}
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
                    <span className="block truncate text-[13px] font-medium" title={f.name}>
                      <bdi>{f.name}</bdi>
                    </span>
                    <span className="block text-[11px] text-brand-500">{formatFileSize(f.size)}</span>
                  </span>
                  <button
                    type="button"
                    className="wx-button wx-button--ghost wx-button--compact"
                    onClick={() => {
                      setFiles(files.filter((x) => x !== f));
                      setOnlyFirstFile(false);
                    }}
                  >
                    {user ? t("upload.file.remove") : t("upload.file.change")}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {onlyFirstFile && files[0] && (
            <div className="wx-alert" role="status">
              <span>
                <Trans
                  i18nKey="upload.onlyFirstFile"
                  values={{ count: MAX_FILES }}
                  components={{ file: <bdi>{files[0].name}</bdi>, a: <Link to="/login" className="underline" /> }}
                />
              </span>
            </div>
          )}

          {/* items-start: chips under "Translate into" must not stretch the "From" field */}
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <LanguagePicker
              id="source"
              label={t("upload.from")}
              languages={languages}
              selected={[sourceLocale]}
              onChange={(codes) => setSourceLocale(codes[0])}
              placeholder={t("upload.fromPlaceholder")}
            />
            <LanguagePicker
              id="target"
              label={t("upload.into")}
              languages={languages}
              selected={targetLocales}
              onChange={setTargetLocales}
              exclude={[sourceLocale]}
              multiple
              max={MAX_TARGETS}
              whenFull={<MoreLanguages />}
              placeholder={t("upload.intoPlaceholder")}
            />
          </div>

          <OptionPills preset={tonePreset} note={toneNote} onPreset={setTonePreset} onNote={setToneNote} />

          {freeUsed && <FreeUsed allowance={allowance} />}

          {error && (
            <div className="wx-alert wx-alert--danger">
              <span>{error}</span>
            </div>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="wx-button wx-button--primary w-full"
            style={{ minHeight: 40 }}
          >
            {submitting ? t("upload.submitting") : t("upload.submit")}
          </button>

          <p className="text-[11px] leading-relaxed text-brand-500">{t("upload.scanNote")}</p>
        </div>
      </div>
      <RecentActivity />
      <TrustStrip />
    </section>
  );
}

// Shown when Translate meets a used free document: when the next one comes, and the sign-up
// credit to keep going today (or, once today's credits are all given, the smallest pack straight
// to checkout; after paying, /thanks signs the buyer in to translate the file).
function FreeUsed({ allowance }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pack = PACKS[0];
  const free = allowance?.maxWords || FREE_WORDS;
  const signup = allowance ? allowance.signupCredit > 0 : true;
  const hours = allowance?.resetsAt ? Math.max(1, Math.ceil((new Date(allowance.resetsAt) - Date.now()) / 3600000)) : null;
  useEffect(() => track("offer_shown", "free_used", { fits: pack.words }), [pack.words]);

  async function buyNow() {
    setBusy(true);
    setFailed(false);
    try {
      await buy(pack, null, "free_used");
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-brand-200 bg-[#f5f7f9] px-4 py-3.5" role="status">
      <p className="text-[13px] font-medium">{t("freeUsed.title")}</p>
      <p className="mt-1 text-xs leading-relaxed text-brand-500">
        {t("freeUsed.body", {
          when: hours ? "hours" : "tomorrow",
          hours: hours || 0,
          amount: wordsAndPages(free),
          offer: signup ? "signup" : "pack",
          credit: formatMoney(SIGNUP_CREDIT.dollars),
          creditAmount: wordsAndPages(SIGNUP_CREDIT.words),
          packAmount: wordsAndPages(pack.words),
          price: formatMoney(pack.price),
        })}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {signup ? (
          <Link to="/login" className="wx-button wx-button--primary wx-button--compact">
            {t("common.getCredits", { amount: formatMoney(SIGNUP_CREDIT.dollars) })}
          </Link>
        ) : (
          <button type="button" onClick={buyNow} disabled={busy} className="wx-button wx-button--primary wx-button--compact">
            {busy ? t("common.openingCheckout") : t("freeUsed.buyPack", { words: pack.words, price: formatMoney(pack.price) })}
          </button>
        )}
        <Link to="/pricing" className="text-xs underline">
          {signup ? t("common.buyWords") : t("freeUsed.allPacks")}
        </Link>
      </div>
      {failed && <p className="wx-error mt-2 text-xs">{t("common.checkoutFailed")}</p>}
    </div>
  );
}

// Each locked pill tags its own click, so we can see which feature pulls people to the platform.
const platformUrl = (key) =>
  `https://wxrks.com/pricing?utm_source=translate.wxrks.com&utm_medium=referral&utm_campaign=free-translator&utm_content=platform-${key}`;

// Each feature's label, title and note are messages: platform.<key>.label, .title and .note.
const PLATFORM_FEATURES = ["memory", "glossary", "history"];

const PILL = "inline-flex min-h-[32px] items-center gap-1.5 rounded-md border px-2.5 text-xs [@media(pointer:coarse)]:min-h-[44px]";
const POPOVER = "absolute start-0 top-full z-20 mt-1.5 w-full rounded-md border border-brand-200 bg-white p-4 shadow-[0_6px_20px_#11141814]";

// Tone and the wxrks platform features as one line of pills, so the form stays short. Each pill
// opens a small pop-up under the row: the tone (a Sous-Chef agent: a preset, plus anything the
// visitor wants to add), or what a locked platform feature does and where to get it.
function OptionPills({ preset, note, onPreset, onNote }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(null);
  const rowRef = useRef(null);
  const tone = TONES.find((x) => x.key === preset) || TONES[0];
  const feature = PLATFORM_FEATURES.find((f) => f === open);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      if (!rowRef.current?.contains(e.target)) setOpen(null);
    }
    function onKeyDown(e) {
      if (e.key !== "Escape") return;
      document.getElementById(`pill-${open}`)?.focus();
      setOpen(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = (key) => setOpen((current) => (current === key ? null : key));

  return (
    <div ref={rowRef} className="relative">
      <div className="flex flex-wrap items-center gap-2">
        <button
          id="pill-tone"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open === "tone"}
          aria-controls="pop-tone"
          onClick={() => toggle("tone")}
          className={`${PILL} ${open === "tone" ? "border-brand-600 bg-brand-50" : "border-brand-200 bg-white hover:bg-[#f7f8fa]"}`}
        >
          <ChefHatIcon />
          <span>
            <Trans
              i18nKey="tone.pill"
              values={{ label: toneLabel(tone.key), note: note.trim() ? "yes" : "no" }}
              components={{ b: <span className="font-medium" /> }}
            />
          </span>
          <ChevronIcon up={open === "tone"} />
        </button>
        {PLATFORM_FEATURES.map((f) => (
          <button
            key={f}
            id={`pill-${f}`}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open === f}
            aria-controls={`pop-${f}`}
            onClick={() => toggle(f)}
            className={`${PILL} ${
              open === f
                ? "border-[#757d88] bg-brand-50 text-brand-600"
                : "border-dashed border-[#c4cad2] bg-[#f7f8fa] text-brand-500 hover:text-brand-600"
            }`}
          >
            <LockIcon />
            {t(`platform.${f}.label`)}
          </button>
        ))}
      </div>

      {open === "tone" && (
        <div id="pop-tone" role="dialog" aria-label={t("tone.dialogLabel")} className={`${POPOVER} max-w-[420px]`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span id="tone-label" className="text-[13px] font-medium">
              {t("tone.question")}
            </span>
            <span className="text-[11px] text-brand-500">{t("tone.byline")}</span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="tone-label">
            {TONES.map((x) => (
              <button
                key={x.key}
                type="button"
                role="radio"
                aria-checked={preset === x.key}
                onClick={() => onPreset(x.key)}
                className={`rounded-md border px-3 py-1.5 text-xs ${
                  preset === x.key ? "border-brand-600 bg-brand-50 font-medium" : "border-brand-200 hover:bg-[#f7f8fa]"
                }`}
              >
                {toneLabel(x.key)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-brand-500">{toneHint(tone.key)}</p>
          <input
            className="wx-input mt-2.5 w-full"
            value={note}
            dir="auto"
            maxLength={TONE_NOTE_MAX}
            onChange={(e) => onNote(e.target.value)}
            aria-label={t("tone.noteLabel")}
            placeholder={t("tone.notePlaceholder")}
          />
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={() => setOpen(null)} className="wx-button wx-button--primary wx-button--compact">
              {t("tone.done")}
            </button>
          </div>
        </div>
      )}

      {feature && (
        <div id={`pop-${feature}`} role="dialog" aria-label={t(`platform.${feature}.title`)} className={`${POPOVER} max-w-[320px]`}>
          <p className="flex items-center gap-1.5 text-[13px] font-medium">
            <LockIcon />
            {t(`platform.${feature}.title`)}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-brand-500">{t(`platform.${feature}.note`)}</p>
          <a href={platformUrl(feature)} className="mt-2 inline-block text-xs font-medium underline">
            {t("platform.cta")}
          </a>
        </div>
      )}
    </div>
  );
}

// Under the language picker once it holds MAX_TARGETS: the platform takes any number at once.
function MoreLanguages() {
  return (
    <p className="mt-2 text-[11px] leading-relaxed text-brand-500" role="status">
      <Trans i18nKey="upload.moreLanguages" values={{ max: MAX_TARGETS }} components={{ a: <a href={platformUrl("languages")} className="underline" /> }} />
    </p>
  );
}

function ChefHatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
      <path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z" />
      <path d="M6 17h12" />
    </svg>
  );
}

function ChevronIcon({ up }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-brand-500 transition-transform ${up ? "rotate-180" : ""}`} aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

const UTM = "utm_source=translate.wxrks.com&utm_medium=referral&utm_campaign=free-translator&utm_content=trust";

// Who is behind the translator. The badges are wxrks's own, the same ones wxrks.com shows; the
// text is in the page, so it translates (the G2 badge itself is G2's English artwork).
export function TrustStrip() {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex items-center gap-5 rounded-[10px] border border-brand-200 bg-white px-5 py-4">
      <img src="/badges/g2-leader-fall-2026.svg" alt={t("trust.g2Alt")} className="h-[72px] w-auto shrink-0" />
      <div className="min-w-0">
        <p className="text-[13px] font-medium">
          <Trans i18nKey="trust.madeBy" components={{ a: <a href={`https://wxrks.com/?${UTM}`} className="underline" /> }} />
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-brand-500">{t("trust.about")}</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-brand-500">
          <img src="/badges/soc2.svg" alt="" className="h-3.5 w-auto" />
          <span lang="en">SOC 2 Type 2</span>
          <span aria-hidden="true">·</span>
          <a href={`https://wxrks.com/security?${UTM}`} className="underline">
            {t("trust.security")}
          </a>
        </p>
      </div>
    </div>
  );
}

// Type a few letters, then click a match or press Enter. There are 100+ languages, so typing
// beats scrolling a list. Single mode shows the chosen name in the box; multiple mode adds chips.
// Names show in the reader's language, and a match on the catalog's English name or the code
// counts too ("portug", "Portuguese", "pt_br").
function LanguagePicker({ id, label, languages, selected, onChange, exclude = [], multiple = false, max = Infinity, whenFull = null, placeholder }) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const named = useMemo(
    () => languages.map((l) => ({ ...l, label: languageLabel(l.code, l.name) })),
    [languages, i18n.resolvedLanguage] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const nameOf = (code) => named.find((l) => l.code === code)?.label || code;
  const full = multiple && selected.length >= max;
  const counter =
    multiple && max !== Infinity ? (selected.length ? t("picker.count", { count: selected.length, max }) : t("picker.upTo", { max })) : null;

  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q || full) return [];
    const starts = (l) => l.label.toLocaleLowerCase().startsWith(q) || l.name.toLowerCase().startsWith(q);
    return named
      .filter((l) => !exclude.includes(l.code) && !(multiple && selected.includes(l.code)))
      .filter((l) => l.label.toLocaleLowerCase().includes(q) || l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q))
      .sort((a, b) => Number(starts(b)) - Number(starts(a)) || compareText(a.label, b.label))
      .slice(0, 8);
  }, [query, named, exclude, multiple, selected, full]);

  function pick(l) {
    onChange(multiple ? [...selected, l.code] : [l.code]);
    setQuery("");
    setActive(0);
    if (!multiple) document.getElementById(id)?.blur();
  }

  function onKeyDown(e) {
    // Chinese, Japanese and Korean input methods confirm a character with Enter.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <label className="wx-label" htmlFor={id}>
          {label}
        </label>
        {counter && <span className="text-[11px] text-brand-500">{counter}</span>}
      </div>
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
          disabled={full}
          placeholder={
            full ? t("picker.full", { max }) : !multiple && selected[0] ? nameOf(selected[0]) : multiple && selected.length ? t("picker.addAnother") : placeholder
          }
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
                  className={`w-full px-3 py-2 text-start text-[13px] ${i === active ? "bg-brand-50" : ""} hover:bg-brand-50`}
                  onMouseDown={(e) => e.preventDefault()} // keep focus so the click lands before blur
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(l)}
                >
                  {l.label}
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
              <button type="button" aria-label={t("picker.remove", { language: nameOf(code) })} onClick={() => onChange(selected.filter((c) => c !== code))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {full && whenFull}
    </div>
  );
}
