async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON response (e.g. file downloads use plain links, not this helper)
  }
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${res.status}`);
    err.code = data?.error;
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  me: () => request("/api/auth/me"),
  // next: the path the link brings them back to (their file, from the sign-up credit offer).
  requestLoginLink: (email, next) => request("/api/auth/request-link", { method: "POST", body: JSON.stringify({ email, next }) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  languages: () => request("/api/languages"),
  createJob: (formData) => request("/api/jobs", { method: "POST", body: formData }),
  listJobs: () => request("/api/jobs"),
  getJob: (id, k) => request(`/api/jobs/${id}${k ? `?k=${encodeURIComponent(k)}` : ""}`),
  cancelJob: (id) => request(`/api/jobs/${id}/cancel`, { method: "POST" }),
  unlockJob: (id, body, k) =>
    request(`/api/jobs/${id}/unlock${k ? `?k=${encodeURIComponent(k)}` : ""}`, { method: "POST", body: JSON.stringify(body) }),
  rerunJob: (id, k) => request(`/api/jobs/${id}/rerun${k ? `?k=${encodeURIComponent(k)}` : ""}`, { method: "POST" }),
  reviewers: (id, k) => request(`/api/jobs/${id}/reviewers${k ? `?k=${encodeURIComponent(k)}` : ""}`),
  adminActivity: (days) => request(`/api/admin/activity?days=${days}`),
  adminSendDigest: () => request("/api/admin/digest", { method: "POST" }),
  credits: () => request("/api/credits"),
  allowance: () => request("/api/allowance"),
  checkoutConfig: () => request("/api/checkout/config"),
  checkout: (body) => request("/api/checkout", { method: "POST", body: JSON.stringify(body) }),
  checkoutSession: (id) => request(`/api/checkout/session/${encodeURIComponent(id)}`),
  jobFeedback: (id, body, k) =>
    request(`/api/jobs/${id}/feedback${k ? `?k=${encodeURIComponent(k)}` : ""}`, { method: "POST", body: JSON.stringify(body) }),
  previewText: (id) => request(`/api/jobs/${id}/preview-text`),
  emailFeedback: (body) => request("/api/feedback", { method: "POST", body: JSON.stringify(body) }),
};

// The buying funnel (server/services/events.js): fire and forget, never in the visitor's way.
export function track(name, place, extra = {}) {
  try {
    fetch("/api/events", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, place, ...extra }),
    }).catch(() => {});
  } catch {
    // measuring never breaks the page
  }
}

// Back from Stripe Checkout without paying: the cancel URL carries ?checkout=cancelled&place=…
export function trackCancelledCheckout(jobId) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("checkout") !== "cancelled") return;
  track("checkout_cancelled", params.get("place") || (jobId ? "over_limit" : "pricing"), jobId ? { jobId } : {});
  params.delete("checkout");
  params.delete("place");
  const rest = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
}
