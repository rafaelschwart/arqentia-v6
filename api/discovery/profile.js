// api/discovery/profile.js
import { supabase } from '../_lib/supabase.js';
import { resolveProspect } from '../_lib/auth.js';
import { signCookie, serializeCookie } from '../_lib/cookie.js';
import { logEvent } from '../_lib/events.js';
import { generateProfileSummary } from '../_lib/claude.js';
import { generateDemoPayload } from '../_lib/generate-demo.js';
import { computeCompleteness } from '../_lib/completeness.js';
import { readJson, sendJson, sendError, methodNotAllowed , withEnv } from '../_lib/http.js';

async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const token = url.searchParams.get('token');

  if (req.method === 'GET') return getProfile(req, res, token);
  if (req.method === 'PATCH') return patchProfile(req, res, token);
  return methodNotAllowed(res, ['GET', 'PATCH']);
}

async function getProfile(req, res, token) {
  const prospect = await resolveProspect(req, token);
  if (!prospect) return sendError(res, 404, 'Not found');

  // If we resolved via token (not cookie), set the cookie now
  if (token && prospect.magic_token === token) {
    res.setHeader('Set-Cookie', serializeCookie('arq_pid', signCookie(prospect.id)));
    await logEvent({ prospect_id: prospect.id, type: 'magic_link_clicked', payload: {}, req });
  }

  const [{ data: answers }, { data: summary }, { data: demoRow }, { data: ackEvents }] = await Promise.all([
    supabase.from('profile_answers').select('*').eq('prospect_id', prospect.id).order('asked_at'),
    supabase.from('profile_summaries').select('*').eq('prospect_id', prospect.id).maybeSingle(),
    supabase.from('demo_payloads').select('generated_at, edited').eq('prospect_id', prospect.id).maybeSingle(),
    // Acknowledge/un-acknowledge cycle: most recent of the two wins. Latest
    // ack with no subsequent un-ack → acknowledged. Reverse → not.
    supabase.from('events').select('type, created_at').eq('prospect_id', prospect.id).in('type', ['profile_acknowledged', 'profile_unacknowledged']).order('created_at', { ascending: false }).limit(1)
  ]);
  const ackEvent = ackEvents?.[0];
  const ackTs = (ackEvent?.type === 'profile_acknowledged') ? ackEvent.created_at : null;

  // Voice-fill rate limit: count voice_fill_started events in the last 6h
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { count: voiceFillCount } = await supabase
    .from('events').select('*', { count: 'exact', head: true })
    .eq('prospect_id', prospect.id)
    .eq('type', 'voice_fill_started')
    .gte('created_at', sixHoursAgo);

  await logEvent({ prospect_id: prospect.id, type: 'profile_viewed', payload: {}, req });

  const { password_hash, ...safe } = prospect;
  const completeness = computeCompleteness(safe, answers || []);
  return sendJson(res, 200, {
    prospect: safe,
    answers: answers || [],
    summary,
    completeness,
    acknowledged_at: ackTs,                           // ISO timestamp if acknowledged, null otherwise
    has_password: !!password_hash,                    // prospect can sign in later via /discovery/login
    demo_status: {
      has_demo: !!demoRow,
      generated_at: demoRow?.generated_at || null,
      edited: !!demoRow?.edited,
      blocked: !completeness.complete
    },
    voice_fill: {
      attempts_in_window: voiceFillCount || 0,
      attempts_remaining: Math.max(0, 3 - (voiceFillCount || 0)),
      window_hours: 6
    }
  });
}

