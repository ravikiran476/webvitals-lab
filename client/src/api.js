const TOKEN_KEY = 'webvitals.token';

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

let token = readToken();

export function setToken(value) {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the token lasts for this page load only */
  }
}

export const hasToken = () => Boolean(token);

/** The server wants a token for this action (missing, wrong, or not configured yet). */
export class AuthError extends Error {}

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new AuthError(body.error || 'API token required');
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const api = {
  health: () => request('/health'),
  /** Run summaries, newest first (no findings or request lists). */
  listRuns: () => request('/runs'),
  getRun: (id) => request(`/runs/${id}`),
  createRun: (payload) => request('/runs', { method: 'POST', body: JSON.stringify(payload) }),
  renameRun: (id, label) => request(`/runs/${id}`, { method: 'PATCH', body: JSON.stringify({ label }) }),
  deleteRun: (id) => request(`/runs/${id}`, { method: 'DELETE' }),
  reportUrl: (id) => `/api/runs/${id}/report`,
};
