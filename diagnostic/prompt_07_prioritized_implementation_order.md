# Prompt 7 Diagnostic: Prioritized Implementation Order

Scope assumptions used for prioritization:
- OpenF1 remains the primary warehouse source.
- FastF1/helper-repo logic is applied as semantic modeling guidance, not ingestion replacement.
- Priority is weighted by expected improvement on the intense 50-question benchmark.

## 1) Top priorities table

| Pri | Implementation move | Track | Subsystem | Problem solved | Benchmark questions improved | Complexity | Expected payoff | Dependency order |
|---:|---|---|---|---|---|---|---|---|
| 1 | Make semantic core views the default planning targets (`core.laps_enriched`, `core.lap_semantic_bridge`, `core.replay_lap_frames`) | Semantic-layer | Runtime planning + deterministic SQL | Fixes dominant `all_ideal_tables_used` failures (23 occurrences) by moving analysis off raw-table improvisation | 21-35, 37, 42-49 | Medium | Very High | Foundation for most other items |
| 2 | Update deterministic templates and LLM SQL table surface to explicitly include semantic/replay core objects | Semantic-layer | `deterministicSql.ts`, `anthropic.ts`, `chatRuntime.ts` | Prevents planner/generator from “forgetting” new semantic contracts | 21-35, 37, 42-49 | Medium | Very High | After/with #1 |
| 3 | Implement `core.stint_summary` + `core.strategy_summary` | Semantic-layer | Warehouse derived views | Canonicalizes pit/stint interpretation and removes repeated ad hoc stint math | 31, 32, 42-48 | Medium-High | High | After #1/#2 |
| 4 | Implement `core.race_progression_summary` + `core.grid_vs_finish` | Semantic-layer | Warehouse derived views | Stabilizes progression, pit-cycle position deltas, and result classification semantics | 45, 46, 49, 50 | Medium-High | High | After #1/#2 |
| 5 | Add `core.lap_phase_summary` + `core.telemetry_lap_bridge` | Semantic-layer | Warehouse derived views | Formalizes final-third/phase logic and telemetry-to-lap alignment | 28, 35, 36, 37, 49 | High | Medium-High | After #1/#2 |
| 6 | Upgrade lap hygiene policy to `valid_lap_policy` v2 (track-flag handling + richer invalid taxonomy) | Semantic-layer | Policy + transformed lap contract | Reduces semantic drift in clean-lap/pace metrics and makes validity explainable | 21-24, 27, 29, 30, 33, 34 | Medium | High | After #1 (can run parallel with #3/#4) |
| 7 | Add structured fact-contract layer before narration (typed answer payload per family) | Synthesis-layer | API answer pipeline | Prevents narrative drift and inconsistent comparative claims | 23, 30, 31, 33, 42, 45, 46, 49 | Medium | High | Needs stable semantic outputs (#1-#4) |
| 8 | Add synthesis validators (numeric consistency, stints->stops rule, null-sensitive claim guards, count/list parity) | Synthesis-layer | Post-query validation | Catches “plausible but wrong” narration when SQL is directionally right | 23, 30, 42, 45, 46, 49 and similar | Medium | High | After #7 |
| 9 | Redesign grader to multi-axis scoring + root-cause labels (resolver/semantic/synthesis/data) | Benchmark/grader | `chat-health-check-baseline` + report schema | Converts grades into actionable diagnostics for development steering | All (especially 21-49) | Medium | High (decision quality) | Can start in parallel; best after #1-#2 to calibrate |
| 10 | Tighten resolver disambiguation policy for “answerable without clarification” intents | Resolver | Resolution logic + ambiguity policy | Fixes unnecessary clarifications on benchmark prompts expected to auto-resolve | 8, 9, 25 (and related session-bound prompts) | Low-Medium | Medium | Independent; do early |

## 2) Wave 1

Objective: remove the biggest benchmark blockers fast by enforcing semantic contracts in query generation.

### Semantic-layer tasks
1. #1 Semantic core views as default planning targets.
2. #2 Template + LLM prompt table-surface alignment.
3. #6 Valid-lap policy v2 upgrade (start here so downstream summaries inherit stable hygiene logic).

### Resolver tasks
4. #10 Resolver disambiguation tightening for expected-answerable prompts.

### Why this wave first
- Current intense failures are dominated by semantic non-adoption (`all_ideal_tables_used`, `required_sql_patterns`).
- These changes directly attack the highest-frequency failure modes and unlock most downstream gains.

### Expected benchmark impact
- Largest lift in lap/sector/head-to-head/pit/progression families (IDs 21-49).
- Clarification misses reduce on 8/9/25.

## 3) Wave 2

Objective: formalize missing derived models for strategy/progression/telemetry and improve synthesis correctness.

### Semantic-layer tasks
1. #3 Build `core.stint_summary` + `core.strategy_summary`.
2. #4 Build `core.race_progression_summary` + `core.grid_vs_finish`.
3. #5 Build `core.lap_phase_summary` + `core.telemetry_lap_bridge`.

### Synthesis-layer tasks
4. #7 Structured fact-contract stage before natural-language output.
5. #8 Deterministic synthesis validators.

### Why this wave second
- Once semantic defaults are active (Wave 1), these objects reduce repeated complex SQL and make advanced families deterministic.
- Synthesis work becomes much more reliable when fed stable canonical derived outputs.

### Expected benchmark impact
- Major stability gains for 31-49 (advanced strategy/progression families).
- Better consistency and fewer contradictory summaries in sector/head-to-head answers.

## 4) Wave 3

Objective: improve development steering and guard against regressions.

### Benchmark/grader tasks
1. #9 Multi-axis grading redesign with root-cause labels.

### Optional hardening follow-ups
2. Extend rubric validators to consume executable intent fields (not only SQL pattern checks).
3. Add family-level release gates and trend dashboards by root-cause class.

### Why this wave third
- Grader redesign is most useful after architectural fixes begin landing, so it can measure meaningful progress and prevent backsliding.

### Expected benchmark impact
- Better prioritization accuracy and shorter debug loops; fewer false positives from single-letter grading.

## 5) Risks / sequencing notes

1. Risk: doing synthesis fixes before semantic defaults
- If done too early, validators will fight unstable raw-query outputs and create noise.
- Mitigation: keep #7/#8 in Wave 2 after #1/#2.

2. Risk: building many derived views without runtime adoption
- Warehouse objects alone do not improve benchmark quality if planners/templates still target raw tables.
- Mitigation: treat #1/#2 as non-negotiable gate before heavy model expansion.

3. Risk: overfitting to SQL pattern checks only
- Can improve rubric compliance without improving factual correctness.
- Mitigation: include synthesis consistency validators and multi-axis grading (#8/#9).

4. Risk: resolver changes regress currently-strong families
- Aggressive disambiguation changes can cause false auto-resolution.
- Mitigation: make resolver updates narrow and benchmark-backed (focus 8/9/25 first).

5. Risk: scope expansion into replay product UI too early
- Current priority is benchmark quality and semantic correctness.
- Mitigation: keep replay work at intermediate model/API contract level for now; defer UI expansion.

---

## Practical execution order (compact)

1. Wave 1: #1, #2, #6, #10
2. Wave 2: #3, #4, #5, #7, #8
3. Wave 3: #9 (+ optional grading refinements)

This sequence maximizes near-term benchmark gains while preserving OpenF1 as the core source of truth and using helper/FastF1 logic where it matters most: semantic modeling and contract quality.
