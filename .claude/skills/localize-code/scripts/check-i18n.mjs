#!/usr/bin/env node
// check-i18n.mjs: find what will break when an app is translated.
//
//   node check-i18n.mjs [dir]            report (default dir: .)
//   node check-i18n.mjs . --strict       exit 1 when anything in FIX is found (for CI)
//   node check-i18n.mjs . --json         machine-readable output
//   node check-i18n.mjs . --all          list every finding, not the first 8 per check
//   node check-i18n.mjs . --source en    source locale (default: LOCALIZATION.md, then en)
//
// It scans components, styles and locale files for the problems coding agents
// leave behind most often: text written into components, sentences glued from
// pieces, English-only plurals, hand-built prices and dates, CSS that won't
// mirror for right-to-left languages, missing <html lang>, Enter handlers that
// break Chinese and Japanese input, ASCII-only name validation, and locale
// files with missing keys, broken placeholders or missing plural forms.
//
// It is a heuristic. FIX findings are very likely real; CHECK findings need a
// look. Read each one before changing code.
//
// Zero dependencies. Node 18+. MIT license.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, basename, dirname } from 'node:path';

// ---------- options ----------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const valued = new Set(['--source', '--max']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));
const ROOT = positional[0] ?? '.';
const STRICT = flag('--strict');
const JSON_OUT = flag('--json');
const MAX = flag('--all') ? Infinity : Number(value('--max') ?? 8);

if (flag('--help') || flag('-h')) {
  console.log('Usage: node check-i18n.mjs [dir] [--strict] [--json] [--all] [--source en]');
  process.exit(0);
}
if (!existsSync(ROOT)) { console.error(`No such directory: ${ROOT}`); process.exit(2); }

