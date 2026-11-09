import { Routes, Route, Link, useNavigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Upload from "./pages/Upload";
import Job from "./pages/Job";
import Jobs from "./pages/Jobs";
import Login from "./pages/Login";
import Account from "./pages/Account";
import Pricing from "./pages/Pricing";
import Thanks from "./pages/Thanks";
import Admin from "./pages/Admin";

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
                {creditBalance != null ? `${creditBalance.toLocaleString()} credits` : "Account"}
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

export default function App() {
  return (
    <div className="wx min-h-screen" style={{ background: "var(--wx-surface-sidebar)" }}>
      <Header />
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
