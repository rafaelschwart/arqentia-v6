// api/_lib/http.js

export async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export function sendError(res, status, message, extra = {}) {
  sendJson(res, status, { error: message, ...extra });
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  sendError(res, 405, 'Method not allowed');
}

export function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .toString().split(',')[0].trim();
}

// withEnv: wrap an API handler so a missing-env error returns 503 instead of
// crashing the Vercel dev process. Also catches any other unexpected throw.
export function withEnv(handler) {
  return async function wrapped(req, res) {
    try {
      return await handler(req, res);
    } catch (e) {
      if (e?.code === 'ENV_MISSING') {
        return sendError(res, 503, 'Backend not configured yet', {
          missing_env: String(e.message || ''),
          hint: 'Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, RESEND_API_KEY, ARQ_COOKIE_SECRET in .env.local (see MANUAL-SETUP-CHECKLIST.md)'
        });
      }
      console.error('[api]', req?.url, e?.stack || e);
      if (!res.writableEnded) {
        return sendError(res, 500, 'Internal error', { detail: String(e?.message || e) });
      }
    }
  };
}
