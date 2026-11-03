import { Routes, Route, Link, useNavigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Upload from "./pages/Upload";
import Job from "./pages/Job";
import Jobs from "./pages/Jobs";
import Login from "./pages/Login";
import Account from "./pages/Account";

function Header() {
  const { user, creditBalance, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <Link to="/" className="text-lg font-semibold text-brand-600">
          DocTranslate
        </Link>
        <nav className="flex items-center gap-4 text-sm">
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
    <div className="min-h-screen">
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
        </Routes>
      </main>
      {/* AGPL-3.0 §13: users of the network service get a way to the source. */}
      <footer className="mx-auto max-w-4xl px-4 pb-8 text-xs text-slate-400">
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
        . DocTranslate is open source under the AGPL-3.0 —{" "}
        <a href="https://github.com/wxrks-builders/pdf-translation" className="underline hover:text-slate-600">
          source code
        </a>
        .
      </footer>
    </div>
  );
}
