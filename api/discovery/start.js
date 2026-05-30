// api/discovery/start.js
import { supabase } from '../_lib/supabase.js';
import { signCookie, serializeCookie } from '../_lib/cookie.js';
import { logEvent } from '../_lib/events.js';
import { checkRate } from '../_lib/ratelimit.js';
import { readJson, sendJson, sendError, methodNotAllowed, getClientIp , withEnv } from '../_lib/http.js';
import { QUESTIONS, getById } from '../_lib/questions.js';

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const ip = getClientIp(req);
  if (!checkRate(`start:${ip}`, 10, 60_000).allowed) return sendError(res, 429, 'Too many requests');

  const body = await readJson(req).catch(() => ({}));
  const lang = body.language === 'es' ? 'es' : 'en';

  const { data, error } = await supabase
    .from('prospects')
    .insert({
      language: lang,
      utm_source:   body.utm_source   || null,
      utm_medium:   body.utm_medium   || null,
      utm_campaign: body.utm_campaign || null
    })
    .select('id, magic_token, language')
    .single();
  if (error) return sendError(res, 500, 'Could not start');

  res.setHeader('Set-Cookie', serializeCookie('arq_pid', signCookie(data.id)));
  await logEvent({ prospect_id: data.id, type: 'wizard_start', payload: { lang, utm: body.utm_source }, req });

  sendJson(res, 200, {
    prospect_id: data.id,
    magic_token: data.magic_token,
    language: data.language,
    first_question: getById('Q1'),
    section_count: 5,
    total_anchors: QUESTIONS.filter(q => !q.is_followup).length
  });
}

export default withEnv(handler);
