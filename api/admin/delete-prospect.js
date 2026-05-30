// api/admin/delete-prospect.js
// POST { prospect_id, hard?: boolean }
//
// Soft delete (default): UPDATE prospects SET status='deleted'
//   - Recoverable, all data preserved
//   - Hidden from default admin list
// Hard delete: DELETE the prospect row + all child rows
//   - Irrecoverable
//   - Removes from profile_answers, profile_summaries, demo_payloads,
//     events, notifications (cascade NOT guaranteed by FK so we delete explicitly)

import { supabase } from '../_lib/supabase.js';
import { logEvent } from '../_lib/events.js';
import { readJson, sendJson, sendError, methodNotAllowed, withEnv } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin-auth.js';

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (requireAdmin(req, res)) return;
  const body = await readJson(req).catch(() => null);
  if (!body?.prospect_id) return sendError(res, 400, 'Missing prospect_id');

  const prospectId = body.prospect_id;
  const hard = body.hard === true;

  // Confirm prospect exists
  const { data: prospect, error: pErr } = await supabase
    .from('prospects').select('id, name, status').eq('id', prospectId).maybeSingle();
  if (pErr) return sendError(res, 500, 'Fetch failed', { detail: pErr.message });
  if (!prospect) return sendError(res, 404, 'Prospect not found');

  if (hard) {
    // Best-effort cascade: delete dependents first, then prospect.
    // If your schema already has ON DELETE CASCADE, the explicit deletes are no-ops.
    const childTables = ['profile_answers', 'profile_summaries', 'demo_payloads', 'events', 'notifications'];
    for (const tbl of childTables) {
      const { error } = await supabase.from(tbl).delete().eq('prospect_id', prospectId);
      if (error) {
        // Some tables may not have the column (logging only) — try without filter on those
        if (!String(error.message || '').toLowerCase().includes('column') ) {
          console.error(`[delete-prospect] failed to wipe ${tbl}:`, error.message);
        }
      }
    }
    const { error: delErr } = await supabase.from('prospects').delete().eq('id', prospectId);
    if (delErr) return sendError(res, 500, 'Hard delete failed', { detail: delErr.message });
    // Can't log the event with the prospect_id (just deleted) — fire a free-form event instead
    await logEvent({ type: 'prospect_hard_deleted', payload: { prospect_id: prospectId, name: prospect.name }, req });
    return sendJson(res, 200, { ok: true, mode: 'hard' });
  }

  // Soft delete
  const { error: updErr } = await supabase.from('prospects')
    .update({ status: 'deleted', last_active_at: new Date().toISOString() })
    .eq('id', prospectId);
  if (updErr) return sendError(res, 500, 'Soft delete failed', { detail: updErr.message });
  await logEvent({ prospect_id: prospectId, type: 'prospect_soft_deleted', payload: { previous_status: prospect.status }, req });
  return sendJson(res, 200, { ok: true, mode: 'soft' });
}

export default withEnv(handler);
