# Prompt 5 Diagnostic: Architectural Question Families and Readiness

## 1) Question family map

This family map is based on `openf1/web/scripts/chat-health-check.questions.json` and evaluated primarily against the intense benchmark run at `openf1/web/logs/chat_health_check_2026-03-17T00-24-31-350Z.json`.

| Family | Question IDs | Primary benchmark intent |
|---|---|---|
| Session discovery | 1-10 | Session resolution, metadata completeness, warehouse coverage |
| Driver roster / participation | 11-18 | Session roster, participation coverage, driver-team mappings |
| Fastest-lap / lap pace | 19, 20, 21, 22, 24, 25, 26, 27, 28 | Fastest laps, clean-lap pace, session-level pace/degradation |
| Sector comparison | 23, 30, 33 | Sector bests/averages and sector loss attribution |
| Head-to-head pace | 29, 31, 32, 34, 37 | Direct driver-vs-driver pace/consistency comparisons |
| Pit strategy / stints | 38-48 | Pit counts, pit laps, compounds, stint lengths, pit-cycle effects |
| Telemetry comparison | 35, 36 | Top speed and braking/speed-carry telemetry judgments |
| Race progression | 49 | Running-order change across race timeline |
| Result / positions gained | 50 | Grid-to-finish delta and positions gained |

## 2) Readiness by family

### Readiness snapshot (intense rubric)

| Family | Intense baseline A/B/C | Readiness | Resolver dependency | Semantic-layer dependency | Synthesis dependency | Dependency on missing derived views |
|---|---:|---|---|---|---|---|
| Session discovery | 5 / 2 / 3 | Moderate | High | Medium | Medium | Medium (`core.session_completeness` usage + stronger coverage summaries) |
| Driver roster / participation | 7 / 1 / 0 | Strong | Medium | Low | Low-Medium | Low (`core.driver_session_summary` would help scale) |
| Fastest-lap / lap pace | 2 / 0 / 7 | Fragile | Medium | Very High | Medium | Very High (`core.laps_enriched`, `core.lap_phase_summary`) |
| Sector comparison | 0 / 0 / 3 | Fragile | Low | Very High | High | High (`core.laps_enriched` contract use) |
| Head-to-head pace | 0 / 0 / 5 | Fragile | Low-Medium | Very High | High | High (`core.laps_enriched`, `core.stint_summary`) |
| Pit strategy / stints | 5 / 0 / 6 | Fragile-Moderate | Low-Medium | High | High | Very High (`core.stint_summary`, `core.race_progression_summary`) |
| Telemetry comparison | 1 / 0 / 1 | Fragile-Moderate | Low | High | Medium | High (`core.telemetry_lap_bridge`) |
| Race progression | 0 / 0 / 1 | Fragile | Low | Very High | Medium-High | Very High (`core.race_progression_summary`, `core.replay_lap_frames` adoption) |
| Result / positions gained | 1 / 0 / 0 | Strong (narrow) | Low | Medium | Low | Medium (`core.grid_vs_finish` for generalization) |

### Structural strength vs fragility

Structurally strong now:
- Driver roster / participation
- Result / positions gained (for the specific current pattern)

Structurally moderate:
- Session discovery
- Telemetry comparison (split quality)

Structurally fragile:
- Fastest-lap / lap pace
- Sector comparison
- Head-to-head pace
- Pit strategy / stints (advanced strategy questions)
- Race progression

### Evidence notes

1. Intense run family outcomes come from `openf1/web/logs/chat_health_check_2026-03-17T00-24-31-350Z.json`.
2. Main `C` reasons are dominated by semantic-contract misses (`all_ideal_tables_used`, `required_sql_patterns`) defined in `openf1/web/scripts/chat-health-check.rubric.intense.json` and enforced by `openf1/web/scripts/chat-health-check-baseline.mjs`.
3. Previous baseline run (`openf1/web/logs/chat_health_check_2026-03-16T13-53-15-369Z.json`) was much stronger, which confirms the intense rubric is measuring architectural readiness, not just superficial answer adequacy.

## 3) Root causes by family

### Session discovery (1-10)

Current strengths:
- Canonical ID/session lookup and straightforward metadata retrieval are stable (Q1-Q4, Q10).

Current weaknesses:
- Coverage-completeness query remains generic/metadata-like (Q6).
- Unnecessary clarification remains on questions expected to be directly answerable (Q8, Q9).

Primary root causes:
- Resolver policy still over-clarifies in some metadata intents.
- Coverage logic is not consistently anchored to semantic completeness objects.

### Driver roster / participation (11-18)

Current strengths:
- Session roster and participation queries are generally robust.
- Good handling of driver/team participation and counts.

Current weaknesses:
- One lingering generic/incomplete mapping response (Q14).

Primary root causes:
- Mostly synthesis specificity, not core resolver/semantic failure.

### Fastest-lap / lap pace (19, 20, 21, 22, 24, 25, 26, 27, 28)

Current strengths:
- Basic fastest-lap retrieval is reliable (Q19, Q20).

