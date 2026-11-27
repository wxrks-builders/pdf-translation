import { useEffect, useState } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { useAuth } from "./context/AuthContext";
import { SIGNUP_CREDIT, pagesFor, wordsAndPages } from "./pricing";
import { LOCALES } from "./i18n";
import { formatMoney } from "./i18n/format";
import { Link, LanguageSuggestion, LanguageSwitcher, useLocaleSync, useNavigate, usePagePath } from "./i18n/routing";
import Upload from "./pages/Upload";
import Job from "./pages/Job";
import Jobs from "./pages/Jobs";
import Login from "./pages/Login";
import Account from "./pages/Account";
import Pricing from "./pages/Pricing";
import Thanks from "./pages/Thanks";
import Admin from "./pages/Admin";
import Feedback from "./pages/Feedback";

function Header() {
  const { t } = useTranslation();
  const { user, creditBalance, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="border-b border-brand-200 bg-white">
      <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
        <Link to="/" className="flex items-center gap-2" aria-label={t("nav.homeLabel")}>
          {/* "wxrks Translate" is the product's name in every language (LOCALIZATION.md). */}
          <img src="/wxrks-logo.svg" alt="wxrks" className="h-[18px] w-auto" />
          <span className="text-[15px] font-medium text-brand-500" lang="en">
            Translate
          </span>
        </Link>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Link to="/pricing" className="wx-button wx-button--primary wx-button--compact order-last">
            {t("common.buyWords")}
          </Link>
          {user ? (
            <>
              <Link to="/jobs" className="text-slate-600 hover:text-slate-900">
                {t("nav.myJobs")}
              </Link>
              <Link to="/account" className="text-slate-600 hover:text-slate-900">
                {creditBalance != null ? (
                  <>
                    <span className={creditBalance > 0 ? "sm:hidden" : ""}>{t("units.words", { words: creditBalance })}</span>
                    {creditBalance > 0 && (
                      <span className="hidden sm:inline">{t("units.wordsAndPages", { words: creditBalance, pages: pagesFor(creditBalance) })}</span>
                    )}
                  </>
                ) : (
                  t("nav.account")
                )}
              </Link>
              <button
                onClick={async () => {
                  await logout();
                  navigate("/");
                }}
                className="text-slate-500 hover:text-slate-900"
              >
                {t("nav.signOut")}
              </button>
            </>
          ) : (
            <Link to="/login" className="text-slate-600 hover:text-slate-900">
              {t("nav.signIn")}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

// Back from a sign-in link that made a new account: the server added the sign-up credit and
// says so with ?credit= (server/routes/auth.js). Shown once, then taken off the address.
function CreditAdded() {
  const { t } = useTranslation();
  const location = useLocation();
  const { creditBalance } = useAuth();
  const [words, setWords] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const credit = parseInt(params.get("credit"), 10);
    if (!credit) return;
    setWords(credit);
    params.delete("credit");
    const rest = params.toString();
    window.history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}`);
  }, [location.search, location.pathname]);
  if (!words) return null;
  return (
    <div className="mx-auto mt-6 max-w-xl px-4">
      <div className="wx-alert wx-alert--success" role="status">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0">
          <path d="M3 8.5l3.2 3L13 4.5" />
        </svg>
        <span>
          <Trans
            i18nKey="creditAdded.text"
            values={{ amount: formatMoney(SIGNUP_CREDIT.dollars), balance: wordsAndPages(creditBalance ?? words) }}
            components={{ strong: <strong className="inline font-medium" /> }}
          />
        </span>
        <button type="button" onClick={() => setWords(null)} className="ms-auto text-xs underline">
          {t("creditAdded.close")}
        </button>
      </div>
    </div>
  );
}

// The landing pages' titles come from the server on the first load (server/seo.js); after that
// the app keeps the tab's title in the page's language.
const TITLES = { "/": "home", "/pdf": "pdf", "/documents": "documents" };
function useDocumentTitle() {
  const { t } = useTranslation();
  const path = usePagePath();
  const page = TITLES[path] || "home";
  useEffect(() => {
    document.title = t(`seo.${page}.title`);
  }, [page, t]);
}

// Every page, once per language: /pdf, /es/pdf, /pt-br/pdf... The same elements in the same
// places, so switching language keeps what is on the page (the file picked, the email typed).
const pages = (
  <>
    <Route index element={<Upload />} />
    <Route path="pdf" element={<Upload />} />
    <Route path="documents" element={<Upload />} />
    <Route path="jobs" element={<Jobs />} />
    <Route path="jobs/:id" element={<Job />} />
    <Route path="login" element={<Login />} />
    <Route path="account" element={<Account />} />
    <Route path="pricing" element={<Pricing />} />
    <Route path="thanks" element={<Thanks />} />
    <Route path="admin" element={<Admin />} />
    <Route path="feedback" element={<Feedback />} />
  </>
);

export default function App() {
  useLocaleSync();
  useDocumentTitle();
  return (
    <div className="wx min-h-screen" style={{ background: "var(--wx-surface-sidebar)" }}>
      <Header />
      <LanguageSuggestion />
      <CreditAdded />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Routes>
          {LOCALES.map((l) => (
            <Route key={l.code} path={`/${l.path}`}>
              {pages}
            </Route>
          ))}
        </Routes>
      </main>
      {/* AGPL-3.0 §13: users of the network service get a way to the source. */}
      <Footer />
    </div>
  );
}

function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-brand-500">
      <p className="flex flex-wrap gap-x-2">
        <Link to="/pdf" className="underline hover:text-slate-600">
          {t("footer.pdf")}
        </Link>
        <span aria-hidden="true">·</span>
        <Link to="/documents" className="underline hover:text-slate-600">
          {t("footer.documents")}
        </Link>
      </p>
      <p>
        <Trans
          i18nKey="footer.credits"
          components={{
            company: <a href="https://wxrks.com" className="underline hover:text-slate-600" />,
            repo: <a href="https://github.com/wxrks-builders/pdf-translation" className="underline hover:text-slate-600" />,
          }}
        />
      </p>
      <LanguageSwitcher />
    </footer>
  );
}
