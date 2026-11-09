import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ThumbIcon } from "./Job";

// Where the feedback email's links land (/feedback?job=…&r=up|down&t=…): the click is the answer,
// recorded at once; a note is optional.
export default function Feedback() {
  const [params] = useSearchParams();
  const job = params.get("job");
  const t = params.get("t");
  const [rating, setRating] = useState(params.get("r") === "down" ? "down" : "up");
  const [state, setState] = useState("saving");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!job || !t) return setState("missing");
    api
      .emailFeedback({ job, t, rating })
      .then(() => setState("saved"))
      .catch(() => setState("missing"));
  }, [job, t, rating]);

  async function send(e) {
    e.preventDefault();
    setState("sending");
    try {
      await api.emailFeedback({ job, t, rating, comment });
      setState("sent");
    } catch {
      setState("saved");
    }
  }

  return (
    <section className="mx-auto max-w-xl">
      <div className="rounded-[10px] border border-brand-200 bg-white p-6 sm:p-8">
        {state === "missing" ? (
          <p className="text-[15px]">This link has expired.</p>
        ) : (
          <>
            <h1 className="text-[22px] font-medium tracking-[-0.3px]">
              {rating === "up" ? "Glad it worked. Thank you." : "Sorry it didn't work. Thank you for telling us."}
            </h1>
            <div className="mt-4 flex flex-wrap gap-2">
              {["up", "down"].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRating(r)}
                  aria-pressed={rating === r}
                  className={`wx-button inline-flex items-center gap-2 ${rating === r ? "wx-button--primary" : ""}`}
                >
                  <ThumbIcon down={r === "down"} />
                  {r === "up" ? "It worked" : "Something was off"}
                </button>
              ))}
            </div>
            {state === "sent" ? (
              <p className="mt-4 text-[13px] text-brand-500">Got it. A person reads every note.</p>
            ) : (
              <form onSubmit={send} className="mt-5 space-y-2">
                <label className="wx-label" htmlFor="fb-note">
                  {rating === "up" ? "Anything we should know? (optional)" : "What went wrong? (optional)"}
                </label>
                <textarea
                  id="fb-note"
                  className="wx-input w-full"
                  rows={4}
                  maxLength={2000}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  style={{ height: "auto", paddingTop: 8, paddingBottom: 8 }}
                />
                <button type="submit" className="wx-button wx-button--primary" disabled={!comment.trim() || state === "sending"}>
                  Send
                </button>
              </form>
            )}
            <Link to="/" className="mt-6 inline-block text-xs underline">
              Translate another document
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
