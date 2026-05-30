// api/discovery/auth/password.js
import bcrypt from 'bcryptjs';
import { supabase } from '../../_lib/supabase.js';
import { resolveProspectId } from '../../_lib/auth.js';
import { signCookie, serializeCookie } from '../../_lib/cookie.js';
import { logEvent } from '../../_lib/events.js';
import { checkRate } from '../../_lib/ratelimit.js';
import { readJson, sendJson, sendError, methodNotAllowed, getClientIp, withEnv } from '../../_lib/http.js';
import { adminCookieValue, ADMIN_COOKIE_NAME } from '../../_lib/admin-auth.js';

const ADMIN_EMAIL = 'hello@arqentia.com';

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const ip = getClientIp(req);
  if (!checkRate(`pwd:${ip}`, 10, 60_000).allowed) return sendError(res, 429, 'Too many requests');

  const body = await readJson(req).catch(() => null);
  if (!body || !body.mode || !body.password) return sendError(res, 400, 'Missing fields');
  if (body.password.length < 8) return sendError(res, 400, 'Password too short (min 8 chars)');

  if (body.mode === 'set') {
    const { prospectId } = resolveProspectId(req);
    if (!prospectId) return sendError(res, 401, 'No session');
    const hash = await bcrypt.hash(body.password, 12);
    await supabase.from('prospects').update({ password_hash: hash }).eq('id', prospectId);
    await logEvent({ prospect_id: prospectId, type: 'password_set', payload: {}, req });
    return sendJson(res, 200, { ok: true });
  }

  if (body.mode === 'login') {
    // The "username" field on the form is the prospect's email. Accept either
    // body.email (legacy) or body.username (new label) — both contain the email.
    const identifier = (body.email || body.username || '').toString().trim();
    if (!identifier) return sendError(res, 400, 'Missing email');

    // ── ADMIN BRANCH ───────────────────────────────────────────────────────
    // If credentials match the admin pair, set the admin cookie and signal a
    // redirect to /arqentia/admin. Same form, different destination.
    const supplied = identifier.toLowerCase();
    if (supplied === ADMIN_EMAIL.toLowerCase()) {
      const expected = process.env.ARQ_ADMIN_PASSWORD;
      if (!expected) {
        // Constant-time miss to avoid leaking that admin mode exists when env not configured
        await bcrypt.compare(body.password, '$2a$12$' + 'x'.repeat(53));
        return sendError(res, 401, 'Invalid credentials');
      }
      // Length-safe compare for the env password
      let matches = (body.password.length === expected.length);
      if (matches) {
        let diff = 0;
        for (let i = 0; i < body.password.length; i++) {
          diff |= body.password.charCodeAt(i) ^ expected.charCodeAt(i);
        }
        matches = diff === 0;
      }
      // Run a dummy bcrypt regardless so admin vs prospect attempts take similar time
      await bcrypt.compare(body.password, '$2a$12$' + 'y'.repeat(53));
      if (!matches) return sendError(res, 401, 'Invalid credentials');
      res.setHeader('Set-Cookie', serializeCookie(ADMIN_COOKIE_NAME, adminCookieValue(), { maxAge: 60 * 60 * 24 * 30 }));
      await logEvent({ type: 'admin_login', payload: { method: 'unified-form' }, req });
      return sendJson(res, 200, { ok: true, role: 'admin', redirect: '/arqentia/admin' });
    }

    // ── PROSPECT BRANCH ────────────────────────────────────────────────────
    // Match by email (case-insensitive). The form label says "Username" but
    // the value is the prospect's email — that's their sign-in identity.
    const { data } = await supabase
      .from('prospects').select('id, password_hash, magic_token, email')
      .ilike('email', identifier).maybeSingle();
    // Constant response time on miss + bad pwd to avoid user enumeration
    if (!data || !data.password_hash) {
      await bcrypt.compare(body.password, '$2a$12$' + 'x'.repeat(53)); // dummy work
      return sendError(res, 401, 'Invalid credentials');
    }
    const ok = await bcrypt.compare(body.password, data.password_hash);
    if (!ok) return sendError(res, 401, 'Invalid credentials');
    res.setHeader('Set-Cookie', serializeCookie('arq_pid', signCookie(data.id)));
    await logEvent({ prospect_id: data.id, type: 'password_login', payload: {}, req });
    return sendJson(res, 200, { ok: true, role: 'prospect', magic_token: data.magic_token, redirect: `/discovery/p/${data.magic_token}` });
  }

  return sendError(res, 400, 'Unknown mode');
}

export default withEnv(handler);
