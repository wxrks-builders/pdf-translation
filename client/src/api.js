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
  requestLoginLink: (email) => request("/api/auth/request-link", { method: "POST", body: JSON.stringify({ email }) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  languages: () => request("/api/languages"),
  createJob: (formData) => request("/api/jobs", { method: "POST", body: formData }),
  listJobs: () => request("/api/jobs"),
  getJob: (id) => request(`/api/jobs/${id}`),
  cancelJob: (id) => request(`/api/jobs/${id}/cancel`, { method: "POST" }),
  credits: () => request("/api/credits"),
};
