// api/admin/restore-prospect.js
// POST { prospect_id, status?: 'completed'|'started' }
// Restores a soft-deleted prospect by setting status back. Defaults to 'completed'
// if they had a summary, else 'started'.

import { supabase } from '../_lib/supabase.js';
import { logEvent } from '../_lib/events.js';
import { readJson, sendJson, sendError, methodNotAllowed, withEnv } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin-auth.js';

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (requireAdmin(req, res)) return;
  const body = await readJson(req).catch(() => null);
  if (!body?.prospect_id) return sendError(res, 400, 'Missing prospect_id');

  const { data: prospect, error: pErr } = await supabase
    .from('prospects').select('id, status').eq('id', body.prospect_id).maybeSingle();
  if (pErr) return sendError(res, 500, 'Fetch failed', { detail: pErr.message });
  if (!prospect) return sendError(res, 404, 'Prospect not found');
  if (prospect.status !== 'deleted') return sendError(res, 409, 'Prospect is not in trash');

  // Default: completed (was the most common pre-delete status)
  const targetStatus = body.status || 'completed';

  const { error: updErr } = await supabase.from('prospects')
    .update({ status: targetStatus, last_active_at: new Date().toISOString() })
    .eq('id', body.prospect_id);
  if (updErr) return sendError(res, 500, 'Restore failed', { detail: updErr.message });

  await logEvent({ prospect_id: body.prospect_id, type: 'prospect_restored', payload: { to_status: targetStatus }, req });
  return sendJson(res, 200, { ok: true, status: targetStatus });
}

export default withEnv(handler);
