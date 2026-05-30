// api/_lib/usage.js
// Centralized API-cost telemetry. Every Claude / OpenAI call funnels through
// logClaudeUsage() or logOpenAIRealtimeUsage() (fire-and-forget) so the admin
// panel can render daily totals + per-prospect spend.
//
// Pricing is hardcoded here so that we (a) don't trust the model's billing
// metadata blindly and (b) get accurate USD figures even when LLM responses
// omit cache token counts. Update PRICING when providers adjust their rates.

import { supabase } from './supabase.js';

// ─── PRICING ─────────────────────────────────────────────────────────────────
// USD per 1M tokens unless otherwise noted. Sources verified 2026-05-28:
//   • Anthropic: https://www.anthropic.com/pricing
//   • OpenAI:    https://openai.com/api/pricing
//
// Cache reads are billed at 10% of input price (Anthropic prompt caching).
// Cache writes are billed at 25% premium (ephemeral 5-min) or 100% premium
// (1-hour) on input price. We assume ephemeral writes by default.
//
// Realtime API is billed by AUDIO TOKEN, not by second. The estimates below
// are derived empirically: 1 second of audio ≈ 80 input tokens / 50 output
// tokens at default sampling. This will undercount cached realtime audio
// (which we don't use today).

export const PRICING = {
  // Anthropic — USD per 1M tokens
  'claude-opus-4-7':            { in: 15.00, out: 75.00 },
  'claude-opus-4-7-20250101':   { in: 15.00, out: 75.00 },
  'claude-sonnet-4-6':          { in:  3.00, out: 15.00 },
  'claude-sonnet-4-6-20250901': { in:  3.00, out: 15.00 },
  'claude-haiku-4-5':           { in:  1.00, out:  5.00 },
  'claude-haiku-4-5-20251001':  { in:  1.00, out:  5.00 },

  // OpenAI — USD per 1M tokens (text)
  'gpt-4o':                     { in:  2.50, out: 10.00 },
  'gpt-4o-mini':                { in:  0.15, out:  0.60 },

  // OpenAI Realtime — USD per 1M AUDIO tokens (NOT text). These rates are
  // for gpt-realtime as of 2026-Q1. Per-second cost is derived in
  // estimateRealtimeCost() below.
  'gpt-realtime':               { audio_in: 32.00, audio_out: 64.00 },
  'gpt-realtime-mini':          { audio_in: 10.00, audio_out: 20.00 }
};

// Anthropic cache pricing multipliers (off input price)
const CACHE_READ_MULTIPLIER = 0.10;   // 10% of input
const CACHE_WRITE_MULTIPLIER = 1.25;  // 125% of input (ephemeral 5m)

// Realtime audio token rate per second. Empirical, conservative.
const REALTIME_AUDIO_IN_TOKENS_PER_SEC  = 80;
const REALTIME_AUDIO_OUT_TOKENS_PER_SEC = 50;

// ─── COST CALCULATION ────────────────────────────────────────────────────────

/** USD cost for an Anthropic call. Returns 0 if model is unknown. */
export function computeAnthropicCost(model, usage = {}) {
  const p = PRICING[model] || PRICING[stripModelDate(model)];
  if (!p) return 0;

  const input        = Number(usage.input_tokens || 0);
  const output       = Number(usage.output_tokens || 0);
  const cacheRead    = Number(usage.cache_read_input_tokens || 0);
  const cacheWrite   = Number(usage.cache_creation_input_tokens || 0);

  // Anthropic reports cache_read separately from input_tokens, so we treat
  // them additively but at the cache rate. Net input billed = input + cacheWrite + cacheRead.
  const inCost          = (input        / 1_000_000) * p.in;
  const outCost         = (output       / 1_000_000) * p.out;
  const cacheReadCost   = (cacheRead    / 1_000_000) * p.in * CACHE_READ_MULTIPLIER;
  const cacheWriteCost  = (cacheWrite   / 1_000_000) * p.in * CACHE_WRITE_MULTIPLIER;
  return round6(inCost + outCost + cacheReadCost + cacheWriteCost);
}

/** USD cost for an OpenAI text completion. */
export function computeOpenAIChatCost(model, usage = {}) {
  const p = PRICING[model];
  if (!p || !p.in) return 0;
  const input  = Number(usage.prompt_tokens || usage.input_tokens || 0);
  const output = Number(usage.completion_tokens || usage.output_tokens || 0);
  return round6((input / 1_000_000) * p.in + (output / 1_000_000) * p.out);
}

