// api/discovery/webhook/calendly.js
import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabase } from '../../_lib/supabase.js';
import { logEvent } from '../../_lib/events.js';
import { notifyAll } from '../../_lib/notify.js';
import { sendJson, sendError, methodNotAllowed, withEnv } from '../../_lib/http.js';

export const config = { api: { bodyParser: false } };

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  // Verify signature if secret is set
  const secret = process.env.CALENDLY_WEBHOOK_SECRET;
  if (secret) {
    const sigHeader = req.headers['calendly-webhook-signature'] || '';
    const parts = sigHeader.split(',').reduce((acc, p) => {
      const [k, v] = p.split('='); if (k && v) acc[k.trim()] = v.trim(); return acc;
    }, {});
    const t = parts.t; const v1 = parts.v1;
    if (!t || !v1) return sendError(res, 401, 'Missing signature');
    const expected = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
    let ok = false;
    try {
      const a = Buffer.from(v1, 'hex'); const b = Buffer.from(expected, 'hex');
      ok = a.length === b.length && timingSafeEqual(a, b);
    } catch {}
    if (!ok) return sendError(res, 401, 'Bad signature');
  }

  let event;
  try { event = JSON.parse(raw); } catch { return sendError(res, 400, 'Bad JSON'); }
  if (event.event !== 'invitee.created') return sendJson(res, 200, { ignored: true });

  const email     = event.payload?.email;
  const eventUri  = event.payload?.uri;
  const startTime = event.payload?.scheduled_event?.start_time;
  if (!email || !eventUri) return sendError(res, 400, 'Missing fields');

  // Idempotency: skip if we've already logged this event_uri
  const { data: dupe } = await supabase
    .from('events').select('id').eq('type', 'calendly_booked')
    .contains('payload', { event_uri: eventUri }).maybeSingle();
  if (dupe) return sendJson(res, 200, { duplicate: true });

  const { data: prospect } = await supabase.from('prospects').select('*').eq('email', email).maybeSingle();
  if (!prospect) return sendJson(res, 200, { unknown_prospect: true });

  await supabase.from('prospects').update({
    calendly_url: eventUri,
    status: 'booked',
    last_active_at: new Date().toISOString()
  }).eq('id', prospect.id);
  await logEvent({ prospect_id: prospect.id, type: 'calendly_booked', payload: { event_uri: eventUri, start_time: startTime } });

  const { data: summary } = await supabase.from('profile_summaries').select('*').eq('prospect_id', prospect.id).maybeSingle();
  notifyAll(prospect, summary).catch((e) => console.error('Notify failed:', e?.message));

  return sendJson(res, 200, { ok: true });
}

export default withEnv(handler);
