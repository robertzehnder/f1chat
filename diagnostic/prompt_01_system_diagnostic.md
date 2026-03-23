# Prompt 1 Diagnostic: OpenF1 Analytics System

## 1) System overview

This repository is operating as a multi-layer analytics system with 8 major subsystems:

1. Data ingestion and warehousing (`raw` + `core`)
- Ingestion CLI + mapping/ordering logic: `src/ingest.py`, `src/mappings.py`, `src/db.py`
- Raw schema and constraints: `sql/001_create_schemas.sql`, `sql/002_create_tables.sql`, `sql/003_indexes.sql`, `sql/004_constraints.sql`
- Helper lookup and resolver views: `sql/005_helper_tables.sql`
- Semantic/replay modeling layer: `sql/006_semantic_lap_layer.sql`

2. Resolver and runtime orchestration
- End-to-end runtime stages (intake -> resolution -> completeness -> plan): `web/src/lib/chatRuntime.ts` (`buildChatRuntime` at line ~863)

3. SQL generation
- Deterministic template router: `web/src/lib/deterministicSql.ts`
- LLM SQL generation and SQL repair: `web/src/lib/anthropic.ts`
- Heuristic SQL fallback: `web/src/lib/queries.ts` (`buildHeuristicSql` at line ~632)

4. SQL safety and execution
- Read-only guardrails: `web/src/lib/querySafety.ts`
- Query execution wrapper + limits/timeouts: `web/src/lib/queries.ts` (`runReadOnlySql` at line ~594)

5. Answer synthesis
- LLM answer synthesis from returned rows: `web/src/lib/anthropic.ts` (`synthesizeAnswerWithAnthropic`)
- Generic fallback summarizer: `web/src/app/api/chat/route.ts`

6. API orchestration
- Main chat API route and retry/repair flow: `web/src/app/api/chat/route.ts`

7. Benchmark and grading pipeline
- Runner: `web/scripts/chat-health-check.mjs`
- Regrader: `web/scripts/chat-health-check-grade.mjs`
- Rubrics: `web/scripts/chat-health-check.rubric.json`, `web/scripts/chat-health-check.rubric.intense.json`
- Rubric evaluator: `web/scripts/chat-health-check-baseline.mjs`

8. Source-comparison audit subsystem
- FastF1 extraction + comparison: `fastf1_audit/src/*`
- Latest exported report set: `fastf1_audit/exports/audit_20260316T234249Z/*`

## 2) Current strengths

1. Clear staged runtime exists (not pure prompt-to-SQL)
- Evidence: `web/src/lib/chatRuntime.ts` has explicit stage logs and structured outputs for resolution, completeness, grain, and query planning.

2. Alias-aware resolver surfaces are implemented in SQL
- Evidence: `core.session_search_lookup`, `core.driver_identity_lookup`, `core.session_completeness` are created in `sql/005_helper_tables.sql` (lines ~95, ~205, ~321) and called by `web/src/lib/queries.ts` (lines ~369, ~431, ~537, ~556).

3. Semantic lap/replay contracts now exist in warehouse
- Evidence: `core.lap_semantic_bridge`, `core.laps_enriched`, `core.replay_lap_frames` in `sql/006_semantic_lap_layer.sql` (lines ~173, ~272, ~501), plus policy and registry tables (`core.valid_lap_policy`, `core.metric_registry`, `core.replay_contract_registry`).

4. Stronger benchmark infrastructure now exists
- Evidence: intense rubric features (`required_sql_patterns`, `critical_checks`, `minimum_score_ratio`) in `web/scripts/chat-health-check-baseline.mjs` and `web/scripts/chat-health-check.rubric.intense.json`.

5. Safety baseline is in place for query execution
- Evidence: read-only statement enforcement and single-statement checks in `web/src/lib/querySafety.ts`; timeout/row-limit wrapping in `web/src/lib/queries.ts`.

## 3) Current weakness areas

### A. Resolver weaknesses

What exists:
- Heuristic scoring resolver with alias lookup + confidence, plus candidate coverage re-ranking.
- Evidence: `classifyQuestion` (~386), `requiresResolvedSession` (~488), candidate scoring and ambiguity logic in `web/src/lib/chatRuntime.ts`.

What is missing:
- Strong disambiguation policy by benchmark family (e.g., explicit canonical session resolver by venue/year/session type before analytics).
- Deterministic handling for ambiguous but answerable benchmark prompts (several still go to clarification or low-confidence routing).

Severity:
- High.

