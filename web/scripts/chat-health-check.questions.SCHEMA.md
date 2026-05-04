# Chat health-check question schema

Source files: `web/scripts/chat-health-check.questions.json` (curated 50q
baseline) and the per-category Phase 19 files
`web/scripts/chat-health-check.questions.<category>.json` (Slice 19-B).

The healthcheck loader (`web/scripts/chat-health-check.mjs`) treats each
file as a flat array of question records. Every record MUST be valid
JSON (RFC 8259) — `JSON.parse` is the loader, so `//` line comments are
forbidden inside the source files. The JSONC block below is for human
documentation only; the second block is the copy-paste-ready valid JSON.

## Fields

### Required on every question

| Field | Type | Notes |
|---|---|---|
| `id` | integer | Stable across runs. New Phase 19 categories use the 1700+ range. |
| `category` | string | One of: `metadata`, `pace`, `stint`, `dominance`, `corner`, `braking`, `traction`, `straight_line`, `tyre`, `traffic`, `pit`, `overtake`, `restart`, `weather`, `incident`, `driver_score`, `data_health`, `proprietary_no_data`, `cross_category`. |
| `complexity` | `"low"` \| `"medium"` \| `"high"` | Per Phase 19 rubric. |
| `expected_outcome` | `"answer"` \| `"clarification"` \| `"insufficient_data"` | Drives the grader branch. |
| `question` | string | The user-visible prompt. |

### Required when `expected_outcome === "answer"` AND a contract is asserted

| Field | Type | Notes |
|---|---|---|
| `expected_path` | enum (see below) | Soft expectation; reported but not gated. |
| `expected_tables` | string[] | Each entry is `<schema>.<table_or_view>`. |
| `expected_columns` | string[] | Fully-qualified `<schema>.<table>.<column>` form. **Unqualified names like `compound_name` are NOT accepted.** |
| `expected_grade_floor` | string \| object | See "Grade floor shape" below. |

### Optional fields

| Field | Type | Notes |
|---|---|---|
| `floor_active_after_slice` | string \| `null` | Slice id (e.g. `"21-corner-analysis"`) after which the per-question floor is enforced. Default `null` = active immediately. |
| `column_match_waiver` | boolean | When `true`, the gate accepts a `kind: "skipped"` outcome from the alias-aware expected-columns matcher (e.g. CTE-projected SQL). Without a waiver, `skipped` fails the gate. |
| `author_note` | string | **Required when `column_match_waiver: true`.** Short justification reviewed at PR time. |

## `expected_path` enum

```
anthropic                   — LLM-generated SQL on first attempt (the happy path).
anthropic_repaired          — LLM-repaired after the column-validator caught a column miss.
deterministic_template      — A static template matched and ran without an LLM call.
runtime_clarification       — buildChatRuntime decided clarification was needed.
sql_generation_failed       — Honest 17-D failure (validator caught hallucinated columns).
no_data_refusal             — Phase 19-A proactive INSUFFICIENT_DATA refusal (proprietary-no-data class).
```

## Grade floor shape

Either a string (most common) or an object form when an axis-specific
floor is needed:

```jsonc
"expected_grade_floor": "A"

// or, axis-specific:

"expected_grade_floor": {
  "baselineGrade": "A",
  "axes": { "factual_correctness": "A" }
}
```

The gate (Slice 19-D) compares each question's `baselineGrade` (the
rubric-graded output from `chat-health-check-baseline.mjs`, NOT the
runtime `adequacyGrade`) against the floor. If the object form's
`axes` map is set, every named axis grade (`factual_correctness`,
`completeness`, `clarity`) must also meet its declared floor.

Default if the field is absent: `"A"` for `complexity ∈ {low, medium}`,
`"B"` for `complexity: high`.

## Activation lifecycle (`floor_active_after_slice`)

