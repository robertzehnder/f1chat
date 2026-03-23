# Current F1 Analytics System Design Report

## 1. Current architecture overview

The repository is structured as a layered analytics system rather than a single prompt-to-SQL script.

1. Data ingestion and source warehousing (`raw`)
- Schemas and raw tables are defined in [001_create_schemas.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/001_create_schemas.sql:3), [002_create_tables.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/002_create_tables.sql:21), [002_create_tables.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/002_create_tables.sql:38), and [002_create_tables.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/002_create_tables.sql:57).
- CSV ingestion/upsert flow is in [ingest.py](/Users/robertzehnder/Documents/coding/f1/openf1/src/ingest.py:243), with run orchestration in [ingest.py](/Users/robertzehnder/Documents/coding/f1/openf1/src/ingest.py:311).
- Table mapping and load order live in [mappings.py](/Users/robertzehnder/Documents/coding/f1/openf1/src/mappings.py:41) and [mappings.py](/Users/robertzehnder/Documents/coding/f1/openf1/src/mappings.py:71).

2. Core/helper resolution layer (`core` lookup surfaces)
- Alias and lookup helper surfaces for session/driver resolution and completeness are in [005_helper_tables.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/005_helper_tables.sql:95), [005_helper_tables.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/005_helper_tables.sql:205), and [005_helper_tables.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/005_helper_tables.sql:321).

3. Semantic modeling layer (transformed lap and replay intermediates)
- Semantic objects are defined in [006_semantic_lap_layer.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/006_semantic_lap_layer.sql:4), [006_semantic_lap_layer.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/006_semantic_lap_layer.sql:50), [006_semantic_lap_layer.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/006_semantic_lap_layer.sql:119), [006_semantic_lap_layer.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/006_semantic_lap_layer.sql:173), [006_semantic_lap_layer.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/006_semantic_lap_layer.sql:272), [006_semantic_lap_layer.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/006_semantic_lap_layer.sql:446), and [006_semantic_lap_layer.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/006_semantic_lap_layer.sql:501).
- Contract documentation exists in [transformed_lap_schema.md](/Users/robertzehnder/Documents/coding/f1/openf1/docs/transformed_lap_schema.md:5).

4. Runtime orchestration and planning
- Chat runtime construction is centralized in [chatRuntime.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/chatRuntime.ts:863).

5. SQL generation layer
- Deterministic templates: [deterministicSql.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/deterministicSql.ts:30).
- LLM generation and SQL repair: [anthropic.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/anthropic.ts:139) and [anthropic.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/anthropic.ts:212).
- Heuristic fallback SQL: [queries.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/queries.ts:632).

6. SQL safety and execution
- Read-only SQL guard: [querySafety.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/querySafety.ts:8).
- Execution wrapper with timeout/row cap: [queries.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/queries.ts:594).

7. Synthesis layer
- Post-query answer synthesis via LLM: [anthropic.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/anthropic.ts:305).
- Endpoint orchestration for answer construction: [route.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/app/api/chat/route.ts:365).

8. Benchmark and grading layer
- Runtime adequacy grading: [chatQuality.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/chatQuality.ts:32).
- Rubric baseline grading: [chat-health-check-baseline.mjs](/Users/robertzehnder/Documents/coding/f1/openf1/web/scripts/chat-health-check-baseline.mjs:195).
- Benchmark runner integration: [chat-health-check.mjs](/Users/robertzehnder/Documents/coding/f1/openf1/web/scripts/chat-health-check.mjs:320).

9. Source-comparison and helper-influenced strategy layer
- OpenF1 vs FastF1 source audit output: [source_audit_report.md](/Users/robertzehnder/Documents/coding/f1/openf1/fastf1_audit/exports/audit_20260316T234249Z/source_audit_report.md:23).
- Helper adoption strategy and status: [helper_repo_analysis.md](/Users/robertzehnder/Documents/coding/f1/openf1/docs/helper_repo_analysis.md:9) and [helper_repo_adoption_status.md](/Users/robertzehnder/Documents/coding/f1/openf1/docs/helper_repo_adoption_status.md:164).

