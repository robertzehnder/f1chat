# Project state — last updated: 2026-04-29T22:17:25Z

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
| 8 | 7 | 1 | 0 | 6 | 0 | 0 | 0 | 0 | 0 |
| 9 | 21 | 0 | 0 | 21 | 0 | 0 | 0 | 0 | 0 |
| 10 | 6 | 0 | 0 | 6 | 0 | 0 | 0 | 0 | 0 |
| 11 | 5 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 |
| 12 | 3 | 1 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |

## Latest benchmark headline

- File: `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json`
- Overall A/B/C: 24 / 11 / 15
- Answer A/B/C: 44 / 6 / 0
- Semantic conformance A/B/C: 29 / 6 / 15
- Root causes: raw_table_regression: 1, semantic_contract_missed: 1, resolver_failure: 1
- Total questions: 50

## Latest perf baseline

- File: `diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json`
- (could not parse stages from diagnostic/artifacts/perf/06-cu-rightsize-before_2026-04-28.json)

## Recent slice merges (last 10)

- `804aa07` merge: 08-fact-contract-shape [pass] — 2026-04-29
- `6e2aa4e` merge: 07-streaming-synthesis-client-wiring [pass] — 2026-04-29
- `cd8fc0d` merge: 07-streaming-synthesis-route-sse [pass] — 2026-04-29
- `785749b` merge: 07-streaming-synthesis-server [pass] — 2026-04-29
- `b4a9aad` merge: 07-skip-repair-on-deterministic [pass] — 2026-04-29
- `e8d0a17` merge: 07-zero-llm-path-tighten [pass] — 2026-04-29
- `cfe2972` merge: 06-cu-rightsize [pass] — 2026-04-29
- `731300a` merge: 06-stmt-cache-off [pass] — 2026-04-29
- `0616c01` merge: 06-pooled-url-assertion [pass] — 2026-04-29
- `205c23b` merge: 06-driver-swap-local-fallback [pass] — 2026-04-28

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
