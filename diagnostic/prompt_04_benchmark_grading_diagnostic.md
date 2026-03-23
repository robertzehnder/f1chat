# Prompt 4 Diagnostic: Benchmark and Grading Architecture

## 1) Current benchmark/grading architecture

### Benchmark execution flow

1. Question set
- Source: `openf1/web/scripts/chat-health-check.questions.json`
- Shape: fixed 50-question suite grouped by category (session metadata, roster, lap pace, strategy, progression).

2. Runner and collection
- Source: `openf1/web/scripts/chat-health-check.mjs`
- Behavior:
  - Sends each question to `/api/chat`
  - Captures runtime metadata (`questionType`, resolution status, selected session, SQL text, rowCount, warnings, adequacy grade)
  - Writes JSON + Markdown logs under `openf1/web/logs/`

3. In-run baseline grading
- Source: `openf1/web/scripts/chat-health-check.mjs` + `openf1/web/scripts/chat-health-check-baseline.mjs`
- Behavior:
  - Loads rubric (`--rubric` flag; default baseline rubric)
  - Computes baseline grade and answerability label per row during run
  - Emits both adequacy and baseline columns in the report

4. Regrading path
- Source: `openf1/web/scripts/chat-health-check-grade.mjs`
- Behavior:
  - Regrades a chosen historical JSON file with a chosen rubric (default or intense)
  - Writes `chat_health_check_baseline_*.json/.md`

5. Script entry points
- Source: `openf1/web/package.json`
- Commands:
  - `healthcheck:chat`
  - `healthcheck:chat:intense`
  - `healthcheck:grade`
  - `healthcheck:grade:intense`

### Two grading systems currently coexist

1. Runtime adequacy grading (legacy/coarse)
- Source: `openf1/web/src/lib/chatQuality.ts`
- Design:
  - Lightweight heuristic on answer text + row presence + clarification/completeness flags
  - Most row-backed answers end up as `B` (“Answer appears to address the question”)

2. Rubric/baseline grading (newer/stricter)
- Source: `openf1/web/scripts/chat-health-check-baseline.mjs`
- Design:
  - Per-question rubric checks:
    - answerability expectation (clarification required or not)
    - session and driver scope checks
    - ideal-table usage checks
    - fact-table requirement checks
    - required/forbidden SQL regex patterns
    - anti-generic answer check
    - optional critical checks + minimum score ratio + derived leniency
  - Emits:
    - `baselineGrade` (`A/B/C`)
    - `baselineAnswerability` status
    - check-level failure reason text

### Observable architecture shift (evidence)

1. Older run (adequacy-centric)
- `openf1/web/logs/chat_health_check_2026-03-16T00-48-15-801Z.md`
- Summary: `Grades: B=49, C=1`
- No baseline split shown.

2. Newer intense run (dual grading, stricter diagnostics)
- `openf1/web/logs/chat_health_check_2026-03-17T00-24-31-350Z.md`
- Summary:
  - Adequacy: `B=50`
  - Baseline (intense): `A=21, B=3, C=26`
- This demonstrates the newer rubric layer is now the main differentiator of quality signal.

## 2) What the current grader does well

1. It now detects architectural misses that adequacy misses
- Evidence: all-`B` adequacy alongside 26 baseline `C` grades in the intense run.
- Practical value: highlights that many answers are “plausible” but not using required semantic contracts.

2. It separates answerability handling from quality outcome
- `baselineAnswerability` labels include:
  - `expected_clarification_met`
  - `expected_clarification_missed`
  - `unnecessary_clarification`
  - `answerable_and_answered`
  - `answerable_but_unanswered`
- This is a major improvement over single-score evaluation.

3. It supports per-question strictness and derived-logic pressure testing
- Intense rubric (`openf1/web/scripts/chat-health-check.rubric.intense.json`) adds stronger constraints like:
  - `require_all_ideal_tables`
  - `critical_checks`
  - `required_sql_patterns`
  - higher `minimum_score_ratio`

4. It exposes failed checks in human-readable reasons
- Example baseline reasons in logs include explicit misses like:
  - `all_ideal_tables_used`
  - `required_sql_patterns`
  - `non_generic_answer`
- This is actionable for implementation planning.

5. It supports regrading historical runs
- Enables apples-to-apples comparison across grading policy changes without rerunning the full benchmark.

## 3) What it still gets wrong

1. Over-reliance on letter grades still hides failure type
- Both adequacy and baseline collapse multiple error modes into `A/B/C`.
- A `C` can mean very different things:
  - unresolved session ambiguity
  - semantic-table non-use
  - generic wording
  - SQL pattern miss with otherwise correct logic

2. Baseline grading conflates correctness and compliance
- Current checks heavily reward SQL/table compliance (`ideal_tables`, regex patterns).
- This is useful, but some rows can be factually right while still grading low for contract non-compliance.
- That is a valid enforcement signal, but not a pure correctness signal.

3. Runtime adequacy is still too optimistic for development decisions
- In `chatQuality.ts`, row-backed answers usually get `B` and there is no rigorous numeric-consistency validation.
- This creates false confidence if used as the primary KPI.

