# Seven-Prompt Outcome Summary (March 2026)

This document consolidates outcomes from the seven prompt waves requested for the OpenF1 analytics repo.

## Overall status

- Prompt 1: `partially completed` (coverage contracts and gating implemented; non-race ingestion/backfill still source-dependent)
- Prompt 2: `completed`
- Prompt 3: `mostly completed` (major regressions removed; explicit raw fact/fallback paths remain by design)
- Prompt 4: `completed`
- Prompt 5: `completed`
- Prompt 6: `completed`
- Prompt 7: `completed`

## Prompt-by-prompt outcomes

## 1) Data coverage and session completeness

### Implemented

- Canonical session completeness contract:
  - `core.session_completeness`
- Canonical weekend coverage contracts:
  - `core.weekend_session_coverage`
  - `core.weekend_session_expectation_audit`
- Placeholder/future awareness fields and statuses:
  - `is_future_session`, `is_placeholder`, `completeness_status`, `completeness_score`
- Resolver/query default gating for analytics-oriented session lookup:
  - defaults exclude future/placeholder sessions unless explicitly requested

### Evidence

- `sql/005_helper_tables.sql`
- `web/src/lib/queries.ts` (`includeFutureSessions` / `includePlaceholderSessions` filters)
- `web/src/lib/chatRuntime.ts` (data-health planning tables include completeness contracts)

### Remaining gap

- Full non-race (Practice/Qualifying/Sprint) coverage backfill is not fully solved by contract layer alone and remains dependent on source availability/ingestion completeness.

## 2) Lookup and governance contracts

### Implemented

- Team alias contract:
  - `core.team_alias_lookup`
- Weekend/session expectation governance:
  - `core.weekend_session_expectation_rules`
  - `core.weekend_session_expectation_audit`
- Source anomaly governance:
  - `core.source_anomaly_manual`
  - `core.source_anomaly_tracking`
- Team/driver/session identity and lookup views used in resolver paths:
  - `core.team_identity_lookup`
  - `core.driver_identity_lookup`
  - `core.session_search_lookup`

### Evidence

- `sql/005_helper_tables.sql`
- `web/src/lib/queries.ts`

## 3) Runtime raw/alias regressions

### Implemented

- Resolver-side canonical identity/alias usage is contract-backed (not hardcoded maps).
- Deterministic templates for key strategy families moved to semantic contracts:
  - Q31 family (`after pit stops`): `core.strategy_summary` + `core.laps_enriched`
  - Q45 family (`pit cycle gain`): `core.pit_cycle_summary`
  - Q46 family (`undercut/overcut evidence`): `core.strategy_evidence_summary`

### Evidence

- `web/src/lib/queries.ts`
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/deterministicSql.ts`

### Remaining fallback paths

- Raw tables still intentionally used for canonical raw fact domains and resilience fallback (for example telemetry/event streams).

## 4) Canonical pit-cycle / undercut evidence contract

### Implemented

- `core.pit_cycle_summary`
  - includes pit lap, pre/post position, pace windows, and evidence sufficiency flags
- `core.strategy_evidence_summary`
  - includes rival-context pairing, relative position deltas, undercut/overcut signal, and confidence flags

### Evidence

- `sql/007_semantic_summary_contracts.sql`
- `web/src/lib/deterministicSql.ts` (Q45/Q46 adoption)
- `web/src/lib/answerSanity.ts` (evidence gating)

## 5) Synthesis summarization enforcement

### Implemented

- Stronger row-dump suppression and structured-row summarization in answer guards.
- Topic-aware summaries for strategy, stints, pit-cycle, undercut/overcut, comparisons, and ranked outputs.
- Added/used synthesis checks:
  - `stop_count_consistent_with_stints`
  - `sector_summary_matches_metrics`
  - `structured_rows_summarized`
  - `evidence_required_for_strategy_claim`
  - `grid_finish_evidence_present`
- LLM synthesis prompt explicitly discourages `"I found N rows"` style output.

### Evidence

- `web/src/lib/answerSanity.ts`
- `web/src/lib/anthropic.ts`
- `web/src/app/api/chat/route.ts`
- `web/scripts/chat-health-check-baseline.mjs`

## 6) Grading/rubric/reporting + regression tests

### Implemented

- Grading model split:
  - `answer_grade`
  - `semantic_conformance_grade`
  - `root_cause_labels`
- Baseline clarification policy made explicit and consistent:
  - benchmark mode is stateless
  - underspecified questions should request clarification
- Intense rubric aligned to current semantic contracts and synthesis checks.
- Actionable report outputs now include grade splits, answerability outcomes, and root-cause counts.
- Regression harness with fixture coverage for:
  - clarification policy
  - semantic conformance drift
  - synthesis/root-cause labeling
  - report output shape

### Evidence

- `web/scripts/chat-health-check-baseline.mjs`
- `web/scripts/chat-health-check.rubric.json`
- `web/scripts/chat-health-check.rubric.intense.json`
- `web/scripts/chat-health-check.mjs`
- `web/scripts/chat-health-check-grade.mjs`
- `web/scripts/tests/grading-regression.test.mjs`
- `web/scripts/tests/fixtures/*`

### Verification

- `npm run test:grading` passes (`4/4` tests).

### Latest rerun artifact snapshot

From:

- `web/logs/chat_health_check_baseline_2026-03-17T12-33-12-125Z.summary.json`

Headline metrics:

- Answer grades: `A=38, B=7, C=5`
- Semantic conformance grades: `A=28, B=4, C=18`
- Answerability: `expected_clarification_met=2, expected_clarification_missed=2, unnecessary_clarification=1, answerable_and_answered=45`
- Top root causes:
  - `semantic_contract_missed` (8)
  - `structured_rows_summarized` (5)
  - `raw_table_regression` (3)

## 7) Canonical contract map and source-audit runbook docs

### Implemented

- Canonical semantic contract map + adoption status:
  - `docs/semantic_contract_map.md`
- Source-audit operational runbook:
  - `docs/source_audit_runbook.md`
- Stale guidance consolidated and corrected:
  - `docs/helper_repo_adoption_status.md` (rewritten as concise pointer/status doc)
  - `docs/semantic_runtime_adoption.md` (updated to align with current architecture)

### Evidence

- `docs/semantic_contract_map.md`
- `docs/source_audit_runbook.md`
- `docs/helper_repo_adoption_status.md`
- `docs/semantic_runtime_adoption.md`

## Current highest-leverage residual work

1. Reduce `semantic_contract_missed`/`raw_table_regression` rows (especially Q27/Q31/Q32/Q45/Q46/Q47/Q48 families).
2. Improve resolver behavior for remaining clarification misses (Q15/Q17 in latest intense rerun).
3. Continue synthesis tightening for row-heavy families still flagged with `structured_rows_summarized`.
