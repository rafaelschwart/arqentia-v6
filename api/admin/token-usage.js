// api/admin/token-usage.js
// Admin endpoint for the API-cost panel.
//
//   GET /api/admin/token-usage
//     → summary: today / 7d / 30d / all-time totals + per-provider + per-model
//       + top 10 prospects by spend + 14-day daily series
//
//   GET /api/admin/token-usage?prospect_id=<uuid>
//     → that prospect's full per-call history + totals broken down by
//       provider, model, and route.

import { supabase } from '../_lib/supabase.js';
import { sendJson, sendError, methodNotAllowed, withEnv } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin-auth.js';

async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  if (requireAdmin(req, res)) return;

  const url = new URL(req.url, 'http://x');
  const prospectId = url.searchParams.get('prospect_id');

  if (prospectId) return getProspectDetail(res, prospectId);
  return getOverview(res);
}

// ─── OVERVIEW ──────────────────────────────────────────────────────────────────

async function getOverview(res) {
  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7  * 24 * 3600 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000).toISOString();

  // Pull last 30 days of rows in one shot; aggregate in memory. Cheap because
  // each call writes ~1 row and we'd see ~thousands max per month.
  const { data: rows, error } = await supabase
    .from('token_usage')
    .select('id, prospect_id, provider, model, route, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, audio_input_sec, audio_output_sec, cost_usd, created_at')
    .gte('created_at', thirtyDaysAgo)
    .order('created_at', { ascending: false });

  if (error) {
    // If the table doesn't exist yet, return a friendly empty payload so the
    // UI can show a "run migration" hint instead of a 500.
    if (/token_usage/.test(error.message || '')) {
      return sendJson(res, 200, { ok: true, migration_needed: true, ...emptyOverview() });
    }
    return sendError(res, 500, 'Fetch failed', { detail: error.message });
  }

  const allRows = rows || [];

  // All-time totals — single cheap aggregate (no row pull)
  const { data: allTimeRow } = await supabase
    .from('token_usage')
    .select('cost_usd, input_tokens, output_tokens')
    .limit(50000);   // safety cap

  const today  = bucket(allRows, r => r.created_at >= startOfToday);
  const week   = bucket(allRows, r => r.created_at >= sevenDaysAgo);
  const month  = bucket(allRows, r => r.created_at >= thirtyDaysAgo);
  const allTime = bucket(allTimeRow || [], () => true);

  // Per-provider breakdown for last 30 days
  const byProvider = groupBy(allRows, r => r.provider);
  const byModel    = groupBy(allRows, r => r.model);

  // Top spenders (last 30 days). Anonymous prospects (null id) bucketed.
  const byProspect = new Map();
  for (const r of allRows) {
    const key = r.prospect_id || '__anonymous__';
    if (!byProspect.has(key)) byProspect.set(key, { prospect_id: r.prospect_id, cost_usd: 0, calls: 0, tokens: 0 });
    const agg = byProspect.get(key);
    agg.cost_usd += Number(r.cost_usd || 0);
    agg.calls    += 1;
    agg.tokens   += Number(r.input_tokens || 0) + Number(r.output_tokens || 0);
  }
  const top = Array.from(byProspect.values())
    .sort((a, b) => b.cost_usd - a.cost_usd)
    .slice(0, 10);

  // Hydrate names/companies for top prospects in one query
  const ids = top.map(t => t.prospect_id).filter(Boolean);
  if (ids.length) {
    const { data: prospects } = await supabase
      .from('prospects').select('id, name, company, email').in('id', ids);
    const nameMap = new Map((prospects || []).map(p => [p.id, p]));
    for (const t of top) {
      const p = nameMap.get(t.prospect_id);
      t.name    = p?.name    || null;
      t.company = p?.company || null;
      t.email   = p?.email   || null;
    }
  }

  // 14-day daily time series (date → totals + by-provider)
  const series = buildDailySeries(allRows.filter(r => r.created_at >= fourteenDaysAgo));

  return sendJson(res, 200, {
    ok: true,
    summary: { today, week, month, all_time: allTime },
    by_provider: byProvider,
    by_model: byModel,
    top_prospects: top,
    daily_series: series,
    row_count_30d: allRows.length
  });
}

// ─── PROSPECT DETAIL ──────────────────────────────────────────────────────────

