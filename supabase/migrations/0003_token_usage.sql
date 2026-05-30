-- API token-usage telemetry · 2026-05-28
-- One row per outbound LLM/Realtime call. Tracks who, what, how many tokens,
-- and the computed USD cost so the admin panel can show Claude + OpenAI spend
-- per day and per prospect without re-running pricing math on every read.
--
-- Costs are computed at INSERT time using the pricing constants in
-- api/_lib/usage.js so that price changes don't retroactively rewrite history.

CREATE TABLE IF NOT EXISTS token_usage (
  id                  bigserial PRIMARY KEY,
  prospect_id         uuid REFERENCES prospects(id) ON DELETE SET NULL,
  provider            text NOT NULL,                              -- 'anthropic' | 'openai'
  model               text NOT NULL,                              -- e.g. 'claude-sonnet-4-6', 'gpt-realtime'
  route               text,                                       -- 'dashboard-edit' | 'generate-demo' | 'voice' | 'explain-metric' | etc.
  input_tokens        integer NOT NULL DEFAULT 0,
  output_tokens       integer NOT NULL DEFAULT 0,
  cache_read_tokens   integer NOT NULL DEFAULT 0,                 -- Anthropic prompt-caching reads (cheaper)
  cache_write_tokens  integer NOT NULL DEFAULT 0,                 -- Anthropic prompt-caching writes (~25% premium)
  audio_input_sec     numeric(10,2) NOT NULL DEFAULT 0,           -- Realtime audio input seconds
  audio_output_sec    numeric(10,2) NOT NULL DEFAULT 0,           -- Realtime audio output seconds
  cost_usd            numeric(12,6) NOT NULL DEFAULT 0,           -- Computed at insert
  elapsed_ms          integer,                                    -- Wall-clock latency of the call
  metadata            jsonb,                                      -- Anything else worth storing
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS token_usage_created_at_idx     ON token_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS token_usage_prospect_id_idx    ON token_usage(prospect_id) WHERE prospect_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS token_usage_provider_idx       ON token_usage(provider, created_at DESC);
CREATE INDEX IF NOT EXISTS token_usage_day_idx            ON token_usage(date_trunc('day', created_at AT TIME ZONE 'UTC'));
