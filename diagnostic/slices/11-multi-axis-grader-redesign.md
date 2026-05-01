---
slice_id: 11-multi-axis-grader-redesign
phase: 11
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-05-01T20:30:00Z
---

## Goal
Redesign the chat-quality grader so each healthcheck row carries three independent axis grades — **factual_correctness**, **completeness**, **clarity** (each `A`/`B`/`C` plus a reason string) — replacing today's single `answer_grade` / `semantic_conformance_grade` fields. Update the healthcheck artifact schema, the offline grader pipeline (`web/scripts/chat-health-check-*`), the runtime grader (`web/src/lib/chatQuality.ts`), and every downstream consumer (`scripts/loop/update_state.sh`, fixtures, regression tests) so the new schema round-trips end-to-end.

## Inputs
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` (latest in-tree healthcheck artifact at author time; the 2026-04-26 file referenced earlier does not exist on disk)
- Specific failing-question IDs identified from that artifact's rows where `answer_grade` is `C` or `semantic_conformance_grade` is `C`

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/11-rerun-benchmark-baseline.md`

## Required services / env
None at author time. The slice is offline: it only edits TS/MJS/JSON under `web/`, fixtures under `web/scripts/tests/fixtures/`, and the loop state shaping in `scripts/loop/update_state.sh`. No DB, no Anthropic, no Neon credentials required.

## Steps
1. Enumerate the specific failing question IDs the slice targets by scanning `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` for rows where `answer_grade` ≠ `A` or `semantic_conformance_grade` ≠ `A`. Record the IDs in the `Decisions` subsection below before changing any code so the audit can verify scope.
2. Define the new axis schema in code:
   - Extend `ChatQualityAssessment` in `web/src/lib/chatQuality.ts` to expose `{ factual_correctness: { grade, reason }, completeness: { grade, reason }, clarity: { grade, reason } }` and update each return branch in `assessChatQuality` to populate all three axes.
   - Update every call site in `web/src/app/api/chat/orchestration.ts` (lines 415, 483, 993, 1126, 1191) to consume the new shape instead of the single `grade` field.
3. Rebuild the offline grader pipeline so artifact rows carry the three axes:
   - In `web/scripts/chat-health-check-baseline.mjs` and `web/scripts/chat-health-check-grade.mjs`, replace `answer_grade` / `answer_grade_reason` / `semantic_conformance_grade` / `semantic_conformance_reason` with `factual_correctness`, `completeness`, `clarity` (each `{ grade, reason }`). Keep `root_cause_labels` for orthogonal regression detection.
   - Update `summarizeBaselineGrades` (and any markdown report builder) to emit `factualCorrectnessCounts`, `completenessCounts`, `clarityCounts` in the artifact `summary` object.
   - Update `web/scripts/chat-health-check.rubric.json` and `web/scripts/chat-health-check.rubric.intense.json` so each rubric entry carries per-axis expectations (or document a deterministic mapping from existing rubric keys to the new axes).
4. Update the healthcheck artifact schema and every consumer:
   - Re-shape every artifact row to the new fields and bump `summary` to expose the three axis count maps.
   - Update `scripts/loop/update_state.sh` (`render_benchmark_headline`, lines 99–122) so the benchmark headline reads from the new `factualCorrectnessCounts`, `completenessCounts`, and `clarityCounts` keys; keep a one-version legacy fallback only if both key sets coexist in-tree on author day, otherwise replace cleanly.
   - Update the regression-test fixtures under `web/scripts/tests/fixtures/` (`clarification.fixture.json`, `semantic-conformance.fixture.json`, and any sibling `*.rubric.json`) and the assertions in `web/scripts/tests/grading-regression.test.mjs` to use the three axis fields instead of `answer_grade` / `semantic_conformance_grade`.
   - Regenerate `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` (or write a sibling re-grade artifact at `diagnostic/artifacts/healthcheck/11-multi-axis-regrade_<YYYY-MM-DD>.json`) by running `node web/scripts/chat-health-check-grade.mjs` against the existing input rows so the artifact-on-disk matches the new schema. Reference the regenerated path under `## Artifact paths` below.
