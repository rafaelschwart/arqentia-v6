-- Discovery demo payloads · v1 · 2026-05-24
-- One row per prospect storing the Claude-generated, prospect-specific
-- demo dashboard data (KPIs, chart, insights, activity, capability rec).

CREATE TABLE demo_payloads (
  prospect_id        uuid PRIMARY KEY REFERENCES prospects(id) ON DELETE CASCADE,
  payload            jsonb NOT NULL,
  generated_at       timestamptz NOT NULL DEFAULT now(),
  generated_by       text NOT NULL,            -- model id e.g. 'claude-haiku-4-5-20251001'
  edited             boolean NOT NULL DEFAULT false,
  edited_at          timestamptz,
  edit_count         int NOT NULL DEFAULT 0
);

CREATE INDEX demo_payloads_generated_at_idx ON demo_payloads(generated_at DESC);
