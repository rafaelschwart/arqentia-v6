// api/admin/dashboard-generate.js
// POST { prospect_id }
//
// Admin-side endpoint that builds a fresh demo payload from scratch for a
// prospect that doesn't have one yet. Bypasses the completeness gate (admin
// can force-build even on thin profiles) and bypasses the magic-token check
// (admin owns by prospect_id, not token).
//
// Pairs with /api/admin/dashboard-edit which only works ONCE a payload exists.

import { supabase } from '../_lib/supabase.js';
import { logEvent } from '../_lib/events.js';
import { runAgentPipeline } from '../_lib/agent-pipeline.js';
import { readJson, sendJson, sendError, methodNotAllowed, withEnv } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin-auth.js';

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (requireAdmin(req, res)) return;

  const body = await readJson(req).catch(() => null);
  if (!body?.prospect_id) return sendError(res, 400, 'Missing prospect_id');

  const prospectId = body.prospect_id;
  // Admin can override the generation language (e.g. when they toggle the
  // admin UI from ES to EN and want the prospect's dashboard to follow).
  // Falls back to the prospect's recorded discovery language.
  const overrideLang = (body.language === 'en' || body.language === 'es') ? body.language : null;

  const [
    { data: prospect, error: pErr },
    { data: answers },
    { data: summary }
  ] = await Promise.all([
    supabase.from('prospects').select('*').eq('id', prospectId).maybeSingle(),
    supabase.from('profile_answers').select('*').eq('prospect_id', prospectId),
    supabase.from('profile_summaries').select('*').eq('prospect_id', prospectId).maybeSingle()
  ]);
  if (pErr) return sendError(res, 500, 'Fetch failed', { detail: pErr.message });
  if (!prospect) return sendError(res, 404, 'Prospect not found');

  if (!summary) {
    return sendError(res, 409, 'Prospect has no summary yet — complete a voice call or wizard first');
  }

  const t0 = Date.now();
  let result;
  try {
    result = await runAgentPipeline({
      prospect,
      answers: answers || [],
      summary,
      language: overrideLang || prospect.language || 'en'
    });
  } catch (e) {
    if (e.code === 'ENV_MISSING') throw e;
    console.error('[admin/dashboard-generate] pipeline failed:', e?.message);
    await logEvent({ prospect_id: prospectId, type: 'demo_generation_error', payload: { error: String(e?.message || e), source: 'admin' } });
    return sendError(res, 502, 'Generation failed', { detail: e?.message });
  }

  // Stamp the language onto the payload so the admin UI can detect drift
  // between admin chrome language and dashboard language on next view.
  const stampedPayload = { ...result.payload, language: overrideLang || prospect.language || 'en' };

  const { error: upErr } = await supabase.from('demo_payloads').upsert({
    prospect_id:  prospectId,
    payload:      stampedPayload,
    generated_at: new Date().toISOString(),
    generated_by: result.model,
    edited:       false
  });
  if (upErr) {
    return sendError(res, 500, 'Could not persist payload', { detail: upErr.message });
  }

  await logEvent({ prospect_id: prospectId, type: 'demo_generated', payload: { trigger: 'admin', wall_ms: Date.now() - t0 } });

  return sendJson(res, 200, {
    ok: true,
    payload: stampedPayload,
    pipeline: result.pipeline_version,
    language: stampedPayload.language,
    wall_ms: Date.now() - t0
  });
}

export default withEnv(handler);
