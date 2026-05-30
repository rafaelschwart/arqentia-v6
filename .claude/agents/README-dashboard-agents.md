# Dashboard Agents

Each `.md` file in this folder is a specialist agent the admin chat orchestrator can dispatch. Edit any file to retune that agent's prompt, model, or routing keywords — the change is picked up on the next API request (loader caches at module load; restart `vercel dev` to reload).

## File format

```markdown
---
name: <unique slug>                       # required — referenced from JS
description: <one-line>                    # shown in admin UI + telemetry
model: claude-haiku-4-5-20251001          # which Claude model to call
                                          # options: claude-haiku-4-5-20251001 | claude-sonnet-4-6 | claude-opus-4-7
max_tokens: 800                            # output budget
keywords:                                  # orchestrator dispatches when admin prompt matches
  - kpi
  - kpis
  - metric
output_field: kpis                         # which top-level field of demo_payloads.payload this agent writes
output_transform: kpis_array               # how the orchestrator interprets the agent's output:
                                          #   single_value  → uses {output_field: value}
                                          #   nested        → spread agent output into output_field (object merge)
                                          #   kpis_array    → map agent's kpis → dashboard kpi shape
                                          #   passthrough   → use agent's keys directly at payload root
---

[system prompt body — supports ${LANG} placeholder which becomes "Spanish" or "English" at runtime]
```

## Model selection guidance

| Type of work | Recommended model |
|---|---|
| Structured extraction, simple lists, arithmetic | `claude-haiku-4-5-20251001` (fast, cheap) |
| Domain reasoning, judgment calls, good copy taste | `claude-sonnet-4-6` |
| Hardest reasoning, very nuanced strategic writing | `claude-opus-4-7` (use sparingly — slow + expensive) |

## The 12 agents

| # | File | Purpose |
|---|---|---|
| 1 | `data_extractor.md` | Pulls hard facts from Q0..Q10 |
| 2 | `process_optimizer.md` | Workflow improvement recs tied to their tools |
| 3 | `graph_expert.md` | Chart type + 12 data points + axis |
| 4 | `kpi_designer.md` | 6 KPIs (KPI 1 = Q8 verbatim) |
| 5 | `headline_writer.md` | Punchy sector-aware headline |
| 6 | `insights_generator.md` | 3 analyst-style observations |
| 7 | `activity_synthesizer.md` | 5 realistic event rows |
| 8 | `recommendations_generator.md` | 10 numbered recs sorted by impact × ease |
| 9 | `risk_analyzer.md` | 4-5 risks they should know |
| 10 | `roadmap_architect.md` | 12-week roadmap |
| 11 | `pricing_strategist.md` | Build / Maintenance / Build+Maint |
| 12 | `roi_calculator.md` | Annual savings + payback math |
