# Phase 24 — Per-question A-grade iteration roadmap — 2026-05-04 (rev1: autonomous-launch)

## Autonomous launch

Operator runs ONE command:

```bash
nohup python3 scripts/phase24_autonomous_loop.py \
  --baseline diagnostic/phase_19_baseline_2026-05-04.json \
  --base-url http://127.0.0.1:3000 \
  --max-iterations 10 \
  --max-runtime-hours 24 \
  --resume \
  > logs/phase24_autonomous_loop.out 2>&1 &
```

The driver:
1. Reads the latest baseline.
2. Identifies non-A questions whose `floor_active_after_slice` is null
   (active-floor only — deferred questions stay deferred until their
   lift slice ships).
3. For each, runs the per-slice template (hypothesis → impl →
   validate → loop → skip / merge).
4. Caps each slice at 10 iterations; codex calls a skip-decision audit
   on the 10th attempt.
5. Auto-commits per merged slice; auto-reverts the worktree on a
   no-regression failure.
6. Resumable: re-running with `--resume` picks up where it left off
   based on `scripts/loop/state/phase24_progress.json`.
7. Mirrors progress to `_state.md` so `tail -f _state.md` from another
   shell shows live progress while you're away.

Stop with `kill <pid>`; the driver checkpoints between slices so a
mid-iteration kill loses at most 10 minutes of work.

Goal: drive every Phase 19 benchmark question to A-grade via the
autonomous loop runner ([scripts/loop/runner.sh](../scripts/loop/runner.sh)).
Each non-A question becomes a slice. Slice flow per question:

1. **Diagnose** failure mode from the latest baseline run.
2. **Form hypothesis**: what specific change would lift this question to A?
3. **Codex audit** the hypothesis before code lands.
4. **Implement** the fix in a worktree.
5. **Validate** by re-running that single question.
6. **Iterate** up to N times if still not A.
7. **No-regression** gate against prior A'd questions.
8. **Codex skip-decision** if cap hit; merge if A; skip if codex
   approves "data doesn't support an A".

The existing runner.sh + dispatchers already handle worktree creation,
codex/Claude dispatch, merge, status tracking. Phase 24 adds five
infrastructure slices, then **one slice per non-A question**
(currently ~88 slices) under the per-question iteration template.

---

## Phase 24 budget

- **Phase 24-A through 24-E**: 5 infrastructure slices, ~3 days total.
- **Phase 25 iter-19-q<id> slices**: one per non-A question. Today's
  baseline shows **88 non-A questions** (79 A / 27 B / 61 C of 167).
  Per-slice budget ~20 min runner-wallclock (one diagnose pass +
  one fix attempt + one validation re-run is ~10 min; cap 10 attempts).
  88 × 20 min = ~30 hours runner-wallclock if every slice runs to cap.

The per-question slice budget is intentionally tight — most slices
should land in 1 iteration once the hypothesis is right. The cap
exists so a stuck slice doesn't burn the budget on its own.

---

## Phase 24-A — per-question runner

**Goal**: extend the benchmark runner to target a single question by
ID, so iteration validation is fast (one POST instead of 167).

**Steps**:

1. Extend [run_category_benchmarks.mjs](../web/scripts/run_category_benchmarks.mjs)
   with `--question <id>[,<id>...]` arg. When set, only those question
   IDs run (loaded from any category file). Output goes to
   `web/logs/question_iteration_<id>_<runId>.json`.
2. Add `--retries <N>` arg. Re-runs each question up to N times to
   debounce flaky LLM responses; takes the BEST grade across attempts
   so a single C among 3 A's promotes to A. Default N=1.
3. Reuse the existing graded-row shape (Slice 19-A schema). Output
   includes `iterationAttempt` per row.
4. Unit test: pass a fake question ID list, assert the runner loads
   exactly those questions and POSTs only to the expected count.

**Acceptance**:
- `node web/scripts/run_category_benchmarks.mjs --question 1758` runs
  in <60s end-to-end against the dev server.
- Output JSON conforms to the existing graded-row shape and is
  consumable by `chat-health-check-baseline.mjs:gradeHealthCheckResults`.

