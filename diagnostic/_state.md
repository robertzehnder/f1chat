# Project state — last updated: 2026-05-01T20:00:56Z

_Read this file at the start of every plan-audit, plan-revise,
implementation, and implementation-audit dispatch. It is the
accumulated context the loop carries between slices._

## Phases status

| Phase | Total | Done | Pending | Pending plan-audit | Revising plan | Awaiting audit | Ready to merge | Blocked | Missing |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 10 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | 5 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 3 | 13 | 13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 4 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 5 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 6 | 5 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 7 | 5 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 8 | 7 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 9 | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 10 | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 11 | 5 | 4 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| 12 | 3 | 1 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |

## Latest benchmark headline

- File: `diagnostic/artifacts/healthcheck/11-multi-axis-regrade_2026-05-01.json`
- Overall A/B/C: 47 / 3 / 0
- Factual correctness A/B/C: 50 / 0 / 0
- Completeness A/B/C: 47 / 3 / 0
- Clarity A/B/C: 50 / 0 / 0
- Root causes: sector_summary_matches_metrics: 1, synthesis_contradiction: 1
- Total questions: 50

## Latest perf baseline

- File: `diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json`
- (could not parse stages from diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json)

## Recent slice merges (last 10)

- `62c38ca` merge: 11-resolver-disambiguation-tightening [pass] — 2026-05-01
- `8586a82` merge: 11-valid-lap-policy-v2 [pass] — 2026-05-01
- `ab49619` merge: 11-residual-raw-table-regressions [pass] — 2026-05-01
- `d06e7e4` merge: 11-rerun-benchmark-baseline [pass] — 2026-04-30
- `3318644` merge: 10-replay-viewer-mvp [pass] — 2026-04-30
- `2bc21df` merge: 10-saved-analyses-persistence [pass] — 2026-04-30
- `fc7e4f1` merge: 10-catalog-completeness-page [pass] — 2026-04-30
- `454425e` merge: 10-session-detail-strategy-summary [pass] — 2026-04-30
- `77b0cac` merge: 10-session-detail-stint-timeline [pass] — 2026-04-30
- `d732597` merge: 10-session-detail-pace-table [pass] — 2026-04-30

## Open architectural decisions

_None._

## Notes for auditors

_No accumulated notes yet. Auditors may append single-line lessons here, max 10 entries._
- Require every Phase 3 per-contract materialization slice to include DB apply/existence/parity gate commands, not only web gates (slice:03-strategy-evidence-summary).
- For multi-index SQL slices, gate every declared index individually or assert `pg_index.indisvalid = true`; existence plus a shared EXPLAIN is insufficient (slice:04-perf-indexes-sql).
- For `web/src/lib/db.ts` slices, verify all existing env-configuration branches (`*_DATABASE_URL`, `NEON_DB_HOST`, `DB_*`) before accepting “behavior unchanged” claims or fallback semantics (slice:06-driver-swap-local-fallback).
- Drift-check bash gates must have an explicit `else` clause (or negated `if !`) that sets a flag and a post-loop exit; an `if … then :; fi` without else silently passes on missing keys (slice:07-zero-llm-path-tighten).
- Two-way drift gates must compare both expected->source and source->expected sets; checking only one direction misses newly added or renamed source keys (slice:07-zero-llm-path-tighten).
- When a plan proposes direct transpilation/import of a TS module in a Node test, require explicit rewrites or stubs for every `@/lib/*` dependency; transpile-only is not self-contained (slice:07-zero-llm-path-tighten).
- When a slice claims to skip or alter an LLM JSON-repair path, verify the named module actually owns that parse/repair flow before approving test or file scope (slice:07-skip-repair-on-deterministic).
- For async route-harness tests that temporarily set `NODE_ENV`, require the helper to await the callback (or inline `try/finally` around awaited work); a synchronous wrapper resets env before later repair/fallback awaits execute (slice:07-skip-repair-on-deterministic).
- When a plan specifies a stub for an async-generator, require it to name the concrete discriminant field and reference the TypeScript type definition; missing this causes test-internal passes against wrong field names (slice:07-streaming-synthesis-route-sse).
- When a slice declares a repo-wide gate like `npm run test:grading`, hold the audit at REVISE on any non-zero exit even if the slice-local assertions pass; require an isolated green gate or repair the shared failures first (slice:08-fact-contract-shape).
- Slice plans must invoke the test-grading gate via `bash scripts/loop/test_grading_gate.sh`, not raw `cd web && npm run test:grading`; the wrapper diffs failures against `scripts/loop/state/test_grading_baseline.txt` so pre-existing integration failures (e.g. `driver-fallback.test.mjs` Cases A/B/E) do not auto-REJECT (slice:08-synthesis-payload-cutover).
