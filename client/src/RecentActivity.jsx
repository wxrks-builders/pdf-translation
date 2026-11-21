import { useEffect, useState } from "react";
import { api } from "./api";

// What people really translated here this week (server/routes/activity.js): languages, words and
// when, nothing that names anyone. Shown only when there is enough of it to say something: three
// translations this week. Rodrigo, 2026-11-21, asked to show people finishing translations; this
// shows only real ones.
const MIN_ROWS = 3;
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function ago(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return rtf.format(-Math.max(1, minutes), "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}

export default function RecentActivity({ className = "mt-4" }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.recentActivity().then(setData).catch(() => {});
  }, []);
  if (!data || data.recent.length < MIN_ROWS) return null;
  return (
    <div className={`${className} rounded-[10px] border border-brand-200 bg-white px-5 py-4`}>
      <p className="text-[13px] font-medium">Translated here this week</p>
      <ul className="mt-2 space-y-1.5">
        {data.recent.map((r, i) => (
          <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
            <span>
              {r.from} → {r.to.join(", ")} · {r.words.toLocaleString("en-US")} words
            </span>
            <span className="text-brand-500">{ago(r.at)}</span>
          </li>
        ))}
      </ul>
      {data.last30.documents >= 10 && (
        <p className="mt-2.5 text-[11px] text-brand-500">
          {data.last30.documents.toLocaleString("en-US")} documents translated in the last 30 days.
        </p>
      )}
    </div>
  );
}
