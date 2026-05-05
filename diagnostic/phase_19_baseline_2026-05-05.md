# Phase 19 Baseline — Per-category A-rate snapshot

Generated: 2026-05-05T03:04:02.263Z
Base URL: `http://127.0.0.1:3000`
Total questions: 167

## Per-category summary

| Category | Total | A | B | C | A-rate | median elapsedMs | cache hit % |
|---|---:|---:|---:|---:|---:|---:|---:|
| braking | 10 | 7 | 2 | 1 | 70.0% | - | 0.0% |
| corner | 10 | 5 | 4 | 1 | 50.0% | - | 0.0% |
| cross_category | 9 | 0 | 0 | 9 | 0.0% | - | 0.0% |
| data_health | 8 | 6 | 1 | 1 | 75.0% | - | 0.0% |
| dominance | 12 | 5 | 5 | 2 | 41.7% | - | 0.0% |
| driver_score | 8 | 5 | 0 | 3 | 62.5% | - | 0.0% |
| incident | 7 | 3 | 1 | 3 | 42.9% | - | 0.0% |
| metadata | 7 | 7 | 0 | 0 | 100.0% | - | 0.0% |
| overtake | 7 | 2 | 1 | 4 | 28.6% | - | 0.0% |
| pace | 10 | 6 | 0 | 4 | 60.0% | - | 0.0% |
| pit | 8 | 5 | 1 | 2 | 62.5% | - | 0.0% |
| proprietary_no_data | 9 | 9 | 0 | 0 | 100.0% | - | 0.0% |
| restart | 7 | 1 | 3 | 3 | 14.3% | - | 0.0% |
| stint | 10 | 6 | 0 | 4 | 60.0% | - | 0.0% |
| straight_line | 10 | 10 | 0 | 0 | 100.0% | - | 0.0% |
| traction | 10 | 8 | 1 | 1 | 80.0% | - | 0.0% |
| traffic | 8 | 5 | 3 | 0 | 62.5% | - | 0.0% |
| tyre | 10 | 6 | 2 | 2 | 60.0% | - | 0.0% |
| weather | 7 | 5 | 0 | 2 | 71.4% | - | 0.0% |
| **TOTAL** | 167 | 101 | 24 | 42 | 60.5% | 30019 | 0.0% |

## generationSource distribution (overall)

| generationSource | count | % of total |
|---|---:|---:|
| `anthropic` | 91 | 54.5% |
| `anthropic_repaired` | 28 | 16.8% |
| `runtime_clarification` | 26 | 15.6% |
| `no_data_refusal` | 9 | 5.4% |
| `sql_generation_failed` | 6 | 3.6% |
| `heuristic_after_sql_timeout` | 4 | 2.4% |
| `deterministic_template` | 2 | 1.2% |
| `?` | 1 | 0.6% |

## Lift targets (categories at 0% A-rate)

These categories are the explicit lift targets for Phase 21. Each Phase 21 slice's PR-time acceptance must publish a delta vs this baseline.

- cross_category
