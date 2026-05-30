-- Add summary_language column to profile_summaries · 2026-05-29
-- The admin language toggle (EN/ES) can now regenerate the AI summary in
-- the chosen language. This column records which language the cached
-- summary_text is in so the admin UI can detect drift the next time the
-- prospect is opened.

ALTER TABLE profile_summaries
  ADD COLUMN IF NOT EXISTS summary_language text;

-- Backfill: if a prospect has a recorded language, assume their cached
-- summary was generated in it. New regens always stamp explicitly.
UPDATE profile_summaries ps
SET    summary_language = p.language
FROM   prospects p
WHERE  ps.prospect_id = p.id
  AND  ps.summary_language IS NULL
  AND  p.language IS NOT NULL;
