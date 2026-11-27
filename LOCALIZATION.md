# LOCALIZATION.md

How this app handles languages. Read it before writing any text a person will see, and update it
when a decision changes.

## Languages

- Source language: en
- Target languages: pt-BR, es, fr, de, it, sv, ar, zh-CN, ja, ko (the ten languages wxrks.com publishes)
- Fallback: any key a language doesn't have yet shows in English (en), never as a raw key; in
  development the console lists them.
- First visit: English, with a one-line suggestion (never a redirect) when the browser prefers
  one of the target languages. Never by IP.
- Right-to-left languages in scope: ar
- Pseudo-locale for testing: en-XA, development only (`npm run i18n:pseudo --prefix client`, then
  open `/en-xa/`). The generated file is not committed.

## Where the text lives

- Messages: `client/src/locales/{locale}.json`, one file per language. `en.json` is the only one
  edited by hand; the others change through translation (`references/translating.md` in the
  localize-code skill).
- Format: ICU MessageFormat inside JSON (`{count, plural, one {# word} other {# words}}`,
  `{x, select, …}`, `{n, number}`). Rich text as tags: `<a>`, `<b>`, `<strong>`; `<file/>` and
  `<text/>` are slots the app fills with user text. Never name a tag after an HTML void element
  (`link`, `source`, `img`…): `<Trans>` would render it empty.
- Library: react-i18next with i18next-icu. English is bundled; every other language is loaded
  when it is first needed.
- The languages, their URL prefixes and their own names: `client/src/locales/_languages.json`,
  read by the client and by the server.
- Context notes for translators: `client/src/locales/_context.json`
- Approval status: `client/src/locales/_status.json` (`source` is the English each translation
  was made from; check-i18n reports translations whose English changed since)
- Key style: area.element.purpose, for example `job.over.typeEmail`. Keys never change when the
  English does.
- Formatting: `client/src/i18n/format.js` (numbers, US-dollar prices, percents, lists, dates, file
  sizes, language names). Never `toLocaleString("en-US")` or a hand-written `$` in the client.
- Language names: the wxrks catalog's English names in English; `Intl.DisplayNames` in the
  reader's language everywhere else ("portugués (Brasil)").
- Server errors: the API answers with stable codes (`invalid_email`, `too_many_languages`…); the
  client shows `errors.<code>`, never the API's English `message`.
- Content from the database: none translated (file names, partner names and notes are shown as
  written, with `dir="auto"`).
- Images with text: the G2 and SOC 2 badges are the vendors' own English artwork; their alt text
  and the sentences around them are translated.
- Checks: `npm run i18n:check --prefix client` runs `client/scripts/check-messages.mjs` (every key
  the code uses exists, every message in every language parses as ICU with the English
  placeholders and tags) and the skill's `check-i18n.mjs` (plural categories, missing keys,
  out-of-date translations).

## URLs and search

- English at `/`, `/pdf`, `/documents`; every other language under its prefix: `/pt-br/`,
  `/es/`, `/fr/`, `/de/`, `/it/`, `/sv/`, `/ar/`, `/zh-cn/`, `/ja/`, `/ko/` (`/es/pdf`,
  `/es/jobs/…`). Links inside the app keep the current prefix (`client/src/i18n/routing.jsx`).
- The server renders each landing page in its language: `<html lang dir>`, title, description,
  self-referencing canonical, `og:locale`, hreflang for every language plus `x-default` (English),
  and the heading inside `#root` (`server/seo.js`, from the `seo` messages). The sitemap lists every
  language version with its alternates; robots.txt keeps the private pages out in every language.
- The visitor's choice is the `wx_locale` cookie (a year). Addresses without a prefix (links in
  emails, Stripe's return, sign-in links) open in the saved language. Visiting a prefixed page
  saves it; picking English in the switcher saves English.
- The switcher is in the footer of every page: each language in its own name, linking to the
  same page (query string kept), so a picked file or typed email stays.

## Never translate