Current weaknesses:
- Most derived pace questions fail intense checks due to semantic-contract non-adoption.
- One avoidable clarification in qualifying improvement intent (Q25).

Primary root causes:
- Runtime and SQL generation still rely on raw-table improvisation where semantic objects should be default.
- Missing formal phase/clean-lap semantic summaries in execution path.

### Sector comparison (23, 30, 33)

Current strengths:
- SQL often gets directionally useful sector data.

Current weaknesses:
- Family is fully `C` under intense rubric.
- Synthesis can produce internally inconsistent sector claims in narrative output.

Primary root causes:
- Semantic table contract not enforced.
- Missing synthesis guardrails for comparative sign consistency.

### Head-to-head pace (29, 31, 32, 34, 37)

Current strengths:
- Directional comparison narratives are often plausible.

Current weaknesses:
- Entire family fails intense rubric.
- Derived comparisons are recomputed ad hoc each time, causing inconsistent logic and fragility.

Primary root causes:
- No enforced use of `core.laps_enriched` and no canonical head-to-head derived layer.
- Synthesis lacks deterministic post-query validation.

### Pit strategy / stints (38-48)

Current strengths:
- Basic pit count/lap/time questions are structurally solid (Q38-Q41, Q44).

Current weaknesses:
- Advanced strategy/stint interpretation remains fragile (Q42, Q43, Q45-Q48).

Primary root causes:
- Missing summary views for stint/strategy semantics.
- Pit-cycle progression and undercut/overcut logic are not backed by canonical progression objects.
- Synthesis over-assertion risk when positional evidence is partial.

### Telemetry comparison (35, 36)

Current strengths:
- Braking/speed-carry comparison can succeed when telemetry windowing is explicit (Q36).

Current weaknesses:
- Top-speed comparison still fails intense semantic expectations (Q35).

Primary root causes:
- Telemetry-lap linkage is not formalized as a reusable semantic object.
- Telemetry analyses still rely on bespoke raw-table windowing.

### Race progression (49)

Current strengths:
- Some directional narrative is possible from raw position history.

Current weaknesses:
- Family remains `C` under intense rubric.

Primary root causes:
- No canonical progression summary contract used by runtime.
- Replay/progression semantic objects exist but are not yet first-class query targets.

### Result / positions gained (50)

Current strengths:
- Current pattern is strong and deterministic for this benchmark.

Current weaknesses:
- Narrow success; not yet generalized into broader result-classification contract.

Primary root causes:
- Template-centric success without broader semantic abstraction.

## 4) Highest-leverage fixes by family

### Session discovery

1. Add resolver guardrails so generic “given session” prompts do not trigger unnecessary clarification when canonical session inference is possible.
2. Force Q6-like coverage questions onto `core.session_completeness` and explicit downstream completeness scoring.

### Driver roster / participation

1. Add `core.driver_session_summary` to reduce repeated ad hoc aggregation and improve consistency on mapping/count questions.
2. Add list/count parity checks in synthesis to avoid generic under-scoped outputs.

### Fastest-lap / lap pace

1. Make `core.laps_enriched` the default contract for clean-lap, representative pace, and degradation families.
2. Add `core.lap_phase_summary` for “final third / phase” questions.
3. Add fallback-to-semantic-template routing before raw SQL improvisation.

### Sector comparison

1. Enforce semantic-layer table use for all sector-family prompts.
2. Add synthesis validator checks for comparative consistency (best/avg claims must match computed values).

### Head-to-head pace

1. Build reusable head-to-head derived summaries from `core.laps_enriched` and `core.stint_summary`.
2. Add deterministic contracts for common metrics: best lap, avg clean lap, consistency, common-window pace.

### Pit strategy / stints

1. Implement `core.stint_summary` and `core.strategy_summary` (or equivalent) so stint/pit logic is canonical.
2. Build `core.race_progression_summary` hooks for pit-cycle position delta and undercut/overcut evidence.
3. Add synthesis guards for stop-count derivation and null-sensitive position claims.

### Telemetry comparison

1. Implement `core.telemetry_lap_bridge` for reusable lap-window telemetry alignment.
2. Route telemetry questions through bridge-backed patterns before bespoke raw-car-data windows.

### Race progression

1. Promote `core.replay_lap_frames` and a dedicated `core.race_progression_summary` into runtime planning defaults.
2. Add deterministic progression templates for running-order narrative extraction.

### Result / positions gained

1. Formalize `core.grid_vs_finish` to make current deterministic success portable to broader result families.
2. Add fallback hierarchy for missing grid/result records with explicit confidence labels.

---

## Bottom line

The benchmark is now clearly separating families that are already structurally solid from those that remain architecture-fragile.

- Strong now: driver roster and narrow result classification.
- Fragile now: pace, sector, head-to-head, advanced pit/strategy, race progression.

The highest-leverage next wave is family-targeted semantic adoption: make semantic objects first-class query contracts per family, then add synthesis validation so correct SQL cannot be degraded by inconsistent narration.
