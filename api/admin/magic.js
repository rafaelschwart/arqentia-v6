// api/admin/magic.js
// Magic-link admin auth — hardcoded to hello@arqentia.com.
//
//   POST          { action: 'request' }                → emails a magic link
//   GET ?token=X                                       → verifies token, sets cookie, redirects to /arqentia/admin
//
// The token is a self-contained signed payload: "<expiresUnix>.<hmac>"
// where hmac = HMAC-SHA256(ARQ_COOKIE_SECRET, expiresUnix). No DB row needed.
// Tokens expire 15 minutes after issue.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { sendAdminMagicLink } from '../_lib/email.js';
import { adminCookieValue, ADMIN_COOKIE_NAME } from '../_lib/admin-auth.js';
import { serializeCookie } from '../_lib/cookie.js';
import { readJson, sendJson, sendError, methodNotAllowed, withEnv } from '../_lib/http.js';

const TTL_MS = 15 * 60 * 1000;

function sign(expiresUnix) {
  const secret = process.env.ARQ_COOKIE_SECRET;
  if (!secret) throw new Error('Missing ARQ_COOKIE_SECRET');
  const mac = createHmac('sha256', secret).update(`admin-magic:${expiresUnix}`).digest('hex');
  return `${expiresUnix}.${mac}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const expiresUnix = parseInt(token.slice(0, dot), 10);
  const supplied = token.slice(dot + 1);
  if (!Number.isFinite(expiresUnix)) return false;
  if (Date.now() > expiresUnix) return false;
  const secret = process.env.ARQ_COOKIE_SECRET;
  if (!secret) return false;
  const expected = createHmac('sha256', secret).update(`admin-magic:${expiresUnix}`).digest('hex');
  if (supplied.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}

async function handler(req, res) {
  if (req.method === 'GET') {
    // Verification: ?token=<signed>
    const url = new URL(req.url, 'http://x');
    const token = url.searchParams.get('token');
    if (!verify(token)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.statusCode = 401;
      res.end(`<!doctype html><meta charset="utf-8"><title>Invalid link</title><body style="font-family:system-ui;padding:48px;color:#0B1220;background:#F8FAFC;"><h1 style="margin:0 0 12px;">Link expired or invalid</h1><p>Magic links expire after 15 minutes. <a href="/arqentia/admin">Request a new one</a>.</p></body>`);
      return;
    }
    res.setHeader('Set-Cookie', serializeCookie(ADMIN_COOKIE_NAME, adminCookieValue(), { maxAge: 60 * 60 * 24 * 30 }));
    res.statusCode = 302;
    res.setHeader('Location', '/arqentia/admin');
    res.end();
    return;
  }

  if (req.method !== 'POST') return methodNotAllowed(res, ['POST', 'GET']);
  const body = await readJson(req).catch(() => ({}));
  if (body.action !== 'request') return sendError(res, 400, 'Unknown action');

  const expiresUnix = Date.now() + TTL_MS;
  const token = sign(expiresUnix);

  try {
    await sendAdminMagicLink({ code: token, expiresAtIso: new Date(expiresUnix).toISOString() });
  } catch (e) {
    console.error('[admin/magic] send failed:', e?.message);
    return sendError(res, 502, 'Could not send magic link', { detail: e?.message });
  }
  return sendJson(res, 200, { ok: true, expires_at: new Date(expiresUnix).toISOString() });
}

export default withEnv(handler);