4. Rubric fields are richer than what grader actually uses
- `chat-health-check.rubric.json` includes descriptive fields (`ideal_resolution`, `ideal_answer_summary`, `grade_rules`), but scoring logic in `chat-health-check-baseline.mjs` does not consume them directly.
- Result: some intent-level expectations remain informal rather than machine-evaluated.

5. Generic-answer detection is heuristic and brittle
- `detectGenericOrIncompleteAnswer` relies on phrase matching.
- This can yield false positives/negatives depending on narration style.

6. Unlisted question behavior in intense rubric can create mixed strictness
- Intense rubric explicitly states unlisted IDs fall back to default baseline behavior.
- Useful for phased rollout, but weaker as a full-system quality gate.

7. Failure attribution is still inferred manually
- The current output does not explicitly tag rows as `resolver_failure`, `semantic_failure`, `synthesis_failure`, etc.
- Teams still need manual diagnosis from logs.

## 4) Missing evaluation dimensions

The current system is directionally strong, but still missing explicit dimensions needed for trustworthy development guidance.

1. Failure taxonomy dimension (missing)
- Needed labels per question:
  - resolver failure
  - SQL planning failure
  - semantic contract miss
  - synthesis inconsistency
  - source-data insufficiency

2. Evidence consistency dimension (missing)
- Needed checks:
  - numeric claim vs returned values
  - derived rule correctness (for example `stops = stints - 1`)
  - null-sensitive claim gating
- Today this is mostly unmeasured by the grader.

3. Coverage/completeness confidence dimension (missing)
- Distinguish:
  - complete evidence
  - partial/truncated evidence
  - placeholder-session evidence
- Avoid treating all answered rows as equally trustworthy.

4. Contract adherence vs factual correctness split (missing)
- Need separate scores:
  - `factual_correctness_score`
  - `semantic_contract_adherence_score`
- Current baseline merges them in one letter.

5. Benchmark-family KPI dimension (missing)
- Need family-level pass criteria beyond global grade counts.
- Example: lap/strategy/progression families should have dedicated targets and failure breakdowns.

6. Severity and actionability dimension (missing)
- Not all failures are equal.
- Add severity levels (blocker/high/medium/low) and ownership mapping (resolver vs semantic layer vs synthesis).

## 5) Recommended grading redesign / refinement

### A. Keep current components, but change output model

Keep:
- adequacy grader (quick smoke signal)
- baseline rubric grader (contract enforcement)

Add a new multi-axis row schema for every benchmark item:

1. `answerability_status`
2. `factual_correctness_status`
3. `semantic_contract_status`
4. `synthesis_consistency_status`
5. `evidence_completeness_status`
6. `root_cause_primary`
7. `severity`
8. `release_blocking` (boolean)

### B. Split grade into two independent scores

1. `Correctness Score` (truth/evidence alignment)
- validates claims against result data
- penalizes contradictions and invalid derivations

2. `Contract Score` (architecture compliance)
- validates semantic table usage, required SQL patterns, policy adherence

Then keep letter grades as a presentation layer derived from those two scores.

### C. Add explicit root-cause tagging in grader output

Introduce deterministic mapping from failed checks + runtime metadata to root-cause classes, for example:

1. `resolver_failure`
- triggered by unnecessary or missed clarification states

2. `semantic_layer_failure`
- triggered by semantic contract checks (`all_ideal_tables_used`, required semantic patterns)

3. `synthesis_failure`
- triggered by numeric contradiction/derivation checks

4. `data_availability_failure`
- triggered by completeness warnings / missing raw domains / placeholder sessions

5. `sql_planning_failure`
- triggered when query scope/table choice invalidates intent despite answer text quality

### D. Make rubric intent fields executable

Currently `ideal_resolution`, `ideal_answer_summary`, `grade_rules` are mostly descriptive.
Add executable validators tied to these fields (or migrate to explicit validator keys), so intent is scored rather than only documented.

### E. Add family-level scorecards and gates

For each question family, publish:

1. pass rate by dimension
2. dominant root-cause classes
3. median severity
4. trend vs prior run

Recommended immediate gate for decision-making:
- do not use adequacy alone as a release signal
- require baseline + multi-axis thresholds, especially on derived semantic families.

### F. Define actionable statuses besides letter grades

Add standardized statuses that product/engineering can act on directly:

1. `ready`
2. `needs_semantic_object`
3. `needs_resolver_rule`
4. `needs_synthesis_guard`
5. `blocked_by_source_data`

These are more useful than a raw `B`/`C` for sprint planning.

---

## Bottom line

The grading architecture has improved substantially: it now catches real architectural weakness that the old adequacy score masked. But it is not yet a fully trustworthy development control signal because it still compresses multiple failure types into letter grades and does not explicitly score factual consistency versus contract compliance.

If you adopt a multi-axis grading model with explicit root-cause labels and family-level gates, the benchmark system can move from “diagnostic snapshot” to “reliable steering system” for implementation decisions.
