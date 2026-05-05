# Phase 19 Baseline — Per-category A-rate snapshot

Generated: 2026-05-05T17:16:14.159Z
Base URL: `http://127.0.0.1:3000`
Total questions: 167

## Per-category summary

| Category | Total | A | B | C | A-rate | median elapsedMs | cache hit % |
|---|---:|---:|---:|---:|---:|---:|---:|
| braking | 10 | 9 | 1 | 0 | 90.0% | - | 0.0% |
| corner | 10 | 9 | 0 | 1 | 90.0% | - | 0.0% |
| cross_category | 9 | 1 | 0 | 8 | 11.1% | - | 0.0% |
| data_health | 8 | 5 | 2 | 1 | 62.5% | - | 0.0% |
| dominance | 12 | 6 | 1 | 5 | 50.0% | - | 0.0% |
| driver_score | 8 | 5 | 0 | 3 | 62.5% | - | 0.0% |
| incident | 7 | 2 | 2 | 3 | 28.6% | - | 0.0% |
| metadata | 7 | 6 | 0 | 1 | 85.7% | - | 0.0% |
| overtake | 7 | 2 | 2 | 3 | 28.6% | - | 0.0% |
| pace | 10 | 6 | 0 | 4 | 60.0% | - | 0.0% |
| pit | 8 | 5 | 1 | 2 | 62.5% | - | 0.0% |
| proprietary_no_data | 9 | 9 | 0 | 0 | 100.0% | - | 0.0% |
| restart | 7 | 4 | 1 | 2 | 57.1% | - | 0.0% |
| stint | 10 | 3 | 1 | 6 | 30.0% | - | 0.0% |
| straight_line | 10 | 9 | 1 | 0 | 90.0% | - | 0.0% |
| traction | 10 | 7 | 1 | 2 | 70.0% | - | 0.0% |
| traffic | 8 | 6 | 1 | 1 | 75.0% | - | 0.0% |
| tyre | 10 | 5 | 1 | 4 | 50.0% | - | 0.0% |
| weather | 7 | 5 | 0 | 2 | 71.4% | - | 0.0% |
| **TOTAL** | 167 | 104 | 15 | 48 | 62.3% | 28464 | 0.0% |

## generationSource distribution (overall)

| generationSource | count | % of total |
|---|---:|---:|
| `anthropic` | 84 | 50.3% |
| `anthropic_repaired` | 35 | 21.0% |
| `runtime_clarification` | 31 | 18.6% |
| `no_data_refusal` | 9 | 5.4% |
| `heuristic_after_sql_timeout` | 5 | 3.0% |
| `deterministic_template` | 2 | 1.2% |
| `sql_generation_failed` | 1 | 0.6% |

## Lift targets (categories at 0% A-rate)

These categories are the explicit lift targets for Phase 21. Each Phase 21 slice's PR-time acceptance must publish a delta vs this baseline.

(none — every category has at least one A-graded question)