**Codex audit ask**:
- Is `--retries N` a sound debouncer or does it mask real flakiness?
- Should the runner emit a structured failure-mode tag in the output
  row (saves a downstream classifier pass)?

---

## Phase 24-B — failure-mode classifier

**Goal**: given a graded question result, output a structured
failure-mode tag + the fix-vector hypothesis.

**Failure modes** (extracted from Phase 19 baseline analysis):

| Tag | Signal | Fix vector |
|---|---|---|
| `proprietary_leak_missed` | gen=anthropic on a `proprietary_no_data` question | extend `PROPRIETARY_NO_DATA_TOPICS` |
| `clarification_overfire` | gen=runtime_clarification on a venue+year question | extend `RACE_SHAPED_MARKERS` or scope-narrow the deny-list |
| `column_hallucination` | gen=sql_generation_failed | extend raw-table reminder block (Fix 4 pattern) |
| `timeout_via_proximity_join` | gen=heuristic_after_sql_timeout AND SQL contains timestamp-proximity shape | extend `joinPatternsCheck.ts` to flag the pattern |
| `timeout_other` | gen=heuristic_after_sql_timeout but no proximity shape | requires per-case investigation; possibly Phase 21 matview |
| `repaired_to_zero_rows` | gen=anthropic_repaired with rowCount=0 | repair-LLM hint extension |
| `wrong_rows_synthesis` | rowCount>0 but answer fails factual_correctness | synthesizer prompt issue |
| `proven_data_unavailable` | matched by Fix 6 classifier | already correctly graded B; skip |
| `requires_phase21_lift` | question's `floor_active_after_slice` references an unshipped slice AND no other fix vector applies | skip until lift slice ships |

**Steps**:
1. Add [scripts/phase24_classify_failure.py](../scripts/phase24_classify_failure.py)
   that reads a graded result row and emits `{ failureMode, rationale,
   suggestedFixVector }`.
2. The classifier is deterministic (rule-based) for the well-known
   signals above; falls through to `unknown` if no rule fires.
3. Unit test with synthetic graded rows for each failure mode.

**Acceptance**:
- All 88 non-A questions in the 2026-05-04 baseline classify into
  one of the named modes (no `unknown`).
- Classification output is JSON-stable (re-running on the same input
  produces byte-identical output).

**Codex audit ask**:
- Are the failure modes mutually exclusive, or can a single question
  legitimately match two?
- Is `requires_phase21_lift` the right fall-through, or are there
  questions whose floor is null but legitimately need Phase 21?

---

## Phase 24-C — hypothesis-formation codex prompt + audit gate

**Goal**: per non-A question, codex generates a fix hypothesis grounded
in the failure-mode classifier output AND the surrounding code paths.

**Prompt template** (`scripts/loop/prompts/per_question_hypothesis.md`):

```
You are auditing a Phase 19 benchmark question that did not grade A.

Question id: {{ID}}
Category: {{CATEGORY}}
Complexity: {{COMPLEXITY}}
Question text: "{{QUESTION}}"
Last attempt's graded result: {{GRADED_JSON}}
Failure mode (from classifier): {{FAILURE_MODE}}
Suggested fix vector: {{FIX_VECTOR}}

Read these reference files before responding:
- diagnostic/phase_19_outcome_fix_plan_2026-05-03.md (the layered fix taxonomy)
- web/src/lib/chatRuntime/proprietaryNoData.ts (if proprietary_*)
- web/src/lib/chatRuntime.ts (if clarification_*)
- web/src/lib/anthropic.ts (if column_*/repaired_*)
- web/src/lib/sqlValidation/joinPatternsCheck.ts (if timeout_via_proximity_join)
- web/src/lib/sqlValidation/columnExistenceCheck.ts (if column_hallucination)

Output STRICT JSON (no surrounding prose):
{
  "verdict": "PROCEED" | "REVISE" | "SKIP",
  "skipReason": "<set when verdict=SKIP>",
  "hypothesis": "<one-sentence summary of the proposed change>",
  "fixVectorConfirmed": true | false,
  "files": [{"path": "<repo-relative>", "changeKind": "extend|patch|new", "details": "<one line>"}],
  "validationCommand": "<single shell command that re-runs only this question and asserts A-grade>",
  "regressionRisk": "low" | "medium" | "high",
  "codexConfidence": 0.0-1.0
}

PROCEED = a code change is well-defined and likely to lift this question to A.
REVISE = the suggested fix vector doesn't apply OR the failure-mode classification is wrong; rewrite.
SKIP = the underlying data does not support an A-grade answer (e.g. requires Phase 21 matview, or proven_data_unavailable).
```

