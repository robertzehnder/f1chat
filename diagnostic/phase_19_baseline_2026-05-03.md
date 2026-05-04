# Phase 19 Baseline — Per-category A-rate snapshot

Generated: 2026-05-03T14:41:23.648Z
Base URL: `http://127.0.0.1:3000`
Total questions: 167

## Per-category summary

| Category | Total | A | B | C | A-rate | median elapsedMs | cache hit % |
|---|---:|---:|---:|---:|---:|---:|---:|
| braking | 10 | 4 | 1 | 5 | 40.0% | - | 0.0% |
| corner | 10 | 3 | 6 | 1 | 30.0% | - | 0.0% |
| cross_category | 9 | 1 | 0 | 8 | 11.1% | - | 0.0% |
| data_health | 8 | 3 | 1 | 4 | 37.5% | - | 0.0% |
| dominance | 12 | 6 | 3 | 3 | 50.0% | - | 0.0% |
| driver_score | 8 | 2 | 0 | 6 | 25.0% | - | 0.0% |
| incident | 7 | 2 | 1 | 4 | 28.6% | - | 0.0% |
| metadata | 7 | 4 | 1 | 2 | 57.1% | - | 0.0% |
| overtake | 7 | 2 | 1 | 4 | 28.6% | - | 0.0% |
| pace | 10 | 5 | 2 | 3 | 50.0% | - | 0.0% |
| pit | 8 | 2 | 2 | 4 | 25.0% | - | 0.0% |
| proprietary_no_data | 9 | 8 | 0 | 1 | 88.9% | - | 0.0% |
| restart | 7 | 2 | 3 | 2 | 28.6% | - | 0.0% |
| stint | 10 | 3 | 2 | 5 | 30.0% | - | 0.0% |
| straight_line | 10 | 5 | 2 | 3 | 50.0% | - | 0.0% |
| traction | 10 | 4 | 2 | 4 | 40.0% | - | 0.0% |
| traffic | 8 | 6 | 2 | 0 | 75.0% | - | 0.0% |
| tyre | 10 | 4 | 3 | 3 | 40.0% | - | 0.0% |
| weather | 7 | 2 | 0 | 5 | 28.6% | - | 0.0% |
| **TOTAL** | 167 | 68 | 32 | 67 | 40.7% | 30019 | 0.0% |

## generationSource distribution (overall)

| generationSource | count | % of total |
|---|---:|---:|
| `anthropic` | 65 | 38.9% |
| `runtime_clarification` | 45 | 26.9% |
| `anthropic_repaired` | 35 | 21.0% |
| `heuristic_after_sql_timeout` | 10 | 6.0% |
| `no_data_refusal` | 8 | 4.8% |
| `sql_generation_failed` | 3 | 1.8% |
| `deterministic_template` | 1 | 0.6% |

## Lift targets (categories at 0% A-rate)

These categories are the explicit lift targets for Phase 21. Each Phase 21 slice's PR-time acceptance must publish a delta vs this baseline.

(none — every category has at least one A-graded question)