5. Re-grade just the target question IDs (from step 1) and verify each previously-failing axis improves in the regenerated artifact while previously-passing questions in the same category retain their grades.
6. Run the gate commands listed below and ensure each exits 0.

## Decisions
- _Filled by implementer in step 1: list of target question IDs and which axis each one is failing on, e.g. `id=12 → completeness=C`, `id=27 → factual_correctness=C`._
- The healthcheck artifact rewrite is **not backwards-compatible**: consumers must be updated in the same slice. The only consumer that lives outside `web/` is `scripts/loop/update_state.sh`, which is updated in step 4. No other repo-wide consumer of `answer_grade` / `semantic_conformance_grade` exists at author time (verified by grep on 2026-05-01); if implementation finds one, address it here rather than deferring.

## Changed files expected
- `web/src/lib/chatQuality.ts` (runtime grader; emit three axes)
- `web/src/app/api/chat/orchestration.ts` (5 call sites consume the new shape)
- `web/scripts/chat-health-check-baseline.mjs` (offline grader: per-axis grading + summary counts)
- `web/scripts/chat-health-check-grade.mjs` (CLI entrypoint + markdown report)
- `web/scripts/chat-health-check.rubric.json`
- `web/scripts/chat-health-check.rubric.intense.json`
- `web/scripts/chat-health-check-grading.md` (doc the new axes)
- `web/scripts/tests/grading-regression.test.mjs` (assertions against new axis fields)
- `web/scripts/tests/fixtures/clarification.fixture.json`
- `web/scripts/tests/fixtures/clarification.rubric.json`
- `web/scripts/tests/fixtures/semantic-conformance.fixture.json` (and matching `*.rubric.json` if present)
- `scripts/loop/update_state.sh` (`render_benchmark_headline` reads new count keys)
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` regenerated, OR new artifact `diagnostic/artifacts/healthcheck/11-multi-axis-regrade_<YYYY-MM-DD>.json`

## Artifact paths
- Regenerated/new healthcheck artifact written in step 4 (path declared in the slice-completion note).

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
# Schema-consumer gate: prove update_state.sh still parses the new artifact
# without falling through to the "could not parse" branch.
bash -lc 'tmp=$(mktemp); scripts/loop/update_state.sh > "$tmp" 2>&1; \
  grep -q "could not parse" "$tmp" && { echo "FAIL: update_state.sh could not parse new artifact"; cat "$tmp"; exit 1; } || \
  grep -q "Factual correctness\|Completeness\|Clarity" "$tmp" || { echo "FAIL: new axis headline missing from _state.md render"; cat "$tmp"; exit 1; }'
```

## Acceptance criteria
- [ ] Every row in the regenerated healthcheck artifact (path declared in the slice-completion note) contains `factual_correctness`, `completeness`, and `clarity` objects, each with a `grade` (one of `A`/`B`/`C`) and a non-empty `reason` string; the legacy `answer_grade` / `semantic_conformance_grade` fields are absent (or, if a transitional alias is kept for one round, this is documented in the `Decisions` block with rationale).
- [ ] The regenerated artifact's `summary` object contains `factualCorrectnessCounts`, `completenessCounts`, and `clarityCounts` count maps; `update_state.sh` consumes them without hitting its `could not parse` branch (verified by the schema-consumer gate above).
- [ ] For each target question ID listed in the `Decisions` block, the previously-failing axis improves by at least one grade step in the regenerated artifact (e.g. `C → B` or `B → A`); the regenerated artifact path and the per-ID before/after axis grades are recorded in the slice-completion note.
- [ ] No category-mate regression: for every other question ID in the same `category` as a target ID, no axis grade decreases versus `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json`. The slice-completion note records the diff (per-ID, per-axis) used to verify this.
- [ ] `web/scripts/tests/grading-regression.test.mjs` asserts the three new axis fields on at least the existing fixture rows (`id=101`, `id=102` and the semantic-conformance fixtures) and exits 0 under `bash scripts/loop/test_grading_gate.sh`.