**Steps**:
1. Add prompt template at the path above.
2. Add `dispatch_per_question_hypothesis.sh` that wraps `codex exec`
   with the rendered prompt and parses the JSON response (regex
   `<verdict-json>{...}</verdict-json>` block, falling back to first
   valid JSON object found if the wrapping convention isn't honored).
3. Codex's response is stored at
   `scripts/loop/state/iter_19_q<id>_hypothesis.json` for audit-trail.
4. If `verdict === "SKIP"`, the slice transitions directly to
   `merged_skipped` in `slices_status.json` (new status; see 24-D)
   and the runner moves to the next slice without dispatching a
   Claude implementation pass.

**Acceptance**:
- Dispatcher produces a valid hypothesis JSON on a sample question
  in <120s.
- SKIP path correctly fast-paths the slice without dispatching impl.

**Codex audit ask**:
- Is "single shell command that asserts A-grade" the right
  validation contract, or should we also gate on the no-regression
  pass before calling the slice green?
- Should `regressionRisk: high` automatically force a manual
  operator review even on PROCEED, or just inflate the iteration
  cap?

---

## Phase 24-D — iteration cap + skip-decision gate

**Goal**: every per-question slice has an iteration cap. After the
cap, codex audits the cumulative attempt history and decides:
continue (rare), skip (common), or escalate-to-operator (when
regression risk turned out to be high).

**Steps**:
1. Add `MAX_ITERATIONS=10` env var in `runner.sh` for
   `iter-19-q*` slices.
2. State machine per slice:
   - `pending` → `hypothesis_pending` → `impl_in_flight` →
     `validation_pending`.
   - On validation A: → `merged`.
   - On validation not-A: increment `iteration_count` in slice state;
     if `< MAX_ITERATIONS`, loop back to `hypothesis_pending` with the
     latest attempt's graded result fed in (codex sees what didn't
     work).
   - On `iteration_count >= MAX_ITERATIONS`: dispatch
     `dispatch_per_question_skip_audit.sh` — codex emits SKIP /
     CONTINUE / ESCALATE.
3. New slice statuses in `slices_status.json`:
   - `merged_skipped` — codex approved skip; baseline records the
     question as deliberately not-A (different from a regression).
   - `escalated` — operator review required; runner halts the slice
     and continues with others.
4. The skip-audit prompt template
   (`scripts/loop/prompts/per_question_skip_audit.md`) summarizes the
   N attempts, asks codex whether the data fundamentally supports an
   A-grade answer.

**Acceptance**:
- Three failed-iteration mock runs trigger the skip-audit path.
- A `merged_skipped` slice does NOT contribute to the active-floor
  A-rate denominator (the regression gate scopes A-rate to slices
  not in the skipped set).

**Codex audit ask**:
- Is `MAX_ITERATIONS=10` the right cap, or should it scale with
  `regressionRisk`?
- Should `merged_skipped` slices contribute to a "skip-rate" metric
  in the gate's exit summary, separate from A-rate?

---

## Phase 24-E — no-regression gate

**Goal**: every per-question fix re-validates the questions that
WERE A in the previous baseline. A fix that lifts question X to A
but flips question Y from A to B/C is a net loss and the slice is
auto-rejected.

**Steps**:
1. Add `scripts/phase24_no_regression_gate.py` that:
   - Reads the prior baseline JSON (the snapshot that the iter-19-q*
     slice is iterating against).
   - Identifies all questions that were A in the prior baseline.
   - Re-runs them via the existing
     `run_category_benchmarks.mjs --question <id-list>`.
   - Asserts every previously-A question is still A.
   - Exits non-zero if any previously-A question regresses.
