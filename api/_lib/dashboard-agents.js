// api/_lib/dashboard-agents.js
// Orchestrator for the dashboard agent suite. The 12 specialists themselves
// live as editable markdown files in agents/dashboard/<name>.md — see that
// folder's README.md.
//
// Responsibilities:
//   - Match the admin's edit prompt to relevant specialists via keyword rules
//     loaded from each agent's frontmatter.
//   - Dispatch matched specialists in parallel against Claude (each with its
//     own model + max_tokens from its .md file).
//   - Apply each agent's JSON output to the dashboard payload patch using the
//     specialist's declared `output_transform`.
//   - Return a unified { patch, specialists_used, errors, explain } result.

import Anthropic from '@anthropic-ai/sdk';
import { listAgents, getAgent, resolvePrompt, getLoadErrors } from './agent-loader.js';
import { emitSubagentStart, emitSubagentStop } from './hook-emitter.js';
import { logClaudeUsage } from './usage.js';

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

// Robust JSON extractor: handles trailing prose, markdown fences, and tolerant
// of slightly malformed output. Walks the brace tree from the first { to the
// matching }, ignoring chars inside string literals.
function parseJson(text, agent) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) throw new Error(`${agent}: no JSON object in output`);
  let depth = 0, inString = false, escape = false, end = -1;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error(`${agent}: unterminated JSON object`);
  const json = cleaned.slice(start, end + 1);
  try { return JSON.parse(json); }
  catch (e) {
    throw new Error(`${agent} JSON parse failed: ${e.message}\nRaw: ${json.slice(0, 260)}`);
  }
}

// ─── CONTEXT BUILDER ────────────────────────────────────────────────────────
function buildContext({ prospect, answers, summary, payload }) {
  const A = {};
  for (const a of (answers || [])) {
    A[a.question_id] = a.value_json ?? a.value_text ?? null;
  }
  return {
    company:    prospect?.company || prospect?.name || 'Anonymous',
    name:       prospect?.name    || '',
    role:       prospect?.role    || '',
    sector:     prospect?.sector_id || A['Q1']?.industry || 'unknown',
    headcount:  A['Q1']?.headcount  || 'unknown',
    business:   A['Q2']             || '',
    pain:       A['Q3']             || {},
    hours:      A['Q4']             || '',
    tools:      A['Q5']             || {},
    data_state: A['Q6']             || '',
    fix:        A['Q7']             || {},
    metric:     A['Q8']             || {},
    decision:   A['Q9']             || {},
    summary_text: summary?.summary_text || '',
    sector_caps:  summary?.suggested_capability || '',
    current_payload: {
      headline:        payload?.headline || '',
      kpi_count:       payload?.kpis?.length || 0,
      has_insights:    !!payload?.insights?.length,
      has_recommendations: !!payload?.recommendations?.length,
      has_risks:       !!payload?.risks?.length,
      has_roadmap:     !!payload?.roadmap?.length,
      pricing_tier:    payload?.pricing?.tier || ''
    }
  };
}

// ─── RUN ONE AGENT ──────────────────────────────────────────────────────────
// Note on prefill: haiku models support assistant-message prefill (`{`) which
// forces clean JSON output. Sonnet 4.6 and Opus 4.7 reject it ("This model
// does not support assistant message prefill"), so we skip it for those — the
// brace-counting parser still extracts JSON from any surrounding prose.
function supportsPrefill(model) {
  return /haiku/i.test(model || '');
}

