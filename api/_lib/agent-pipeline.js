// api/_lib/agent-pipeline.js
// 7-pass Claude haiku agent pipeline (optimised to 5 API calls, 4 sequential phases).
// Passes 1+2 are merged into a single intake-analysis call for latency.
// Phase structure:
//   Phase A: Intake (sector intel + pain quantification combined)
//   Phase B: KPI definitions + Capability match  ← parallel
//   Phase C: Insights + Pricing fit              ← parallel
//   Phase D: Synthesis
//
// The 7 logical passes described in the spec are all represented; phases B and C
// each run two passes concurrently, making the total wall-time ~4 API calls deep.

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

/** Strip markdown fences, parse JSON, throw if invalid. */
function parseJson(text, passName) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`${passName} JSON parse failed: ${e.message}\nRaw: ${text.slice(0, 300)}`);
  }
}

/** Core call — prefilled assistant turn forces raw JSON, no fences. */
async function runPass(system, user, maxTokens, passName, prospectId) {
  const t0 = Date.now();
  const r = await client().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [
      { role: 'user',      content: user },
      { role: 'assistant', content: '{' }  // prefill: no markdown fences, raw JSON
    ]
  });
  logClaudeUsage({
    prospect_id: prospectId || null,
    model: r.model || MODEL,
    usage: r.usage,
    route: `agent-pipeline/${passName}`,
    elapsed_ms: Date.now() - t0
  }).catch(() => {});
  const text = '{' + (r.content.find(b => b.type === 'text')?.text || '');
  return parseJson(text, passName);
}

// Company-name helper: when a prospect goes through voice/text intake but
// doesn't have a company captured (Q1.company empty), JS template strings
// interpolate `prospect.company` as the literal string "null", which then
// shows up in the dashboard headline ("null transforms..."). Always run
// through this fallback before interpolating.
function companyName(prospect, language = 'en') {
  const c = (prospect?.company || '').trim();
  if (c && c !== 'null' && c.toLowerCase() !== 'undefined') return c;
  const n = (prospect?.name || '').trim().split(/\s+/)[0];
  if (n) return language === 'es' ? `la operación de ${n}` : `${n}'s operation`;
  return language === 'es' ? 'su operación' : 'their operation';
}

// ─── PASS 1+2 MERGED — INTAKE ANALYSIS ────────────────────────────────────────
// Combines sector intelligence + pain quantification into one call.
async function passIntake({ A, prospect }, language) {
  const lang = language === 'es' ? 'Spanish' : 'English';
  const industry  = A['Q1']?.industry  || prospect.sector_id || 'unknown';
  const headcount = A['Q1']?.headcount || 'unknown';

  const system = `Expert ops analyst. Analyse a prospect's sector and pain simultaneously. Return ONLY compact JSON, no preamble.
Schema:
{
  "sector_intel": {
    "vocabulary": ["<3-4 sector ops terms>"],
    "typical_metrics": ["<4-5 KPI names>"],
    "common_pain_patterns": ["<2-3 sector pains>"],
    "operational_benchmarks": [{"metric":"<m>","baseline":"<v>"}]
  },
  "pain_analysis": {
    "diagnosis": "<1 sentence naming their specific systems>",
    "primary_bottleneck": "<specific process step or system name>",
    "weekly_hours_lost": <int>,
    "annual_dollar_cost_estimate": <int, USD>,
    "failure_modes": ["<specific>","<specific>"],
    "data_friction": "<how data fails between their named tools>",
    "exposed_risks": ["<risk>"]
  }
}
All text in ${lang}.`;

  const user = `industry:${industry} headcount:${headcount}
description:"${(A['Q2']||'').slice(0,200)}"
pain:${JSON.stringify(A['Q3'])} affected:${A['Q3.1']||''} hours_lost:${JSON.stringify(A['Q4'])}
tools:${JSON.stringify(A['Q5'])} data_state:${JSON.stringify(A['Q6'])} disconnected:${A['Q6.1']||''}`;

  return runPass(system, user, 900, 'Pass1+2/Intake', prospect?.id);
}

