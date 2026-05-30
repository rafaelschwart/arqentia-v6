// api/_lib/events.js
import { supabase } from './supabase.js';

export async function logEvent({ prospect_id = null, type, payload = {}, req = null }) {
  try {
    await supabase.from('events').insert({
      prospect_id,
      type,
      payload,
      ip: req?.headers?.['x-forwarded-for']?.toString().split(',')[0].trim() || null,
      user_agent: req?.headers?.['user-agent'] || null
    });
  } catch (e) {
    // Never let logging failures break the request path
    console.error('logEvent error:', e?.message || e);
  }
}
