// api/admin/login.js
// POST { password }  → 200 + Set-Cookie if password matches ARQ_ADMIN_PASSWORD
// DELETE             → clears the cookie (logout)

import { adminCookieValue, ADMIN_COOKIE_NAME } from '../_lib/admin-auth.js';
import { serializeCookie } from '../_lib/cookie.js';
import { readJson, sendJson, sendError, methodNotAllowed, withEnv } from '../_lib/http.js';

async function handler(req, res) {
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST', 'DELETE']);

  const expected = process.env.ARQ_ADMIN_PASSWORD;
  if (!expected) return sendError(res, 503, 'Admin auth not configured (set ARQ_ADMIN_PASSWORD)');

  const body = await readJson(req).catch(() => null);
  const supplied = body?.password;
  if (!supplied || typeof supplied !== 'string') {
    return sendError(res, 400, 'Missing password');
  }

  // Length-safe compare to avoid trivial timing leaks. Both sides are server-side
  // strings of known shape, so this is more belt-and-suspenders than essential.
  if (supplied.length !== expected.length) return sendError(res, 401, 'Wrong password');
  let diff = 0;
  for (let i = 0; i < supplied.length; i++) diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return sendError(res, 401, 'Wrong password');

  res.setHeader('Set-Cookie', serializeCookie(ADMIN_COOKIE_NAME, adminCookieValue(), { maxAge: 60 * 60 * 24 * 30 }));
  return sendJson(res, 200, { ok: true });
}

export default withEnv(handler);
