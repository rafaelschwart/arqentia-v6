// api/discovery/demo/explain-metric.js
// POST { token, kind: 'kpi'|'risk'|'recommendation'|'roi'|'roadmap', payload: { ... } }
//
// Returns a SHORT haiku-generated explanation of WHY a particular dashboard
// element was chosen for this prospect, suitable for showing in a hover
// tooltip. Cheap, fast, no auth gate beyond magic-token resolution.

import Anthropic from '@anthropic-ai/sdk';
import { resolveProspect } from '../../_lib/auth.js';
import { supabase } from '../../_lib/supabase.js';
import { readJson, sendJson, sendError, methodNotAllowed, withEnv } from '../../_lib/http.js';
import { logClaudeUsage } from '../../_lib/usage.js';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 220;

let _client;
function client() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { const e = new Error('Missing ANTHROPIC_API_KEY'); e.code = 'ENV_MISSING'; throw e; }
  _client = new Anthropic({ apiKey: key });
  return _client;
}

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const body = await readJson(req).catch(() => null);
  if (!body) return sendError(res, 400, 'Invalid body');

  const token = body.token;
  const prospect = await resolveProspect(req, token);
  if (!prospect) return sendError(res, 401, 'No session');

  const kind = String(body.kind || 'kpi').toLowerCase();
  const item = body.payload || {};
  const lang = prospect.language === 'es' ? 'Spanish' : 'English';

  // Fetch summary for additional context (sector, capability)
  const { data: summary } = await supabase
    .from('profile_summaries').select('sector_classification, suggested_capability, summary_text')
    .eq('prospect_id', prospect.id).maybeSingle();

  const itemStr = typeof item === 'string' ? item : JSON.stringify(item).slice(0, 600);
  const context = `Prospect: ${prospect.name || 'a LATAM mid-market exec'} · sector: ${summary?.sector_classification || 'unknown'} · capability: ${summary?.suggested_capability || '—'}.`;

  const system = `You are explaining a single dashboard element to the prospect in a hover tooltip.

Return ONLY JSON:
{
  "what": "<one short sentence: what this metric/section measures, in plain language>",
  "why": "<one short sentence: why this was chosen for THIS prospect specifically (reference their sector or named pain when possible)>"
}

Rules:
- TWO sentences total. Each under 22 words.
- Plain text. No HTML, no markdown, no jargon the prospect wouldn't know.
- Text in ${lang}.
- "what" answers: what does this mean.
- "why" answers: why we put it on YOUR dashboard.`;

  const userPrompt = `Element kind: ${kind}
Element payload: ${itemStr}

Prospect context: ${context}`;

  const usePrefill = /haiku/i.test(MODEL);
  const messages = usePrefill
    ? [{ role: 'user', content: userPrompt }, { role: 'assistant', content: '{' }]
    : [{ role: 'user', content: userPrompt }];

  let parsed;
  try {
    const t0 = Date.now();
    const r = await client().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      metadata: { user_id: `${prospect.id.slice(0, 8)}:explain_${kind}` }
    });
    logClaudeUsage({
      prospect_id: prospect?.id || null,
      model: r.model || MODEL,
      usage: r.usage,
      route: `explain-metric/${kind}`,
      elapsed_ms: Date.now() - t0
    }).catch(() => {});
    const raw = r.content.find(b => b.type === 'text')?.text || '';
    const text = usePrefill ? '{' + raw : raw;
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const start = cleaned.indexOf('{');
    const end   = cleaned.lastIndexOf('}');
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    console.error('[explain-metric] failed:', e.message);
    return sendError(res, 502, 'Could not generate explanation', { detail: e.message });
  }

  return sendJson(res, 200, {
    what: String(parsed.what || '').slice(0, 280),
    why:  String(parsed.why  || '').slice(0, 280)
  });
}

export default withEnv(handler);
