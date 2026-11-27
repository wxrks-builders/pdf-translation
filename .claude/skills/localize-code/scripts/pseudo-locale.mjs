#!/usr/bin/env node
// pseudo-locale.mjs: write a fake language from a source message file, so you
// can see every screen as if it were translated before anyone translates it.
//
//   node pseudo-locale.mjs messages/en.json                 -> messages/en-XA.json
//   node pseudo-locale.mjs locales/en/translation.json      -> locales/en-XA/translation.json
//   node pseudo-locale.mjs messages/en.json --out x.json --locale en-XA
//   node pseudo-locale.mjs messages/en.json --bidi          -> messages/ar-XB.json
//   node pseudo-locale.mjs messages/en.json --expand 0.4    (flat 40% longer)
//
// Each string becomes accented, longer and wrapped in brackets:
//   "Start free trial"  ->  "[Šţååååŕţ ƒŕééééééé ţŕîîîåååļ]"
// Placeholders, ICU plural/select syntax, tags and printf tokens are kept as
// they are, so the app still runs. Plain English left on screen is hardcoded
// text; a missing "]" means the layout cut the string.
//
// Length follows the W3C/IBM expansion figures (twice as long for short
// labels, 30% for long text) unless --expand sets a flat rate.
// --bidi wraps words in right-to-left overrides to fake a right-to-left
// language; set dir="rtl" on <html> for that locale.
//
// Zero dependencies. Node 18+. MIT license.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, basename, extname } from 'node:path';

const ACCENTS = {
  a: 'å', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ',
  n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ',
  N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};
const VOWELS = new Set([...'aeiouAEIOU']);

// Expansion by English length, from the IBM figures the W3C publishes.
export function expansionFor(length) {
  if (length <= 10) return 1.0;
  if (length <= 20) return 0.8;
  if (length <= 30) return 0.6;
  if (length <= 50) return 0.4;
  if (length <= 70) return 0.35;
  return 0.3;
}

// Split a message into literal text and protected tokens. ICU arguments are
// parsed so text inside plural/select branches is still pseudo-localized.
export function tokenize(msg, inPlural = false) {
  const out = [];
  let text = '';
  const flush = () => { if (text) { out.push({ t: 'text', v: text }); text = ''; } };
  let i = 0;
  while (i < msg.length) {
    const ch = msg[i];
    const rest = msg.slice(i);
    let m;
    if (rest.startsWith('{{')) {                        // i18next / mustache {{name}}
      const end = msg.indexOf('}}', i + 2);
      if (end !== -1) { flush(); out.push({ t: 'raw', v: msg.slice(i, end + 2) }); i = end + 2; continue; }
    }
    if (ch === '{') {                                   // ICU argument
      const end = matchBrace(msg, i);
      if (end !== -1) { flush(); out.push(parseArgument(msg.slice(i, end + 1))); i = end + 1; continue; }
    }
    if ((m = rest.match(/^<\/?[A-Za-z0-9_.:-]+(\s[^<>]*)?\/?>/))) { // <b>, </link>, <0/>, <br />
      flush(); out.push({ t: 'raw', v: m[0] }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^%(\d+\$)?[-+0#]*\d*(\.\d+)?[sdifuxXeEgGc@%](?![A-Za-z])/))) { // printf %s %1$d %%
      flush(); out.push({ t: 'raw', v: m[0] }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^%\([A-Za-z0-9_]+\)[sdif]/))) {  // Python %(name)s
      flush(); out.push({ t: 'raw', v: m[0] }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^%\{[A-Za-z0-9_]+\}/))) {        // Rails %{name}
      flush(); out.push({ t: 'raw', v: m[0] }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^\$t\([^)]*\)/))) {              // i18next nesting $t(key)
      flush(); out.push({ t: 'raw', v: m[0] }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^@:[A-Za-z0-9_.-]+/))) {         // vue-i18n linked @:key
      flush(); out.push({ t: 'raw', v: m[0] }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^&[A-Za-z]+;|^&#\d+;/))) {       // HTML entities
      flush(); out.push({ t: 'raw', v: m[0] }); i += m[0].length; continue;
    }
    if (inPlural && ch === '#') { flush(); out.push({ t: 'raw', v: '#' }); i++; continue; }
    text += ch; i++;
  }
  flush();
  return out;
}

function matchBrace(s, start) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// "{count, plural, one {# item} other {# items}}" -> keep the frame, transform branches
function parseArgument(arg) {
  const inner = arg.slice(1, -1);
  const m = inner.match(/^\s*([A-Za-z0-9_]+)\s*,\s*(plural|select|selectordinal)\s*,([\s\S]*)$/);
  if (!m) return { t: 'raw', v: arg };                // {name}, {n, number}, {d, date, short}
  const [, name, type, body] = m;
  const branches = [];
  let i = 0, prefix = '';
  const off = body.match(/^\s*offset:\d+\s*/);
  if (off) { prefix = off[0]; i = off[0].length; }
  while (i < body.length) {
    const sel = body.slice(i).match(/^\s*(=\d+|[A-Za-z0-9_]+)\s*/);
    if (!sel) break;
    i += sel[0].length;
    if (body[i] !== '{') break;
    const end = matchBrace(body, i);
    if (end === -1) break;
    branches.push({ selector: sel[1], message: body.slice(i + 1, end) });
    i = end + 1;
  }
  if (!branches.length) return { t: 'raw', v: arg };
  return { t: 'icu', name, type, prefix, branches, tail: body.slice(i), plural: type !== 'select' };
}