## Out of scope
- Changing the rubric's *content* beyond the structural per-axis split (no new rubric questions, no question rewrites).
- Re-running the live chat health check against the running web app (only re-grading existing healthcheck inputs is in scope).
- Touching the runtime grader's call sites outside `web/src/app/api/chat/orchestration.ts`.

## Risk / rollback
- Risk: downstream consumers we haven't enumerated may parse the legacy keys. Mitigation: the schema-consumer gate above proves `update_state.sh` is happy; a final repo-wide grep for `answer_grade\|semantic_conformance_grade\|answerGradeCounts\|semanticConformanceGradeCounts` must return only the files this slice deliberately edits.
- Rollback: `git revert <commit>` is sufficient because the artifact rewrite, code changes, and consumer updates land in a single slice commit.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Rewrite the acceptance criteria and validation steps around multi-axis outputs instead of `A or B`, because the goal is to replace the single-letter grade with factual-correctness / completeness / clarity scoring and the current plan still audits the old schema.
- [x] Add explicit implementation and gate coverage for the healthcheck artifact schema update, including the concrete artifact fields/files that must change and the command(s) that prove consumers still pass with the new schema.

### Medium
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` per the loop protocol in `diagnostic/_state.md`.
- [x] Expand `## Changed files expected` beyond `(determined by diagnosis)` to name the grader, healthcheck artifact schema, and test files the implementer is expected to touch so slice scope is auditable.
- [x] Make step 4 and the acceptance criteria name the exact re-grade artifact or test assertion that proves the targeted question IDs improved on the new axes and that previously passing questions in the same category did not regress.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T18:26:26Z`).

## Plan-audit verdict (round 2)

**Status: REVISE**
**Auditor: claude-plan-audit (round-2 forced-findings ratchet: not applied — substantive findings present)**

### High
- [ ] Fix the fixture filename: step 4 and `## Changed files expected` reference `web/scripts/tests/fixtures/semantic-conformance.fixture.json`, but the actual file on disk is `web/scripts/tests/fixtures/semantic.fixture.json` (sibling rubric `semantic.rubric.json`). The implementer will fail to find the named file.
- [ ] Enumerate the missed in-tree consumers of the legacy fields and add them to step 3/4 and `## Changed files expected`: `web/scripts/chat-health-check.mjs` (live healthcheck runner — emits `answer_grade_counts` / `semantic_conformance_grade_counts` at lines 87-88, renders `Answer grade` / `Semantic conformance grade` markdown rows at 253 and 271-273) and `web/scripts/build-rerun-comparison-md.mjs` (the deterministic `.md` generator from slice 11-rerun-benchmark-baseline; lines 139-153 read `r.answer_grade` / `r.semantic_conformance_grade`). The slice's Decisions claim that "no other repo-wide consumer of `answer_grade` / `semantic_conformance_grade` exists" is incorrect — `git grep` still surfaces these two on author day.
- [ ] Bring `report.fixture.json`, `report.rubric.json`, `synthesis.fixture.json`, and `synthesis.rubric.json` into scope: `web/scripts/tests/grading-regression.test.mjs` lines 78-109 assert root-cause fields on `synthesis.fixture.json`, and lines 111-171 assert `summary.summary.answerGradeCounts`, `summary.summary.semanticConformanceGradeCounts`, `summary.actionable.answer_grade_counts`, `summary.actionable.semantic_conformance_grade_counts`, and per-row `answer_grade` / `semantic_conformance_grade` / `semantic_conformance_reason` against `report.fixture.json`. The slice's step 4 only edits the clarification + semantic fixtures, so the report-fixture test will fail under the new schema.
- [ ] Cover the markdown-report assertions in the same test (`grading-regression.test.mjs:167-168` — `assert.match(markdown, /Answer Grade/i)` and `/Semantic Grade/i`). When the offline grader's markdown builder is rebuilt around the three new axes, these regex assertions break unless the test (or the report header strings) is updated. Add an explicit step + acceptance criterion for this.
- [ ] The "previously-failing axis improves by at least one grade step (e.g. C → B or B → A)" acceptance criterion has no defined mapping from the legacy single-field grades (`answer_grade`, `semantic_conformance_grade`) to one of the three new axes (`factual_correctness`, `completeness`, `clarity`). A single legacy `answer_grade=B` row gets split into three independent axis grades; "the previously-failing axis" is undefined. Either (a) declare a deterministic mapping in `## Decisions` (e.g. legacy `answer_grade` → `factual_correctness`, legacy `semantic_conformance_grade` → `completeness`, with `clarity` newly introduced and exempt from the improvement criterion), or (b) drop the per-step "improves" framing and replace it with an absolute axis-grade target (e.g. "the regenerated row has at least two A-grade axes").