async function runAgent(agent, ctx, { language, adminFocus = '', prospectId = null, images = [] } = {}) {
  const system = resolvePrompt(agent.prompt_template, { language, adminFocus });
  const userText = JSON.stringify(ctx);

  // Build user message content. If images are attached AND the model is vision-
  // capable (haiku 4.5 + sonnet 4.6 + opus 4.7 all support vision), include
  // them in the user turn. Otherwise just send the text.
  const supportsVision = !/legacy|2\.1/i.test(agent.model);
  const userContent = (images.length && supportsVision)
    ? [
        ...images.map(img => ({
          type: 'image',
          source: { type: 'base64', media_type: img.media_type, data: img.data }
        })),
        { type: 'text', text: userText }
      ]
    : userText;

  const usePrefill = supportsPrefill(agent.model);
  const messages = usePrefill
    ? [{ role: 'user', content: userContent }, { role: 'assistant', content: '{' }]
    : [{ role: 'user', content: userContent }];

  // Tag each Anthropic call with agent name + prospect id so we can filter
  // them in the Anthropic Console (https://console.anthropic.com/usage)
  // and any external observability you wire up.
  const tag = `${(prospectId || 'unknown').slice(0, 8)}:${agent.name}`;

  const startMs = Date.now();
  const r = await client().messages.create({
    model: agent.model,
    max_tokens: agent.max_tokens,
    system,
    messages,
    metadata: { user_id: tag }
  });
  const elapsedMs = Date.now() - startMs;

  // Server log — shows up in `vercel dev` stdout + Vercel function logs.
  // Format is grep-friendly: `[agent]` prefix, key=value pairs.
  console.log(`[agent] ${agent.name} model=${agent.model} prospect=${(prospectId || '?').slice(0, 8)} tokens_in=${r.usage?.input_tokens ?? '?'} tokens_out=${r.usage?.output_tokens ?? '?'} images=${images.length} elapsed=${elapsedMs}ms`);

  logClaudeUsage({
    prospect_id: prospectId || null,
    model: r.model || agent.model,
    usage: r.usage,
    route: `dashboard-edit/${agent.name}`,
    elapsed_ms: elapsedMs,
    metadata: { images: images.length, max_tokens: agent.max_tokens }
  }).catch(() => {});

  const raw = r.content.find(b => b.type === 'text')?.text || '';
  const text = usePrefill ? '{' + raw : raw;
  return parseJson(text, agent.name);
}

// ─── KEYWORD MATCHER ────────────────────────────────────────────────────────
// Returns a Set of agent names whose keywords appear in the prompt.
// Uses prefix matching (no trailing \b) so plurals/suffixes hit:
// "recommendations" matches "recommend", "insights" matches "insight", etc.
//
// Each agent's `output_field` is also implicitly matched — so "activity",
// "kpis", "insights", "risks", "recommendations", "roadmap", "pricing",
// "headline", "chart" all route to the agent that owns that section without
// needing to be repeated in `keywords`.
// Triggers that force routing to freeform_editor exclusively, suppressing every
// specialist even if their keywords also appear in the prompt. Mentioning the
// main agent is treated as the admin saying "skip the routing logic, let
// Claude handle this." Patterns cover the natural English + Spanish phrasings
// Rafael actually types — "free editor", "free form", "freeform", "main
// agent", "use claude", "agente principal", etc.
const FREEFORM_TRIGGER_PATTERNS = [
  /\bfree[\s-]?form\b/i,                                              // freeform, free-form, free form
  /\bfree\s+editor\b/i,                                               // free editor
  /\bfreeform[\s-]?editor\b/i,                                        // freeform editor, freeform-editor
  /\bmain\s+agent\b/i,                                                // main agent
  /\buse\s+(?:the\s+)?(?:main\s+agent|claude|sonnet|opus|freeform)\b/i, // use claude, use the main agent
  /\bagente\s+(?:principal|general|libre)\b/i,                        // ES: agente principal/general/libre
  /\beditor\s+libre\b/i,                                              // ES: editor libre
  /\busa\s+(?:el\s+)?agente\s+principal\b/i,                          // ES: usa el agente principal
  /\bcustom\b/i,
  /\bsurprise\s+me\b/i,
  /\bup\s+to\s+you\b/i,
  /\bdo\s+what\s+you\s+think\b/i,
  /\buse\s+your\s+judgment\b/i,
  /\bfigure\s+(?:this|it)?\s*out\b/i,
  /\bwork\s+it\s+out\b/i,
  /\bflexible\b/i,
  /\bwhatever\b/i
];

function isFreeformRequested(prompt) {
  const lower = (prompt || '').toLowerCase();
  return FREEFORM_TRIGGER_PATTERNS.some(re => re.test(lower));
}

