# Slice Queue Index

Ordered list of slices for the runner. The runner walks this top-to-bottom and stops at the first actionable slice. **Do not reorder without understanding the gate dependencies in the execution plan §7.**

Source plan: [execution_plan_2026-04_autonomous_loop.md](../execution_plan_2026-04_autonomous_loop.md)
Automation spec: [automation_2026-04_loop_runner.md](../automation_2026-04_loop_runner.md)

## Phase 0 — Bootstrap, Hygiene & Baseline

Bootstrap (must land before anything else):

- `00-gitignore-exceptions`
- `00-branch-bootstrap`
- `00-artifact-tree`
- `00-codex-handoff-protocol`
- `00-tsbuildinfo-gitignore`

Hygiene:

- `00-ci-workflow`
- `00-dep-patches`
- `00-font-network-doc`
- `00-verify-script`

Baseline (gates Phase 1):

- `00-fresh-benchmark`

## Phase 1 — Performance Instrumentation

- `01-perf-trace-helpers`
- `01-route-stage-timings`
- `01-perf-summary-route`
- `01-baseline-snapshot`
- `01-perf-trace-fix-spans`

## Phase 2 — Anthropic Prompt Caching

- `02-prompt-static-prefix-split`
- `02-cache-control-markers`
- `02-cache-hit-assertion`
- `02-cost-telemetry-validation`

## Phase 3 — Materialize Hot Semantic Contracts

- `03-core-build-schema`
- `03-driver-session-summary-prototype`
- `03-laps-enriched-grain-discovery`
- `03-laps-enriched-materialize`
- `03-stint-summary`
- `03-strategy-summary`
- `03-race-progression-summary`
- `03-grid-vs-finish`
- `03-pit-cycle-summary`
- `03-strategy-evidence-summary`
- `03-lap-phase-summary`
- `03-lap-context-summary`
- `03-telemetry-lap-bridge`

## Phase 4 — Targeted Indexes

- `04-perf-indexes-sql`
- `04-explain-before-after`

## Phase 5 — App-Layer Caches

- `05-resolver-lru`
- `05-template-cache-coverage-audit`
- `05-answer-cache`

## Phase 6 — Neon Production Plumbing

- `06-driver-swap-local-fallback`
- `06-pooled-url-assertion`
- `06-stmt-cache-off`
- `06-warm-keeper-cron`
- `06-cu-rightsize`

## Phase 7 — LLM Path Tightening + Streaming

- `07-zero-llm-path-tighten`
- `07-skip-repair-on-deterministic`
<!-- - `07-streaming-synthesis` (decomposed 2026-04-29 after iter cap of 10 plan-revise rounds without converging; codex's audit verdicts repeatedly surfaced multi-surface integration concerns — synthesis seam attached to wrong module, JSON contract preservation, 6 non-LLM exit branches needing SSE compat, client placeholder ordering. The slice was over-scoped for one iteration cycle; replaced with three focused sub-slices below.) -->
- `07-streaming-synthesis-server`
- `07-streaming-synthesis-route-sse`
- `07-streaming-synthesis-client-wiring`

## Phase 8 — Synthesis Hardening

- `08-fact-contract-shape`
- `08-synthesis-payload-cutover`
- `08-validators-pit-stints`
- `08-validators-sector-consistency`
- `08-validators-grid-finish`
- `08-validators-strategy-evidence`
- `08-validators-count-list-parity`

## Phase 9 — Runtime Refactor

- `09-split-chatRuntime-classification`
- `09-split-chatRuntime-resolution`
- `09-split-chatRuntime-completeness`
- `09-split-chatRuntime-recommendations`
- `09-split-chatRuntime-planTrace`
- `09-split-deterministicSql-pace`
- `09-split-deterministicSql-strategy`
- `09-split-deterministicSql-result`
- `09-split-deterministicSql-telemetry`
- `09-split-deterministicSql-dataHealth`
- `09-split-queries-catalog`
- `09-split-queries-resolver`
- `09-split-queries-sessions`
- `09-split-queries-execute`
- `09-split-route-orchestration`
- `09-split-answerSanity-pit-stints`
- `09-split-answerSanity-sector`
- `09-split-answerSanity-grid-finish`
- `09-split-answerSanity-strategy-evidence`
- `09-split-answerSanity-count-list`
- `09-line-count-gate`

## Phase 10 — Product Surfaces

- `10-session-detail-pace-table`
- `10-session-detail-stint-timeline`
- `10-session-detail-strategy-summary`
- `10-catalog-completeness-page`
- `10-saved-analyses-persistence`
- `10-replay-viewer-mvp`

## Phase 11 — Quality Cleanup

- `11-rerun-benchmark-baseline`
- `11-residual-raw-table-regressions`
- `11-valid-lap-policy-v2`
- `11-resolver-disambiguation-tightening`
- `11-multi-axis-grader-redesign`

## Phase 12 — Production Deployment Hardening

- `12-read-replica-pool-split`
- `12-env-assertions`
- `12-migration-runner-adoption`
