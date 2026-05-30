// api/discovery/gate.js
import { supabase } from '../_lib/supabase.js';
import { resolveProspectId } from '../_lib/auth.js';
import { logEvent } from '../_lib/events.js';
import { sendMagicLink } from '../_lib/email.js';
import { checkRate } from '../_lib/ratelimit.js';
import { readJson, sendJson, sendError, methodNotAllowed, getClientIp , withEnv } from '../_lib/http.js';
import { getById } from '../_lib/questions.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const ip = getClientIp(req);
  if (!checkRate(`gate:${ip}`, 10, 60_000).allowed) return sendError(res, 429, 'Too many requests');

  const { prospectId } = resolveProspectId(req);
  if (!prospectId) return sendError(res, 401, 'No session');

  const body = await readJson(req).catch(() => null);
  if (!body?.name || !body?.email) return sendError(res, 400, 'Missing fields');
  if (!EMAIL_RE.test(body.email)) return sendError(res, 400, 'Invalid email');
  if (body.honeypot) return sendError(res, 400, 'Bot detected');

  // Duplicate-email handling
  const { data: existing } = await supabase
    .from('prospects').select('id, magic_token, name, language').eq('email', body.email).maybeSingle();

  if (existing && existing.id !== prospectId) {
    await supabase.from('prospects').delete().eq('id', prospectId);
    try {
      await sendMagicLink({ to: body.email, name: existing.name || body.name, magic_token: existing.magic_token, language: existing.language });
    } catch (e) { console.error('Magic link send failed:', e?.message); }
    await logEvent({ prospect_id: existing.id, type: 'magic_link_sent', payload: { reason: 'gate_duplicate' }, req });
    return sendJson(res, 200, { action: 'check_email', existing: true });
  }

  const { data: updated, error } = await supabase
    .from('prospects')
    .update({
      name: body.name,
      email: body.email,
      company: body.company || null,
      status: 'gated',
      last_active_at: new Date().toISOString()
    })
    .eq('id', prospectId)
    .select('magic_token, language')
    .single();
  if (error) return sendError(res, 500, 'Could not save');

  await logEvent({ prospect_id: prospectId, type: 'email_submitted', payload: { email: body.email }, req });
  try {
    await sendMagicLink({ to: body.email, name: body.name, magic_token: updated.magic_token, language: updated.language });
    await logEvent({ prospect_id: prospectId, type: 'magic_link_sent', payload: {}, req });
  } catch (e) {
    console.error('Magic link send failed:', e?.message);
    // Don't fail the request — they can use the resend endpoint later.
  }

  return sendJson(res, 200, { action: 'next', question: getById('Q5') });
}

export default withEnv(handler);
