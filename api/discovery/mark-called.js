// api/discovery/mark-called.js
import { supabase } from '../_lib/supabase.js';
import { verifyMarkCalledSig } from '../_lib/notify.js';
import { logEvent } from '../_lib/events.js';
import { sendError, methodNotAllowed , withEnv } from '../_lib/http.js';

async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const url = new URL(req.url, 'http://x');
  const id = url.searchParams.get('id');
  const sig = url.searchParams.get('sig');
  if (!id || !sig || !verifyMarkCalledSig(id, sig)) return sendError(res, 401, 'Invalid signature');

  await supabase.from('prospects').update({ status: 'called', last_active_at: new Date().toISOString() }).eq('id', id);
  await logEvent({ prospect_id: id, type: 'marked_called', payload: {}, req });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Marked as called</title></head><body style="font-family:system-ui,sans-serif;padding:40px;color:#0B1220;background:#F8FAFC;">
<div style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#475569;">// Status updated</div>
<h1 style="font-weight:600;margin:12px 0 6px;">Marked as called.</h1>
<p style="color:#475569;">Prospect status is now <code>called</code>. You can close this tab.</p>
</body></html>`);
}

export default withEnv(handler);