function pickSpecialists(prompt) {
  const lower = (prompt || '').toLowerCase();

  // PRIORITY OVERRIDE — if the admin explicitly invokes the free editor / main
  // agent / Claude directly, return ONLY freeform_editor. This runs BEFORE the
  // specialist loop so a phrase like "use the free editor to redo the graph"
  // doesn't accidentally pick up graph_expert from the word "graph".
  if (isFreeformRequested(prompt)) {
    return ['freeform_editor'];
  }

  const matched = new Set();
  for (const agent of listAgents()) {
    // Skip freeform_editor in the keyword loop — it's only invoked via the
    // explicit-request check above OR the "no matches" fallback below.
    if (agent.name === 'freeform_editor') continue;
    const allKws = [...(agent.keywords || [])];
    if (agent.output_field) allKws.push(agent.output_field);
    for (const kw of allKws) {
      const escaped = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}`, 'i');
      if (re.test(lower)) { matched.add(agent.name); break; }
    }
  }

  // Catch-all "rebuild/polish/everything/full/comprehensive" — fire the heavy hitters
  if (/\b(everything|whole|full|rebuild|regenerate|comprehensive|polish|complete)/i.test(lower)) {
    matched.add('headline_writer');
    matched.add('kpi_designer');
    matched.add('insights_generator');
    matched.add('recommendations_generator');
  }

  // No specialist matched → use the main agent rather than the safe default.
  // The freeform_editor can see the whole payload and decide what to touch,
  // which is what the admin almost always wants when nothing else fits.
  if (matched.size === 0) {
    return ['freeform_editor'];
  }

  // If the structural editor fired AND the prompt is clearly structural
  // (remove/delete/hide/add/rename — not just an incidental keyword), drop the
  // content regenerators. They're redundant and slower than necessary.
  if (matched.has('section_manager') && /\b(remove|delete|hide|drop|get rid|add\s+(a|an|new|section)|create\s+(a\s+)?section|rename|swap|replace\s+(the\s+)?section)/i.test(lower)) {
    return ['section_manager'];
  }

  return Array.from(matched);
}

// Choose a model dynamically for the freeform editor based on prompt complexity.
// Sonnet for normal edits, Opus when the prompt is long or has many images
// (heavy reasoning / strong vision work). Haiku is too small here — freeform
// edits routinely need to reason about the whole payload.
function pickFreeformModel(prompt, imageCount) {
  const promptLen = (prompt || '').length;
  const isHeavy = promptLen > 280 || imageCount >= 2;
  return isHeavy ? 'claude-opus-4-7' : 'claude-sonnet-4-6';
}

// ─── OUTPUT → PATCH TRANSFORM ───────────────────────────────────────────────
// Each agent declares output_transform in its frontmatter. The transform
// decides how the agent's JSON output gets applied to the dashboard patch.
function applyOutput(agent, out, patch) {
  const field = agent.output_field;
  const transform = agent.output_transform;

  switch (transform) {
    case 'passthrough':
      // Take the keys we expect from the agent's output and put them as patch[field]
      // For agents like recommendations_generator where out = { recommendations: [...] }
      // we copy out[field] → patch[field]
      if (out[field] !== undefined) patch[field] = out[field];
      else patch[field] = out; // fall back: whole output
      break;

    case 'passthrough_object':
      // Spread the whole agent output object as patch[field]
      patch[field] = { ...(out || {}) };
      break;

    case 'nested':
      // Spread agent output into payload.<field>, merging with whatever's there.
      // Spread BEFORE special-cases so type-specific fields (chart_type,
      // x_label, line_label, bar_label, etc.) get preserved.
      patch[field] = { ...(patch[field] || {}), ...out };
      // Special-case: pricing agent uses `tier` directly, not nested
      if (field === 'pricing' && out.tier) patch.pricing.tier = out.tier;
      // Special-case: chart — ensure title fallback exists but DON'T drop
      // chart_type or any type-specific keys
      if (field === 'chart') {
        if (!patch.chart.title) patch.chart.title = '// METRIC · PROJECTED';
        if (!patch.chart.chart_type) patch.chart.chart_type = 'line';
      }
      break;

    case 'kpis_array':
      if (Array.isArray(out.kpis)) {
        patch.kpis = out.kpis.map(k => ({
          label:   k.label,
          value:   k.value,
          delta:   k.delta,
          context: k.context
        }));
      }
      break;

    case 'merge_all':
      // freeform_editor output: a partial payload object. Spread every top-level
      // key directly into the patch. Any field the agent included gets applied;
      // any field it omitted is left alone (mergePatch handles the join later).
      for (const [k, v] of Object.entries(out || {})) {
        if (k === '_freeform' || k === 'reasoning') continue; // skip meta keys
        patch[k] = v;
      }
      break;

    case 'structural':
      // section_manager output: { remove: [...], rename: {...}, add: [...], explain: '...' }
      // Apply each op directly to the patch as semantic operations.
      if (Array.isArray(out.remove)) {
        for (const id of out.remove) {
          // Setting to null tells the renderer to hide the section. We use null
          // (not delete) so the merger DOESN'T fall back to the previous value
          // (see mergePatch in dashboard-edit.js which treats null as "skip").
          // Override that behavior by using an empty array/object/string here
          // so the merger sees it as a real value.
          const empty = ['kpis','insights','activity','recommendations','risks','roadmap'].includes(id)
            ? [] : (id === 'chart' || id === 'capability' || id === 'pricing' || id === 'roi' ? {} : '');
          patch[id] = empty;
        }
      }
      if (out.rename && typeof out.rename === 'object') {
        // Rename = override the section's title field if it has one.
        patch._renames = { ...(patch._renames || {}), ...out.rename };
      }
      if (Array.isArray(out.add)) {
        // Append to custom_sections — renderer iterates this at the bottom.
        patch.custom_sections = [...(patch.custom_sections || []), ...out.add.filter(s => s && s.id)];
      }
      // Stash the explain message so the orchestrator's `explain` line is useful
      patch._structural_explain = out.explain || '';
      break;

    default:
      // Unknown transform — store under field as-is
      patch[field] = out;
  }
}

// ─── EXPLAIN BUILDER ────────────────────────────────────────────────────────
function buildExplain(specs, errors, language) {
  if (specs.length === 0) {
    return language === 'es' ? 'Sin cambios aplicados.' : 'No changes applied.';
  }
  // Use the description from each agent's frontmatter as the verb phrase
  const verbs = specs.map(name => {
    const a = getAgent(name);
    if (!a) return name;
    // Take first sentence of description, lowercase first word
    const firstSentence = (a.description || name).split(/\.\s|$/)[0];
    return firstSentence.charAt(0).toLowerCase() + firstSentence.slice(1);
  });

  const join = language === 'es' ? ' y ' : ' and ';
  const prefix = language === 'es' ? 'Listo — ' : 'Done — ';
  const list = verbs.length === 1
    ? verbs[0]
    : verbs.slice(0, -1).join(', ') + join + verbs.slice(-1);
  const errSuffix = errors.length
    ? (language === 'es' ? ` (${errors.length} agentes fallaron)` : ` (${errors.length} agents failed)`)
    : '';
  return prefix + list + '.' + errSuffix;
}

// ─── MAIN ORCHESTRATOR ──────────────────────────────────────────────────────
export async function orchestrate({ prospect, answers, summary, payload, prompt, images = [], language = 'en', forceSpecialists = null }) {
  const specs = forceSpecialists && forceSpecialists.length
    ? forceSpecialists
    : pickSpecialists(prompt);

  const ctx = buildContext({ prospect, answers, summary, payload });

  // Track which model was actually used for each spec — surfaced to the UI so
  // the chat can show "Used main agent (Opus) for this custom edit".
  const modelsUsed = {};

  // Run all picked specialists in parallel
  const results = await Promise.allSettled(
    specs.map(async (name) => {
      const baseAgent = getAgent(name);
      if (!baseAgent) throw new Error(`Unknown agent: ${name}`);

      // For freeform_editor only: dynamically swap in opus on heavy prompts /
      // multi-image input. Other specialists keep their declared model.
      let agent = baseAgent;
      if (name === 'freeform_editor') {
        const dynamicModel = pickFreeformModel(prompt, (images || []).length);
        if (dynamicModel !== baseAgent.model) {
          agent = { ...baseAgent, model: dynamicModel };
        }
      }
      modelsUsed[name] = agent.model;

      // Emit SubagentStart so Nerdy Claude OS can display the agent
      await emitSubagentStart(name, 'dashboard-agent');

      try {
        const out = await runAgent(agent, ctx, { language, adminFocus: prompt, prospectId: prospect?.id, images });
        // Emit SubagentStop on success
        await emitSubagentStop(name, 'completed', 'dashboard-agent');
        return { name, agent, out };
      } catch (err) {
        // Emit SubagentStop on error
        await emitSubagentStop(name, 'error', 'dashboard-agent');
        throw err;
      }
    })
  );

  const patch = {};
  const errors = [];
  for (const r of results) {
    if (r.status === 'rejected') {
      errors.push(String(r.reason?.message || r.reason));
      continue;
    }
    const { agent, out } = r.value;
    try {
      applyOutput(agent, out, patch);
    } catch (e) {
      errors.push(`${agent.name} apply-output failed: ${e.message}`);
    }
  }

  const explain = buildExplain(specs, errors, language);
  const usedMainAgent = specs.includes('freeform_editor');
  return {
    patch,
    specialists_used: specs,
    errors,
    explain,
    used_main_agent: usedMainAgent,
    main_agent_model: usedMainAgent ? modelsUsed.freeform_editor : null,
    models_used: modelsUsed
  };
}

// Public: list of agent metadata for the admin UI
export function listSpecialists() {
  return listAgents().map(a => ({
    name: a.name,
    description: a.description,
    model: a.model,
    keywords: a.keywords
  }));
}

export const SPECIALISTS = listAgents().map(a => a.name);

// Surface loader errors for debugging
export function getAgentLoadErrors() { return getLoadErrors(); }
