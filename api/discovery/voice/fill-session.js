// api/discovery/voice/fill-session.js
// POST { token? }   (token in body OR ?token=, falls back to cookie)
//
// Issues an OpenAI Realtime ephemeral key for a SCOPED voice session that
// only asks about the prospect's still-missing required fields. Enforces the
// 3-attempts-per-6h rate limit by counting prior `voice_fill_started` events.

import { resolveProspect } from '../../_lib/auth.js';
import { supabase } from '../../_lib/supabase.js';
import { logEvent } from '../../_lib/events.js';
import { createRealtimeEphemeralKey } from '../../_lib/openai.js';
import { computeCompleteness } from '../../_lib/completeness.js';
import { readJson, sendJson, sendError, methodNotAllowed, withEnv } from '../../_lib/http.js';

const WINDOW_HOURS = 6;
const MAX_ATTEMPTS = 3;

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const body = await readJson(req).catch(() => ({}));
  const url  = new URL(req.url, 'http://x');
  const token = body.token || url.searchParams.get('token') || null;
  // Optional ?section=<id> — scopes the voice agent to only that section's
  // questions, plus any quality-improving follow-up.
  const sectionId = (body.section || url.searchParams.get('section') || '').toLowerCase();

  const prospect = await resolveProspect(req, token);
  if (!prospect) return sendError(res, 401, 'No session');

  // Rate limit check
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('events').select('*', { count: 'exact', head: true })
    .eq('prospect_id', prospect.id)
    .eq('type', 'voice_fill_started')
    .gte('created_at', since);
  const attempts = count || 0;
  if (attempts >= MAX_ATTEMPTS) {
    return sendError(res, 429, 'Voice-fill limit reached', {
      attempts_in_window: attempts,
      window_hours: WINDOW_HOURS
    });
  }

  // Compute what's still missing
  const { data: answers } = await supabase
    .from('profile_answers').select('*').eq('prospect_id', prospect.id);
  const completeness = computeCompleteness(prospect, answers || []);

  // Section → question IDs map. Voice-fill scoped to a specific section asks
  // about THOSE Q's (whether they're missing OR just under-detailed). Lets the
  // prospect improve a single section's quality without re-doing everything.
  const SECTION_QS = {
    business:   ['Q1', 'Q2'],
    operations: ['Q3', 'Q4', 'Q6'],
    tools:      ['Q5'],
    goals:      ['Q7', 'Q8'],
    you:        ['Q9', 'Q10']
  };
  const scopedQIds = sectionId && SECTION_QS[sectionId] ? SECTION_QS[sectionId] : null;

  // When a section is specified, we still want a useful call even if the
  // prospect's profile is already "complete" — they may want to add detail.
  if (completeness.complete && !scopedQIds) {
    return sendError(res, 409, 'Profile is already complete — no fields to fill');
  }

  // Build the agent's target list. If scoped: all questions in that section
  // (with current value as context). If global: only the still-missing ones.
  let targetLines;
  if (scopedQIds) {
    const answersByQ = new Map((answers || []).map(a => [a.question_id, a]));
    targetLines = scopedQIds.map((qid, i) => {
      const cur = answersByQ.get(qid);
      const curStr = cur ? (cur.value_text || JSON.stringify(cur.value_json) || '(empty)') : '(empty)';
      return `  ${i + 1}. ${qid} — current answer: "${String(curStr).slice(0, 200)}"`;
    }).join('\n');
  } else {
    targetLines = completeness.missing
      .map((f, i) => `  ${i + 1}. ${f.q_id} — ${prospect.language === 'es' ? f.label_es : f.label_en}`)
      .join('\n');
  }

  const lang = prospect.language === 'es' ? 'Spanish' : 'English';
  const intro = scopedQIds
    ? `You are Arqentia's discovery agent helping the prospect IMPROVE one section of their profile (the "${sectionId}" section). You can see their current answers and your job is to ask 1-2 sharp questions to ADD DETAIL or CORRECT what's there. Do NOT re-ask everything from scratch — build on what they already said.`
    : `You are Arqentia's discovery agent in a SHORT FILL-IN call. The prospect has already completed most of their profile; you only need to capture these ${completeness.missing.length} missing fields:`;

  const instructions = `${intro}

${targetLines}

Rules of engagement:
- Open with a warm one-sentence greeting that names what you're updating ("Quick follow-up on your ${sectionId || 'profile'} — ...").
- Build on what they already said. Ask for SPECIFIC details: tool names (SAP Business One, not "ERP"), numbers (hours/week), processes.
- One question at a time. Acknowledge each answer briefly.
- If they go off-topic, gently steer back.
- Total call target: under 90 seconds.
- When you've added the missing detail, say "Perfect, that's much sharper — your profile is updated" and end naturally.
- Speak in ${lang}. Match their formality.`;

  let result;
  try {
    result = await createRealtimeEphemeralKey({ language: prospect.language, instructions });
  } catch (e) {
    if (e.code === 'ENV_MISSING') throw e;
    console.error('[voice/fill-session] OpenAI error:', e.message);
    return sendError(res, 502, 'Voice agent unavailable', { detail: e.message });
  }

  await logEvent({ prospect_id: prospect.id, type: 'voice_fill_started', payload: { missing_count: completeness.missing.length, section: sectionId || null, attempts_after: attempts + 1 }, req });

  return sendJson(res, 200, {
    client_secret: result.value,
    expires_at:    result.expires_at,
    model:         result.session?.model || 'gpt-realtime',
    voice:         result.session?.audio?.output?.voice || 'alloy',
    missing:       completeness.missing,
    section:       sectionId || null,
    attempts_remaining: MAX_ATTEMPTS - (attempts + 1),
    window_hours:  WINDOW_HOURS
  });
}

export default withEnv(handler);
