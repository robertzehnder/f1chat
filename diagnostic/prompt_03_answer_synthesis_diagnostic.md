# Prompt 3 Diagnostic: Answer Synthesis Layer

## 1) Current synthesis architecture

### Pipeline location

Answer synthesis is centralized in the chat API route and Anthropic helper:

- Orchestration: `web/src/app/api/chat/route.ts`
- LLM synthesis call: `synthesizeAnswerWithAnthropic(...)` in `web/src/lib/anthropic.ts`
- Fallback synthesis: `buildFallbackAnswer(...)` in `web/src/app/api/chat/route.ts`

### Current runtime flow (post-query)

1. SQL is generated (deterministic template, LLM, or heuristic fallback).
2. SQL is executed in preview mode (`runReadOnlySql(..., { preview: true })`).
3. If rows exist:
   - route calls `synthesizeAnswerWithAnthropic` with:
     - question
     - SQL text
     - returned rows
     - row count
     - runtime metadata
4. If synthesis fails:
   - route falls back to `buildFallbackAnswer` (generic row-summary narration).

### Important constraints in current synthesis

1. Synthesis prompt requests only concise prose JSON (`answer`, `reasoning`) and does not enforce numeric self-consistency checks.
- Evidence: `web/src/lib/anthropic.ts` synthesis prompt.

2. Synthesis sees only sampled rows (`rows.slice(0, 25)`), even when more rows are returned.
- Evidence: `web/src/lib/anthropic.ts` uses `const rowsForPrompt = input.rows.slice(0, 25);`.

3. Query execution is preview-limited, and truncation status is not used as a hard synthesis guard.
- Evidence: `web/src/lib/queries.ts` preview execution + truncation behavior; route still synthesizes directly from preview result.

4. There is no deterministic post-synthesis validator before final answer is returned.
- Evidence: `web/src/app/api/chat/route.ts` returns synthesized answer directly after coarse quality scoring.

### What it does well today

1. Unified synthesis path across generation sources
- Deterministic/LLM/heuristic SQL all converge to one narration mechanism.

2. Includes runtime context + SQL + row sample
- Helps the model produce grounded answers in many straightforward cases.

3. Has graceful fallback
- If synthesis fails, users still get a minimal evidence summary instead of hard failure.

## 2) Observed synthesis weakness patterns

Using `web/logs/chat_health_check_2026-03-17T00-24-31-350Z.md` and prior run artifacts, recurring patterns are:

### Pattern A: internally contradictory comparative narration

Example: sector comparison answers assert both sides of the same claim.

- Q23/Q30 narrative claims Leclerc has S3 average advantage while also stating Verstappen’s S3 average is better.
- Evidence:
  - sector values in result summary show `avg_s3` favors Verstappen.
  - answer text still states Leclerc edge in S3 averages before contradicting itself.

This is synthesis inconsistency, not SQL failure, because row reasoning and row summary are coherent.

### Pattern B: derived interpretation error from correct base facts

Example: stop-count interpretation from stint counts.

- Q42 lists 2 stints (Verstappen) and 3 stints (Leclerc), then says “two-stop” and “three-stop” strategies.
- Correct mapping should be `stops = stints - 1`.
- This exact phrasing recurs across multiple benchmark logs:
  - `chat_health_check_2026-03-17T00-24-31-350Z.md`
  - `chat_health_check_2026-03-16T13-53-15-369Z.md`
  - `chat_health_check_2026-03-16T12-59-56-916Z.md`

This is a synthesis rule failure, not a query failure.

### Pattern C: over-assertive conclusion with missing prerequisite fields

Example: pit-cycle position gain claims.

- Q45 answer says one driver “gained better track position” while also admitting `pre_pit_position` is null.
- Result rows explicitly show null pre-pit fields.
- This should be constrained to “cannot determine positions gained” + optional descriptive post-pit positions.

This is “stronger-than-evidence” narration.

### Pattern D: count/list consistency failure in long enumerations

Example: driver-all-sessions list formatting.

- Q18 says “All 20 drivers...” while the listed names are fewer than 20 unique entries in some runs.
- This mismatch recurs in some historical logs with variant counts and team attribution shifts.

This is a synthesis integrity issue (count-to-list parity), not necessarily SQL wrongness.

