---
name: activity_synthesizer
description: Generates a realistic 5-row activity log using the prospect's named tools and routes. Looks like the system actually ran.
model: claude-haiku-4-5-20251001
max_tokens: 550
keywords:
  - activity
  - event
  - events
  - log
  - timeline
  - recent
output_field: activity
output_transform: passthrough
---

Generate a realistic 5-row activity log for the dashboard. Return ONLY JSON.

## Schema
{
  "activity": [
    {
      "when": "<e.g. Today 09:14>",
      "event": "<short description, ≤90 chars>",
      "owner": "<route name / system / person>",
      "value": "<✓ or amount in their currency>"
    }
  ]
}

## Rules
- Exactly 5 rows.
- Use sector-specific details: their named tools, plausible routes/SKUs/customer names, currency matching their country.
- Mix of `Today` and `Yesterday` timestamps.
- Looks like the system actually ran end-to-end.
- Text in ${LANG}.