## 2. End-to-end runtime flow

The `/api/chat` execution pipeline is currently:

1. Request intake and runtime build
- Request arrives at [route.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/app/api/chat/route.ts:100).
- Runtime classification/resolution/completeness planning is built with [buildChatRuntime](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/chatRuntime.ts:863).

2. Clarification and completeness gates
- If resolution needs clarification, API returns a clarification response at [route.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/app/api/chat/route.ts:158).
- If required data is unavailable and fallback is disallowed, API returns blocked/unavailable at [route.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/app/api/chat/route.ts:195).

3. SQL generation routing
- Deterministic template attempt first at [route.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/app/api/chat/route.ts:257).
- Otherwise LLM SQL generation at [route.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/app/api/chat/route.ts:270).
- If LLM fails, heuristic fallback at [route.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/app/api/chat/route.ts:286).

4. SQL execution and repair
- Execute in preview mode at [route.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/app/api/chat/route.ts:301).
- If execution fails and source is LLM, attempt SQL repair at [route.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/app/api/chat/route.ts:313).

5. Answer synthesis
- If rows exist, synthesize natural language answer at [route.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/app/api/chat/route.ts:365).
- If synthesis fails, use fallback answer builder at [route.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/app/api/chat/route.ts:383).

6. Runtime quality scoring and logging
- Adequacy grade is computed via [assessChatQuality](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/chatQuality.ts:32) and attached/logged at [route.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/app/api/chat/route.ts:391).

## 3. Current strengths

1. Clear staged architecture with guardrails
- The system has explicit runtime stages (classification, resolution, completeness, planning) rather than opaque prompt behavior.

2. Strong read-only execution safety
- Unsafe/multi-statement SQL is blocked early by [querySafety.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/querySafety.ts:8).

3. Robust failure paths
- Deterministic -> LLM -> heuristic fallback chain and LLM repair path are implemented in [route.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/app/api/chat/route.ts:257).

4. Semantic contracts exist in warehouse
- The transformed-lap and replay intermediate contracts are already formalized in [006_semantic_lap_layer.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/006_semantic_lap_layer.sql:272) and [006_semantic_lap_layer.sql](/Users/robertzehnder/Documents/coding/f1/openf1/sql/006_semantic_lap_layer.sql:501).

5. Benchmark infrastructure matured
- The benchmark now runs dual scoring (adequacy + rubric baseline), and intense rubric catches architectural misses.
- Evidence of divergence: [chat_health_check_2026-03-17T00-24-31-350Z.md](/Users/robertzehnder/Documents/coding/f1/openf1/web/logs/chat_health_check_2026-03-17T00-24-31-350Z.md:11) and [chat_health_check_2026-03-17T00-24-31-350Z.md](/Users/robertzehnder/Documents/coding/f1/openf1/web/logs/chat_health_check_2026-03-17T00-24-31-350Z.md:13).

## 4. Weaknesses by subsystem

### Resolver weaknesses

1. Resolver/planner is still biased toward raw-table analytical defaults
- Required/recommended tables for aggregate/comparison/telemetry default to `raw.*` in [chatRuntime.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/chatRuntime.ts:668) and [chatRuntime.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/chatRuntime.ts:737).

2. Clarification policy still has avoidable misses on benchmark intents
- Intense run reports unnecessary clarification counts in [chat_health_check_2026-03-17T00-24-31-350Z.md](/Users/robertzehnder/Documents/coding/f1/openf1/web/logs/chat_health_check_2026-03-17T00-24-31-350Z.md:14).

### Semantic-layer weaknesses

1. Semantic models are implemented but under-consumed
- Semantic layer exists in SQL, but runtime planning/templates remain raw-centric.
- Deterministic templates are still mostly raw-lap based from [deterministicSql.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/deterministicSql.ts:99).

