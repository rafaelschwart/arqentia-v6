// api/discovery/auth/resend-magic.js
import { supabase } from '../../_lib/supabase.js';
import { sendMagicLink } from '../../_lib/email.js';
import { logEvent } from '../../_lib/events.js';
import { checkRate } from '../../_lib/ratelimit.js';
import { readJson, sendJson, sendError, methodNotAllowed, getClientIp, withEnv } from '../../_lib/http.js';

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const ip = getClientIp(req);
  if (!checkRate(`resend:${ip}`, 5, 60_000).allowed) return sendError(res, 429, 'Too many requests');

  const body = await readJson(req).catch(() => null);
  if (!body?.email) return sendError(res, 400, 'Missing email');

  // Always return 200 (don't reveal existence to enumerators)
  const { data } = await supabase
    .from('prospects').select('id, name, magic_token, language').eq('email', body.email).maybeSingle();
  if (data) {
    try {
      await sendMagicLink({ to: body.email, name: data.name, magic_token: data.magic_token, language: data.language });
      await logEvent({ prospect_id: data.id, type: 'magic_link_resent', payload: {}, req });
    } catch (e) { console.error('Magic link resend failed:', e?.message); }
  }
  sendJson(res, 200, { ok: true });
}

export default withEnv(handler);