async function getProspectDetail(res, prospectId) {
  const { data: rows, error } = await supabase
    .from('token_usage')
    .select('*')
    .eq('prospect_id', prospectId)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (error) {
    if (/token_usage/.test(error.message || '')) {
      return sendJson(res, 200, { ok: true, migration_needed: true, prospect_id: prospectId, calls: [], totals: emptyBucket(), by_provider: {}, by_model: {}, by_route: {} });
    }
    return sendError(res, 500, 'Fetch failed', { detail: error.message });
  }

  const allRows = rows || [];
  const totals  = bucket(allRows, () => true);
  const byProvider = groupBy(allRows, r => r.provider);
  const byModel    = groupBy(allRows, r => r.model);
  const byRoute    = groupBy(allRows, r => r.route || 'unknown');

  return sendJson(res, 200, {
    ok: true,
    prospect_id: prospectId,
    totals,
    by_provider: byProvider,
    by_model: byModel,
    by_route: byRoute,
    calls: allRows.map(r => ({
      id:                 r.id,
      created_at:         r.created_at,
      provider:           r.provider,
      model:              r.model,
      route:              r.route,
      input_tokens:       r.input_tokens,
      output_tokens:      r.output_tokens,
      cache_read_tokens:  r.cache_read_tokens,
      cache_write_tokens: r.cache_write_tokens,
      audio_input_sec:    Number(r.audio_input_sec),
      audio_output_sec:   Number(r.audio_output_sec),
      cost_usd:           Number(r.cost_usd),
      elapsed_ms:         r.elapsed_ms
    }))
  });
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function bucket(rows, predicate) {
  let cost = 0, calls = 0, inT = 0, outT = 0, audioIn = 0, audioOut = 0;
  for (const r of rows) {
    if (!predicate(r)) continue;
    cost     += Number(r.cost_usd || 0);
    calls    += 1;
    inT      += Number(r.input_tokens || 0);
    outT     += Number(r.output_tokens || 0);
    audioIn  += Number(r.audio_input_sec || 0);
    audioOut += Number(r.audio_output_sec || 0);
  }
  return { cost_usd: round4(cost), calls, input_tokens: inT, output_tokens: outT, audio_input_sec: round2(audioIn), audio_output_sec: round2(audioOut) };
}

function emptyBucket() { return { cost_usd: 0, calls: 0, input_tokens: 0, output_tokens: 0, audio_input_sec: 0, audio_output_sec: 0 }; }

function emptyOverview() {
  const z = emptyBucket();
  return {
    summary: { today: z, week: z, month: z, all_time: z },
    by_provider: {}, by_model: {}, top_prospects: [], daily_series: [], row_count_30d: 0
  };
}

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, { cost_usd: 0, calls: 0, input_tokens: 0, output_tokens: 0 });
    const agg = m.get(k);
    agg.cost_usd      += Number(r.cost_usd || 0);
    agg.calls         += 1;
    agg.input_tokens  += Number(r.input_tokens || 0);
    agg.output_tokens += Number(r.output_tokens || 0);
  }
  // Convert to plain object, round costs
  const out = {};
  for (const [k, v] of m.entries()) {
    out[k] = { ...v, cost_usd: round4(v.cost_usd) };
  }
  return out;
}

function buildDailySeries(rows) {
  // 14 entries, oldest → newest, even if a day had zero calls
  const days = {};
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    days[key] = { date: key, cost_usd: 0, calls: 0, anthropic_usd: 0, openai_usd: 0 };
  }
  for (const r of rows) {
    const key = String(r.created_at).slice(0, 10);
    if (!days[key]) continue;
    const cost = Number(r.cost_usd || 0);
    days[key].cost_usd += cost;
    days[key].calls    += 1;
    if (r.provider === 'anthropic') days[key].anthropic_usd += cost;
    if (r.provider === 'openai')    days[key].openai_usd    += cost;
  }
  return Object.values(days).map(d => ({
    ...d,
    cost_usd:      round4(d.cost_usd),
    anthropic_usd: round4(d.anthropic_usd),
    openai_usd:    round4(d.openai_usd)
  }));
}

function round4(n) { return Math.round(n * 10000) / 10000; }
function round2(n) { return Math.round(n * 100) / 100; }

export default withEnv(handler);