// ─── PASS 3 — KPI DEFINITIONS ─────────────────────────────────────────────────
async function passKPIDefs({ A, intake, prospect }, language) {
  const lang = language === 'es' ? 'Spanish' : 'English';
  const { sector_intel, pain_analysis } = intake;

  const system = `KPI designer for a business ops dashboard. Return ONLY compact JSON, no preamble.
Schema: {"kpis":[{"label":"// MONO LABEL","current_value":"<baseline>","target_value":"<projected>","delta_label":"<e.g. ↘ -2.6d or ↗ +22 pts>","context":"<subtitle>","metric_type":"time_reduction|accuracy_improvement|volume_increase|cost_reduction|hours_returned|other"}]}
Rules: exactly 6 KPIs. KPI #1 MUST directly mirror Q8 metric+target (e.g. if Q8 says "3 days → 4 hours", then current_value="3 days", target_value="4 h"). KPIs 2-6 from sector_metrics. Labels: // ALL CAPS, English. Other text in ${lang}.`;

  const user = `Q8:${JSON.stringify(A['Q8'])} Q7:${JSON.stringify(A['Q7'])} Q7.1:${A['Q7.1']||''}
bottleneck:${pain_analysis.primary_bottleneck}
sector_metrics:${JSON.stringify(sector_intel.typical_metrics)}
sector_benchmarks:${JSON.stringify(sector_intel.operational_benchmarks)}`;

  return runPass(system, user, 750, 'Pass3/KPIDefs', prospect?.id);
}

// ─── PASS 5 — CAPABILITY MATCHING ─────────────────────────────────────────────
async function passCapabilityMatch({ A, intake, prospect }, language) {
  const lang = language === 'es' ? 'Spanish' : 'English';
  const { pain_analysis } = intake;

  const system = `Arqentia solutions architect. Return ONLY compact JSON, no preamble.
Capabilities (use EXACTLY these codes): C.01=Dashboards(KPI/real-time viz), C.02=Workflows(multi-step automation), C.03=AI Agents(autonomous reconciliation/classification), C.04=Integration(ERP/CRM/sheets/WhatsApp)
Schema: {"primary_capability":"C.01|C.02|C.03|C.04","secondary_capability":"<same or null>","combined_code":"<e.g. C.01+C.04>","label":"<human label>","why_this_fits":"<1 sentence referencing their specific tools>","what_we_will_NOT_do":"<1 sentence out-of-scope>"}
Text in ${lang}.`;

  const user = `bottleneck:${pain_analysis.primary_bottleneck} friction:${pain_analysis.data_friction}
tools:${JSON.stringify(A['Q5'])} data_state:${JSON.stringify(A['Q6'])} disconnected:${A['Q6.1']||''}`;

  return runPass(system, user, 450, 'Pass5/CapabilityMatch', prospect?.id);
}

// ─── PASS 4 — INSIGHTS GENERATION ─────────────────────────────────────────────
async function passInsights({ intake, kpiDefs, prospect }, language) {
  const lang = language === 'es' ? 'Spanish' : 'English';
  const { sector_intel, pain_analysis } = intake;
  const kpi1 = kpiDefs.kpis?.[0];

  const co = companyName(prospect, language);
  const system = `Ops consultant writing 3 specific dashboard insights. Return ONLY compact JSON, no preamble.
Schema: {"insights":[{"headline":"<bold outcome sentence>","body":"<1-2 sentences citing company name + specific number/system/route>"}]}
Rules: exactly 3 insights. Each MUST mention "${co}" or a specific route/system/SKU. Write like an analyst who studied their data — no generic advice. NEVER use the literal word "null". Text in ${lang}.`;

  const user = `company:${co}
bottleneck:${pain_analysis.primary_bottleneck} friction:${pain_analysis.data_friction}
hours_lost:${pain_analysis.weekly_hours_lost} risks:${JSON.stringify(pain_analysis.exposed_risks)}
kpi1:"${kpi1 ? `${kpi1.label} ${kpi1.current_value}→${kpi1.target_value}` : ''}"
sector_pains:${JSON.stringify(sector_intel.common_pain_patterns)}`;

  return runPass(system, user, 650, 'Pass4/Insights', prospect?.id);
}

