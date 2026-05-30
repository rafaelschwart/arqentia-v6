// api/_lib/claude.js
import Anthropic from '@anthropic-ai/sdk';
import { logClaudeUsage } from './usage.js';

const MODEL = 'claude-haiku-4-5-20251001';

let _client;
function client() {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('Missing ANTHROPIC_API_KEY');
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

async function ask(systemPrompt, userPrompt, maxTokens = 600, opts = {}) {
  const t0 = Date.now();
  const r = await client().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });
  const text = r.content.find(b => b.type === 'text')?.text ?? '';
  logClaudeUsage({
    prospect_id: opts.prospect_id || null,
    model: r.model,
    usage: r.usage,
    route: opts.route || 'claude-ask',
    elapsed_ms: Date.now() - t0
  }).catch(() => {});
  return { text, model: r.model, usage: r.usage };
}

// Conditional follow-up generator (Q3, Q6 if multiple-systems, Q7)
export async function generateFollowUp({ language, anchor_id, anchor_answer, prospect_id }) {
  const lang = language === 'es' ? 'Spanish' : 'English';
  const system = `You are helping an operations consultancy understand a prospect's bottleneck.
Generate ONE short follow-up question (max 12 words) in ${lang}.
Respond with ONLY the question text, no preamble, no quotes.`;
  const user = `Anchor: ${anchor_id}\nProspect's answer: "${anchor_answer}"\nFollow-up question:`;
  const { text } = await ask(system, user, 80, { prospect_id, route: 'discovery-followup' });
  return text.trim().replace(/^["']|["']$/g, '');
}

// Final summary + sector classification
export async function generateProfileSummary({ language, answers, prospect_id }) {
  const lang = language === 'es' ? 'Spanish' : 'English';
  const system = `You are an operations consultant summarizing a discovery profile.

OUTPUT FORMAT — read carefully:
1. Write a 4-sentence summary in ${lang} for the consultant to read before the call.
2. Use ONE italic-serif emphasis word (wrap with <em>...</em>) on the prospect's key pain.
3. Then on a new line return a JSON object exactly as specified below.

STRICT RULES (failure to follow these breaks the downstream parser):
- DO NOT use any markdown formatting: no '#' headers, no '**bold**', no '*italic*', no bullet points, no numbered lists.
- DO NOT wrap the JSON in code fences (no \`\`\`json or \`\`\` at all).
- DO NOT prefix the summary with a title like "Summary:" or "Resumen:" or "# Resumen".
- The <em>...</em> tag IS allowed — it is the ONLY HTML/markup permitted.
- The summary must be plain prose only, exactly 4 sentences.

JSON schema (return on a new line AFTER the summary, with no fences and no surrounding text):
{"sector":"<one of: distribucion, retail, manufactura, servicios, logistica, salud, construccion, educacion>","est_hours_saved":<int>,"est_payback_months":<int>,"capability":"<C.01|C.02|C.03|C.04 or combo like 'C.01+C.04'>"}`;
  const user = `Answers:\n${JSON.stringify(answers, null, 2)}`;
  const { text, model } = await ask(system, user, 600, { prospect_id, route: 'profile-summary' });
  const parsed = parseSummaryResponse(text);
  return { summary: parsed.summary, meta: parsed.meta, model };
}

// Robust parser for the summary + JSON response. Tolerates Claude slipping
// in markdown despite the prompt: strips code fences, leading '#' headers,
// bold/italic markdown, trailing JSON whether or not it's in a code fence.
function parseSummaryResponse(raw) {
  const empty = { sector: null, est_hours_saved: null, est_payback_months: null, capability: null };
  let text = String(raw || '').trim();
  let meta = { ...empty };

  // 1) Try to extract a JSON object containing "sector" — prefer the LAST one
  // in the response since the prompt asks for JSON at the end. Match any
  // {...} block whose content references "sector". Greedy across newlines.
  const jsonMatches = [...text.matchAll(/\{[^{}]*"sector"[^{}]*\}/gs)];
  let jsonStart = -1, jsonEnd = -1;
  if (jsonMatches.length) {
    const last = jsonMatches[jsonMatches.length - 1];
    try {
      meta = { ...empty, ...JSON.parse(last[0]) };
      jsonStart = last.index;
      jsonEnd = last.index + last[0].length;
    } catch { /* JSON.parse failed — fall through, leave meta empty */ }
  }

  // 2) Take only the prose BEFORE the JSON block (or full text if no JSON found).
  let prose = jsonStart >= 0 ? text.slice(0, jsonStart) : text;

  // 3) Strip every markdown construct Claude might still inject.
  prose = prose
    // Strip surrounding code fences (```json ... ``` or ``` ... ```)
    .replace(/```[a-zA-Z]*\n?/g, '')
    .replace(/```/g, '')
    // Strip ATX headers (lines starting with one or more '#' followed by space)
    .replace(/^\s*#{1,6}\s+.*$/gm, '')
    // Strip leading "Summary:" / "Resumen:" / "Resumen de Descubrimiento" titles
    .replace(/^\s*(summary|resumen(?:\s+de\s+descubrimiento)?)\s*:?\s*/i, '')
    // Drop standalone bullet markers at line start
    .replace(/^\s*[-*•]\s+/gm, '')
    // Drop markdown bold/italic asterisks but keep the wrapped text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^\*])\*([^*\n]+)\*/g, '$1$2')
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { summary: prose, meta };
}
