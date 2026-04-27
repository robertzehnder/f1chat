# Project state — last updated: 2026-04-27T03:55:00Z

_Read this file at the start of every plan-audit, plan-revise,
implementation, and implementation-audit dispatch. It is the
accumulated context the loop carries between slices._

## Phases status

| Phase | Total | Done | Pending | Pending plan-audit | Revising plan | Awaiting audit | Ready to merge | Blocked | Missing |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 10 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ? | 71 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 71 |

## Latest benchmark headline

- File: `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json`
- Overall A/B/C: 24 / 11 / 15
- Answer A/B/C: 44 / 6 / 0
- Semantic conformance A/B/C: 29 / 6 / 15
- Root causes: raw_table_regression: 1, semantic_contract_missed: 1, resolver_failure: 1
- Total questions: 50

## Latest perf baseline

- File: `diagnostic/artifacts/perf/01-perf-trace-fix-spans_2026-04-27.json`
- Slowest stages by p50:
  - `total` p50=12479.77ms p95=27861.57ms n=50
  - `resolve_db` p50=6990.80ms p95=16343.94ms n=50
  - `synthesize_llm` p50=4589.59ms p95=7429.50ms n=46
  - `sqlgen_llm` p50=3280.96ms p95=13902.69ms n=12
  - `repair_llm` p50=2345.44ms p95=5434.11ms n=2
- Overall p50=12479.77ms p95=27861.57ms
- `runtime_classify` and `resolve_db` are now sequential and de-aliased (`runtime_classify` p50=0.01ms, `resolve_db` p50=6990.80ms).

## Recent slice merges (last 10)

- `eb5a31a` merge: 01-baseline-snapshot [pass] — 2026-04-26
- `c0993ea` merge: 01-perf-summary-route [pass] — 2026-04-26
- `551dedc` merge: 01-route-stage-timings [pass] — 2026-04-26
- `4621b9f` merge: 01-perf-trace-helpers [pass] — 2026-04-25
- `2eee714` merge: 00-fresh-benchmark [pass] — 2026-04-25
- `89b0dd7` merge: 00-verify-script [pass] — 2026-04-25
- `87e1e1b` merge: 00-font-network-doc [pass] — 2026-04-25
- `38c8704` merge: 00-dep-patches [pass] — 2026-04-25
- `c2c2442` merge: 00-ci-workflow [pass] — 2026-04-25
- `d395a74` merge: 00-codex-handoff-protocol [pass] — 2026-04-25

## Open architectural decisions

_None._

## Notes for auditors

_No accumulated notes yet. Auditors may append single-line lessons here, max 10 entries._