async function patchProfile(req, res, token) {
  const prospect = await resolveProspect(req, token);
  if (!prospect) return sendError(res, 401, 'Unauthorized');

  const body = await readJson(req).catch(() => null);
  if (!body) return sendError(res, 400, 'Invalid body');

  if (body.action === 'acknowledge') {
    // Prospect confirms their profile is correct. We persist this as an event
    // (no schema change needed) and the frontend toggles to "locked in — ready
    // for discovery call" state.
    await logEvent({ prospect_id: prospect.id, type: 'profile_acknowledged', payload: {}, req });
    await supabase.from('prospects').update({ last_active_at: new Date().toISOString() }).eq('id', prospect.id);
    return sendJson(res, 200, { ok: true, acknowledged_at: new Date().toISOString() });
  }

  if (body.action === 'unacknowledge') {
    // Prospect wants to make more changes — clear the acknowledgment so the
    // sections become editable again with the "review + confirm" CTA.
    await logEvent({ prospect_id: prospect.id, type: 'profile_unacknowledged', payload: {}, req });
    return sendJson(res, 200, { ok: true, acknowledged_at: null });
  }

  if (body.action === 'regenerate_summary') {
    const { data: answers } = await supabase.from('profile_answers').select('*').eq('prospect_id', prospect.id);
    let result;
    try {
      result = await generateProfileSummary({ language: prospect.language, answers, prospect_id: prospect.id });
    } catch (e) {
      return sendError(res, 502, 'Summary regeneration failed');
    }
    await supabase.from('profile_summaries').upsert({
      prospect_id: prospect.id,
      summary_text: result.summary,
      sector_classification: result.meta.sector,
      est_hours_saved: result.meta.est_hours_saved,
      est_payback_months: result.meta.est_payback_months,
      suggested_capability: result.meta.capability,
      generated_at: new Date().toISOString(),
      generated_by: result.model
    });
    await logEvent({ prospect_id: prospect.id, type: 'summary_regenerated', payload: {}, req });
    const { data: summary } = await supabase.from('profile_summaries').select('*').eq('prospect_id', prospect.id).single();
    return sendJson(res, 200, { summary });
  }

  if (body.question_id) {
    await supabase.from('profile_answers').upsert({
      prospect_id: prospect.id,
      question_id: body.question_id,
      value_text: body.value_text ?? null,
      value_json: body.value_json ?? null,
      answered_at: new Date().toISOString()
    }, { onConflict: 'prospect_id,question_id' });
    await supabase.from('prospects').update({ last_active_at: new Date().toISOString() }).eq('id', prospect.id);
    await logEvent({ prospect_id: prospect.id, type: 'profile_edited', payload: { question_id: body.question_id }, req });

    // Auto-regen demo if this edit just pushed them over the completeness threshold
    // AND they don't have a demo payload yet. Awaited so the response carries the
    // updated demo_status (frontend can show "your demo is ready" toast).
    const completeness = await maybeGenerateDemo(prospect);
    return sendJson(res, 200, { ok: true, completeness });
  }

  // Identity edit (name / email / company / role / phone) — whitelist only,
  // never trust caller to set sector_id / status / magic_token / password etc.
  if (body.identity && typeof body.identity === 'object') {
    const allowed = ['name', 'email', 'company', 'role', 'phone', 'country'];
    const patch = {};
    for (const k of allowed) {
      if (body.identity[k] !== undefined) {
        const v = body.identity[k];
        patch[k] = (typeof v === 'string' && v.trim() === '') ? null : v;
      }
    }
    if (Object.keys(patch).length === 0) return sendError(res, 400, 'No allowed fields in identity patch');

    patch.last_active_at = new Date().toISOString();
    const { error: updErr } = await supabase.from('prospects').update(patch).eq('id', prospect.id);
    if (updErr) {
      // Most likely cause: UNIQUE-email collision (another prospect already has this email).
      if (String(updErr.message || '').toLowerCase().includes('duplicate') || updErr.code === '23505') {
        return sendError(res, 409, 'Email already in use by another profile');
      }
      return sendError(res, 500, 'Identity update failed', { detail: updErr.message });
    }
    await logEvent({ prospect_id: prospect.id, type: 'identity_edited', payload: { fields: Object.keys(patch).filter(k => k !== 'last_active_at') }, req });
    const { data: updated } = await supabase.from('prospects').select('*').eq('id', prospect.id).single();
    const { password_hash, ...safe } = updated || {};
    // Identity edits commonly fill name/email/phone — re-check completeness + maybe-regen
    const completeness = await maybeGenerateDemo(safe);
    return sendJson(res, 200, { ok: true, prospect: safe, completeness });
  }

  return sendError(res, 400, 'Unknown action');
}

// ─── Auto-regen helper ────────────────────────────────────────────────────────
// Called after any edit that might fill missing fields. If profile is now
// complete AND there's no demo payload yet (or it's stale), trigger generation.
// Synchronous (awaited) so the response carries the latest demo_status.
async function maybeGenerateDemo(prospect) {
  const { data: answers } = await supabase
    .from('profile_answers').select('*').eq('prospect_id', prospect.id);
  const completeness = computeCompleteness(prospect, answers || []);
  if (!completeness.complete) return completeness;

  // Don't regenerate if a demo already exists — that's a user-initiated regen path
  const { data: existing } = await supabase
    .from('demo_payloads').select('prospect_id').eq('prospect_id', prospect.id).maybeSingle();
  if (existing) return completeness;

  // Fetch summary (required for demo generation context)
  const { data: summary } = await supabase
    .from('profile_summaries').select('*').eq('prospect_id', prospect.id).maybeSingle();
  if (!summary) {
    // No summary yet — can't generate the demo without it. Caller can manually
    // trigger /complete or wait for the summary to land.
    return completeness;
  }

  try {
    const { payload, model } = await generateDemoPayload({
      prospect, answers: answers || [], summary, language: prospect.language
    });
    await supabase.from('demo_payloads').upsert({
      prospect_id: prospect.id,
      payload,
      generated_at: new Date().toISOString(),
      generated_by: model,
      edited: false
    });
    await logEvent({ prospect_id: prospect.id, type: 'demo_generated', payload: { trigger: 'edit-threshold' } });
  } catch (e) {
    console.error('[profile] maybeGenerateDemo failed:', e?.message);
    await logEvent({ prospect_id: prospect.id, type: 'demo_generation_error', payload: { error: String(e?.message || e) } });
  }
  return completeness;
}

export default withEnv(handler);
