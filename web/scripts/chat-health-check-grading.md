# Chat Health Check Grading Model

The benchmark grader now separates two concerns per result row:

- `answer_grade`: answerability handling, correctness/completeness, synthesis consistency, and caveat discipline.
- `semantic_conformance_grade`: whether preferred semantic/core contracts were used (and whether raw-table regressions occurred where semantic contracts exist).

The legacy `baselineGrade` is still produced for compatibility and is derived as the lower of:

- `answer_grade`
- `semantic_conformance_grade`

The grader also emits `root_cause_labels` to support actionable diagnostics, including:

- `unnecessary_clarification`
- `resolver_failure`
- `semantic_contract_missed`
- `summary_contract_missing`
- `synthesis_contradiction`
- `insufficient_evidence_handling`
- `raw_table_regression`

## Synthesis Checks

The grader also supports synthesis-oriented answer checks (answer-quality side), which can be enabled by rubric rows via `required_answer_checks` or listed in `critical_checks`:

- `stop_count_consistent_with_stints`
- `sector_summary_matches_metrics`
- `structured_rows_summarized`
- `evidence_required_for_strategy_claim`
- `grid_finish_evidence_present`

Check strength notes:

- Stronger/data-backed:
  - `sector_summary_matches_metrics` (compares sector winner statements to `previewRows` metrics when present).
  - `grid_finish_evidence_present` (requires grid/finish evidence for gained/lost position claims).
- Heuristic/lightweight:
  - `stop_count_consistent_with_stints` (text consistency between stint and stop counts).
  - `structured_rows_summarized` (detects row-dump template answers lacking synthesis language).
  - `evidence_required_for_strategy_claim` (requires position-context evidence for decisive undercut/overcut/pit-cycle claims).

## Artifacts

- `chat-health-check.mjs` writes row-level grading fields into each health-check JSON row.
- `chat-health-check.mjs` also writes a summary sidecar (`chat_health_check_*.summary.json`).
- `chat-health-check-grade.mjs` writes:
  - graded rows (`chat_health_check_baseline_*.json`)
  - summary metadata (`chat_health_check_baseline_*.summary.json`)
  - markdown matrix/report (`chat_health_check_baseline_*.md`)