/** USD cost for an OpenAI Realtime voice session, estimated from duration. */
export function estimateRealtimeCost(model, audioInSec, audioOutSec) {
  const p = PRICING[model];
  if (!p || !p.audio_in) return 0;
  const inTokens  = audioInSec  * REALTIME_AUDIO_IN_TOKENS_PER_SEC;
  const outTokens = audioOutSec * REALTIME_AUDIO_OUT_TOKENS_PER_SEC;
  return round6(
    (inTokens  / 1_000_000) * p.audio_in +
    (outTokens / 1_000_000) * p.audio_out
  );
}

// ─── LOGGERS (fire-and-forget; never throw upstream) ─────────────────────────

/** Log a Claude/Anthropic call. Safe to await OR drop the promise. */
export async function logClaudeUsage({ prospect_id, model, usage, route, elapsed_ms, metadata }) {
  if (!model || !usage) return;
  const cost = computeAnthropicCost(model, usage);
  return writeRow({
    prospect_id: prospect_id || null,
    provider: 'anthropic',
    model,
    route: route || null,
    input_tokens:       Number(usage.input_tokens || 0),
    output_tokens:      Number(usage.output_tokens || 0),
    cache_read_tokens:  Number(usage.cache_read_input_tokens || 0),
    cache_write_tokens: Number(usage.cache_creation_input_tokens || 0),
    audio_input_sec:  0,
    audio_output_sec: 0,
    cost_usd:    cost,
    elapsed_ms:  elapsed_ms || null,
    metadata:    metadata || null
  });
}

/** Log an OpenAI text completion (gpt-4o-mini etc.). */
export async function logOpenAIChatUsage({ prospect_id, model, usage, route, elapsed_ms, metadata }) {
  if (!model || !usage) return;
  const cost = computeOpenAIChatCost(model, usage);
  return writeRow({
    prospect_id: prospect_id || null,
    provider: 'openai',
    model,
    route: route || null,
    input_tokens:       Number(usage.prompt_tokens || usage.input_tokens || 0),
    output_tokens:      Number(usage.completion_tokens || usage.output_tokens || 0),
    cache_read_tokens:  0,
    cache_write_tokens: 0,
    audio_input_sec:  0,
    audio_output_sec: 0,
    cost_usd:    cost,
    elapsed_ms:  elapsed_ms || null,
    metadata:    metadata || null
  });
}

/**
 * Log an OpenAI Realtime voice session. duration_sec is the total wall-clock
 * call length. We split 60/40 input/output as an empirical default; pass
 * audio_in_sec/audio_out_sec explicitly if better data is available.
 */
export async function logOpenAIRealtimeUsage({ prospect_id, model, duration_sec, audio_in_sec, audio_out_sec, route, metadata }) {
  if (!model || !duration_sec) return;
  const inSec  = audio_in_sec  != null ? audio_in_sec  : duration_sec * 0.60;
  const outSec = audio_out_sec != null ? audio_out_sec : duration_sec * 0.40;
  const cost = estimateRealtimeCost(model, inSec, outSec);
  return writeRow({
    prospect_id: prospect_id || null,
    provider: 'openai',
    model,
    route: route || 'voice',
    input_tokens:       Math.round(inSec  * REALTIME_AUDIO_IN_TOKENS_PER_SEC),
    output_tokens:      Math.round(outSec * REALTIME_AUDIO_OUT_TOKENS_PER_SEC),
    cache_read_tokens:  0,
    cache_write_tokens: 0,
    audio_input_sec:  round2(inSec),
    audio_output_sec: round2(outSec),
    cost_usd:    cost,
    elapsed_ms:  Math.round(duration_sec * 1000),
    metadata:    metadata || null
  });
}

// ─── INTERNAL ────────────────────────────────────────────────────────────────

async function writeRow(row) {
  try {
    const { error } = await supabase.from('token_usage').insert(row);
    if (error) {
      // The table might not exist yet (pre-migration). Log once per process
      // to stdout so the dev sees it, but don't crash the parent request.
      if (!_warnedNoTable && /token_usage/.test(error.message || '')) {
        _warnedNoTable = true;
        console.warn('[usage] token_usage table missing — run supabase/migrations/0003_token_usage.sql to enable cost telemetry. (' + error.message + ')');
      } else if (!_warnedNoTable) {
        console.warn('[usage] insert failed:', error.message);
      }
    }
  } catch (e) {
    if (!_warnedNoTable) {
      _warnedNoTable = true;
      console.warn('[usage] insert threw:', e?.message || e);
    }
  }
}
let _warnedNoTable = false;

// Strip the date suffix ('claude-haiku-4-5-20251001' → 'claude-haiku-4-5')
// so older / newer SKUs still hit the price table.
function stripModelDate(model) {
  return String(model || '').replace(/-\d{8}$/, '');
}

function round6(n) { return Math.round(n * 1_000_000) / 1_000_000; }
function round2(n) { return Math.round(n * 100) / 100; }
