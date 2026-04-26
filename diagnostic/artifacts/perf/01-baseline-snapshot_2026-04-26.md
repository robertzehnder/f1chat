# Phase 1 Baseline Perf Snapshot — 2026-04-26

Source: `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.json`
Benchmark: `web/scripts/chat-health-check.mjs` against full 50-question intense set
(`web/scripts/chat-health-check.questions.json`, rubric
`web/scripts/chat-health-check.rubric.intense.json`).
Window: `window.requested = 50`, `window.returned = 50` (trace file rotated
before the run; only this slice's 50 perfTrace records contribute).

## Headline

Overall median request time (`total.p50_ms`): **12603.28 ms** (~12.6 s).
Overall p95 (`total.p95_ms`): **26310.01 ms** (~26.3 s); overall max
(`total.max_ms`): **31252.96 ms** (~31.3 s).

## Per-stage p50 / p95

Sorted by `p95_ms` descending. `count` is the number of records (out of 50)
that reached the stage.

| Stage              | count | p50_ms    | p95_ms    | max_ms    |
| ------------------ | ----: | --------: | --------: | --------: |
| total              |    50 | 12603.28  | 26310.01  | 31252.96  |
| runtime_classify   |    50 |  7190.91  | 16718.68  | 17967.61  |
| resolve_db         |    50 |  7190.91  | 16718.68  | 17967.61  |
| sqlgen_llm         |    12 |  3807.30  |  7650.41  |  7650.41  |
| synthesize_llm     |    46 |  4719.58  |  7085.43  |  7874.45  |
| repair_llm         |     2 |  4456.08  |  6129.08  |  6129.08  |
| execute_db         |    49 |  1680.40  |  5629.55  |  7828.96  |
| sanity_check       |    46 |     0.10  |     0.46  |     0.62  |
| request_intake     |    50 |     0.16  |     0.22  |     0.31  |
| template_match     |    46 |     0.03  |     0.07  |     0.42  |

## Notes

- `runtime_classify` and `resolve_db` report identical p50 / p95 / max
  values across all 50 records. This is consistent with the current route
  wiring where `resolve_db` wraps `runtime_classify` (or the same elapsed
  window is recorded under both names). Worth confirming in a later slice;
  it is not a benchmarking artifact — both stages were emitted by every
  record.
- `sqlgen_llm` only fired on 12 of 50 requests (template_match took the
  rest), so its percentiles are over a small sample. `repair_llm` only
  fired twice; its p50 and p95 are nearest-rank picks from a 2-element
  array.
- `execute_db` (the warehouse round-trip) is well under the LLM stages at
  the median (1.68 s) but its long tail (p95 5.63 s, max 7.83 s) is
  substantial — the only non-LLM stage with seconds-scale latency.
- Sub-millisecond stages (`request_intake`, `sanity_check`,
  `template_match`) are pure CPU and not a latency target.
- `synthesize_llm` p95 ~7.1 s is the dominant LLM step on the synthesis
  side; combined with the two ~16.7 s p95 stages above, this baseline
  shows latency is overwhelmingly LLM-bound, with `execute_db` as the
  only meaningful non-LLM contributor.
- No cold-start spike was isolated; the `total.max_ms` of 31.25 s was
  spread across the runtime_classify and synthesize_llm tails on the
  same record (raw record-level inspection deferred — this baseline only
  tracks aggregates).