### Pattern E: confidence strength mismatch

- Some answers use decisive wording even when underlying evidence is sparse, partial, or caveated.
- Opposite also occurs: occasionally answers are more tentative than row evidence requires.

## 3) Likely root causes

### Root cause 1: no structured answer contract before prose

Synthesis currently jumps from row sample to free-form prose.
No intermediate typed object enforces:
- metric winners
- uncertainty level
- comparison direction
- derived rules (e.g., stints -> stops)

### Root cause 2: sampled-row synthesis without row-shape validation

- Only first 25 rows are sent to synthesis.
- No verification that the sampled rows are sufficient for requested claim type.

### Root cause 3: missing domain guardrails for common derived inferences

No deterministic guards for:
- stop-count mapping
- comparative sign consistency (`avg_a < avg_b`)
- null-dependent claims (cannot infer gains when pre values null)

### Root cause 4: quality checks are coarse and do not validate factual consistency

- `chatQuality` mainly checks generic adequacy, not numerical consistency.
- Row-backed narrative usually receives acceptable grade even if internally inconsistent.

### Root cause 5: synthesis asked to be concise but not asked to be auditable

Prompt emphasizes short prose and general grounding, but not strict claim-to-field traceability.

## 4) Missing validation/sanity-check layer

A lightweight post-query validation layer is currently missing. It should sit between SQL result and narration.

### Missing checks (high value)

1. Numeric comparison consistency check
- For comparative answers, verify each stated winner against actual metric values in result rows.

2. Derived-rule checks
- Enforce known formulas, e.g.:
  - `pit_stops = stints - 1`
  - position gains require both start and finish/pre and post values.

3. Null-sensitive claim gating
- If required inputs are null, block decisive claims and enforce uncertainty phrasing.

4. Count/list parity check
- If answer states `N` entities, ensure exactly `N` are listed (or require “sample” wording).

5. Truncation and sample adequacy check
- If query output is truncated/sampled, prevent “definitive” wording unless aggregation explicitly guarantees correctness.

6. Claim strength guard
- Map evidence completeness to allowed certainty labels (`definitive`, `likely`, `insufficient`).

### Distinguishing error classes (required operationally)

1. SQL/query error
- Wrong rows returned or missing needed columns.

2. Semantic-layer error
- Correct raw rows but missing canonical derived semantics causing fragile logic.

3. Answer-synthesis error
- Rows are directionally correct, but prose contradicts, overstates, or mis-derives.

Current system does not explicitly classify failures into these buckets before returning the final answer.

## 5) Recommended design improvements

Keep this practical and incremental.

### Step 1: add structured synthesis contracts per question family

Before narration, build a typed “answer payload” object from rows:
- Example fields for comparison:
  - `metric_name`
  - `driver_a_value`
  - `driver_b_value`
  - `winner`
  - `delta`
  - `confidence_level`
  - `blocking_nulls`

Narration should then be generated from this validated payload, not directly from raw row sample.

### Step 2: implement a minimal validator library (deterministic)

Add reusable validators for the recurring failures:
1. sector/pace winner consistency
2. stints-to-stops derivation
3. null-gated pit-cycle inference
4. count/list parity
5. truncation-aware certainty policy

If validator fails:
- either downgrade claim strength automatically,
- or replace with conservative template sentence.

### Step 3: split synthesis into two passes

1. Pass A: extract structured facts (JSON schema, strict keys).
2. Pass B: prose rendering from validated facts.

This gives traceability and makes contradictions detectable.

### Step 4: add synthesis-specific benchmark checks

Extend health-check grading to include:
- contradiction detection against returned values,
- derived-rule correctness checks,
- evidence-strength calibration checks.

### Step 5: introduce per-family fallback templates

For high-risk families (sector comparisons, pit strategy, race progression):
- use deterministic sentence templates when validator confidence is low.
- This avoids plausible-but-wrong prose while keeping system simple.

---

## Summary

The synthesis layer is functional but currently “free-form and optimistic.”
It performs well for straightforward summaries, but recurring benchmark artifacts show a stable class of correctness failures where rows are usable and narration is wrong or inconsistent.

The highest-leverage fix is to add a lightweight structured fact contract + deterministic validation between query output and final prose, with targeted domain guards for strategy/comparison/progression answers.
