// api/admin/prospects.js
// Admin endpoint — list prospects (with summary excerpts) OR fetch one
// prospect's full detail (identity + answers + summary + demo payload + events).
//
// NO AUTH IN DEV per Rafael's choice. Wire ARQ_ADMIN_PASSWORD + cookie gate
// before deploying to prod (see [Prod hardening] todo).

import { supabase } from '../_lib/supabase.js';
import { sendJson, sendError, methodNotAllowed, withEnv } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin-auth.js';

async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  if (requireAdmin(req, res)) return;
  const url = new URL(req.url, 'http://x');
  const id = url.searchParams.get('id');

  if (id) return getOne(res, id);
  return listAll(res, url.searchParams);
}

async function listAll(res, params) {
  const limit  = Math.min(parseInt(params.get('limit') || '100', 10), 500);
  const status = params.get('status'); // optional filter
  const sector = params.get('sector'); // optional filter

  let q = supabase
    .from('prospects')
    .select('id, name, email, company, role, phone, sector_id, language, status, magic_token, created_at, last_active_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) {
    q = q.eq('status', status);
  } else {
    // Default list excludes soft-deleted prospects. Use ?status=deleted to view trash.
    q = q.neq('status', 'deleted');
  }
  if (sector) q = q.eq('sector_id', sector);

  const { data: prospects, error } = await q;
  if (error) return sendError(res, 500, 'List failed', { detail: error.message });

  // Bulk-fetch summaries + demo_payload presence in 2 queries
  const ids = prospects.map(p => p.id);
  const [{ data: summaries }, { data: payloads }] = await Promise.all([
    supabase.from('profile_summaries').select('prospect_id, sector_classification, suggested_capability, est_hours_saved, est_payback_months, summary_text, generated_at').in('prospect_id', ids),
    supabase.from('demo_payloads').select('prospect_id, generated_at, edited').in('prospect_id', ids)
  ]);
  const summaryMap = new Map((summaries || []).map(s => [s.prospect_id, s]));
  const payloadMap = new Map((payloads  || []).map(d => [d.prospect_id, d]));

  const rows = prospects.map(p => ({
    ...p,
    summary: summaryMap.get(p.id) || null,
    demo: payloadMap.get(p.id) ? { generated_at: payloadMap.get(p.id).generated_at, edited: payloadMap.get(p.id).edited } : null
  }));
  return sendJson(res, 200, { count: rows.length, prospects: rows });
}

async function getOne(res, id) {
  const [
    { data: prospect, error: pErr },
    { data: answers },
    { data: summary },
    { data: demo },
    { data: events },
    { data: notifications }
  ] = await Promise.all([
    supabase.from('prospects').select('*').eq('id', id).maybeSingle(),
    supabase.from('profile_answers').select('*').eq('prospect_id', id).order('question_id'),
    supabase.from('profile_summaries').select('*').eq('prospect_id', id).maybeSingle(),
    supabase.from('demo_payloads').select('*').eq('prospect_id', id).maybeSingle(),
    supabase.from('events').select('type, created_at, payload').eq('prospect_id', id).order('created_at', { ascending: true }).limit(200),
    supabase.from('notifications').select('channel, status, sent_at, error, created_at').eq('prospect_id', id).order('created_at', { ascending: false })
  ]);
  if (pErr) return sendError(res, 500, 'Fetch failed', { detail: pErr.message });
  if (!prospect) return sendError(res, 404, 'Not found');
  const { password_hash, ...safe } = prospect;
  return sendJson(res, 200, {
    prospect: safe,
    answers: answers || [],
    summary: summary || null,
    demo: demo || null,
    events: events || [],
    notifications: notifications || []
  });
}

export default withEnv(handler);
