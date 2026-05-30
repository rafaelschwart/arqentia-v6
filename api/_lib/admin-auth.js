// api/_lib/admin-auth.js
// Simple env-var password gate for the /arqentia/admin tooling.
// Set ARQ_ADMIN_PASSWORD in env. The admin login page POSTs the password to
// /api/admin/login which sets a signed cookie (arq_admin). Subsequent API
// calls check the cookie via requireAdmin(req).
//
// This is a stop-gap. Track D3 (magic-link to hello@arqentia.com) replaces
// it for prod, but the cookie scheme stays the same — only the login flow
// changes.

import { parseCookies, signCookie, verifyCookie } from './cookie.js';
import { sendError } from './http.js';

const COOKIE_NAME = 'arq_admin';
// Value stored in the cookie. Doesn't carry identity yet (single-admin setup);
// just proves the session was authenticated. Rotating this string invalidates
// all sessions.
const ADMIN_TOKEN_VALUE = 'admin-ok-v1';

export function isAdminAuthed(req) {
  const cookies = parseCookies(req.headers?.cookie);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return false;
  const v = verifyCookie(raw);
  return v === ADMIN_TOKEN_VALUE;
}

// Use at the top of every admin endpoint. Returns true if the request should
// stop (already sent a 401 response).
export function requireAdmin(req, res) {
  if (!process.env.ARQ_ADMIN_PASSWORD) {
    // No password configured — refuse instead of leaving open. Operator must
    // set ARQ_ADMIN_PASSWORD to use admin endpoints.
    sendError(res, 503, 'Admin auth not configured (set ARQ_ADMIN_PASSWORD)');
    return true;
  }
  if (!isAdminAuthed(req)) {
    sendError(res, 401, 'Admin authentication required');
    return true;
  }
  return false;
}

export function adminCookieValue() {
  return signCookie(ADMIN_TOKEN_VALUE);
}

export { COOKIE_NAME as ADMIN_COOKIE_NAME };
