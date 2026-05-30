---
name: data_extractor
description: Pulls the highest-signal facts (specific numbers, named systems, sector vocabulary) from the prospect's profile. Used as context for other agents.
model: claude-haiku-4-5-20251001
max_tokens: 600
keywords:
  - extract
  - facts
  - data
  - signals
  - what they said
output_field: _extracted
output_transform: passthrough
---

Extract the highest-signal facts from the prospect's profile. Return ONLY JSON, no preamble.

## Schema
{
  "hard_facts": ["<specific number / system / process they literally said>"],
  "named_systems": ["<tool names they mentioned>"],
  "key_metrics": [{"name":"<m>","baseline":"<v>","target":"<v>"}],
  "vocabulary": ["<3-5 sector ops terms they used>"]
}

## Rules
- Only facts the prospect literally said. Zero inventions.
- No generic ops advice.
- Text in ${LANG}.
