// api/admin/regenerate-summary.js
// POST { prospect_id, language? }
//
// Runs the Claude profile-summary pipeline against an existing prospect's
// answers and overwrites the cached profile_summaries row. Designed to be
// triggered from the admin when the chrome language is toggled — the
// 2-sentence summary regenerates in the new language so admin reads
// everything consistently.
//
// Defensive about the profile_summaries schema:
//   - sector_classification is NOT NULL → fall back to prospect.sector_id
//     or 'servicios' if Claude returns null.
//   - generated_by is NOT NULL → fall back to 'claude-haiku-4-5'.
//   - summary_language may or may not exist (migration 0004 optional) →
//     try the upsert with it, retry without it if any schema error fires.

import { supabase } from '../_lib/supabase.js';
import { logEvent } from '../_lib/events.js';
import { generateProfileSummary } from '../_lib/claude.js';
import { readJson, sendJson, sendError, methodNotAllowed, withEnv } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin-auth.js';

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (requireAdmin(req, res)) return;

  const body = await readJson(req).catch(() => null);
  if (!body?.prospect_id) return sendError(res, 400, 'Missing prospect_id');

  const prospectId = body.prospect_id;
  const overrideLang = (body.language === 'en' || body.language === 'es') ? body.language : null;

  const [
    { data: prospect, error: pErr },
    { data: answers }
  ] = await Promise.all([
    supabase.from('prospects').select('*').eq('id', prospectId).maybeSingle(),
    supabase.from('profile_answers').select('*').eq('prospect_id', prospectId)
  ]);
  if (pErr) return sendError(res, 500, 'Fetch failed', { detail: pErr.message });
  if (!prospect) return sendError(res, 404, 'Prospect not found');

  const lang = overrideLang || prospect.language || 'en';
  const t0 = Date.now();

  let result;
  try {
    result = await generateProfileSummary({
      language: lang,
      answers: answers || [],
      prospect_id: prospectId
    });
  } catch (e) {
    if (e.code === 'ENV_MISSING') throw e;
    console.error('[admin/regenerate-summary] Claude failed:', e?.message);
    await logEvent({ prospect_id: prospectId, type: 'summary_regen_error', payload: { error: String(e?.message || e), source: 'admin' } });
    return sendError(res, 502, 'Summary regeneration failed', { detail: e?.message });
  }

  const meta = result.meta || {};

  // Build the upsert row with safe defaults for NOT NULL columns.
  // sector_classification falls back to prospect.sector_id (already validated
  // at intake) then to 'servicios' so an aggressive Claude null doesn't
  // 500 the request.
  const baseRow = {
    prospect_id:           prospectId,
    summary_text:          result.summary || '',
    sector_classification: meta.sector || prospect.sector_id || 'servicios',
    suggested_capability:  meta.capability ?? null,
    est_hours_saved:       meta.est_hours_saved ?? null,
    est_payback_months:    meta.est_payback_months ?? null,
    generated_at:          new Date().toISOString(),
    generated_by:          result.model || 'claude-haiku-4-5'
  };

  // First attempt: include summary_language (works if migration 0004 ran).
  let upErr;
  ({ error: upErr } = await supabase.from('profile_summaries').upsert({
    ...baseRow,
    summary_language: lang
  }));

  // If the column doesn't exist (common when 0004 hasn't been applied yet),
  // retry without it. Match defensively — PostgREST's error messages vary
  // across versions but "summary_language" is always somewhere in the body
  // OR the error code is 42703 (undefined_column).
  if (upErr) {
    const msg = String(upErr.message || '');
    const isMissingCol = /summary_language/i.test(msg)
      || /column.*does not exist/i.test(msg)
      || upErr.code === '42703'
      || upErr.code === 'PGRST204';
    if (isMissingCol) {
      console.warn('[admin/regenerate-summary] summary_language column missing, retrying without:', msg);
      ({ error: upErr } = await supabase.from('profile_summaries').upsert(baseRow));
    }
  }

  if (upErr) {
    console.error('[admin/regenerate-summary] upsert failed:', upErr.message, '| code:', upErr.code);
    await logEvent({ prospect_id: prospectId, type: 'summary_regen_error', payload: { error: upErr.message, code: upErr.code, source: 'admin', stage: 'persist' } });
    return sendError(res, 500, 'Could not persist summary', { detail: upErr.message, code: upErr.code });
  }

  await logEvent({
    prospect_id: prospectId,
    type: 'summary_regenerated',
    payload: { language: lang, source: 'admin', wall_ms: Date.now() - t0 }
  });

  return sendJson(res, 200, {
    ok: true,
    summary: result.summary,
    meta,
    language: lang,
    wall_ms: Date.now() - t0
  });
}

export default withEnv(handler);
