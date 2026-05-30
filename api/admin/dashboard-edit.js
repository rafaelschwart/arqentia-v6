// api/admin/dashboard-edit.js
// POST { prospect_id, prompt, force_specialists? }
//
// Routes the admin's edit prompt through the 12-agent dashboard suite, merges
// the patch into demo_payloads.payload, marks edited=true, returns the updated
// payload + which specialists ran + a 1-line natural-language explanation.

import { supabase } from '../_lib/supabase.js';
import { logEvent } from '../_lib/events.js';
import { orchestrate, SPECIALISTS } from '../_lib/dashboard-agents.js';
import { readJson, sendJson, sendError, methodNotAllowed, withEnv } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin-auth.js';

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (requireAdmin(req, res)) return;

  const body = await readJson(req).catch(() => null);
  if (!body || !body.prospect_id) return sendError(res, 400, 'Missing prospect_id');

  const prospectId = body.prospect_id;
  const promptText = String(body.prompt || '').slice(0, 2000);
  const force = Array.isArray(body.force_specialists)
    ? body.force_specialists.filter(s => SPECIALISTS.includes(s))
    : null;

  // Optional image attachments — admin can drag/drop or paste images as
  // visual references ("make the chart look like this"). Each:
  //   { media_type: 'image/png', data: '<base64>' }
  // Limited to 4 images, 5MB each. Forwarded to vision-capable agents.
  const images = Array.isArray(body.images) ? body.images.slice(0, 4).filter(im => im && im.media_type && im.data) : [];

  // Need either a prompt OR at least one image
  if (!promptText && images.length === 0) {
    return sendError(res, 400, 'Provide a prompt, image, or both');
  }

  // Load all context
  const [
    { data: prospect, error: pErr },
    { data: answers },
    { data: summary },
    { data: demoRow }
  ] = await Promise.all([
    supabase.from('prospects').select('*').eq('id', prospectId).maybeSingle(),
    supabase.from('profile_answers').select('*').eq('prospect_id', prospectId),
    supabase.from('profile_summaries').select('*').eq('prospect_id', prospectId).maybeSingle(),
    supabase.from('demo_payloads').select('*').eq('prospect_id', prospectId).maybeSingle()
  ]);
  if (pErr) return sendError(res, 500, 'Fetch failed', { detail: pErr.message });
  if (!prospect) return sendError(res, 404, 'Prospect not found');
  if (!demoRow) return sendError(res, 409, 'No demo payload exists — generate one first');

  const t0 = Date.now();
  let orchestrationResult;
  try {
    orchestrationResult = await orchestrate({
      prospect,
      answers: answers || [],
      summary: summary || null,
      payload: demoRow.payload,
      prompt: promptText,
      images, // pass through to the orchestrator
      language: prospect.language,
      forceSpecialists: force
    });
  } catch (e) {
    console.error('[dashboard-edit] orchestration crashed:', e?.message);
    await logEvent({ prospect_id: prospectId, type: 'dashboard_edit_error', payload: { error: String(e?.message || e), prompt: promptText } });
    return sendError(res, 502, 'Edit generation failed', { detail: e?.message });
  }
  const elapsedMs = Date.now() - t0;

  const merged = mergePatch(demoRow.payload, orchestrationResult.patch);

  const { error: upErr } = await supabase.from('demo_payloads').update({
    payload: merged,
    edited: true,
    generated_at: new Date().toISOString(),
    generated_by: `agent-suite/${orchestrationResult.specialists_used.join('+')}`
  }).eq('prospect_id', prospectId);
  if (upErr) {
    console.error('[dashboard-edit] payload update failed:', upErr.message);
    return sendError(res, 500, 'Could not persist edit', { detail: upErr.message });
  }

  await logEvent({
    prospect_id: prospectId,
    type: 'dashboard_edited',
    payload: {
      prompt: promptText.slice(0, 500),
      specialists: orchestrationResult.specialists_used,
      elapsed_ms: elapsedMs,
      errors: orchestrationResult.errors
    }
  });

  return sendJson(res, 200, {
    ok: true,
    payload: merged,
    specialists_used: orchestrationResult.specialists_used,
    errors: orchestrationResult.errors,
    explain: orchestrationResult.explain,
    used_main_agent: !!orchestrationResult.used_main_agent,
    main_agent_model: orchestrationResult.main_agent_model || null,
    models_used: orchestrationResult.models_used || {},
    elapsed_ms: elapsedMs
  });
}

// Shallow-merge a partial patch into the payload.
//   - Arrays REPLACE wholesale (intent of "regenerate KPIs" is replace, not append).
//     An EMPTY array is a valid value — it means "this section was deliberately
//     emptied" (used by section_manager `remove` ops to hide a section).
//   - Nested objects merge one level deep (e.g. pricing.tier without nuking pricing.headline).
//     An EMPTY object also means "deliberately emptied".
//   - Strings (including empty string) overwrite.
//   - undefined is skipped (agent didn't touch this field).
//   - null is treated like an explicit empty value where appropriate.
// `_renames` and `_structural_explain` are internal markers that get applied
// separately + then stripped.
function mergePatch(base, patch) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined) continue;
    if (k === '_renames' || k === '_structural_explain' || k === '_extracted') continue;
    if (Array.isArray(v)) {
      out[k] = v; // wholesale replace (including empty array = hide section)
    } else if (v && typeof v === 'object') {
      out[k] = { ...(out[k] || {}), ...v };
    } else if (v === null) {
      // null = explicit clear, but for safety only clear known section fields
      out[k] = null;
    } else {
      out[k] = v;
    }
  }
  // Apply rename ops to the `title` field of each named section if present
  if (patch._renames) {
    for (const [sectionId, newTitle] of Object.entries(patch._renames)) {
      if (out[sectionId] && typeof out[sectionId] === 'object' && !Array.isArray(out[sectionId])) {
        out[sectionId].title = newTitle;
      } else if (Array.isArray(out.custom_sections)) {
        const cs = out.custom_sections.find(s => s.id === sectionId);
        if (cs) cs.title = newTitle;
      }
    }
  }
  return out;
}

export default withEnv(handler);