// ─── PASS 6 — PRICING FIT ─────────────────────────────────────────────────────
async function passPricing({ capabilityMatch, A, prospect }, language) {
  const lang = language === 'es' ? 'Spanish' : 'English';

  const system = `Arqentia sales strategist. Return ONLY compact JSON, no preamble.
Tiers (exact numbers only — never invent): Discovery=free(30min diagnostic+one-page diagnosis), Build=from $8K(11-week to production), Maintenance=from $500/mo(SLA), Build+Maintenance=both.
Schema: {"recommended_tier":"Discovery only|Build only|Build + Maintenance|Maintenance only","headline":"<e.g. Build $8K + $500/mo maintenance>","sub":"<1 sentence: what's included, scoped to their pain>","rationale":"<1 sentence: why this tier>"}
Text in ${lang}.`;

  const user = `capability:${capabilityMatch.combined_code} why:${capabilityMatch.why_this_fits}
decision_unit:${JSON.stringify(A['Q9'])} headcount:${JSON.stringify(A['Q1']?.headcount)} company:${companyName(prospect, language)}`;

  return runPass(system, user, 300, 'Pass6/Pricing', prospect?.id);
}

// ─── PASS 7 — SYNTHESIS ────────────────────────────────────────────────────────
async function passSynthesize({
  prospect, intake, kpiDefs, insights, capabilityMatch, pricing, A
}, language) {
  const lang = language === 'es' ? 'Spanish' : 'English';

  // Sector labels are picked from the same map used in discovery/profile.js
  // so a dashboard generated in Spanish reads "Manufactura" and one generated
  // in English reads "Manufacturing" — drives the eyebrow on the demo card.
  const SECTOR_LABELS = {
    distribucion: { en: 'Distribution',  es: 'Distribución' },
    retail:       { en: 'Retail',        es: 'Retail' },
    manufactura:  { en: 'Manufacturing', es: 'Manufactura' },
    servicios:    { en: 'Services',      es: 'Servicios' },
    logistica:    { en: 'Logistics',     es: 'Logística' },
    salud:        { en: 'Healthcare',    es: 'Salud' },
    construccion: { en: 'Construction',  es: 'Construcción' },
    educacion:    { en: 'Education',     es: 'Educación' }
  };
  const sectorId    = prospect.sector_id || 'servicios';
  const sectorLabel = SECTOR_LABELS[sectorId]?.[language] || SECTOR_LABELS[sectorId]?.en || sectorId;
  const { sector_intel, pain_analysis } = intake;

  const kpi1 = kpiDefs.kpis?.[0];
  const isDecline = kpi1?.metric_type === 'time_reduction' || kpi1?.metric_type === 'cost_reduction';

  const co = companyName(prospect, language);
  const system = `Assemble final demo dashboard JSON. Return ONLY valid JSON — no preamble, no markdown fences.

Required schema (all fields mandatory):
{
  "company":"<string>","prospect_name":"<first name>","sector":"<sector_id>","sector_label":"<label>",
  "headline":"<1 sentence using company name, in ${lang}>",
  "kpis":[{"label":"// MONO","value":"<target_value from kpiDef>","delta":"<delta_label from kpiDef>","context":"<context from kpiDef>"}],
  "chart":{"title":"// METRIC · PROJECTED","subtitle":"12 weeks if you build with us","y_label":"<unit matching KPI #1>","data":[<12 numbers>]},
  "insights":[{"headline":"<bold>","body":"<1-2 sentences>"}],
  "activity":[{"when":"<e.g. Today 09:14>","event":"<short description>","owner":"<route/system/person>","value":"<✓ or S/. amount>"}],
  "capability":{"code":"<combined_code>","label":"<label>","why":"<why_this_fits>"},
  "pricing":{"tier":"<tier>","headline":"<headline>","sub":"<sub>"}
}

Rules:
- The "company" field MUST be "${co}" (never the literal word "null").
- The headline MUST use that company name and MUST NOT start with the literal word "null".
- Exactly 6 KPIs — convert kpiDefs: value=target_value, delta=delta_label, context=context. KPI #1 = prospect's Q8 target exactly.
- Chart: 12 numbers for KPI #1 metric. ${isDecline ? 'DECLINING trajectory — starts high, ends at target_value.' : 'RISING trajectory — starts at baseline, rises to target.'}
- Exactly 3 insights (from insights input).
- Exactly 5 activity rows. Use sector-specific detail: SAP Business One, Lima routes, bodega names, WhatsApp notifications if distribución.
- All customer-facing text in ${lang}. Mono labels (// ...) stay English-style.
- "sector_label" MUST be the ${lang}-localized version of the sector (not the slug).`;

  const user = `company:${co} name:${prospect.name || ''} sector:${sectorId} sector_label:${sectorLabel}

KPI_DEFS:${JSON.stringify(kpiDefs.kpis)}

INSIGHTS:${JSON.stringify(insights.insights)}

CAPABILITY:${JSON.stringify({code:capabilityMatch.combined_code,label:capabilityMatch.label,why:capabilityMatch.why_this_fits})}

PRICING:${JSON.stringify({tier:pricing.recommended_tier,headline:pricing.headline,sub:pricing.sub})}

PAIN:diagnosis="${pain_analysis.diagnosis}" bottleneck="${pain_analysis.primary_bottleneck}" hours_lost=${pain_analysis.weekly_hours_lost}

SECTOR_VOCAB:${JSON.stringify(sector_intel.vocabulary)}`;

  // 2600 tokens — voice transcripts produce richer prompts, and Spanish output
  // is verbose enough that 1600 occasionally truncates the JSON mid-string.
  return runPass(system, user, 2600, 'Pass7/Synthesis', prospect?.id);
}

