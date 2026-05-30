// api/_lib/supabase.js
// Lazy proxy so missing env vars don't crash module loading (e.g. during
// `vercel dev` before Rafael adds .env.local). The error surfaces only when
// a function actually tries to hit Supabase.
import { createClient } from '@supabase/supabase-js';

let _client = null;
function init() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const e = new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    e.code = 'ENV_MISSING';
    throw e;
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

export const supabase = new Proxy({}, {
  get(_t, prop) {
    return init()[prop];
  }
});
