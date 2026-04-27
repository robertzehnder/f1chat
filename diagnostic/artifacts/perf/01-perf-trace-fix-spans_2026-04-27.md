# Phase 1 Re-Baseline (post span-boundary fix) — 2026-04-27

Source: `diagnostic/artifacts/perf/01-perf-trace-fix-spans_2026-04-27.json`
Benchmark: `web/scripts/chat-health-check.mjs` against full 50-question intense set
(`web/scripts/chat-health-check.questions.json`, rubric
`web/scripts/chat-health-check.rubric.intense.json`).
Window: `window.requested = 50`, `window.returned = 50` (trace file rotated
before the run; only this slice's 50 perfTrace records contribute).

## Headline

Overall median request time (`total.p50_ms`): **12479.77 ms** (~12.5 s).
Overall p95 (`total.p95_ms`): **27861.57 ms** (~27.9 s); overall max
(`total.max_ms`): **30543.74 ms** (~30.5 s).

`runtime_classify` and `resolve_db` are now **sequential and non-overlapping**
spans inside `buildChatRuntime`: `runtime_classify` brackets the synchronous
`classifyQuestion` call only, and `resolve_db` brackets the entity-resolution
and DB-touching work that follows it. The two stages no longer alias.

## Per-stage p50 / p95

Sorted by `p95_ms` descending. `count` is the number of records (out of 50)
that reached the stage.

| Stage              | count | p50_ms    | p95_ms    | max_ms    |
| ------------------ | ----: | --------: | --------: | --------: |
| total              |    50 | 12479.77  | 27861.57  | 30543.74  |
| resolve_db         |    50 |  6990.80  | 16343.94  | 18006.07  |
| sqlgen_llm         |    12 |  3280.96  | 13902.69  | 13902.69  |
| synthesize_llm     |    46 |  4589.59  |  7429.50  |  8429.99  |
| execute_db         |    49 |  1656.26  |  5461.64  |  7553.53  |
| repair_llm         |     2 |  2345.44  |  5434.11  |  5434.11  |
| sanity_check       |    46 |     0.08  |     0.71  |     0.88  |
| request_intake     |    50 |     0.17  |     0.32  |     0.67  |
| template_match     |    46 |     0.02  |     0.06  |     0.43  |
| runtime_classify   |    50 |     0.01  |     0.02  |     0.14  |

## Notes

- **Span split: `runtime_classify` vs `resolve_db` (the headline).** In the
  prior baseline (`01-baseline-snapshot_2026-04-26.json`) both stages reported
  identical p50 7190.91 ms / p95 16718.68 ms / max 17967.61 ms across all 50
  records — they were two concurrent spans wrapping the same
  `buildChatRuntime` call. After this slice the spans live inside
  `buildChatRuntime` and are sequential, so the numbers separate cleanly:
  `runtime_classify` now reports p50 **0.01 ms** / p95 **0.02 ms** / max
  **0.14 ms** (essentially CPU-only regex/string work, as expected for the
  synchronous `classifyQuestion` body), while `resolve_db` reports p50
  **6990.80 ms** / p95 **16343.94 ms** / max **18006.07 ms** (the real DB
  lookups + post-classify work).
- The previous baseline's `runtime_classify` p50 7190.91 ms was an artifact
  of span aliasing — the actual classification step is sub-millisecond. The
  Phase-2/3 caching/materialization work targets the latency now correctly
  attributed to `resolve_db`.
- Overall `total` p50 (12479.77 ms) and p95 (27861.57 ms) are within run-to-run
  variance of the prior baseline (12603.28 / 26310.01); the split itself does
  not change the end-to-end timing — it only fixes which stage gets the
  attribution.
- `sqlgen_llm` p95 jumped to 13902.69 ms (single tail sample on n=12) versus
  7650.41 ms in the prior baseline; sample size is small, so this is
  expected variance, not a regression introduced by this slice.
- Sub-millisecond stages (`request_intake`, `sanity_check`, `template_match`,
  and now `runtime_classify`) are pure CPU and not a latency target.
- `execute_db` p50 (1656.26 ms) and p95 (5461.64 ms) are essentially
  unchanged from the prior baseline (1680.40 / 5629.55) — the warehouse
  round-trip itself was not touched by this slice.
