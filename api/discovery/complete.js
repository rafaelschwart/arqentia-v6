// api/discovery/complete.js
import { supabase } from '../_lib/supabase.js';
import { resolveProspectId } from '../_lib/auth.js';
import { logEvent } from '../_lib/events.js';
import { generateProfileSummary } from '../_lib/claude.js';
import { notifyAll } from '../_lib/notify.js';
import { generateDemoPayload } from '../_lib/generate-demo.js';
import { sendJson, sendError, methodNotAllowed , withEnv } from '../_lib/http.js';
import { computeCompleteness } from '../_lib/completeness.js';

async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const { prospectId } = resolveProspectId(req);
  if (!prospectId) return sendError(res, 401, 'No session');

  const { data: prospect } = await supabase.from('prospects').select('*').eq('id', prospectId).single();
  const { data: answers } = await supabase.from('profile_answers').select('*').eq('prospect_id', prospectId);
  if (!prospect) return sendError(res, 404, 'Not found');

  let summary;
  try {
    summary = await generateProfileSummary({ language: prospect.language, answers, prospect_id: prospectId });
  } catch (e) {
    await logEvent({ prospect_id: prospectId, type: 'summary_error', payload: { error: String(e?.message || e) }, req });
    return sendError(res, 502, 'Summary generation failed', { retry: true });
  }

  // Fallback sector: if Claude returned null, derive from Q1 industry answer.
  // sector_classification is NOT NULL in the schema — without this fallback the
  // upsert silently fails and cascades (no summary → no notify → no demo).
  const q1 = (answers || []).find(a => a.question_id === 'Q1');
  const detectedSector =
    summary.meta.sector
    || q1?.value_json?.industry
    || prospect.sector_id
    || 'distribucion';

  const { error: summaryErr } = await supabase.from('profile_summaries').upsert({
    prospect_id: prospectId,
    summary_text: summary.summary || '(no summary)',
    sector_classification: detectedSector,
    est_hours_saved: summary.meta.est_hours_saved,
    est_payback_months: summary.meta.est_payback_months,
    suggested_capability: summary.meta.capability,
    generated_at: new Date().toISOString(),
    generated_by: summary.model
  });
  if (summaryErr) console.error('[complete] profile_summaries upsert failed:', summaryErr);

  const { error: prospErr } = await supabase.from('prospects').update({
    sector_id: detectedSector,
    status: 'completed',
    last_active_at: new Date().toISOString()
  }).eq('id', prospectId);
  if (prospErr) console.error('[complete] prospects update failed:', prospErr);

  await logEvent({ prospect_id: prospectId, type: 'wizard_completed', payload: { sector: detectedSector }, req });

  const { data: summaryRow } = await supabase
    .from('profile_summaries').select('*').eq('prospect_id', prospectId).single();

  // Background work — Vercel's serverless runtime kills fire-and-forget
  // promises when the response is sent, so we await both. Total adds ~25s
  // to /complete but the frontend already shows a "Building your profile…"
  // screen during this window. Notify (~1s) + pipeline (~22s) run in parallel.
  const notifyPromise = notifyAll({ ...prospect, sector_id: detectedSector }, summaryRow)
    .then(() => logEvent({ prospect_id: prospectId, type: 'rafael_notified', payload: {}, req }))
    .catch((e) => { console.error('[complete] Notify failed:', e?.message); });

  // GATE: only generate the personalized demo dashboard if the profile meets
  // the completeness threshold (8 of 11 required fields). Otherwise the
  // dashboard would be built on thin air. Profile page surfaces a "complete
  // your profile to unlock your demo" state when this gate fails.
  const completeness = computeCompleteness({ ...prospect, sector_id: detectedSector }, answers);
  let demoPromise = Promise.resolve();
  if (completeness.complete) {
    demoPromise = generateDemoPayload({ prospect: { ...prospect, sector_id: detectedSector }, answers, summary: summaryRow, language: prospect.language })
      .then(async ({ payload, model }) => {
        const { error: demoErr } = await supabase.from('demo_payloads').upsert({
          prospect_id: prospectId,
          payload,
          generated_at: new Date().toISOString(),
          generated_by: model,
          edited: false
        });
        if (demoErr) console.error('[complete] demo_payloads upsert failed:', demoErr);
        await logEvent({ prospect_id: prospectId, type: 'demo_generated', payload: { trigger: 'complete' }, req });
      })
      .catch(e => { console.error('[complete] demo generation failed:', e?.message); });
  } else {
    await logEvent({ prospect_id: prospectId, type: 'demo_gated', payload: { completeness }, req });
  }

  await Promise.allSettled([notifyPromise, demoPromise]);

  return sendJson(res, 200, {
    dashboard_url: `/discovery/p/${prospect.magic_token}`,
    sector: detectedSector,
    completeness
  });
}

export default withEnv(handler);