// ─── MAIN PIPELINE EXPORT ──────────────────────────────────────────────────────
/**
 * @param {Object} input
 * @param {Object} input.prospect — prospect record
 * @param {Array}  input.answers  — profile_answers rows
 * @param {Object} input.summary  — profile_summaries row
 * @param {'en'|'es'} input.language
 * @returns {Promise<{payload, model, pipeline_version, wall_ms, debug}>}
 */
export async function runAgentPipeline({ prospect, answers, summary, language = 'en' }) {
  const t0 = Date.now();

  // Build answer lookup: value_json preferred, then value_text
  const A = {};
  for (const a of (answers || [])) {
    A[a.question_id] = a.value_json ?? a.value_text ?? null;
  }
  for (const a of (answers || [])) {
    if (a.value_text && !A[`${a.question_id}_text`]) {
      A[`${a.question_id}_text`] = a.value_text;
    }
  }

  // Phase A — intake (sector intel + pain, merged for latency)
  const intake = await passIntake({ A, prospect }, language);

  // Phase B — KPI defs + capability match (parallel; both need intake only)
  const [kpiDefs, capabilityMatch] = await Promise.all([
    passKPIDefs({ A, intake, prospect }, language),
    passCapabilityMatch({ A, intake, prospect }, language)
  ]);

  // Phase C — insights + pricing (parallel)
  const [insights, pricing] = await Promise.all([
    passInsights({ intake, kpiDefs, prospect }, language),
    passPricing({ capabilityMatch, A, prospect }, language)
  ]);

  // Phase D — synthesis
  const payload = await passSynthesize({
    prospect, intake, kpiDefs, insights, capabilityMatch, pricing, A
  }, language);

  const wallMs = Date.now() - t0;
  console.log(`[agent-pipeline] done in ${wallMs}ms (5 API calls / 4 phases, ${language})`);

  return {
    payload,
    model:            MODEL,
    pipeline_version: 'v1',
    wall_ms:          wallMs,
    debug: {
      sectorIntel:     intake.sector_intel,
      painAnalysis:    intake.pain_analysis,
      kpiDefs,
      capabilityMatch,
      insights,
      pricing
    }
  };
}
