async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const api = {
  health: () => request('/health'),
  listRuns: () => request('/runs'),
  getRun: (id) => request(`/runs/${id}`),
  createRun: (payload) => request('/runs', { method: 'POST', body: JSON.stringify(payload) }),
  renameRun: (id, label) => request(`/runs/${id}`, { method: 'PATCH', body: JSON.stringify({ label }) }),
  deleteRun: (id) => request(`/runs/${id}`, { method: 'DELETE' }),
  reportUrl: (id) => `/api/runs/${id}/report`,
};
