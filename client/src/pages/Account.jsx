import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { aboutPages } from "../pricing";
import { formatNumber, formatShortDate } from "../i18n/format";
import { Link } from "../i18n/routing";
import { PackGrid } from "./Pricing";

// Each kind of ledger row is a message: account.kind.<kind>. The server writes its rows' notes in
// English ("10,000-word pack", "translation charge"), restating the row, so they show in English
// only; the notes the team writes on grants show in every language, as written.
const KINDS = ["purchase", "charge", "refund", "grant", "signup"];

export default function Account() {
  const { t, i18n } = useTranslation();
  const { user, loading } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (user) api.credits().then(setData);
  }, [user]);

  if (loading) return <p className="text-brand-500">{t("common.loading")}</p>;
  if (!user)
    return (
      <p>
        <Trans i18nKey="account.signInFirst" components={{ a: <Link to="/login" className="underline" /> }} />
      </p>
    );

  const kind = (k) => (KINDS.includes(k) ? t(`account.kind.${k}`) : k);
  const english = i18n.resolvedLanguage === "en";
  const noteOf = (row) => (row.note && (english || row.kind === "grant") ? row.note : null);
  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-[22px] font-medium tracking-[-0.3px]">{t("account.title")}</h1>
        <p className="mt-1 text-[13px] text-brand-500" dir="ltr">
          <bdi>{user.email}</bdi>
        </p>
      </div>

      <div className="rounded-[10px] border border-brand-200 bg-white px-6 py-5">
        <p className="text-xs text-brand-500">{t("account.balanceLabel")}</p>
        <p className="mt-1 text-[29px] font-medium leading-tight tracking-[-0.4px]">
          {data ? formatNumber(data.balance) : "…"}
          {data?.balance > 0 && (
            <span className="ms-2 text-[15px] font-normal tracking-normal text-brand-500">{t("packs.pages", { about: aboutPages(data.balance) })}</span>
          )}
        </p>
        <p className="mt-2 text-xs text-brand-500">{t("account.creditRule")}</p>
      </div>

      {data?.ledger?.length > 0 && (
        <div className="overflow-hidden rounded-[10px] border border-brand-200 bg-white">
          <h2 className="border-b border-brand-200 px-5 py-3 text-xs font-medium text-brand-500">{t("account.history")}</h2>
          <ul className="divide-y divide-brand-200 text-[13px]">
            {data.ledger.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="font-medium">{row.kind === "signup" ? noteOf(row) || kind("signup") : kind(row.kind)}</span>
                  {row.kind !== "signup" && noteOf(row) && (
                    <span className="text-brand-500">
                      <span aria-hidden="true"> · </span>
                      <bdi>{noteOf(row)}</bdi>
                    </span>
                  )}
                  {row.job_id && (
                    <Link to={`/jobs/${row.job_id}`} className="ms-2 text-brand-500 underline">
                      #{row.job_id}
                    </Link>
                  )}
                  <span className="text-brand-500">
                    <span aria-hidden="true"> · </span>
                    {formatShortDate(row.created_at)}
                  </span>
                </span>
                <span className={`shrink-0 font-medium tabular-nums ${row.delta > 0 ? "text-[#176b45]" : ""}`} dir="ltr">
                  {row.delta > 0 ? "+" : ""}
                  {formatNumber(row.delta)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div id="buy" className="rounded-[10px] border border-brand-200 bg-white px-6 py-5">
        <h2 className="mb-3 text-[13px] font-medium">{t("common.buyWords")}</h2>
        <PackGrid place="account" />
      </div>
    </section>
  );
}
