import { useEffect, useState } from "react";
import { api } from "./api";

// What people really translated here this week (server/routes/activity.js): languages and words,
// nothing that names anyone. Shown only when there is enough of it to say something: three
// translations this week. Rodrigo, 2026-11-21, asked to show people finishing translations; this
// shows only real ones. No day counts ("5 days ago" reads as a quiet site, he said): a row says
// when only while that is fresh and true, "a few moments ago" or "earlier today".
const MIN_ROWS = 3;

function when(iso) {
  const at = new Date(iso);
  const minutes = (Date.now() - at.getTime()) / 60000;
  if (minutes < 5) return "a few moments ago";
  if (minutes < 60) return "a few minutes ago";
  if (at.toDateString() === new Date().toDateString()) return "earlier today";
  return null;
}

export default function RecentActivity({ className = "mt-4" }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.recentActivity().then(setData).catch(() => {});
  }, []);
  if (!data || data.recent.length < MIN_ROWS) return null;
  return (
    <div className={`${className} rounded-[10px] border border-brand-200 bg-white px-5 py-4`}>
      <p className="text-[13px] font-medium">Recently translated here</p>
      <ul className="mt-2 space-y-1.5">
        {data.recent.map((r, i) => {
          const fresh = when(r.at);
          return (
            <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
              <span>
                {r.from} → {r.to.join(", ")} · {r.words.toLocaleString("en-US")} words
              </span>
              {fresh && <span className="text-brand-500">{fresh}</span>}
            </li>
          );
        })}
      </ul>
      {data.last30.documents >= 10 && (
        <p className="mt-2.5 text-[11px] text-brand-500">
          {data.last30.documents.toLocaleString("en-US")} documents translated in the last 30 days.
        </p>
      )}
    </div>
  );
}