2. Wire into `runner.sh` after the validation pass and BEFORE the
   merge dispatch. If the gate fails, the slice transitions to
   `validation_failed_regression` and codex gets the regression list
   in the next hypothesis pass.
3. Performance budget: re-running 79 previously-A questions takes
   ~30 minutes per slice. To make this tractable, the gate uses a
   stratified subsample by default (10 questions across 5 categories)
   and runs the full 79 only on the FINAL iteration before merge.

**Acceptance**:
- A synthetic regression (intentionally break Fix 1's plural match,
  re-run gate) → gate fails non-zero with the regressed question id
  named.
- Stratified subsample mode runs in <8 min.

**Codex audit ask**:
- Is the stratified-subsample design sound, or should we always run
  the full 79? (Trade-off: speed vs. catching rare regressions.)
- Should the no-regression gate scope the curated 50q (which already
  has a stable rubric) instead of just Phase 19's prior-A set?

---

## Phase 25 — per-question iteration slices

**Slice naming**: `iter-19-q<id>` where `<id>` is the question's
numeric ID from `chat-health-check.questions.<category>.json`.

**Slice generation** ships in **Phase 24-F** (one-shot generator):

1. Read `diagnostic/phase_19_baseline_2026-05-04.json`.
2. For every question with `baselineGrade !== "A"` AND
   `floor_active_after_slice IS NULL` (active-floor only by default;
   deferred questions stay deferred until their lift slice ships):
   - Append `iter-19-q<id>` to `slices_status.json` at status
     `pending`.
   - Set `depends_on: []` so the runner is free to interleave.
3. Total expected count: 18 active-floor non-A questions today
   (active 39 — 21 A — 0 not-yet-graded = 18). The deferred-floor
   71 non-A questions are NOT seeded by default; a follow-up plan
   handles them once Phase 21 starts shipping.

**Per-slice template** (every iter-19-q* slice runs this flow under
`runner.sh`):

```
1. preconditions: slices_status.json valid, dev server reachable on port 3001.
2. dispatch_per_question_hypothesis (Phase 24-C):
     IN: question id + last graded row + failure-mode classifier output
     OUT: codex hypothesis JSON
   IF verdict=SKIP: transition to merged_skipped, exit slice.
   IF verdict=REVISE: re-classify and re-prompt up to 1 retry.
   IF verdict=PROCEED: continue.
3. dispatch_claude_per_question_impl:
     IN: hypothesis JSON
     OUT: a single-file or small-multi-file change in a worktree
4. dispatch_per_question_validation:
     run `node run_category_benchmarks.mjs --question <id> --retries 2`
     parse the result row, check baselineGrade === "A"
   IF A: continue.
   IF not A: increment iteration_count, loop back to step 2 (with
            previous-attempt's failure fed in).
   IF iteration_count >= MAX_ITERATIONS:
     dispatch_per_question_skip_audit (Phase 24-D)
     IF codex says SKIP: merged_skipped.
     IF codex says CONTINUE: increment cap by 1 (max 5 absolute).
     IF codex says ESCALATE: status=escalated, exit slice.
5. phase24_no_regression_gate (Phase 24-E):
     subsample re-run on iterations 1-2.
     full 79 on iteration 3.
   IF regression: revert worktree, transition to
                  validation_failed_regression, loop back to step 2.
6. dispatch_merger: merge worktree, mark slice merged.
```

**Acceptance** (per Phase 25 slice):
- The target question grades A on at least one of two retries against
  the post-merge dev server.
- No previously-A question regressed (no-regression gate green).
- Codex hypothesis JSON is committed alongside the impl PR for
  audit-trail.

**Acceptance** (Phase 25 aggregate, after all slices land):
- Aggregate A-rate ≥ baseline_old + (N_merged / 167) where
  `N_merged` is the count of `iter-19-q*` slices in `merged` (not
  `merged_skipped`).
