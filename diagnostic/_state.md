# Project state — last updated: 2026-04-29T18:25:29Z

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
| 7 | 3 | 2 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| 8 | 7 | 0 | 0 | 7 | 0 | 0 | 0 | 0 | 0 |
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

- `b4a9aad` merge: 07-skip-repair-on-deterministic [pass] — 2026-04-29
- `e8d0a17` merge: 07-zero-llm-path-tighten [pass] — 2026-04-29
- `cfe2972` merge: 06-cu-rightsize [pass] — 2026-04-29
- `731300a` merge: 06-stmt-cache-off [pass] — 2026-04-29
- `0616c01` merge: 06-pooled-url-assertion [pass] — 2026-04-29
- `205c23b` merge: 06-driver-swap-local-fallback [pass] — 2026-04-28
- `5c87764` merge: 05-answer-cache [pass] — 2026-04-28
- `4cdd7e0` merge: 05-template-cache-coverage-audit [pass] — 2026-04-28
- `60b2c42` merge: 05-resolver-lru [pass] — 2026-04-28
- `07da581` merge: 04-explain-before-after [pass] — 2026-04-28

## Open architectural decisions

_None._

## Notes for auditors

_No accumulated notes yet. Auditors may append single-line lessons here, max 10 entries._
- For `web/src/lib/db.ts` slices, verify all existing env-configuration branches (`*_DATABASE_URL`, `NEON_DB_HOST`, `DB_*`) before accepting “behavior unchanged” claims or fallback semantics (slice:06-driver-swap-local-fallback).
- Drift-check bash gates must have an explicit `else` clause (or negated `if !`) that sets a flag and a post-loop exit; an `if … then :; fi` without else silently passes on missing keys (slice:07-zero-llm-path-tighten).
- Two-way drift gates must compare both expected->source and source->expected sets; checking only one direction misses newly added or renamed source keys (slice:07-zero-llm-path-tighten).
- When a plan proposes direct transpilation/import of a TS module in a Node test, require explicit rewrites or stubs for every `@/lib/*` dependency; transpile-only is not self-contained (slice:07-zero-llm-path-tighten).
- When a slice claims to skip or alter an LLM JSON-repair path, verify the named module actually owns that parse/repair flow before approving test or file scope (slice:07-skip-repair-on-deterministic).
- For async route-harness tests that temporarily set `NODE_ENV`, require the helper to await the callback (or inline `try/finally` around awaited work); a synchronous wrapper resets env before later repair/fallback awaits execute (slice:07-skip-repair-on-deterministic).
- When a slice changes `/api/*` transport or media type, require the plan to name every existing consumer that must migrate or the explicit compatibility path for legacy structured callers (slice:07-streaming-synthesis).
- When a slice claims progressive UI streaming, require a deterministic gate over the owning UI state-update path, not only over a helper parser callback contract (slice:07-streaming-synthesis).
- For SSE/streaming slices, require one gate that observes pre-terminal bytes before stream close and one gate that splits a logical frame across multiple `ReadableStream` reads; frame-count-only or whole-frame fixtures do not prove real streaming semantics (slice:07-streaming-synthesis).
- When a UI opts all requests into SSE, require the plan to cover every non-streaming early-return branch with `final`/`error` SSE frames or an explicit client-side fallback; otherwise the helper can receive JSON on valid cache-hit, clarification, or validation paths (slice:07-streaming-synthesis).
