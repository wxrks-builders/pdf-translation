import { useEffect, useState } from "react";
import { Routes, Route, Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { SIGNUP_CREDIT, aboutPages, wordsAndPages } from "./pricing";
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
  const { user, creditBalance, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="border-b border-brand-200 bg-white">
      <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2" aria-label="wxrks Translate, home">
          <img src="/wxrks-logo.svg" alt="wxrks" className="h-[18px] w-auto" />
          <span className="text-[15px] font-medium text-brand-500">Translate</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link to="/pricing" className="wx-button wx-button--primary wx-button--compact order-last">
            Buy words
          </Link>
          {user ? (
            <>
              <Link to="/jobs" className="text-slate-600 hover:text-slate-900">
                My jobs
              </Link>
              <Link to="/account" className="text-slate-600 hover:text-slate-900">
                {creditBalance != null ? (
                  <>
                    {creditBalance.toLocaleString("en-US")} words
                    {creditBalance > 0 && <span className="hidden sm:inline"> ({aboutPages(creditBalance)})</span>}
                  </>
                ) : (
                  "Account"
                )}
              </Link>
              <button
                onClick={async () => {
                  await logout();
                  navigate("/");
                }}
                className="text-slate-500 hover:text-slate-900"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link to="/login" className="text-slate-600 hover:text-slate-900">
              Sign in
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
  const location = useLocation();
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
          <strong className="inline font-medium">${SIGNUP_CREDIT.dollars} in credits added for signing up.</strong> You have {wordsAndPages(words)}.
        </span>
        <button type="button" onClick={() => setWords(null)} className="ml-auto text-xs underline">
          Close
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div className="wx min-h-screen" style={{ background: "var(--wx-surface-sidebar)" }}>
      <Header />
      <CreditAdded />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Routes>
          <Route path="/" element={<Upload />} />
          <Route path="/pdf" element={<Upload />} />
          <Route path="/documents" element={<Upload />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/:id" element={<Job />} />
          <Route path="/login" element={<Login />} />
          <Route path="/account" element={<Account />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/thanks" element={<Thanks />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/feedback" element={<Feedback />} />
        </Routes>
      </main>
      {/* AGPL-3.0 §13: users of the network service get a way to the source. */}
      <footer className="mx-auto max-w-4xl px-4 pb-8 text-xs text-brand-500">
        <Link to="/pdf" className="underline hover:text-slate-600">
          PDF translator
        </Link>{" "}
        ·{" "}
        <Link to="/documents" className="underline hover:text-slate-600">
          Document translator
        </Link>
        <br />
        Translations by{" "}
        <a href="https://wxrks.com" className="underline hover:text-slate-600">
          wxrks
        </a>
        . wxrks Translate is open source under the AGPL-3.0:{" "}
        <a href="https://github.com/wxrks-builders/pdf-translation" className="underline hover:text-slate-600">
          source code
        </a>
        .
      </footer>
    </div>
  );
}
