// api/_lib/parse-transcript.js
// Takes the raw transcript of a voice discovery call and asks Claude to
// extract the 10 structured fields the form-wizard captures. The prospect
// can then edit any field on the profile dashboard before submitting.

import Anthropic from '@anthropic-ai/sdk';
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

/**
 * @param {Array<{role:'agent'|'user', text:string}>} transcript
 * @param {'en'|'es'} language
 * @returns {Promise<{answers: Object, summary: {summary_text:string, sector:string, est_hours_saved:number, est_payback_months:number, capability:string}, model: string}>}
 */
export async function parseTranscript(transcript, language = 'en', prospectId = null) {
  const lang = language === 'es' ? 'Spanish' : 'English';
  const transcriptText = transcript
    .map(t => `${t.role === 'agent' ? 'AGENT' : 'USER'}: ${t.text}`)
    .join('\n');

  const system = `You are extracting structured discovery data from a voice interview transcript.
The interview opens with a warm-up identity capture (Q0) then covers 10 anchor topics (Q1-Q10).
Return a JSON object with these exact keys:

{
  "Q0": { "name": "<first name or full name>", "email": "<work email or null>", "phone": "<phone with country code or null>" },
  "Q1": { "industry": "<distribucion|retail|manufactura|servicios|logistica|salud|construccion|educacion|other>", "headcount": "<solo|1-10|11-50|51-200|200+>" },
  "Q2": "<one sentence describing the business>",
  "Q3": { "process": "<short label of the pain process>", "chips": ["<one or more of: reconciling, reports, followups, inventory, approvals, payroll, other>"] },
  "Q4": "<one of: 1-5, 5-10, 10-20, 20-40, 40+>",
  "Q5": { "tools": ["<excel|erp|crm|whatsapp|email|paper|custom|head|other>"], "erp_name": "<text|null>", "crm_name": "<text|null>" },
  "Q6": "<one of: spreadsheets_many, systems_disconnected, one_inconsistent, paper_whatsapp, custom_db, mix>",
  "Q7": { "fix": "<short label of the 90-day fix>", "chips": ["<one or more of: kpis, reports, approvals, errors, time, onboarding, other>"] },
  "Q8": { "metric": "<short metric name>", "target": "<current → target>" },
  "Q9": { "role": "<ceo|coo|ops|finance|other>", "decision_unit": "<me|cofounder|ops_team|finance|exec>" },
  "Q10": { "phone": "<phone with country code or null>", "whatsapp_ok": <true|false> },
  "summary": {
    "summary_text": "<4 sentences in ${lang}, one HTML <em> on the key pain word>",
    "sector": "<same as Q1.industry>",
    "est_hours_saved": <int>,
    "est_payback_months": <int>,
    "suggested_capability": "<C.01|C.02|C.03|C.04|combo like 'C.01+C.04'>"
  }
}

Rules:
- Use null for any field the prospect didn't clearly answer.
- Don't invent specifics — if they didn't say a number, estimate based on industry norms but note it.
- summary_text reads like an ops consultant note before the call: who, biggest pain, hours/week, 90-day goal, decision unit.
- Wrap exactly ONE word in <em>...</em> inside summary_text — the prospect's key pain.
- Return ONLY the JSON object. No preamble, no markdown.`;

  const user = `Transcript (interview was in ${lang}):\n\n${transcriptText}`;

  const t0 = Date.now();
  const r = await client().messages.create({
    model: MODEL,
    max_tokens: 1400,
    system,
    messages: [{ role: 'user', content: user }]
  });
  logClaudeUsage({
    prospect_id: prospectId,
    model: r.model || MODEL,
    usage: r.usage,
    route: 'parse-transcript',
    elapsed_ms: Date.now() - t0
  }).catch(() => {});
  const text = r.content.find(b => b.type === 'text')?.text || '';

  // Strip fence if Claude returns markdown by accident
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Could not parse Claude response as JSON: ${e.message}\nRaw: ${text.slice(0, 400)}`);
  }

  // Split out summary from the answers
  const { summary, ...answers } = parsed;
  return { answers, summary, model: r.model };
}