Affected families:
- Session resolution, driver/session coverage, and any derived analytics family that depends on stable session pinning.

### B. Semantic-layer weaknesses

What exists:
- Semantic views/tables are present (`core.laps_enriched`, `core.lap_semantic_bridge`, `core.replay_lap_frames`).

What is missing:
- Runtime/table-selection logic still defaults analytics to `raw.*` tables.
- Evidence: `requiredTablesForQuestion` and `grainForQuestion` in `web/src/lib/chatRuntime.ts` (lines ~668 and ~729+) mostly return `raw.laps/raw.stints/raw.car_data` and do not prioritize new `core.*` semantic objects.
- LLM SQL prompt does not advertise semantic/replay tables.
- Evidence: `web/src/lib/anthropic.ts` system prompt table list includes `core.sessions/core.session_drivers/...` + `raw.*`, but excludes `core.laps_enriched`, `core.lap_semantic_bridge`, `core.replay_lap_frames`.

Severity:
- Critical.

Affected families:
- Lap pace, clean-lap logic, sector analysis, pit/strategy, race progression, and benchmark questions now graded by intense semantic constraints.

### C. Answer synthesis weaknesses

What exists:
- Synthesizer summarizes rows; fallback emits generic row summaries.

What is missing:
- Synthesis has no strong numerical cross-check layer for internally inconsistent phrasing.
- Fallback answer quality is often generic and caveat-heavy when SQL is under-scoped.

Severity:
- Medium-High.

Affected families:
- Comparison and strategy answers where rows are incomplete or SQL is not semantically aligned.

### D. Grading weaknesses

What exists:
- In-app quality grading (`chatQuality`) and benchmark rubric grading (`chat-health-check-baseline`).

What is missing:
- In-app grader is coarse and optimistic: any row-backed answer often gets `B`.
- Evidence: `web/src/lib/chatQuality.ts` returns `B` for row-backed answers without semantic checks; no `A` path implemented.
- This can mask quality regressions in day-to-day API responses compared to rubric regrade.

Severity:
- High for observability; Medium for runtime correctness.

Affected families:
- All benchmark families (especially where response text sounds plausible but uses weak SQL).

### E. Source-data-model weaknesses

What exists:
- Comprehensive raw schema and ingestion path.

What is missing / problematic:
- Known sparse/null domains still impact correctness and confidence.
- Evidence from context docs and benchmark logs:
  - `meeting_name` sparsity (not reliably usable for venue resolution)
  - empty or sparse result/grid-related tables in prior snapshots
  - placeholder/future sessions with low downstream completeness
- Evidence: `docs/llm_database_context_extended.md`, benchmark logs under `web/logs/*`.

Severity:
- Medium-High (because it cascades into resolver and query-template behavior).

Affected families:
- Session naming/resolution, starting grid, finishing classification, race progression.

## 4) Root-cause analysis by subsystem

1. Intake/classification
- Root cause: keyword heuristics are too broad and can misclassify nuanced benchmark prompts.
- Evidence: `classifyQuestion` in `web/src/lib/chatRuntime.ts`.

2. Session/driver resolver
- Root cause: confidence scoring is heuristic and not tightly tied to benchmark-required disambiguation contracts.
- Evidence: candidate scoring + `needsClarification` logic in `web/src/lib/chatRuntime.ts`.

3. Completeness manager
- Root cause: completeness checks are table-presence oriented, but they do not enforce semantic-contract preference.
- Evidence: required table derivation (`requiredTablesForQuestion`) and per-session counts (`getSessionTableCounts`).

4. Query planner
- Root cause: planner emits generic table/filter plans and does not enforce semantic-lap contract for applicable families.
- Evidence: `buildQueryPlan` in `web/src/lib/chatRuntime.ts`.

5. SQL generator layer
- Root cause A: deterministic templates are still mostly raw-table logic.
- Root cause B: anthropic system prompt table allowlist does not include semantic/replay core views.
- Root cause C: heuristic fallback is raw/metadata-oriented and often generic.
- Evidence: `web/src/lib/deterministicSql.ts`, `web/src/lib/anthropic.ts`, `web/src/lib/queries.ts`.

6. Answer synthesis layer
- Root cause: synthesis is row-conditioned but not contract-conditioned; if SQL is weak, answer quality is weak.
- Evidence: `synthesizeAnswerWithAnthropic` usage in `web/src/app/api/chat/route.ts`.