// ---------- constants ----------
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'Pods', 'DerivedData', 'target', '__snapshots__', 'storybook-static']);
const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro', '.html', '.htm']);
const TEMPLATE_EXT = new Set(['.jsx', '.tsx', '.vue', '.svelte', '.astro', '.html', '.htm']);
const STYLE_EXT = new Set(['.css', '.scss', '.sass', '.less']);
const RTL_LANGS = new Set(['ar', 'he', 'iw', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb']);
const LOCALE_RE = /^[a-z]{2,3}(?:[-_](?:[A-Z][a-z]{3}|[A-Za-z]{2}|\d{3}|[A-Za-z0-9]{5,8}))*$/;
const PSEUDO = new Set(['en-XA', 'ar-XB', 'en_XA', 'ar_XB', 'qps-ploc', 'qps-plocm', 'xx']);
const MESSAGE_DIR_HINT = /(^|\/)(locales?|messages|i18n|lang|langs|translations|l10n|dictionaries)(\/|$)/i;

// ---------- project config from LOCALIZATION.md ----------
const config = { source: null, targets: [], neverTranslate: [] };
const locFile = ['LOCALIZATION.md', 'localization.md', 'docs/LOCALIZATION.md'].map((p) => join(ROOT, p)).find(existsSync);
if (locFile) {
  const md = readFileSync(locFile, 'utf8');
  // Only real language codes: "none yet" must not become a locale called "yet".
  const known = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'code' });
  const tags = (s) => (s.match(/\b[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\b/g) || []).filter((t) => { try { const c = Intl.getCanonicalLocales(t)[0]; return known.of(c) !== c; } catch { return false; } });
  const src = md.match(/source language[^:\n]*:\s*(.+)/i);
  if (src) config.source = tags(src[1].replace(/[`*]/g, ''))[0] ?? null;
  const tgt = md.match(/target languages?[^:\n]*:\s*(.+)/i);
  if (tgt) config.targets = tags(tgt[1].replace(/[`*]/g, '').replace(/\(.*?\)/g, ''));
  const nt = md.match(/^#{1,3}\s*never translate[^\n]*\n([\s\S]*?)(?=^#{1,3}\s|(?![\s\S]))/im);
  if (nt) config.neverTranslate = nt[1].split('\n').map((l) => l.match(/^\s*[-*]\s+`?([^`—–:(]+?)`?\s*(?:[—–:(].*)?$/)?.[1]?.trim()).filter((t) => t && !/^\[.*\]$/.test(t));
}
const SOURCE = value('--source') ?? config.source ?? 'en';

// ---------- findings ----------
const CHECKS = {
  'hardcoded-text':   ['fix',   'Text written into components', 'Move it to the source message file and render it with the translation function.'],
  'hardcoded-attr':   ['fix',   'Text written into attributes (placeholder, alt, title, aria-label)', 'Use a message for the attribute value too.'],
  'hardcoded-call':   ['fix',   'Text passed straight to a toast, alert or error setter', 'Pass a message key or a translated message instead.'],
  'hardcoded-data':   ['check', 'Text in data objects (plan names, features, FAQs)', 'If people see it, store a message key and translate it where it renders.'],
  'concatenation':    ['fix',   'Sentences glued from translated pieces', 'Use one message with named placeholders.'],
  'english-plural':   ['fix',   'English-only plural logic', 'Use an ICU plural message (or the library\'s count option).'],
  'currency':         ['fix',   'Currency symbol written by hand', 'Format with Intl.NumberFormat(locale, { style: "currency", currency }).'],
  'money-tofixed':    ['check', 'Money formatted with toFixed', 'Intl.NumberFormat handles decimals, grouping and symbol per locale.'],
  'date-no-locale':   ['fix',   'toLocale*String() called without a locale', 'Pass the active locale (and timeZone on the server).'],
  'date-manual':      ['check', 'Date built or formatted with a fixed pattern', 'Use Intl.DateTimeFormat with dateStyle, or a locale-aware format token.'],
  'hardcoded-locale': ['check', 'Formatter pinned to one locale', 'Pass the active locale instead of a fixed one.'],
  'compare-no-locale':['check', 'localeCompare without a locale', 'Pass the active locale: a.localeCompare(b, locale).'],
  'uppercase':        ['fix',   'Translated text uppercased in code', 'Casing is language-specific. Write it in the message or use CSS with lang set.'],
  'physical-css':     ['check', 'Left/right CSS that will not mirror for right-to-left languages', 'Use logical properties: ms/me/ps/pe/start/end/text-start, margin-inline-start, marginStart.'],
  'html-lang':        ['fix',   '<html> without a lang attribute', 'Set lang (and dir) from the active locale.'],
  'html-lang-fixed':  ['check', '<html lang> fixed to one language', 'Set lang and dir from the active locale.'],
  'ime-enter':        ['fix',   'Enter handler that ignores input-method composition', 'Return early when event.isComposing (event.nativeEvent.isComposing in React) or keyCode 229.'],
  'ascii-name':       ['fix',   'Name validation that only accepts A-Z', 'Accept any script: José, Nguyễn, 王芳 and محمد are real names.'],
  'flag-for-language':['check', 'Flag emoji near language code', 'Flags are countries. List languages by their own names (Intl.DisplayNames).'],
  'fixed-width':      ['check', 'Fixed width or truncation on a button or heading', 'Size by padding and let text wrap; translations run longer.'],
  'missing-file':     ['fix',   'Target language without a message file', 'Create the file (translate, or copy the source as a draft and mark it).'],
  'missing-key':      ['fix',   'Keys missing in a target language', 'Translate them; until then they fall back to the source language.'],
  'extra-key':        ['check', 'Keys in a target language that the source no longer has', 'Delete them, or restore the source key if it was removed by mistake.'],
  'placeholder':      ['fix',   'Placeholders or tags that differ from the source', 'Keep every {placeholder}, {{placeholder}}, %s and <tag> exactly as in the source.'],
  'plural-forms':     ['fix',   'Plural forms the language needs are missing', 'Add the missing categories (see Intl.PluralRules(locale).resolvedOptions().pluralCategories).'],
  'syntax':           ['fix',   'Unbalanced braces in a message', 'Fix the ICU syntax; the library will throw or print raw text.'],
  'empty':            ['check', 'Empty translations', 'Translate them or remove them so the fallback applies.'],
  'same-as-source':   ['check', 'Translations identical to the source', 'Probably untranslated (fine for brand names and words that are the same).'],
  'stale':            ['check', 'Translations made from an older source text', 'The source changed after translation. Re-translate or review.'],
};
const findings = [];
const add = (check, file, line, snippet) => findings.push({ check, severity: CHECKS[check][0], file: relative(ROOT, file) || basename(file), line, snippet: String(snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 90) });

// ---------- walk ----------
const files = [];
(function walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;               // .git, .next, .claude (skills hold "before" examples)
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); continue; }
    if (!e.isFile()) continue;
    try { if (statSync(p).size > 1_500_000) continue; } catch { continue; }
    files.push(p);
  }
})(ROOT);

const lineStarts = (s) => { const a = [0]; for (let i = 0; i < s.length; i++) if (s[i] === '\n') a.push(i + 1); return a; };
const lineAt = (starts, idx) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; } return lo + 1; };
const blank = (s) => s.replace(/[^\n]/g, ' ');
const blankBlocks = (src, re) => src.replace(re, (m) => blank(m));

const isTest = (p) => /(\.|\/)(test|spec|stories|story)\.[a-z]+$|(^|\/)(__tests__|__mocks__|tests?|e2e|cypress|playwright)\//i.test(relative(ROOT, p));
const isMessageModule = (p) => MESSAGE_DIR_HINT.test(relative(ROOT, p)) || /(^|\/)(ui|translations?|dictionary|dictionaries|messages)\.(t|j)sx?$/.test(p);

const neverRe = config.neverTranslate.length ? new RegExp(config.neverTranslate.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu') : null;
const meaningful = (text) => {
  let t = text.replace(/&[a-z]+;|&#\d+;/gi, ' ');
  if (neverRe) t = t.replace(neverRe, ' ');
  return /\p{L}{2,}/u.test(t) && !/^\s*(https?:|www\.|[\w.+-]+@[\w-]+\.)/.test(t);
};

function stripBraces(s) {
  // remove {{...}} and balanced {...}; return null when braces are unbalanced (code, not text)
  let out = '', depth = 0;
  s = s.replace(/\{\{[\s\S]*?\}\}/g, ' ');
  for (const ch of s) {
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth < 0) return null; }
    else if (depth === 0) out += ch;
  }
  return depth === 0 ? out : null;
}

const CODE_MARKERS = /;|=>|===|!==|&&|\|\||\breturn\b|\bfunction\b|\bconst\s|\blet\s|\bvar\s|\bimport\s|\bexport\s|\bif\s*\(|\}\s*else|\w\(|\w\.\w+\(|=\s|\s=/;
const SKIP_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style', 'svg', 'path', 'math', 'trans', 'formattedmessage', 'title-template']);

function templateSource(file, src) {
  const ext = extname(file);
  if (ext === '.vue') {
    const m = src.match(/<template[^>]*>([\s\S]*)<\/template>/);
    if (!m) return null;
    const start = src.indexOf(m[0]);
    return blank(src.slice(0, start)) + m[0] + blank(src.slice(start + m[0].length));
  }
  let s = src;
  if (ext === '.astro') s = s.replace(/^---[\s\S]*?\n---/, (m) => blank(m));
  if (ext !== '.jsx' && ext !== '.tsx') s = blankBlocks(s, /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi);
  else s = blankBlocks(s, /<style\b[^>]*>[\s\S]*?<\/style>/gi);
  return s;
}

// ---------- code checks ----------
let scannedCode = 0;
const detectedLocales = new Set();

for (const file of files) {
  const ext = extname(file);
  if (!CODE_EXT.has(ext) && !STYLE_EXT.has(ext)) continue;
  if (/\.min\.(js|css)$|\.d\.ts$/.test(file) || isTest(file)) continue;
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }
  scannedCode++;
  const starts = lineStarts(src);
  const lines = src.split('\n');
  const at = (idx) => lineAt(starts, idx);

  if (STYLE_EXT.has(ext)) { checkCss(file, lines, 0); continue; }
  const messageModule = isMessageModule(file);

  // --- templates: text nodes and attributes
  if (TEMPLATE_EXT.has(ext) && !messageModule) {
    const tpl = templateSource(file, src);
    if (tpl) {
      const re = />([^<>]+)</g;
      let m;
      while ((m = re.exec(tpl))) {
        const gt = m.index;
        const prev = tpl[gt - 1];
        if (prev === '=' || prev === '-') continue;
        const raw = m[1];
        if (!/\p{L}/u.test(raw)) continue;
        const open = tpl.lastIndexOf('<', gt);
        const opener = tpl.slice(open + 1, gt);
        const tag = opener.startsWith('/') ? '' : (opener.match(/^([A-Za-z][\w.-]*)/)?.[1] ?? '').toLowerCase();
        if (SKIP_TAGS.has(tag) || tag.endsWith('.trans')) continue;
        const text = stripBraces(raw);
        if (text === null) continue;
        if (CODE_MARKERS.test(text)) continue;
        if (!meaningful(text)) continue;
        const firstChar = raw.search(/\S/);
        add('hardcoded-text', file, at(gt + 1 + Math.max(0, firstChar)), text);
      }
      const attr = /\s(placeholder|alt|title|aria-label|aria-placeholder|aria-description|aria-roledescription|label)\s*=\s*(["'])([^"'{}]*?)\2/g;
      while ((m = attr.exec(tpl))) if (meaningful(m[3])) add('hardcoded-attr', file, at(m.index), `${m[1]}="${m[3]}"`);
      // <span>${price}</span>, <span>€{price}</span>
      const cur = />\s*[$€£¥₹]\s*\{[^}]+\}/g;
      while ((m = cur.exec(tpl))) add('currency', file, at(m.index), m[0].slice(1));
      // fixed widths and truncation on buttons and headings
      const fw = /<(button|Button|a|h[1-6]|Tab|TabsTrigger|Badge|Chip)\b[^>]*?\bclass(?:Name)?\s*=\s*["'{`]+([^"'`}]*)/g;
      while ((m = fw.exec(tpl))) {
        // w-12 and up (icon buttons are w-6 to w-10), arbitrary widths, or truncation
        if (/(^|\s)(w-(1[2-9]|[2-9]\d|\d{3})|w-\[[^\]]+\]|truncate|text-ellipsis)(\s|$)/.test(m[2])) add('fixed-width', file, at(m.index), `<${m[1]} class="${m[2].trim().slice(0, 70)}">`);
      }
      // <html> lang
      const html = /<html\b([^>]*)>/gi;
      while ((m = html.exec(tpl))) {
        const attrs = m[1];
        if (!/\blang\s*=/.test(attrs)) add('html-lang', file, at(m.index), m[0]);
        else if (/\blang\s*=\s*["'][a-z]{2}(-[A-Za-z]+)?["']/.test(attrs)) add('html-lang-fixed', file, at(m.index), m[0]);
      }
    }
  }

  // --- line checks for all code files
  const isRN = /StyleSheet\.create|from ['"]react-native['"]/.test(src);
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const n = i + 1;
    if (/^\s*(\/\/|\*|\/\*)/.test(L)) continue;         // comments
    if (L.length > 600) continue;                       // minified or data lines

    const dataFile = TEMPLATE_EXT.has(ext) || /(^|\/)(data|content|constants|copy)\//.test(relative(ROOT, file)) || /(^|\/)(plans|pricing|faqs?|features|content|copy|constants)\.(t|j)s$/.test(file);
    if (!messageModule) {
      const call = /\b(toast(?:\.(?:success|error|info|warning|message|loading))?|alert|confirm|prompt|setError|setErrorMessage|setMessage|setStatusMessage|setNotice|notify|showToast|showNotification|message\.(?:success|error|info|warning)|Alert\.alert)\(\s*(["'`])((?:(?!\2).)*?)\2/gu;
      let m;
      while ((m = call.exec(L))) if (meaningful(m[3]) && !/^\s*\$\{\s*t\(/.test(m[3])) add('hardcoded-call', file, n, `${m[1]}("${m[3]}")`);
      const data = L.match(/^\s*(title|subtitle|description|label|placeholder|heading|cta|ctaText|buttonText|text|message|question|answer|tagline|caption|tooltip|helperText|emptyText|errorMessage|successMessage|name|feature)\s*:\s*(["'`])((?:(?!\2).)*\s(?:(?!\2).)*)\2\s*,?\s*$/u);
      if (data && meaningful(data[3]) && /\p{L}{2,}\s+\p{L}{2,}/u.test(data[3]) && dataFile) add('hardcoded-data', file, n, `${data[1]}: "${data[3]}"`);
      const list = L.match(/\b(features|benefits|bullets|perks|highlights|includes)\s*:\s*\[\s*(["'`])([^"'`]*\s[^"'`]*)\2/u);
      if (list && meaningful(list[3]) && dataFile) add('hardcoded-data', file, n, `${list[1]}: ["${list[3]}", …]`);
    }

    const T = String.raw`(?<![\w$.])(?:t|\$t|i18n\.t|translate|intl\.formatMessage|formatMessage)\(`;
    if (new RegExp(`${T}[^()]*\\)\\s*\\+\\s*["'\`\\w]|["'\`\\w)]\\s*\\+\\s*${T}\\s*["'\`]`).test(L)) add('concatenation', file, n, L.trim());
    if (new RegExp(`\`[^\`]*\\p{L}{2,}[^\`]*\\$\\{\\s*${T}|\`[^\`]*\\$\\{\\s*${T}[^\`]*\\}[^\`]*\\p{L}{2,}`, 'u').test(L)) add('concatenation', file, n, L.trim());

    if (/\?\s*(["'`])s\1\s*:\s*(["'`])\2|\?\s*(["'`])\3\s*:\s*(["'`])s\4|===?\s*1\s*\?\s*["'`][^"'`]*["'`]\s*:\s*["'`][^"'`]*s["'`]|!==?\s*1\s*\?\s*["'`][^"'`]*s["'`]\s*:|>\s*1\s*\?\s*["'`][^"'`]*s["'`]\s*:|\bpluralize\(/.test(L)) add('english-plural', file, n, L.trim());

    if (/\$\$\{|(["'`])\$\1\s*\+|\+\s*(["'`])\$\2|[€£¥₹]\$\{|\$\{[^}]+\}\s*[€£¥₹]/.test(L)) add('currency', file, n, L.trim());
    if (/\.toFixed\(\s*2\s*\)/.test(L) && /price|amount|total|cost|fee|subtotal|balance|salary|revenue|\$|€|£/i.test(L)) add('money-tofixed', file, n, L.trim());

    if (/\.toLocale(Date|Time)?String\(\s*\)/.test(L)) add('date-no-locale', file, n, L.trim());
    if (/\bgetMonth\(\)\s*\+\s*1\b|(["'`])(MM\/DD\/YYYY|DD\/MM\/YYYY|MM\/dd\/yyyy|dd\/MM\/yyyy|MM-DD-YYYY|DD-MM-YYYY|M\/D\/YYYY|MMM D, YYYY|MMMM D, YYYY|MMM d, yyyy|MMMM d, yyyy)\1/.test(L)) add('date-manual', file, n, L.trim());
    if (/(Intl\.(NumberFormat|DateTimeFormat|RelativeTimeFormat|ListFormat|PluralRules)|toLocale(Date|Time)?String)\(\s*["']en(-US|-GB)?["']/.test(L)) add('hardcoded-locale', file, n, L.trim());
    if (/\.localeCompare\(\s*[^,()]+\)/.test(L)) add('compare-no-locale', file, n, L.trim());
    if (/\b(t|\$t|i18n\.t)\([^()]*\)\.to(Locale)?UpperCase\(\)/.test(L)) add('uppercase', file, n, L.trim());

    if (/(["'`])Enter\1|keyCode\s*===?\s*13\b|which\s*===?\s*13\b/.test(L)) {
      const win = lines.slice(Math.max(0, i - 8), i + 9).join('\n');
      if (!/isComposing|\b229\b|composition/i.test(win)) add('ime-enter', file, n, L.trim());
    }
    if (/\^\[(a-zA-Z|A-Za-z)(\\s| |'|\\-|-|\.)*\][+*]/.test(L) && /name|first|last|city|company|surname|given|family/i.test(L) && !/email|url|slug|hex|password|username|handle|sku|token/i.test(L)) add('ascii-name', file, n, L.trim());
    if (/[\u{1F1E6}-\u{1F1FF}]{2}/u.test(L) && /lang|locale|language|i18n/i.test(src)) add('flag-for-language', file, n, L.trim());

    // Tailwind physical classes on lines that build class lists
    if (/class(Name)?\s*=|\b(cn|clsx|cva|twMerge|classNames|tw)\s*[(`]/.test(L)) {
      for (const lit of L.match(/(["'`])(?:(?!\1).)*\1/g) ?? []) {
        for (const tok of lit.slice(1, -1).split(/\s+/)) {
          if (/(^|:)(ltr|rtl):/.test(tok)) continue;
          const core = tok.split(':').pop().replace(/^!/, '');
          if (/^-?(ml|mr|pl|pr|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-|^-?(left|right)-(\d+(?![\d/])|\[|px|auto|full)|^text-(left|right)$|^float-(left|right)$|^clear-(left|right)$|^rounded-(l|r|tl|tr|bl|br)(-|$)|^border-(l|r)(-|$)/.test(core)) { add('physical-css', file, n, tok); }
        }
      }
    }
    // React Native and inline style objects
    if (/\b(marginLeft|marginRight|paddingLeft|paddingRight|borderLeftWidth|borderRightWidth|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius)\s*:|textAlign\s*:\s*["'](left|right)["']/.test(L)) add('physical-css', file, n, L.trim());
    if (isRN && /^\s*(left|right)\s*:\s*-?\d/.test(L)) add('physical-css', file, n, L.trim());
  }
  // <style> blocks inside components
  const styleBlocks = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let sb;
  while ((sb = styleBlocks.exec(src))) checkCss(file, sb[1].split('\n'), at(sb.index) - 1);
}

function checkCss(file, lines, offset) {
  let rtlBlock = false;
  lines.forEach((L, i) => {
    if (/\{/.test(L)) rtlBlock = /dir\s*=|:dir\(|\[dir|\brtl\b|\bltr\b/i.test(L);
    if (!rtlBlock && /(^|[\s;{])(margin|padding)-(left|right)\s*:|(^|[\s;{])border-(left|right)(-[a-z]+)?\s*:|border-(top|bottom)-(left|right)-radius\s*:|text-align\s*:\s*(left|right)\b|(^|[\s;{])float\s*:\s*(left|right)\b|(^|[\s;{])(left|right)\s*:\s*-?\d/.test(L)) add('physical-css', file, offset + i + 1, L.trim());
    if (/\}/.test(L)) rtlBlock = false;
  });
}

// ---------- locale files ----------
const sets = new Map(); // key -> { dir, label, files: Map(locale -> path) }
const addSet = (key, dir, label, locale, path) => {
  if (!sets.has(key)) sets.set(key, { dir, label, files: new Map() });
  sets.get(key).files.set(locale.replace('_', '-'), path);
};
const languageNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'code' });
const isLocaleCode = (s) => {
  if (!LOCALE_RE.test(s)) return false;
  try { const c = Intl.getCanonicalLocales(s.replace('_', '-'))[0]; return languageNames.of(c) !== c; } catch { return false; }
};
const flatCandidates = new Map(); // dir -> [{ locale, file }]
for (const file of files) {
  const ext = extname(file);
  if (ext !== '.json' && ext !== '.arb') continue;
  const name = basename(file, ext);
  const dir = dirname(file);
  if (ext === '.arb') { const m = name.match(/^(.*?)_([a-z]{2,3}(?:[-_][A-Za-z0-9]+)*)$/); if (m && isLocaleCode(m[2])) addSet(`${dir}|arb|${m[1]}`, dir, `${relative(ROOT, dir)}/${m[1]}_*.arb`, m[2], file); continue; }
  if (isLocaleCode(name)) { if (!flatCandidates.has(dir)) flatCandidates.set(dir, []); flatCandidates.get(dir).push({ locale: name, file }); continue; }
  const parent = basename(dir);
  if (isLocaleCode(parent) && MESSAGE_DIR_HINT.test(relative(ROOT, dirname(dir)) + '/')) addSet(`${dirname(dir)}|ns|${name}`, dirname(dir), `${relative(ROOT, dirname(dir))}/*/${name}.json`, parent, file);
}
// A folder of locale-named files counts when its path says so (locales/, messages/, i18n/...)
// or when it holds at least two of them, one being the source language.
for (const [dir, list] of flatCandidates) {
  const hinted = MESSAGE_DIR_HINT.test(relative(ROOT, dir) + '/');
  const hasSource = list.some((c) => c.locale.split(/[-_]/)[0] === SOURCE.split('-')[0]);
  if (hinted || (list.length >= 2 && hasSource)) for (const c of list) addSet(`${dir}|flat`, dir, `${relative(ROOT, dir) || '.'}/*.json`, c.locale, c.file);
}

const flatten = (obj, prefix = '', out = {}) => {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('@') || k.startsWith('_') || k === '$schema') continue;
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else if (Array.isArray(obj)) obj.forEach((v, i) => flatten(v, `${prefix}.${i}`, out));
  else if (typeof obj === 'string') out[prefix] = obj;
  return out;
};
const PLURAL_SUFFIX = /^(.*?)(_ordinal)?_(zero|one|two|few|many|other)$/;
const baseKey = (k) => k.replace(PLURAL_SUFFIX, '$1$2');

function matchBrace(s, start) { let d = 0; for (let i = start; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}') { d--; if (d === 0) return i; } } return -1; }
function balanced(s) { let d = 0; for (const c of s.replace(/'[{}]'/g, '')) { if (c === '{') d++; else if (c === '}' && --d < 0) return false; } return d === 0; }

// placeholders: ICU argument names (recursing into plural/select branches), {{x}}, %s, %{x}, <tag>
function placeholders(msg, acc = new Map()) {
  const bump = (k) => acc.set(k, (acc.get(k) ?? 0) + 1);
  let s = msg.replace(/\{\{\s*([\w.-]+)[^}]*\}\}/g, (_, n) => { bump(`{{${n}}}`); return ' '; });
  s = s.replace(/%(\d+\$)?[-+0#]*\d*(\.\d+)?[sdif@](?![A-Za-z])|%\{\w+\}|%\(\w+\)[sdif]/g, (m) => { bump(m.replace(/\.\d+|\d+(?=[sdif@])/, '')); return ' '; });
  s = s.replace(/<\/?([A-Za-z0-9_-]+)[^<>]*>/g, (m, n) => { bump(`<${n}>`); return ' '; });
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    const end = matchBrace(s, i);
    if (end === -1) break;
    const inner = s.slice(i + 1, end);
    const m = inner.match(/^\s*([\w-]+)\s*(?:,\s*(\w+)\s*(?:,([\s\S]*))?)?$/);
    if (m) {
      bump(`{${m[1]}}`);
      if (/^(plural|select|selectordinal)$/.test(m[2] ?? '') && m[3]) {
        const body = m[3];
        for (let j = 0; j < body.length; j++) if (body[j] === '{') { const e = matchBrace(body, j); if (e === -1) break; placeholders(body.slice(j + 1, e), acc); j = e; }
      }
    }
    i = end;
  }
  return acc;
}
const placeholderSet = (msg) => new Set(placeholders(msg).keys());

function pluralSelectors(msg) {
  const out = [];
  for (let i = 0; i < msg.length; i++) {
    if (msg[i] !== '{') continue;
    const end = matchBrace(msg, i);
    if (end === -1) break;
    const inner = msg.slice(i + 1, end);
    const m = inner.match(/^\s*[\w-]+\s*,\s*(plural|selectordinal)\s*,([\s\S]*)$/);
    if (m) {
      const sels = [];
      const body = m[2].replace(/^\s*offset:\d+/, '');
      for (let j = 0; j < body.length; j++) {
        const sm = body.slice(j).match(/^\s*(=\d+|[A-Za-z]+)\s*\{/);
        if (!sm) break;
        sels.push(sm[1]);
        const e = matchBrace(body, j + sm[0].length - 1);
        if (e === -1) break;
        j = e;
      }
      out.push({ type: m[1], sels });
      out.push(...pluralSelectors(m[2]));
    }
    i = end;
  }
  return out;
}
const requiredCache = new Map();
function requiredCategories(locale, type = 'cardinal') {
  const key = `${locale}|${type}`;
  if (requiredCache.has(key)) return requiredCache.get(key);
  let cats = new Set(['other']);
  try {
    const pr = new Intl.PluralRules(locale, { type });
    for (let n = 0; n <= 1000; n++) cats.add(pr.select(n));
  } catch { cats = new Set(['other']); }
  requiredCache.set(key, cats);
  return cats;
}

let localeFiles = 0;
for (const set of sets.values()) {
  const locales = [...set.files.keys()];
  locales.forEach((l) => detectedLocales.add(l));
  const srcLocale = set.files.has(SOURCE) ? SOURCE : locales.find((l) => l.split('-')[0] === SOURCE.split('-')[0]) ?? null;
  if (!srcLocale) continue;
  const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { add('syntax', p, 1, `Not valid JSON: ${e.message}`); return null; } };
  const srcData = read(set.files.get(srcLocale));
  if (!srcData) continue;
  localeFiles += set.files.size;
  const source = flatten(srcData);
  const sourceBases = new Set(Object.keys(source).map(baseKey));
  for (const t of config.targets) {
    if (t === srcLocale || PSEUDO.has(t)) continue;
    const has = locales.some((l) => l.toLowerCase() === t.toLowerCase() || l.toLowerCase().split('-')[0] === t.toLowerCase());
    if (!has) add('missing-file', join(set.dir, `${t}${extname(set.files.get(srcLocale))}`), 1, `${set.label} has no ${t}`);
  }
  let status = null;
  const statusPath = join(set.dir, '_status.json');
  if (existsSync(statusPath)) { try { status = JSON.parse(readFileSync(statusPath, 'utf8')); } catch { add('syntax', statusPath, 1, 'Not valid JSON'); } }

  for (const [locale, path] of set.files) {
    if (locale === srcLocale || PSEUDO.has(locale)) continue;
    const data = read(path);
    if (!data) continue;
    const target = flatten(data);
    const targetBases = new Set(Object.keys(target).map(baseKey));
    const missing = [...sourceBases].filter((k) => !targetBases.has(k));
    const extra = [...targetBases].filter((k) => !sourceBases.has(k));
    if (missing.length) add('missing-key', path, 1, `${locale}: ${missing.length} missing (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ', …' : ''})`);
    if (extra.length) add('extra-key', path, 1, `${locale}: ${extra.length} extra (${extra.slice(0, 4).join(', ')}${extra.length > 4 ? ', …' : ''})`);
    // i18next-style plural keys
    const groups = new Map();
    for (const k of Object.keys(target)) { const m = k.match(PLURAL_SUFFIX); if (m) { const g = `${m[1]}${m[2] ?? ''}`; if (!groups.has(g)) groups.set(g, { ordinal: !!m[2], cats: new Set() }); groups.get(g).cats.add(m[3]); } }
    for (const [g, info] of groups) {
      const need = [...requiredCategories(locale, info.ordinal ? 'ordinal' : 'cardinal')].filter((c) => !info.cats.has(c));
      if (need.length) add('plural-forms', path, 1, `${locale} "${g}" needs ${need.map((c) => `_${c}`).join(', ')}`);
    }
    let empty = 0, same = 0;
    for (const [k, v] of Object.entries(target)) {
      const s = source[k];
      if (!balanced(v)) add('syntax', path, 1, `${locale} "${k}": ${v}`);
      if (s === undefined) continue;
      if (v.trim() === '' && s.trim() !== '') { empty++; continue; }
      if (v === s && meaningful(s) && s.length > 3 && locale.split('-')[0] !== srcLocale.split('-')[0]) same++;
      const a = placeholderSet(s), b = placeholderSet(v);
      // Plural forms may leave out the number ("one item" in Arabic is عنصر واحد).
      const optional = PLURAL_SUFFIX.test(k) ? new Set(['{{count}}', '{count}']) : new Set();
      const lost = [...a].filter((x) => !b.has(x) && !optional.has(x)), unknown = [...b].filter((x) => !a.has(x));
      if (lost.length || unknown.length) add('placeholder', path, 1, `${locale} "${k}": ${lost.length ? 'missing ' + lost.join(' ') : ''}${lost.length && unknown.length ? '; ' : ''}${unknown.length ? 'unknown ' + unknown.join(' ') : ''}`);
      for (const p of pluralSelectors(v)) {
        const need = [...requiredCategories(locale, p.type === 'selectordinal' ? 'ordinal' : 'cardinal')].filter((c) => !p.sels.includes(c));
        if (need.length) add('plural-forms', path, 1, `${locale} "${k}" needs ${need.join(', ')}`);
      }
      const st = status?.[locale]?.[k];
      if (st && typeof st.source === 'string' && st.source !== s) add('stale', path, 1, `${locale} "${k}" was translated from "${st.source.slice(0, 40)}"`);
    }
    if (empty) add('empty', path, 1, `${locale}: ${empty} empty`);
    if (same) add('same-as-source', path, 1, `${locale}: ${same} identical to ${srcLocale}`);
  }
}

// Right-to-left in scope makes physical CSS a real bug.
const inScope = new Set([SOURCE, ...config.targets, ...[...detectedLocales].filter((l) => !PSEUDO.has(l))].map((l) => l.toLowerCase().split(/[-_]/)[0]));
const rtlInScope = [...inScope].filter((l) => RTL_LANGS.has(l));
if (rtlInScope.length) for (const f of findings) if (f.check === 'physical-css') f.severity = 'fix';
// A fixed <html lang> only matters once there is more than one language.
if (inScope.size <= 1) for (let i = findings.length - 1; i >= 0; i--) if (findings[i].check === 'html-lang-fixed') findings.splice(i, 1);

// ---------- report ----------
const order = Object.keys(CHECKS);
const byCheck = new Map();
for (const f of findings) { if (!byCheck.has(f.check)) byCheck.set(f.check, []); byCheck.get(f.check).push(f); }
const fixCount = findings.filter((f) => f.severity === 'fix').length;
const checkCount = findings.length - fixCount;

if (JSON_OUT) {
  console.log(JSON.stringify({ root: ROOT, source: SOURCE, targets: config.targets, detectedLocales: [...detectedLocales], rtlInScope, scannedFiles: scannedCode, localeFiles, summary: { fix: fixCount, check: checkCount }, findings }, null, 2));
} else {
  const locales = [...new Set([SOURCE, ...config.targets, ...detectedLocales])];
  console.log(`check-i18n: ${fixCount} to fix, ${checkCount} to check · ${scannedCode} code files and ${localeFiles} locale files scanned`);
  console.log(`locales: ${locales.join(', ')}${locFile ? ' (from LOCALIZATION.md and files)' : ' (no LOCALIZATION.md found)'}${rtlInScope.length ? ` · right-to-left in scope: ${rtlInScope.join(', ')}` : ''}`);
  for (const sev of ['fix', 'check']) {
    for (const check of order) {
      const list = (byCheck.get(check) ?? []).filter((f) => f.severity === sev);
      if (!list.length) continue;
      const [, title, how] = CHECKS[check];
      console.log(`\n${sev.toUpperCase().padEnd(5)} ${title} (${list.length})  [${check}]\n      ${how}`);
      for (const f of list.slice(0, MAX)) console.log(`      ${f.file}:${f.line}  ${f.snippet}`);
      if (list.length > MAX) console.log(`      … ${list.length - MAX} more (use --all)`);
    }
  }
  if (!findings.length) console.log('\nNothing found. Check the screens in the pseudo-locale too (pseudo-locale.mjs).');
}
// exitCode, not process.exit(): exiting early truncates large output written to a pipe.
process.exitCode = STRICT && fixCount > 0 ? 1 : 0;
