// discovery/api.js
export async function api(path, opts = {}) {
  const r = await fetch(`/api/discovery${path}`, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json().catch(() => ({})) : await r.text();
  if (!r.ok) {
    const err = new Error(data?.error || r.statusText);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}