- Active-floor 39 A-rate ≥ 77% (per the prior outcome-fix plan's
  acceptance bar).
- Skip-rate (merged_skipped count / total iter-19-q* slices) is
  reported in the exit summary; >25% triggers a follow-up plan
  audit (likely indicates a missing fix vector).

---

## Cross-cutting safety

- **Worktree isolation**: every iter-19-q* slice runs in its own
  worktree (existing `worktree_helpers.sh`). Failed slices revert
  cleanly; merged slices update `main` via the existing dispatcher.
- **Codex budget**: each slice budgets ≤4 codex calls (1 hypothesis
  + up to 3 iteration re-prompts). At $X/call × 4 × 88 = total
  Phase 25 cost. Budget gates fire if a slice exceeds 5 codex calls.
- **Test discipline**: every code change in a slice MUST land with
  an updated unit test (failure-mode classifier requires it; the
  impl dispatcher's prompt template includes "your impl must include
  a test fixture for this question's failure mode").
- **Status mirror**: every state transition mirrors to
  `_state.md` via the existing `update_state.sh` so the operator
  can `tail -f` progress.

---

## Out of scope

- **Deferred-floor 71 non-A questions**: these wait for Phase 21
  lift slices; iter-19-q* slices for them spin up only after their
  lift slice merges (a successor plan covers this).
- **Synthesizer-side fixes**: questions where the SQL ran with rows
  but synthesis got the answer wrong are flagged
  `wrong_rows_synthesis`; the per-slice template handles these but
  the fix vector is "edit the synthesizer prompt", which is a global
  change and may regress other categories. These slices ship serial
  with extended no-regression gates.
- **ML-model questions** (Phase 22 dependencies): explicitly out of
  scope; defer to Phase 22 acceptance.
- **Curated 50q regressions**: Phase 24's no-regression gate covers
  Phase 19 prior-A only by default. The curated 50q has its own
  gate (`web/scripts/category_regression_gate.mjs`) — running both
  is the operator's choice but not enforced here.

---

## Codex audit ask (for rev0 → rev1)

This is rev0; the existing per-revision audit pattern applies. Codex
should run an audit pass on this plan before any code lands and
return findings as the prior plan format (HIGH/MEDIUM/LOW with file
paths + line numbers + concrete fix-the-fix language). Specific
audit angles for this plan:

1. **Slice count budget**: 88 slices is a lot of runner-wallclock.
   Should we bound to active-floor 18 first, validate the
   infrastructure, then unblock the remaining 70 deferred ones in
   a follow-up plan? (My current draft does exactly this in §"Phase
   25 slice generation step 2 — active-floor only by default.")
2. **Skip vs continue economics**: a `merged_skipped` slice doesn't
   move A-rate up but consumes ~10 min runner-wallclock plus codex
   calls. Is the skip-decision audit cost worth it for active-floor
   questions where the answer is almost certainly "needs Phase 21"?
3. **Hypothesis dispatcher's JSON contract**: codex doesn't
   reliably emit clean JSON without a wrapping convention. Should
   we mandate `<verdict-json>...</verdict-json>` and fail-fast on
   parse error (slice goes to `escalated`)?
4. **No-regression gate scope**: stratified subsample of 10
   questions risks missing a regression that lives in the 69
   un-sampled. Is "stratified subsample on iterations 1-2, full on
   iteration 3" the right speed/safety trade-off?
5. **Failure-mode mutual exclusivity**: in 24-B, can a single
   question fall into multiple failure modes? If so, does the
   classifier output an ordered list (primary + secondary)?
6. **Iteration cap variability**: should the cap scale with
   `regressionRisk`? E.g., low-risk = 5 attempts, high-risk = 1.
7. **Worktree merge cadence**: 88 worktree merges to main could
   produce noisy commit history. Should we squash N successive
   iter-19-q* slices into a single roll-up commit at the end? (My
   draft says one commit per slice for audit-trail clarity.)

If APPROVED at rev-N, next step is **Phase 24-A** (the runner extension
for `--question <id>`), which is the smallest piece and verifies the
measurement loop end-to-end on a single question.
