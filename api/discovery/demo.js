// api/discovery/demo.js
// GET  ?token=<magic_token>  — return the prospect's stored demo payload (or {status:'pending'})
// PATCH ?token=<magic_token>&internal=1  — Rafael edit mode: validate + upsert edited payload
//
// Special case: token=demo reads from DEMO_CACHE (populated by /demo/regenerate?token=demo).
// If the cache is empty, returns {status:'pending'} and the frontend falls back to the
// hardcoded DEMO_PAYLOAD fixture — so the page always renders something.

import { supabase } from '../_lib/supabase.js';
import { resolveProspect } from '../_lib/auth.js';
import { logEvent } from '../_lib/events.js';
import { DEMO_CACHE } from '../_lib/demo-fixture.js';
import { readJson, sendJson, sendError, methodNotAllowed, withEnv } from '../_lib/http.js';

async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const token    = url.searchParams.get('token');
  const internal = url.searchParams.get('internal') === '1';

  if (req.method === 'GET')   return getDemo(req, res, token);
  if (req.method === 'PATCH') return patchDemo(req, res, token, internal);
  return methodNotAllowed(res, ['GET', 'PATCH']);
}

async function getDemo(req, res, token) {
  // ── Demo fixture path ───────────────────────────────────────────────────────
  if (token === 'demo') {
    if (DEMO_CACHE.has('demo')) {
      const cached = DEMO_CACHE.get('demo');
      return sendJson(res, 200, {
        status:       'ready',
        payload:      cached.payload,
        generated_at: cached.ts,
        generated_by: cached.model,
        pipeline:     cached.pipeline_version
      });
    }
    // Nothing cached yet — frontend falls back to static fixture
    return sendJson(res, 200, { status: 'pending', payload: null });
  }

  // ── Live prospect path ──────────────────────────────────────────────────────
  const prospect = await resolveProspect(req, token);
  if (!prospect) return sendError(res, 404, 'Not found');
  const { data } = await supabase
    .from('demo_payloads')
    .select('payload, generated_at, generated_by, edited, edited_at')
    .eq('prospect_id', prospect.id)
    .maybeSingle();
  if (!data) return sendJson(res, 200, { status: 'pending', payload: null });
  return sendJson(res, 200, { status: 'ready', ...data });
}

async function patchDemo(req, res, token, internal) {
  if (!internal) return sendError(res, 403, 'Edit requires internal mode');
  const prospect = await resolveProspect(req, token);
  if (!prospect) return sendError(res, 404, 'Not found');
  const body = await readJson(req).catch(() => null);
  if (!body?.payload) return sendError(res, 400, 'Missing payload');
  const p = body.payload;
  if (!Array.isArray(p.kpis) || p.kpis.length !== 6) return sendError(res, 400, 'kpis must be array of 6');
  if (!Array.isArray(p.insights) || p.insights.length !== 3) return sendError(res, 400, 'insights must be array of 3');
  if (!Array.isArray(p.activity) || p.activity.length !== 5) return sendError(res, 400, 'activity must be array of 5');

  // Read existing edit_count
  const { data: existing } = await supabase
    .from('demo_payloads').select('edit_count').eq('prospect_id', prospect.id).maybeSingle();
  const next = (existing?.edit_count ?? 0) + 1;

  await supabase.from('demo_payloads').upsert({
    prospect_id:  prospect.id,
    payload:      p,
    generated_at: new Date().toISOString(),
    generated_by: 'rafael-edit',
    edited:       true,
    edited_at:    new Date().toISOString(),
    edit_count:   next
  });
  await logEvent({ prospect_id: prospect.id, type: 'demo_edited', payload: { edit_count: next }, req });
  return sendJson(res, 200, { ok: true, edit_count: next });
}

export default withEnv(handler);
