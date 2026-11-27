import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { formatList, languageLabel } from "../i18n/format";
import { Link } from "../i18n/routing";

const BADGE = {
  delivered: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-500",
  over_free_limit: "bg-amber-100 text-amber-700",
  needs_credits: "bg-amber-100 text-amber-700",
  no_text: "bg-amber-100 text-amber-700",
};

// The statuses a job can be in (server/store.js), each a message (jobs.status.<status>); the
// working ones all read "In progress".
const WORKING = ["created", "uploading", "analyzing", "approving", "translating"];
const STATUSES = ["delivered", "failed", "cancelled", "over_free_limit", "needs_credits", "no_text"];
const statusKey = (s) => (WORKING.includes(s) ? "jobs.status.inProgress" : STATUSES.includes(s) ? `jobs.status.${s}` : null);

export default function Jobs() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const [jobs, setJobs] = useState(null);
  const [names, setNames] = useState({});

  useEffect(() => {
    if (user) api.listJobs().then((d) => setJobs(d.jobs));
  }, [user]);

  useEffect(() => {
    api
      .languages()
      .then((d) => setNames(Object.fromEntries(d.languages.map((l) => [l.code, l.name]))))
      .catch(() => {});
  }, []);

  if (loading) return <p className="text-slate-500">{t("common.loading")}</p>;
  if (!user)
    return (
      <p>
        <Trans i18nKey="jobs.signInFirst" components={{ a: <Link to="/login" className="text-brand-600 underline" /> }} />
      </p>
    );

  const label = (code) => languageLabel(code, names[code]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("nav.myJobs")}</h1>
      {!jobs ? (
        <p className="text-slate-500">{t("common.loading")}</p>
      ) : jobs.length === 0 ? (
        <p className="text-slate-500">
          <Trans i18nKey="jobs.empty" components={{ a: <Link to="/" className="text-brand-600 underline" /> }} />
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link to={`/jobs/${j.id}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 hover:bg-slate-50">
                <span>
                  <span className="font-medium">#{j.id}</span>{" "}
                  <span className="text-sm text-slate-500">
                    {t("jobs.languages", { source: label(j.sourceLocale), targets: formatList(j.targetLocales.map(label)) })}
                    {j.analyzedWords ? (
                      <>
                        <span aria-hidden="true"> · </span>
                        {t("units.words", { words: j.analyzedWords })}
                      </>
                    ) : null}
                  </span>
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[j.status] || "bg-brand-100 text-brand-700"}`}>
                  {statusKey(j.status) ? t(statusKey(j.status)) : j.status.replace(/_/g, " ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
