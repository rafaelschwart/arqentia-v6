// api/discovery/auth/magic.js
import { resolveProspectByToken } from '../../_lib/auth.js';
import { signCookie, serializeCookie } from '../../_lib/cookie.js';
import { logEvent } from '../../_lib/events.js';
import { checkRate } from '../../_lib/ratelimit.js';
import { readJson, sendJson, sendError, methodNotAllowed, getClientIp, withEnv } from '../../_lib/http.js';

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const ip = getClientIp(req);
  if (!checkRate(`magic:${ip}`, 10, 60_000).allowed) return sendError(res, 429, 'Too many requests');

  const body = await readJson(req).catch(() => null);
  const prospect = await resolveProspectByToken(body?.token);
  if (!prospect) return sendError(res, 401, 'Invalid token');

  res.setHeader('Set-Cookie', serializeCookie('arq_pid', signCookie(prospect.id)));
  await logEvent({ prospect_id: prospect.id, type: 'magic_link_clicked', payload: {}, req });
  return sendJson(res, 200, { ok: true });
}

export default withEnv(handler);
