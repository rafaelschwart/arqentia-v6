// api/_lib/auth.js
import { parseCookies, verifyCookie } from './cookie.js';
import { supabase } from './supabase.js';

export function resolveProspectId(req) {
  const cookies = parseCookies(req.headers?.cookie);
  if (cookies.arq_pid) {
    const id = verifyCookie(cookies.arq_pid);
    if (id) return { source: 'cookie', prospectId: id };
  }
  return { source: null, prospectId: null };
}

export async function resolveProspectByToken(token) {
  if (!token) return null;
  const { data, error } = await supabase
    .from('prospects')
    .select('*')
    .eq('magic_token', token)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function resolveProspect(req, urlToken = null) {
  const { prospectId } = resolveProspectId(req);
  if (prospectId) {
    const { data } = await supabase.from('prospects').select('*').eq('id', prospectId).maybeSingle();
    if (data) return data;
  }
  if (urlToken) return resolveProspectByToken(urlToken);
  return null;
}
