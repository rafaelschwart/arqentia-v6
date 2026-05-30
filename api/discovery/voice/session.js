// api/discovery/voice/session.js
// POST → returns an ephemeral OpenAI Realtime client_secret so the browser
// can connect directly via WebRTC. Server-side API key never leaves the
// Vercel function.

import { resolveProspectId } from '../../_lib/auth.js';
import { logEvent } from '../../_lib/events.js';
import { checkRate } from '../../_lib/ratelimit.js';
import { createRealtimeEphemeralKey } from '../../_lib/openai.js';
import { readJson, sendJson, sendError, methodNotAllowed, getClientIp, withEnv } from '../../_lib/http.js';

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const ip = getClientIp(req);
  if (!checkRate(`voice-session:${ip}`, 6, 60_000).allowed) return sendError(res, 429, 'Too many requests');

  const body = await readJson(req).catch(() => ({}));
  const language = body.language === 'es' ? 'es' : 'en';
  const { prospectId } = resolveProspectId(req);

  // GA Realtime response shape: { value, expires_at, session: { model, audio: { output: { voice }, ... }, ... } }
  let result;
  try {
    result = await createRealtimeEphemeralKey({ language });
  } catch (e) {
    if (e.code === 'ENV_MISSING') throw e; // withEnv catches this
    console.error('[voice/session] OpenAI error:', e.message);
    return sendError(res, 502, 'Voice agent unavailable', { detail: e.message });
  }

  await logEvent({ prospect_id: prospectId, type: 'voice_session_created', payload: { language }, req });
  return sendJson(res, 200, {
    client_secret: result.value,
    expires_at:    result.expires_at,
    model:         result.session?.model || 'gpt-realtime',
    voice:         result.session?.audio?.output?.voice || 'alloy'
  });
}

export default withEnv(handler);