### Medium
- [ ] Pin the regrade artifact's mtime/discoverability: `scripts/loop/update_state.sh:45-53` (`latest_file`) selects the healthcheck artifact via `ls -t`. The legacy `diagnostic/artifacts/healthcheck/11-valid-lap-policy-v2_2026-05-01.json` is currently the latest by mtime and is in legacy schema (current `_state.md` benchmark headline says `(could not parse: 'list' object has no attribute 'get')`). The schema-consumer gate only passes if the regenerated/new regrade artifact is newest by mtime at gate time. Add an explicit pre-gate assertion (e.g. `test "$(ls -t diagnostic/artifacts/healthcheck/*.json | head -1)" = "$ARTIFACT"`) or move/rename the legacy file in scope.
- [ ] The category-mate non-regression criterion ("for every other question ID in the same category as a target ID, no axis grade decreases versus `11-rerun_2026-04-30.json`") inherits the same legacy-vs-new-axis mapping gap as the High item above and is non-testable as written. Resolve via the same mapping rule, or reframe as e.g. "no row drops below absolute axis-grade `B` on any axis".
- [ ] Address test-grading baseline drift: rewriting `grading-regression.test.mjs` may change `slice_fails` vs the pinned 39 baseline in `scripts/loop/state/test_grading_baseline.txt`. State explicitly whether that baseline file must be regenerated — if yes, add it to `## Changed files expected` with the regeneration command; if no, justify why the new failure set is a strict subset of the baseline.
- [ ] Step 1's "Record the IDs in the Decisions subsection" is unenforced — no gate fails when the Decisions block is empty. Either add a gate command (e.g. `grep -E '^- id=[0-9]+' diagnostic/slices/11-multi-axis-grader-redesign.md`) or fold the requirement into an acceptance criterion that the audit can verify.
- [ ] `docs/prompt_outcomes_summary.md:124-125` references `answer_grade` and `semantic_conformance_grade` as documented field names. The slice's risk-section grep (`answer_grade\|semantic_conformance_grade\|...`) will still surface this file. Either add it to `## Changed files expected` so the doc gets refreshed, or carve it out explicitly (e.g. limit the grep to source/test/fixture/artifact paths).

### Low
- [ ] Schema-consumer gate's `grep -q "Factual correctness\|Completeness\|Clarity"` uses BRE `\|` for alternation. This works under GNU grep / ugrep but on stock BSD grep (default macOS) it matches the literal string `\|`. Switch to `grep -qE "Factual correctness|Completeness|Clarity"` for portability across the developer fleet.
- [ ] The compound `A && B || C` boolean in the schema-consumer gate is hard to read and easy to break under shell rewrites. Consider an explicit `if grep -q "could not parse" "$tmp"; then …; elif ! grep -qE "..."; then …; fi` form.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T18:26:26Z`).
- Round 1 already addressed the goal/acceptance schema rewrite. The round-2 findings above are net-new — they surface during a fresh repo-wide grep for legacy field consumers and a careful read of `web/scripts/tests/grading-regression.test.mjs`.
