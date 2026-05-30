-- Discovery tab schema · v1 · 2026-05-23
-- Spec: docs/superpowers/specs/2026-05-22-discovery-tab-design.md §6

-- 1. prospects ─ one row per lead
CREATE TABLE prospects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text UNIQUE,
  name            text,
  company         text,
  role            text,
  phone           text,
  country         text,
  language        text NOT NULL DEFAULT 'en',
  sector_id       text,
  magic_token     text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  password_hash   text,
  status          text NOT NULL DEFAULT 'started',
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  calendly_url    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_active_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX prospects_status_idx     ON prospects(status);
CREATE INDEX prospects_sector_idx     ON prospects(sector_id);
CREATE INDEX prospects_created_at_idx ON prospects(created_at DESC);

-- 2. profile_answers ─ one row per Q answered (Q1..Q10 + adaptive follow-ups)
CREATE TABLE profile_answers (
  id            bigserial PRIMARY KEY,
  prospect_id   uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  question_id   text NOT NULL,
  value_text    text,
  value_json    jsonb,
  asked_at      timestamptz NOT NULL DEFAULT now(),
  answered_at   timestamptz,
  UNIQUE (prospect_id, question_id)
);

-- 3. profile_summaries ─ AI-generated narrative + classification
CREATE TABLE profile_summaries (
  prospect_id            uuid PRIMARY KEY REFERENCES prospects(id) ON DELETE CASCADE,
  summary_text           text NOT NULL,
  sector_classification  text NOT NULL,
  est_hours_saved        int,
  est_payback_months     int,
  suggested_capability   text,
  generated_at           timestamptz NOT NULL DEFAULT now(),
  generated_by           text NOT NULL
);

-- 4. events ─ audit log + analytics
CREATE TABLE events (
  id           bigserial PRIMARY KEY,
  prospect_id  uuid REFERENCES prospects(id) ON DELETE CASCADE,
  type         text NOT NULL,
  payload      jsonb,
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_type_idx        ON events(type);
CREATE INDEX events_prospect_id_idx ON events(prospect_id);
CREATE INDEX events_created_at_idx  ON events(created_at DESC);

-- 5. notifications ─ Rafael's notification delivery log
CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id  uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  channel      text NOT NULL,
  status       text NOT NULL DEFAULT 'pending',
  sent_at      timestamptz,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
