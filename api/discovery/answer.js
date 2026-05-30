// api/discovery/answer.js
import { supabase } from '../_lib/supabase.js';
import { resolveProspectId } from '../_lib/auth.js';
import { logEvent } from '../_lib/events.js';
import { checkRate } from '../_lib/ratelimit.js';
import { readJson, sendJson, sendError, methodNotAllowed, getClientIp , withEnv } from '../_lib/http.js';
import { getById, getNext } from '../_lib/questions.js';
import { generateFollowUp } from '../_lib/claude.js';

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const ip = getClientIp(req);
  if (!checkRate(`answer:${ip}`, 60, 60_000).allowed) return sendError(res, 429, 'Too many requests');

  const { prospectId } = resolveProspectId(req);
  if (!prospectId) return sendError(res, 401, 'No session');

  const body = await readJson(req).catch(() => null);
  if (!body?.question_id) return sendError(res, 400, 'Missing question_id');

  const { error: insertError } = await supabase
    .from('profile_answers')
    .upsert({
      prospect_id: prospectId,
      question_id: body.question_id,
      value_text:  body.value_text  ?? null,
      value_json:  body.value_json  ?? null,
      answered_at: new Date().toISOString()
    }, { onConflict: 'prospect_id,question_id' });
  if (insertError) return sendError(res, 500, 'Could not save answer');

  await supabase.from('prospects').update({ last_active_at: new Date().toISOString() }).eq('id', prospectId);
  await logEvent({ prospect_id: prospectId, type: 'question_answered', payload: { question_id: body.question_id }, req });

  // Decide what comes next.
  const followup = await maybeFollowUp(prospectId, body);
  if (followup) {
    return sendJson(res, 200, { action: 'followup', question: followup });
  }

  const nextStep = getNext(body.question_id);
  if (nextStep.action === 'gate') {
    return sendJson(res, 200, { action: 'gate' });
  }
  if (nextStep.action === 'complete') {
    return sendJson(res, 200, { action: 'complete' });
  }
  return sendJson(res, 200, { action: 'next', question: getById(nextStep.next_anchor) });
}

async function maybeFollowUp(prospectId, body) {
  if (body.is_followup) return null;
  const q = getById(body.question_id);
  if (!q?.followup_strategy) return null;

  if (q.followup_strategy === 'ai_if_systems_disconnected') {
    const ds = body.value_json?.data_state;
    if (ds !== 'systems_disconnected') return null;
  }

  const { data: prospect } = await supabase.from('prospects').select('language').eq('id', prospectId).single();
  const answerText = body.value_text || JSON.stringify(body.value_json);

  let promptText;
  try {
    promptText = await generateFollowUp({
      language: prospect.language,
      anchor_id: body.question_id,
      anchor_answer: answerText,
      prospect_id: prospectId
    });
  } catch (e) {
    console.error('Follow-up generation failed:', e?.message || e);
    return null; // graceful degrade — skip follow-up if AI fails
  }

  return {
    id: `${body.question_id}.1`,
    is_followup: true,
    section: q.section,
    prompt: { [prospect.language]: promptText, en: promptText, es: promptText },
    inputs: [{ name: 'text', type: 'text', required: false }]
  };
}

export default withEnv(handler);