7. Grading/evaluation layer
- Root cause: mismatch between runtime quality grader (coarse) vs benchmark rubric (strict semantic checks).
- Evidence: `web/src/lib/chatQuality.ts` vs `web/scripts/chat-health-check-baseline.mjs` + intense rubric.

8. Data foundation layer
- Root cause: partial placeholder sessions and sparsity in some domains still create unavoidable uncertainty.
- Evidence: `core.session_completeness` design in `sql/005_helper_tables.sql`, benchmark logs and context docs.

## 5) Benchmark impact analysis

Current signal from latest intense run:
- `web/logs/chat_health_check_2026-03-17T00-24-31-350Z.md` reports:
  - Adequacy grades: `B=50`
  - Baseline intense grades: `A=21, B=3, C=26`

Interpretation:
- Runtime answers remain "adequate" by coarse local grading.
- Intense baseline catches architectural misses: many `C` due missing semantic-table usage and required SQL patterns.
- Evidence lines in the same log repeatedly show gaps like `all_ideal_tables_used` and `required_sql_patterns`.

Family-level impacts:
- Most impacted: lap pace/sector/strategy/progression families (questions requiring semantic contract usage).
- Moderate impact: session/driver families where resolver confidence and ambiguity handling still vary.
- Lower impact: deterministic canonical lookups (e.g., fixed Abu Dhabi 2025 canonical ID case).

Cross-source context:
- FastF1/OpenF1 audit is still mostly tie-heavy in many themes and low-confidence for several use-case recommendations.
- Evidence: `fastf1_audit/exports/audit_20260316T234249Z/source_audit_report.md` (theme summary and recommendation confidence).

## 6) Recommended next design moves

1. Make semantic-layer selection first-class in runtime planning
- Update `requiredTablesForQuestion` and `grainForQuestion` to prefer `core.laps_enriched`, `core.lap_semantic_bridge`, `core.replay_lap_frames` for relevant benchmark families.

2. Update anthropic SQL system prompt table surface
- Include semantic/replay `core.*` relations explicitly; otherwise LLM cannot consistently target new contracts.

3. Align deterministic templates with semantic contracts
- Migrate high-volume benchmark families (clean-lap pace, strategy, progression) to semantic tables first.

4. Add contract-aware SQL validation checks pre-execution
- If question family implies semantic contract, fail or downgrade plans that bypass required semantic tables.

5. Tighten resolver policy for benchmark-grade disambiguation
- Add explicit resolver path for (venue, year, session_type) canonicalization before analytics SQL.

6. Unify runtime quality scoring with baseline rubric signals
- Surface rubric-like checks (table usage, required patterns, anti-generic signals) in runtime logs to reduce false confidence.

7. Build next semantic summaries as planned
- Add summary views from helper adoption roadmap (`driver_session_summary`, `stint_summary`, `strategy_summary`, `grid_vs_finish`, `race_progression_summary`) so SQL generation has stable higher-level targets.

## 7) Questions / ambiguities still unresolved

1. Should benchmark runs block release on intense rubric scores, or stay diagnostic-only?
2. Should semantic-contract enforcement be hard-fail or soft-preference when source tables are sparse?
3. For source-of-truth decisions, what mismatch thresholds in `fastf1_audit` are considered acceptable per theme?
4. Which benchmark families should be deterministic-template-only vs LLM-generated?
5. Should runtime answer grading ever produce `A`, and if so, by what measurable criteria?

## Evidence index (primary files used)

- Runtime orchestration: `web/src/lib/chatRuntime.ts`
- SQL/query access: `web/src/lib/queries.ts`
- Chat API flow: `web/src/app/api/chat/route.ts`
- LLM prompts/generation/synthesis: `web/src/lib/anthropic.ts`
- Safety checks: `web/src/lib/querySafety.ts`
- Runtime quality grading: `web/src/lib/chatQuality.ts`
- Benchmark grader/rubrics:
  - `web/scripts/chat-health-check-baseline.mjs`
  - `web/scripts/chat-health-check.rubric.json`
  - `web/scripts/chat-health-check.rubric.intense.json`
  - `web/logs/chat_health_check_2026-03-17T00-24-31-350Z.md`
- Helper/semantic schema:
  - `sql/005_helper_tables.sql`
  - `sql/006_semantic_lap_layer.sql`
- Supporting docs/reports:
  - `docs/llm_database_context_extended.md`
  - `docs/helper_repo_analysis.md`
  - `docs/helper_repo_adoption_status.md`
  - `docs/transformed_lap_schema.md`
  - `fastf1_audit/exports/audit_20260316T234249Z/source_audit_report.md`
