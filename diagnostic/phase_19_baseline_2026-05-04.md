# Phase 19 Baseline — Per-category A-rate snapshot

Generated: 2026-05-04T02:08:06.336Z
Base URL: `http://127.0.0.1:3000`
Total questions: 167

## Per-category summary

| Category | Total | A | B | C | A-rate | median elapsedMs | cache hit % |
|---|---:|---:|---:|---:|---:|---:|---:|
| braking | 10 | 8 | 1 | 1 | 80.0% | - | 0.0% |
| corner | 10 | 5 | 5 | 0 | 50.0% | - | 0.0% |
| cross_category | 9 | 1 | 0 | 8 | 11.1% | - | 0.0% |
| data_health | 8 | 3 | 1 | 4 | 37.5% | - | 0.0% |
| dominance | 12 | 9 | 0 | 3 | 75.0% | - | 0.0% |
| driver_score | 8 | 1 | 0 | 7 | 12.5% | - | 0.0% |
| incident | 7 | 1 | 3 | 3 | 14.3% | - | 0.0% |
| metadata | 7 | 4 | 1 | 2 | 57.1% | - | 0.0% |
| overtake | 7 | 1 | 1 | 5 | 14.3% | - | 0.0% |
| pace | 10 | 5 | 2 | 3 | 50.0% | - | 0.0% |
| pit | 8 | 2 | 3 | 3 | 25.0% | - | 0.0% |
| proprietary_no_data | 9 | 9 | 0 | 0 | 100.0% | - | 0.0% |
| restart | 7 | 2 | 0 | 5 | 28.6% | - | 0.0% |
| stint | 10 | 3 | 2 | 5 | 30.0% | - | 0.0% |
| straight_line | 10 | 5 | 3 | 2 | 50.0% | - | 0.0% |
| traction | 10 | 6 | 2 | 2 | 60.0% | - | 0.0% |
| traffic | 8 | 8 | 0 | 0 | 100.0% | - | 0.0% |
| tyre | 10 | 4 | 3 | 3 | 40.0% | - | 0.0% |
| weather | 7 | 2 | 0 | 5 | 28.6% | - | 0.0% |
| **TOTAL** | 167 | 79 | 27 | 61 | 47.3% | 30019 | 0.0% |

## generationSource distribution (overall)

| generationSource | count | % of total |
|---|---:|---:|
| `anthropic` | 68 | 40.7% |
| `runtime_clarification` | 45 | 26.9% |
| `anthropic_repaired` | 31 | 18.6% |
| `heuristic_after_sql_timeout` | 10 | 6.0% |
| `no_data_refusal` | 9 | 5.4% |
| `sql_generation_failed` | 3 | 1.8% |
| `deterministic_template` | 1 | 0.6% |

## Lift targets (categories at 0% A-rate)

These categories are the explicit lift targets for Phase 21. Each Phase 21 slice's PR-time acceptance must publish a delta vs this baseline.

(none — every category has at least one A-graded question)