Slice 19-B writes 0-A-grade questions for new analytics categories on
purpose (the system can't answer them yet). Setting
`floor_active_after_slice: "21-<lift-slice>"` defers per-question floor
enforcement until that slice has flipped to `"merged"` in
`diagnostic/slices_status.json`. When a lift slice merges, its PR MUST
null this field on every question it lifts (the gate fails the PR if
a slice is `"merged"` and any question still references it via
`floor_active_after_slice`).

## `expected_columns` matcher

The PR-time gate uses `extractQualifiedColumnRefs` (exported from
`web/src/lib/sqlValidation/columnExistenceCheck.ts`) to resolve generated
SQL aliases against `<schema>.<table>` before comparing to
`expected_columns`. Outcome shape:

```ts
| { kind: "pass"; matched: string[] }
| { kind: "fail"; missing: string[]; observed: string[] }
| { kind: "skipped"; reason: "parse_failed" | "cte_unresolved" | "no_expected_columns"; details: string };
```

PR-gate rules:

- `pass` → A on the column-match axis.
- `fail` → fails the gate. The report lists missing + observed columns.
- `skipped` → fails the gate UNLESS the question declares
  `column_match_waiver: true` with an `author_note`. Authors who need
  CTE-projected coverage either set the waiver with a justification,
  rewrite to direct-table SQL, or rely on `expected_tables` matching
  (which still works through CTE bodies that name the underlying
  analytics table).

## Example records

### JSONC (annotated for humans — NOT valid JSON, do not copy-paste)

```jsonc
{
  // Stable across runs. Phase 19 IDs are in the 1700+ range.
  "id": 1701,
  // One of the 18 enumerated categories.
  "category": "Track dominance",
  // low / medium / high per the Phase 19 rubric.
  "complexity": "medium",
  // answer / clarification / insufficient_data — drives the grader branch.
  "expected_outcome": "answer",
  // Soft expectation; reported, not gated.
  "expected_path": "anthropic",
  // Each entry is <schema>.<table_or_view>.
  "expected_tables": ["analytics.minisector_dominance"],
  // Fully-qualified <schema>.<table>.<column> form is REQUIRED when
  // expected_tables.length > 0. Unqualified names like "compound_name"
  // are NOT accepted (false-positives on common keys like
  // session_key/driver_number/lap_number).
  "expected_columns": [
    "analytics.minisector_dominance.dominant_count",
    "analytics.minisector_dominance.minisector_index"
  ],
  // String form OR object form with optional axes map.
  "expected_grade_floor": "A",
  // null OR a slice id from diagnostic/slices_status.json. Defers
  // per-question floor enforcement until the named slice merges.
  "floor_active_after_slice": "21-minisector-dominance",
  // Optional. When true, requires author_note. Lets the matcher's
  // "skipped" outcome count as "not a regression" for THIS question.
  "column_match_waiver": false,
  // Required when column_match_waiver: true.
  "author_note": null,
  // The user-visible prompt.
  "question": "Who dominated the most mini-sectors at Silverstone 2025 between Verstappen and Norris?"
}
```

### Valid JSON (copy-paste-ready — same record as above without comments)

```json
{
  "id": 1701,
  "category": "Track dominance",
  "complexity": "medium",
  "expected_outcome": "answer",
  "expected_path": "anthropic",
  "expected_tables": ["analytics.minisector_dominance"],
  "expected_columns": [
    "analytics.minisector_dominance.dominant_count",
    "analytics.minisector_dominance.minisector_index"
  ],
  "expected_grade_floor": "A",
  "floor_active_after_slice": "21-minisector-dominance",
  "column_match_waiver": false,
  "author_note": null,
  "question": "Who dominated the most mini-sectors at Silverstone 2025 between Verstappen and Norris?"
}
```

### `expected_outcome: "insufficient_data"` example (proprietary-no-data class)

```json
{
  "id": 1750,
  "category": "Proprietary no-data",
  "complexity": "low",
  "expected_outcome": "insufficient_data",
  "expected_path": "no_data_refusal",
  "expected_grade_floor": "A",
  "floor_active_after_slice": null,
  "question": "What was the brake temperature at Turn 8 for Hamilton in Monza 2025?"
}
```

The Phase 19-A grader branch awards:

- A when `generationSource === "no_data_refusal"` (proactive refusal).
- B when `generationSource === "sql_generation_failed"` with
  `missingColumns` populated (honest failure, but the LLM tried to query
  hallucinated columns instead of refusing proactively).
- C when `generationSource === "runtime_clarification"` (wrong refusal
  class — clarification asked where refusal was expected).
- C when a normal-shaped answer comes back (the chat hallucinated where
  it should have refused).

## Authorship policy (Phase 19-B)

LLM-assisted drafting is permitted to reach the 150-question floor on
schedule, but every drafted question goes through:

1. Human rubric review (does it match the complexity tier? does
   `expected_outcome` match the data we have?).
2. Duplicate check vs the curated 50q + sibling category files.
3. **Author-supplied** (not LLM-supplied) `expected_outcome`,
   `expected_tables`, `expected_columns`. The LLM may propose phrasings;
   humans decide what "correct" looks like.

The slice author commits both the source set and a one-line review-status
note per question.
