// api/_lib/generate-demo.js
// Thin wrapper around the 7-pass agent pipeline.
// The old single-call implementation is preserved below as generateDemoPayloadLegacy
// for reference, but the default export now routes through the pipeline.

import Anthropic from '@anthropic-ai/sdk';
import { runAgentPipeline } from './agent-pipeline.js';
import { logClaudeUsage } from './usage.js';

const MODEL = 'claude-haiku-4-5-20251001';

let _client;
function client() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const e = new Error('Missing ANTHROPIC_API_KEY');
    e.code = 'ENV_MISSING';
    throw e;
  }
  _client = new Anthropic({ apiKey: key });
  return _client;
}

const SECTOR_LABELS = {
  distribucion:  'Distribución',
  retail:        'Retail',
  manufactura:   'Manufactura',
  servicios:     'Servicios',
  logistica:     'Logística',
  salud:         'Salud',
  construccion:  'Construcción',
  educacion:     'Educación'
};

/**
 * Primary entry point — 7-pass agent pipeline.
 * Signature is backwards-compatible with all callers (complete.js, voice/end-call.js,
 * demo/regenerate.js).
 *
 * @param {Object} input
 * @param {Object} input.prospect — prospect row (name, company, sector_id, role, etc.)
 * @param {Array}  input.answers — profile_answers rows
 * @param {Object} input.summary — profile_summaries row
 * @param {'en'|'es'} input.language
 * @returns {Promise<{payload: Object, model: string, meta: Object}>}
 */
export async function generateDemoPayload({ prospect, answers, summary, language = 'en' }) {
  const { payload, model } = await runAgentPipeline({ prospect, answers, summary, language });
  return { payload, model, meta: { pipeline: 'v1' } };
}

/**
 * Legacy single-call implementation — kept for reference, not used in production.
 * @deprecated Use generateDemoPayload (pipeline) instead.
 */
export async function generateDemoPayloadLegacy({ prospect, answers, summary, language = 'en' }) {
  const lang = language === 'es' ? 'Spanish' : 'English';
  const sectorLabel = SECTOR_LABELS[summary?.sector_classification] || SECTOR_LABELS[prospect.sector_id] || prospect.sector_id;

  const system = `You are an operations consultant. A prospect just completed a discovery interview.
Your job: generate a fully prospect-specific demo dashboard JSON payload that shows them what the
first 90 days with Arqentia would look like. Reference their actual company, sector, biggest pain,
hours/week saved, tools, and 90-day goal. Numbers should be plausible for LATAM mid-market and tuned
to THEIR baseline (e.g. if they said "3 days to close" the projected KPI should be "4 hours" not generic).

Write all customer-facing text in ${lang} (mono labels stay English-style code: // LABEL).

Return ONLY valid JSON matching this exact shape — no preamble, no markdown fences, no extra commentary:

{
  "company": "<verbatim company name>",
  "prospect_name": "<first name only>",
  "sector": "<distribucion|retail|manufactura|servicios|logistica|salud|construccion|educacion>",
  "sector_label": "${sectorLabel}",
  "headline": "<one sentence headline, in ${lang}>",
  "kpis": [
    { "label": "// SHORT LABEL", "value": "92%", "delta": "↗ +18 pts", "context": "first 90 days" }
    // EXACTLY 6 entries, sector-appropriate
  ],
  "chart": {
    "title": "// METRIC · PROJECTED",
    "subtitle": "12 weeks if you build with us",
    "y_label": "hours",
    "data": [<12 numbers showing the trajectory — declining for time-reduction metrics, rising for growth>]
  },
  "insights": [
    { "headline": "<bold first sentence>", "body": "<1-2 sentences referencing their company + numbers>" }
    // EXACTLY 3 entries
  ],
  "activity": [
    { "when": "Today 09:14", "event": "<short event description>", "owner": "<route/system/person>", "value": "✓" }
    // EXACTLY 5 entries
  ],
  "capability": {
    "code": "<C.01|C.02|C.03|C.04 or combo like 'C.01+C.04'>",
    "label": "<human label e.g. Dashboards + Integration>",
    "why": "<one sentence why this fits their situation>"
  },
  "pricing": {
    "tier": "<Build | Build + Maintenance | Maintenance only>",
    "headline": "<e.g. Build $8K + $500/mo maintenance>",
    "sub": "<e.g. Scoped to your reconciliation + KPI dashboard>"
  }
}

Rules:
- Match KPIs to the prospect's stated pain. If they said "weekly close: 3 days → 4 hours" then KPI #1 must be exactly that.
- Activity events should be things their actual operation would generate (use route names, SKU codes, customer names appropriate to their sector and the locations they mentioned).
- Insights must reference the company name AND specific numbers from their answers — not generic operations advice.
- Headlines and copy in ${lang}, but mono labels (// ...) stay structured/English-style.
- 6 KPIs · 3 insights · 5 activity rows · 12 chart points — exactly.`;

  const user = `PROSPECT PROFILE:

Company: ${(prospect.company && prospect.company.trim() && prospect.company !== 'null') ? prospect.company : (language === 'es' ? 'su operación' : 'their operation')}
Name: ${prospect.name || '—'}
Role: ${prospect.role || '—'}
Sector: ${prospect.sector_id || summary?.sector_classification || '—'}

AI SUMMARY:
${summary?.summary_text || '(none yet)'}

ANSWERS (Q1..Q10):
${(answers || []).map(a => `${a.question_id}: ${a.value_text ?? JSON.stringify(a.value_json)}`).join('\n')}

Capability hint from summary: ${summary?.suggested_capability || '—'}
Est. hours saved: ${summary?.est_hours_saved ?? '—'}

Generate the JSON payload now.`;

  const t0 = Date.now();
  const r = await client().messages.create({
    model: MODEL,
    max_tokens: 2200,
    system,
    messages: [{ role: 'user', content: user }]
  });
  logClaudeUsage({
    prospect_id: prospect?.id || null,
    model: r.model || MODEL,
    usage: r.usage,
    route: 'generate-demo-legacy',
    elapsed_ms: Date.now() - t0
  }).catch(() => {});
  const text = r.content.find(b => b.type === 'text')?.text || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let payload;
  try {
    payload = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Could not parse Claude demo payload as JSON: ${e.message}\nRaw: ${text.slice(0, 400)}`);
  }
  return { payload, model: r.model };
}