2. LLM system prompt omits semantic/replay core views
- Table allowlist in [anthropic.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/anthropic.ts:52) does not include `core.laps_enriched`, `core.lap_semantic_bridge`, or `core.replay_lap_frames`.

3. Missing second-wave derived summaries
- Planned objects such as `core.driver_session_summary`, `core.stint_summary`, `core.race_progression_summary` are documented but not formalized in main SQL yet, per [helper_repo_adoption_status.md](/Users/robertzehnder/Documents/coding/f1/openf1/docs/helper_repo_adoption_status.md:137).

### Synthesis weaknesses

1. Synthesis works from sampled rows and unconstrained prose
- Synthesis only sees row sample slices in [anthropic.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/anthropic.ts:315).
- There is no deterministic post-synthesis validator in route flow after [route.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/app/api/chat/route.ts:365).

2. This creates correctness risk on derived claims
- Especially in sector/strategy/progression narratives where arithmetic/consistency checks are needed.

### Grading weaknesses

1. Runtime adequacy grading is coarse
- `assessChatQuality` tends to award `B` on row-backed answers without deep factual consistency checks in [chatQuality.ts](/Users/robertzehnder/Documents/coding/f1/openf1/web/src/lib/chatQuality.ts:102).

2. Rubric grader is stronger but still check-centric
- Baseline scoring is largely check aggregation (`all_ideal_tables_used`, regex patterns, generic phrasing heuristics) in [chat-health-check-baseline.mjs](/Users/robertzehnder/Documents/coding/f1/openf1/web/scripts/chat-health-check-baseline.mjs:265).
- It does not yet fully separate semantic failure vs synthesis inconsistency vs data insufficiency in output labels.

## 5. Design risks

1. Architectural quality appears better in runtime than it is
- Adequacy remains high while intense baseline shows substantial misses, indicating observability mismatch.

2. Semantic contracts risk becoming “documentation-only assets”
- If planners/prompts/templates do not default to semantic objects, benchmark quality will plateau.

3. High coupling between SQL shape and prose correctness
- Without a structured fact-validation stage, synthesis can overstate/contradict otherwise decent query output.

4. Overfitting to rubric SQL patterns
- Pattern compliance can improve scores without equivalent gains in factual robustness.

5. Source-of-truth ambiguity in non-session themes
- Source audit remains tie-heavy for many themes (low confidence), so model-layer normalization is more urgent than source replacement.
- Evidence in [source_audit_report.md](/Users/robertzehnder/Documents/coding/f1/openf1/fastf1_audit/exports/audit_20260316T234249Z/source_audit_report.md:24).

Ambiguities to call out:
- It is ambiguous from current repository state alone whether all environments have complete 2023-2026 data parity; some behavior may still be data-sparsity-sensitive.
- It is also ambiguous how often fallback/repair paths trigger in production traffic versus benchmark runs.

## 6. Recommended next design priorities

1. Enforce semantic-first query planning and generation
- Update runtime required/recommended tables and deterministic templates to target semantic core views by default for pace/strategy/progression families.

2. Expand the semantic summary layer
- Add `core.driver_session_summary`, `core.stint_summary`, `core.strategy_summary`, `core.grid_vs_finish`, `core.race_progression_summary`, and phase/telemetry bridges.

3. Tighten synthesis reliability
- Insert a structured fact-contract and deterministic validation layer between SQL output and final prose.

4. Refine resolver behavior on answerable-without-clarification cases
- Reduce unnecessary clarifications for known benchmark intent patterns.

5. Upgrade grading to multi-axis diagnostics
- Split scores into answerability, semantic-contract adherence, factual consistency, synthesis consistency, and data sufficiency.

6. Keep OpenF1 as primary source, use FastF1 primarily for calibration/audit
- This aligns with current source-audit signal where session resolution favors OpenF1 and most other themes remain low-confidence ties.
