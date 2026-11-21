import { useEffect, useState } from "react";
import { api } from "./api";

// What people really translated here this week (server/routes/activity.js), as a light green pill
// in the bottom corner, one translation at a time: "🎉 783 words translated from Portuguese into
// English". Rodrigo, 2026-11-21: version 2 of the toasts canvas
// (https://claude.ai/artifact/56PmtPNQraNK7V1bimbad5). Only real translations: languages and
// words, nothing that names anyone; a time only while it is fresh and true. It plays once a visit,
// at most three pills, and × ends it for the visit; it waits for three translations in a week.
const MIN_ROWS = 3;
const MAX_PILLS = 3;
const START_MS = 2500;
const SHOW_MS = 4500;
const LEAVE_MS = 350;
const GAP_MS = 900;
const EMOJI = ["🎉", "✨", "👏"];
const SEEN_KEY = "wx-activity-seen";

function when(iso) {
  const at = new Date(iso);
  const minutes = (Date.now() - at.getTime()) / 60000;
  if (minutes < 5) return "a few moments ago";
  if (minutes < 60) return "a few minutes ago";
  if (at.toDateString() === new Date().toDateString()) return "earlier today";
  return null;
}

// "Portuguese (Portugal)" → "Portuguese": the pill stays one line on a computer.
const short = (name) => String(name).replace(/\s*\([^)]*\)\s*$/, "");
const list = (names) => {
  const n = [...new Set(names.map(short))];
  return n.length < 2 ? n[0] : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
};

function seen() {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private window: it may play again on the next page, which is fine */
  }
}

export default function RecentActivity() {
  const [rows, setRows] = useState(null);
  const [index, setIndex] = useState(-1);
  const [leaving, setLeaving] = useState(false);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (seen()) return;
    api
      .recentActivity()
      .then((data) => {
        if (data.recent.length >= MIN_ROWS) setRows(data.recent.slice(0, MAX_PILLS));
      })
      .catch(() => {});
  }, []);

  // The sequence: wait, then each pill in turn, then nothing more this visit.
  useEffect(() => {
    if (!rows || closed) return;
    markSeen();
    const timers = [];
    let at = START_MS;
    rows.forEach((_, i) => {
      timers.push(setTimeout(() => (setLeaving(false), setIndex(i)), at));
      timers.push(setTimeout(() => setLeaving(true), at + SHOW_MS - LEAVE_MS));
      at += SHOW_MS + GAP_MS;
    });
    timers.push(setTimeout(() => setIndex(-1), at - GAP_MS));
    return () => timers.forEach(clearTimeout);
  }, [rows, closed]);

  if (!rows || closed || index < 0) return null;
  const r = rows[index];
  const fresh = when(r.at);
  return (
    <div className="wx-activity" role="status" aria-live="polite">
      <div key={index} className="wx-activity-pill" data-leaving={leaving ? "true" : "false"}>
        <span className="relative shrink-0 text-[20px] leading-5">
          <span className="wx-activity-emoji" aria-hidden="true">
            {EMOJI[index % EMOJI.length]}
          </span>
          {index === 0 && (
            <>
              <span className="wx-activity-spark" style={{ left: 18, top: -2, width: 4, height: 4, background: "#00742c" }} />
              <span className="wx-activity-spark" style={{ left: 4, top: -6, width: 3, height: 3, background: "#315b7c", animationDelay: ".15s" }} />
              <span className="wx-activity-spark" style={{ left: 12, top: -10, width: 3, height: 3, background: "#785000", animationDelay: ".3s" }} />
            </>
          )}
        </span>
        <span className="wx-activity-text min-w-0 text-[13px] leading-[18px] text-[#176b45]">
          <strong className="font-medium">{r.words.toLocaleString("en-US")} words</strong> translated from {short(r.from)} into {list(r.to)}
          {fresh ? ` · ${fresh}` : ""}
        </span>
        <button
          type="button"
          aria-label="Close"
          onClick={() => setClosed(true)}
          className="-my-1 -mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[16px] leading-none text-[#176b45] hover:bg-[#d4eedd]"
        >
          ×
        </button>
      </div>
    </div>
  );
}