function pseudoText(text, ratio, bidi) {
  if (!/[A-Za-z]/.test(text)) return text;
  const chars = [...text];
  const accented = chars.map((c) => ACCENTS[c] ?? c);
  // Lengthen by repeating vowels, spread across the text, until the target
  // length is reached. Long unbroken words also stand in for German compounds.
  const letters = chars.filter((c) => /[A-Za-z]/.test(c)).length;
  let extra = Math.ceil(letters * ratio);
  const repeats = chars.map(() => 1);
  const vowelAt = chars.flatMap((c, k) => (VOWELS.has(c) ? [k] : []));
  for (let j = 0; vowelAt.length && extra > 0; j++, extra--) repeats[vowelAt[j % vowelAt.length]]++;
  let s = accented.map((a, k) => a.repeat(repeats[k])).join('') + '~'.repeat(Math.max(0, extra));
  if (bidi) s = s.replace(/[^\s]+/g, (w) => `‮${w}‬`);
  return s;
}

function render(tokens, ratio, bidi) {
  return tokens.map((tok) => {
    if (tok.t === 'text') return pseudoText(tok.v, ratio, bidi);
    if (tok.t === 'raw') return tok.v;
    const branches = tok.branches
      .map((b) => `${b.selector} {${render(tokenize(b.message, tok.plural), ratio, bidi)}}`)
      .join(' ');
    return `{${tok.name}, ${tok.type},${tok.prefix ? ' ' + tok.prefix.trim() : ''} ${branches}${tok.tail}}`;
  }).join('');
}

function visibleLength(tokens) {
  return tokens.reduce((n, t) => n + (t.t === 'text' ? t.v.length : t.t === 'icu' ? Math.max(...t.branches.map((b) => b.message.length)) : 0), 0);
}

export function pseudoMessage(msg, { expand = null, bidi = false } = {}) {
  const tokens = tokenize(msg);
  if (!tokens.some((t) => t.t !== 'raw') || !/[A-Za-z]/.test(msg)) return msg;
  const ratio = expand ?? expansionFor(visibleLength(tokens));
  const body = render(tokens, ratio, bidi);
  return bidi ? `‏[${body}]‏` : `[${body}]`;
}

export function pseudoTree(node, opts) {
  if (typeof node === 'string') return pseudoMessage(node, opts);
  if (Array.isArray(node)) return node.map((n) => pseudoTree(n, opts));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      // Leave metadata alone: ARB "@key" entries, "_comment", "$schema".
      out[k] = k.startsWith('@') || k.startsWith('_') || k === '$schema' ? v : pseudoTree(v, opts);
    }
    return out;
  }
  return node;
}

function main(argv) {
  const args = argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node pseudo-locale.mjs <source.json> [--out file] [--locale en-XA] [--expand 0.35] [--bidi]');
    process.exit(args.length ? 0 : 1);
  }
  const src = args[0];
  const opt = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
  const bidi = args.includes('--bidi');
  const locale = opt('--locale') ?? (bidi ? 'ar-XB' : 'en-XA');
  const expand = opt('--expand') !== null ? Number(opt('--expand')) : null;
  if (expand !== null && !(expand >= 0)) { console.error('--expand takes a number such as 0.35'); process.exit(1); }
  // One folder per language (locales/en/translation.json) gets a sibling folder
  // (locales/en-XA/translation.json); one file per language gets a sibling file.
  const parent = basename(dirname(src));
  const folderPerLanguage = /^[a-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/.test(parent);
  const out = opt('--out') ?? (folderPerLanguage
    ? join(dirname(dirname(src)), locale, basename(src))
    : join(dirname(src), `${locale}${extname(src) || '.json'}`));
  mkdirSync(dirname(out), { recursive: true });
  let data;
  try { data = JSON.parse(readFileSync(src, 'utf8')); }
  catch (e) { console.error(`Could not read ${src} as JSON: ${e.message}`); process.exit(1); }
  const result = pseudoTree(data, { expand, bidi });
  if (result && typeof result === 'object' && '@@locale' in result) result['@@locale'] = locale; // ARB
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  let count = 0;
  (function walk(n) { if (typeof n === 'string') count++; else if (n && typeof n === 'object') Object.values(n).forEach(walk); })(data);
  console.log(`Wrote ${out} (${count} strings, locale ${locale}${bidi ? ', right-to-left' : ''}).`);
  console.log(`Add "${locale}" to the app's locales and switch to it. Plain English on screen is hardcoded text; a missing "]" means the layout cut a string.`);
  if (bidi) console.log('Set dir="rtl" on <html> for this locale.');
  if (basename(src).includes(locale)) console.warn('Warning: the output name matches the input. Use --out.');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('pseudo-locale.mjs')) main(process.argv);
