// api/discovery/voice/end-call.js
// POST → accepts the final voice transcript, runs Claude to parse it into
// the 10 structured fields + AI summary, persists everything, fires
// Rafael's notification. Returns dashboard URL.

import { supabase } from '../../_lib/supabase.js';
import { resolveProspectId } from '../../_lib/auth.js';
import { logEvent } from '../../_lib/events.js';
import { parseTranscript } from '../../_lib/parse-transcript.js';
import { notifyAll } from '../../_lib/notify.js';
import { generateDemoPayload } from '../../_lib/generate-demo.js';
import { readJson, sendJson, sendError, methodNotAllowed, withEnv } from '../../_lib/http.js';
import { computeCompleteness } from '../../_lib/completeness.js';
import { logOpenAIRealtimeUsage } from '../../_lib/usage.js';
import { REALTIME_MODEL_NAME } from '../../_lib/openai.js';

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const { prospectId } = resolveProspectId(req);
  if (!prospectId) return sendError(res, 401, 'No session');

  const body = await readJson(req).catch(() => null);
  const transcript = Array.isArray(body?.transcript) ? body.transcript : [];
  if (!transcript.length) return sendError(res, 400, 'Empty transcript');

  // Persist raw transcript for audit
  await logEvent({
    prospect_id: prospectId,
    type: 'voice_call_ended',
    payload: { turns: transcript.length, duration_sec: body?.duration_sec ?? null },
    req
  });

  // Log OpenAI Realtime cost — billed by audio duration. Fire-and-forget so a
  // failed write never blocks the transcript-parse pipeline below.
  const durationSec = Number(body?.duration_sec || 0);
  if (durationSec > 0) {
    logOpenAIRealtimeUsage({
      prospect_id: prospectId,
      model: REALTIME_MODEL_NAME,
      duration_sec: durationSec,
      route: 'discovery-voice',
      metadata: { turns: transcript.length }
    }).catch(() => {});
  }

  const { data: prospect } = await supabase.from('prospects').select('*').eq('id', prospectId).single();
  if (!prospect) return sendError(res, 404, 'Not found');

  // Parse transcript → structured answers + summary
  let parsed;
  try {
    parsed = await parseTranscript(transcript, prospect.language, prospectId);
  } catch (e) {
    await logEvent({ prospect_id: prospectId, type: 'transcript_parse_error', payload: { error: e.message }, req });
    return sendError(res, 502, 'Transcript parsing failed', { detail: e.message });
  }

  // Upsert each parsed answer as a row in profile_answers
  const rows = Object.entries(parsed.answers).map(([qid, val]) => ({
    prospect_id: prospectId,
    question_id: qid,
    value_text: typeof val === 'string' ? val : null,
    value_json: typeof val === 'object' ? val : null,
    answered_at: new Date().toISOString()
  }));
  if (rows.length) {
    const { error } = await supabase
      .from('profile_answers')
      .upsert(rows, { onConflict: 'prospect_id,question_id' });
    if (error) console.error('[end-call] answer upsert error:', error);
  }

  // Fallback sector: same NOT NULL guardrail as complete.js
  const q1Row = rows.find(r => r.question_id === 'Q1');
  const detectedSector =
    parsed.summary.sector
    || q1Row?.value_json?.industry
    || prospect.sector_id
    || 'distribucion';

  // Persist summary
  const { error: summaryErr } = await supabase.from('profile_summaries').upsert({
    prospect_id: prospectId,
    summary_text: parsed.summary.summary_text || '(no summary)',
    sector_classification: detectedSector,
    est_hours_saved: parsed.summary.est_hours_saved,
    est_payback_months: parsed.summary.est_payback_months,
    suggested_capability: parsed.summary.suggested_capability,
    generated_at: new Date().toISOString(),
    generated_by: parsed.model
  });
  if (summaryErr) console.error('[end-call] profile_summaries upsert failed:', summaryErr);

  // Always-safe update: sector + status + last_active.
  const { error: prospErr } = await supabase.from('prospects').update({
    sector_id: detectedSector,
    status: 'completed',
    last_active_at: new Date().toISOString()
  }).eq('id', prospectId);
  if (prospErr) console.error('[end-call] prospects update failed:', prospErr);

  // Q0 identity capture (warm-up) → write to prospects.name/email/phone.
  // Separate update so a UNIQUE-email collision (re-run with same email) doesn't
  // block the sector/status write above. Falls back to clobbering email only if
  // it's not already taken by a different prospect.
  const q0 = parsed.answers?.Q0 || {};
  const q10 = parsed.answers?.Q10 || {};
  const phoneFromVoice = q0.phone || q10.phone || null;
  const identityUpdate = {};
  if (q0.name)        identityUpdate.name  = q0.name;
  if (q0.email)       identityUpdate.email = q0.email;
  if (phoneFromVoice) identityUpdate.phone = phoneFromVoice;
  if (Object.keys(identityUpdate).length) {
    const { error: idErr } = await supabase.from('prospects').update(identityUpdate).eq('id', prospectId);
    if (idErr) {
      console.error('[end-call] identity update failed (probably unique-email collision):', idErr.message);
      // Retry without email — name + phone still useful even if email is dup
      if (identityUpdate.email) {
        const { email: _drop, ...withoutEmail } = identityUpdate;
        if (Object.keys(withoutEmail).length) {
          await supabase.from('prospects').update(withoutEmail).eq('id', prospectId);
        }
      }
    }
  }

  await logEvent({ prospect_id: prospectId, type: 'voice_profile_built', payload: { sector: detectedSector }, req });

  // Fire-and-forget notification to Rafael
  const { data: summaryRow } = await supabase.from('profile_summaries').select('*').eq('prospect_id', prospectId).single();
  // Same pattern as /complete — await background work so it actually fires
  // (serverless runtime kills fire-and-forget after response is sent).
  const notifyPromise = notifyAll({ ...prospect, sector_id: detectedSector }, summaryRow)
    .then(() => logEvent({ prospect_id: prospectId, type: 'rafael_notified', payload: {}, req }))
    .catch(e => { console.error('[end-call] notify failed:', e.message); });

  // GATE: only generate the personalized demo dashboard if the profile passes
  // the completeness threshold (8 of 11 required). For voice flow, build the
  // updated prospect snapshot from the freshly-written identity fields so the
  // check sees what the DB now has.
  const refreshedProspect = {
    ...prospect,
    sector_id: detectedSector,
    name:  q0.name        ?? prospect.name,
    email: q0.email       ?? prospect.email,
    phone: phoneFromVoice ?? prospect.phone
  };
  const completeness = computeCompleteness(refreshedProspect, rows);

  let demoPromise = Promise.resolve();
  if (completeness.complete) {
    demoPromise = generateDemoPayload({ prospect: refreshedProspect, answers: rows, summary: summaryRow, language: prospect.language })
      .then(async ({ payload, model }) => {
        const { error: demoErr } = await supabase.from('demo_payloads').upsert({
          prospect_id: prospectId,
          payload,
          generated_at: new Date().toISOString(),
          generated_by: model,
          edited: false
        });
        if (demoErr) console.error('[end-call] demo_payloads upsert failed:', demoErr);
        await logEvent({ prospect_id: prospectId, type: 'demo_generated', payload: { trigger: 'voice-end' }, req });
      })
      .catch(async e => {
        console.error('[end-call] demo generation failed:', e?.message, e?.stack);
        try {
          await logEvent({ prospect_id: prospectId, type: 'demo_generation_error', payload: { error: String(e?.message || e), stack: String(e?.stack || '').slice(0, 1200) }, req });
        } catch {}
      });
  } else {
    await logEvent({ prospect_id: prospectId, type: 'demo_gated', payload: { completeness }, req });
  }

  await Promise.allSettled([notifyPromise, demoPromise]);

  return sendJson(res, 200, {
    dashboard_url: `/discovery/p/${prospect.magic_token}`,
    sector: parsed.summary.sector,
    completeness
  });
}

export default withEnv(handler);
