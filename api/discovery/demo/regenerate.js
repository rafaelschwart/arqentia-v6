// api/discovery/demo/regenerate.js
// POST ?token=<magic_token>&internal=1
// Re-runs the agent pipeline against the prospect's current answers + summary,
// stores the fresh payload, and returns it.
// Requires internal=1 — this is a Rafael-only operation.
//
// Special case: token=demo uses the hardcoded Mariana fixture (no Supabase row).

import { supabase } from '../../_lib/supabase.js';
import { resolveProspect } from '../../_lib/auth.js';
import { logEvent } from '../../_lib/events.js';
import { runAgentPipeline } from '../../_lib/agent-pipeline.js';
import { MARIANA_FIXTURE, DEMO_CACHE } from '../../_lib/demo-fixture.js';
import { sendJson, sendError, methodNotAllowed, withEnv } from '../../_lib/http.js';

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const url = new URL(req.url, 'http://x');
  const token    = url.searchParams.get('token');
  const internal = url.searchParams.get('internal') === '1';
  if (!internal) return sendError(res, 403, 'Regenerate requires internal mode');

  // ── Demo fixture path — no Supabase needed ─────────────────────────────────
  if (token === 'demo') {
    const fixture = MARIANA_FIXTURE;
    const t0 = Date.now();
    let result;
    try {
      result = await runAgentPipeline({
        prospect: fixture.prospect,
        answers:  fixture.answers,
        summary:  fixture.summary,
        language: fixture.prospect.language
      });
    } catch (e) {
      if (e.code === 'ENV_MISSING') throw e;
      return sendError(res, 502, 'Demo pipeline failed', { detail: e.message });
    }
    const wallMs = Date.now() - t0;
    DEMO_CACHE.set('demo', {
      payload:          result.payload,
      model:            result.model,
      pipeline_version: result.pipeline_version,
      wall_ms:          wallMs,
      ts:               new Date().toISOString()
    });
    return sendJson(res, 200, {
      ok:       true,
      payload:  result.payload,
      pipeline: result.pipeline_version,
      wall_ms:  wallMs
    });
  }

  // ── Live prospect path ──────────────────────────────────────────────────────
  const prospect = await resolveProspect(req, token);
  if (!prospect) return sendError(res, 404, 'Not found');

  const [{ data: answers }, { data: summary }] = await Promise.all([
    supabase.from('profile_answers').select('*').eq('prospect_id', prospect.id),
    supabase.from('profile_summaries').select('*').eq('prospect_id', prospect.id).maybeSingle()
  ]);

  let result;
  try {
    result = await runAgentPipeline({
      prospect,
      answers: answers || [],
      summary,
      language: prospect.language
    });
  } catch (e) {
    if (e.code === 'ENV_MISSING') throw e;
    return sendError(res, 502, 'Demo generation failed', { detail: e.message });
  }

  await supabase.from('demo_payloads').upsert({
    prospect_id:  prospect.id,
    payload:      result.payload,
    generated_at: new Date().toISOString(),
    generated_by: result.model,
    edited:       false,
    edited_at:    null
  });
  await logEvent({ prospect_id: prospect.id, type: 'demo_regenerated', payload: {}, req });
  return sendJson(res, 200, {
    ok:       true,
    payload:  result.payload,
    pipeline: result.pipeline_version
  });
}

export default withEnv(handler);