- wxrks
- wxrks Translate (the product's name; "Translate" stays English beside the logo)
- Sous-Chef (the wxrks tone agent)
- Smells (the wxrks quality check)
- Confidence Score (the wxrks score Smells gives; to confirm, see Decisions)
- Premium Partner, Pro (wxrks marketplace badges, shown as the marketplace sends them)
- G2, G2 Leader, SOC 2 Type 2, AGPL-3.0, Stripe
- Word, PowerPoint, Excel, PDF, ZIP, CSV (file formats and Microsoft product names)

## Glossary

Terms translated the same way everywhere. Add a row the first time a term is decided.

| Term | Notes | pt-BR | es | fr | de | it | sv | ar | zh-CN | ja | ko |
|---|---|---|---|---|---|---|---|---|---|---|---|
| word | the unit counted and sold: words of the source document | palavra | palabra | mot | Wort | parola | ord | كلمة | 字 | 語 | 단어 |
| credit | one prepaid source word into one language | crédito | crédito | crédit | Credit | credito | kredit | رصيد | 额度 | クレジット | 크레딧 |
| word pack | a one-time purchase of words | pacote de palavras | paquete de palabras | pack de mots | Wortpaket | pacchetto di parole | ordpaket | باقة كلمات | 字数包 | ワードパック | 단어 패키지 |
| page | about 250 words | página | página | page | Seite | pagina | sida | صفحة | 页 | ページ | 페이지 |
| sample | the free pages of a file over the free limit | amostra | muestra | extrait | Probe | anteprima | provsida | عينة | 样本 | サンプル | 샘플 |
| design-kept PDF | the PDF with the translation drawn on the original pages | PDF com o design original | PDF con el diseño original | PDF qui garde la mise en page | PDF im Originaldesign | PDF con il design originale | PDF med originaldesignen | ملف PDF بالتصميم الأصلي | 保留原设计的 PDF | 元のデザインのままの PDF | 원본 디자인 그대로인 PDF |
| tone | how the translation should sound | tom | tono | ton | Tonalität | tono | ton | الأسلوب | 语气 | トーン | 어조 |
| translation memory | wxrks platform feature | memória de tradução | memoria de traducción | mémoire de traduction | Translation Memory | memoria di traduzione | översättningsminne | ذاكرة الترجمة | 翻译记忆库 | 翻訳メモリ | 번역 메모리 |
| glossary | wxrks platform feature | glossário | glosario | glossaire | Glossar | glossario | ordlista | مسرد المصطلحات | 术语表 | 用語集 | 용어집 |
| translator, partner | a professional on the wxrks marketplace | tradutor, parceiro | traductor, socio | traducteur, partenaire | Übersetzer, Partner | traduttore, partner | översättare, partner | مترجم، شريك | 译员、合作伙伴 | 翻訳者、パートナー | 번역가, 파트너 |
| sign up / sign in | make an account / open it, both by an emailed link | cadastrar-se / entrar | registrarse / iniciar sesión | s'inscrire / se connecter | registrieren / anmelden | registrarsi / accedere | registrera dig / logga in | إنشاء حساب / تسجيل الدخول | 注册 / 登录 | 登録 / ログイン | 가입 / 로그인 |
| job | one file (or set of files) sent to translate; "My jobs" | tradução | traducción | traduction | Auftrag | traduzione | jobb | مهمة | 任务 | 翻訳 | 작업 |
| checkout | paying for a word pack | pagamento | pago | paiement | Bezahlseite | pagamento | kassan | الدفع | 结账 | 決済 | 결제 |
| severity | Smells' Critical / Major / Minor | Crítico / Grave / Leve | Crítico / Grave / Leve | Critique / Majeur / Mineur | Kritisch / Erheblich / Gering | Critico / Grave / Lieve | Kritisk / Allvarlig / Mindre | حرج / كبير / طفيف | 严重 / 主要 / 次要 | 重大 / 中程度 / 軽微 | 심각 / 주요 / 경미 |

Arabic counts credits as وحدة رصيد / وحدات رصيد ("5 أرصدة" reads badly); رصيد alone is the balance.

## Voice per language

The English is plain, short and warm. Each language keeps that, in the form its market expects
from a business tool:

- pt-BR: você; friendly and direct.
- es: tú; neutral Latin American Spanish (no vosotros, no regional slang).
- fr: vous.
- de: Sie.
- it: tu.
- sv: du.
- ar: Modern Standard Arabic; neutral constructions where possible, otherwise the masculine
  singular as the generic form. Western digits (0–9), as `Intl` gives for `ar`.
- zh-CN: Simplified Chinese, 您; full-width punctuation.
- ja: です/ます; no excessive honorifics.
- ko: 해요체 for sentences; buttons and labels as nouns or short verbs.

## Markets

| Market | Locale | Currency | Notes |
|---|---|---|---|
| Everywhere | all | USD | Word packs are sold in US dollars in every language; `Intl` writes the price the reader's way ("$9", "9 $US", "US$ 9") |

## Deliberately English

- The admin pages (`/admin` in any language): marked `lang="en" dir="ltr"`.
- The emails the server sends (sign-in links, files, reminders, deletion warnings, feedback).
  Next step: store the `wx_locale` cookie the client already sets on the lead, job or account
  when it is created, and render each email from messages in that language. That touches the job
  and email logic, so it was left out of this change.
- The subject of the "buy by email" fallback (`buyHref` in `client/src/pricing.js`): it is a
  request the wxrks team reads and fulfils by hand.
- What Smells reports about a flagged sentence (its type and note), partner names, badges and
  places from the marketplace, and file names: shown as they come.
- The notes the server writes on credit history rows ("10,000-word pack", "translation charge"):
  shown on the English Account page only; other languages show the row's kind, translated. Notes
  the team writes on grants show in every language, as written.
- The product name on Stripe Checkout ("10,000 words", `server/services/payments.js`), part of the
  payment code. Stripe translates the rest of its page by the browser's language.
- The development-only "Dev mode: sign in now" link on the sign-in page.

## Review

- Who approves each language: [name or team per language — to fill in]
- Every translation in this repository is a draft written by Claude (status `draft` in
  `_status.json`), not yet read by a person who speaks the language.
- Always reviewed by a person who speaks the language before going live: prices and payment
  (`units.*`, `packs.*`, `pricing.*`, `freeUsed.*`, `thanks.*`, `job.over.*`, `job.needs.*`,
  `job.card.*`), account and security messages (`login.*`, `offer.*`, `errors.*`, `job.email.*`,
  `job.privacy`, `job.gated.footnote`), and marketing headlines (`seo.*`, `upload.landing.*`,
  `trust.*`, `job.over.typeEmail`).

### Open questions for each language's reviewer

Raised by the drafts; decide, then update the glossary and the files.

- All: the G2 badge's alt text translates the season ("outono de 2026"); G2 names its reports by
  the northern season, so keeping "Fall 2026" may be better.
- pt-BR: 0 is singular in Portuguese plural rules, so five messages add a `=0` branch ("0
  palavras"). Masculine generic statuses ("Concluído").
- es: `Intl` formats 2000 as "2000" (Spain's rule for four digits) and 20.000 with a dot; most of
  Latin America writes 2,000 and 20,000. Switching the number format to `es-419` would be a small
  code change in `client/src/i18n/format.js`. "socio" for partner may read as co-owner.
- fr / it: the activity pill is rephrased so articles agree with language names; Italian uses
  "anteprima" for both sample and preview.
- de: "Probe" for the sample may read as a product sample ("Leseprobe"? "Probeseiten"?); "Credits im
  Wert von 18 $" is long on a button; "Memory" became "Translation Memory" (the card game).
- sv: "krediter" may read as loan credit.
- ar: وحدة رصيد for counted credits; dual forms after numbers; buttons use masculine imperatives;
  مهامي or ترجماتي for "My jobs"; prices render as `Intl` writes them for `ar` ("18 US$").
- zh-CN: "# 额度" as a counted unit, or "# 点额度".
- ja: half-width spaces between Japanese and Latin letters or digits ("2,000 語").
- ko: particles after placeholders assume language names ending in 어 (로) and counts ending in
  페이지 (를/가).

## Decisions

- 2026-11-27: react-i18next with ICU (i18next-icu), one JSON file per language in
  `client/src/locales/`. English bundled, others loaded on demand.
- 2026-11-27: one URL per language, English unprefixed; the server renders titles, hreflang and
  the sitemap per language. Choice remembered in the `wx_locale` cookie.
- 2026-11-27: Chinese is Simplified Chinese as `zh-CN` (`/zh-cn/`); Spanish is neutral `es`.
  To confirm against how wxrks.com names its versions (it couldn't be read while this was set up).
- 2026-11-27: Confidence Score, Smells and Sous-Chef stay in English as wxrks feature names. To
  confirm with whoever owns those names.
- 2026-11-27: forms of address as in "Voice per language". To confirm with each language's reviewer.
- 2026-11-27: Arabic uses Western digits; the layout mirrors with logical CSS (`ms-*`, `start-*`,
  `inset-inline-*`); arrows on Previous/Next flip.
- 2026-11-27: in right-to-left languages `formatMoney` wraps the currency symbol in a
  left-to-right isolate, so "US$" stays one symbol beside the number ("US$ 9" on screen, read
  from the right) instead of the "$" landing on the far side ("$US 9").
- 2026-11-27: Chinese, Japanese, Korean and Arabic use system fonts after Visual Sans (no web font
  download), with line height 1.7 for body text and no letter-spacing.
