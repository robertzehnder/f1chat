---
slice_id: 11-multi-axis-grader-redesign
phase: 11
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-05-01T22:30:00Z
---

## Goal
Redesign the **offline** chat-quality grader so each healthcheck row carries three independent axis grades — **factual_correctness**, **completeness**, **clarity** (each `A`/`B`/`C` plus a reason string) — replacing today's single `answer_grade` / `semantic_conformance_grade` fields. Update the healthcheck artifact schema, the offline grader pipeline (`web/scripts/chat-health-check-*`), and every downstream consumer (`scripts/loop/update_state.sh`, fixtures, regression tests) so the new schema round-trips end-to-end. **Runtime grader scope (`web/src/lib/chatQuality.ts` and its ~40+ orchestration call sites) is explicitly out of scope** — see `## Out of scope` and the High-2 resolution recorded in `## Decisions`. The slice is offline by construction.

## Inputs
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` (latest in-tree healthcheck artifact at author time; the 2026-04-26 file referenced earlier does not exist on disk)
- Specific failing-question IDs identified from that artifact's rows where `answer_grade` is `C` or `semantic_conformance_grade` is `C`

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/11-rerun-benchmark-baseline.md`

## Required services / env
None at author time. The slice is offline: it only edits TS/MJS/JSON under `web/`, fixtures under `web/scripts/tests/fixtures/`, and the loop state shaping in `scripts/loop/update_state.sh`. No DB, no Anthropic, no Neon credentials required.

## Steps
1. Enumerate the specific failing question IDs the slice targets by scanning `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` for rows where `answer_grade` ≠ `A` or `semantic_conformance_grade` ≠ `A`. Record the IDs in the `Decisions` subsection below before changing any code so the audit can verify scope. Each ID line MUST follow the form `- id=<N> legacy_axis=<answer_grade|semantic_conformance_grade> from=<A|B|C>` so the gate `grep -E '^- id=[0-9]+ legacy_axis=' diagnostic/slices/11-multi-axis-grader-redesign.md` can verify the block was filled.

   **Snapshot category-mate baselines BEFORE any artifact rewrite.** Capture every row's legacy `answer_grade` / `semantic_conformance_grade` from the pre-rewrite artifact into a temp file (e.g. `cp diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json /tmp/11-rerun_legacy_baseline.json`, or use `git show HEAD:diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` later) so the category-mate non-regression criterion remains computable AFTER step 3 rewrites the artifact in place. The slice-completion note must record the per-ID, per-mapped-axis legacy→new diff drawn from this snapshot.
2. Rebuild the offline grader pipeline so artifact rows carry the three axes:
   - In `web/scripts/chat-health-check-baseline.mjs`, `web/scripts/chat-health-check-grade.mjs`, AND `web/scripts/chat-health-check.mjs` (the live healthcheck runner — which also emits `answer_grade_counts` / `semantic_conformance_grade_counts` at lines 87-88 and renders `Answer grade` / `Answer grade reason` / `Semantic conformance grade` markdown rows at lines 253 and 271-273), replace `answer_grade` / `answer_grade_reason` / `semantic_conformance_grade` / `semantic_conformance_reason` with `factual_correctness`, `completeness`, `clarity` (each `{ grade, reason }`). Keep `root_cause_labels` for orthogonal regression detection.
   - Update `summarizeBaselineGrades` (and any markdown report builder, including the per-row `Answer Grade` / `Semantic Grade` columns and the per-row detail block) to emit `factualCorrectnessCounts`, `completenessCounts`, `clarityCounts` in the artifact `summary` object and to render per-axis columns (`Factual Correctness`, `Completeness`, `Clarity`) in the markdown report. The `summary.actionable.*` shape must mirror the same three keys (`factual_correctness_grade_counts`, `completeness_grade_counts`, `clarity_grade_counts`).
   - Update `web/scripts/chat-health-check.rubric.json` and `web/scripts/chat-health-check.rubric.intense.json` so each rubric entry carries per-axis expectations (or document a deterministic mapping from existing rubric keys to the new axes).
   - Update `web/scripts/build-rerun-comparison-md.mjs` (lines 139-153, 172-173, 222) so the rerun-comparison generator reads `factual_correctness` / `completeness` / `clarity` from each row and `factualCorrectnessCounts` / `completenessCounts` / `clarityCounts` from the prior summary. The `Source:` footer string at line 222 must be updated to reference the new summary keys.
   - Update `web/scripts/chat-health-check-grading.md` (lines 5-6, 10-11) so the documented field names are the three new axes (`factual_correctness`, `completeness`, `clarity`) instead of `answer_grade` / `semantic_conformance_grade`.
   - Update `docs/prompt_outcomes_summary.md` (lines 124-125) so the documented field names are the three new axes; otherwise the risk-section grep (see `## Risk / rollback`) will continue to surface this file.
3. Update the healthcheck artifact schema and every consumer:
   - Re-shape every artifact row to the new fields and bump `summary` to expose the three axis count maps. **Keep `summary.gradeCounts`** (the overall A/B/C aggregate of `baselineGrade`) **unchanged** — it is orthogonal to the per-axis split and `scripts/loop/update_state.sh:106-108` still reads it for the `Overall A/B/C:` headline. Do not drop or rename this key.
   - Update `scripts/loop/update_state.sh` (`render_benchmark_headline`, lines 109-113 — the legacy-key reads inside the function) so the benchmark headline reads from the new `factualCorrectnessCounts`, `completenessCounts`, and `clarityCounts` keys; keep a one-version legacy fallback only if both key sets coexist in-tree on author day, otherwise replace cleanly.
   - Update the regression-test fixtures under `web/scripts/tests/fixtures/` — every fixture, namely `clarification.fixture.json` + `clarification.rubric.json`, `semantic.fixture.json` + `semantic.rubric.json` (the actual on-disk filenames; there is no `semantic-conformance.fixture.json`), `report.fixture.json` + `report.rubric.json`, and `synthesis.fixture.json` + `synthesis.rubric.json` — and the assertions in `web/scripts/tests/grading-regression.test.mjs` to use the three axis fields instead of `answer_grade` / `semantic_conformance_grade`. The test currently asserts (a) per-row `answer_grade` / `semantic_conformance_grade` / `semantic_conformance_reason` (lines 47-48, 52, 66-67, 159-164), (b) summary-level `summary.summary.answerGradeCounts` / `summary.summary.semanticConformanceGradeCounts` / `summary.actionable.answer_grade_counts` / `summary.actionable.semantic_conformance_grade_counts` (lines 142-150), and (c) markdown-report regexes `/Answer Grade/i` and `/Semantic Grade/i` (lines 167-168). Each of these MUST be rewritten to assert the new axis fields (`factual_correctness`, `completeness`, `clarity` per row; `factualCorrectnessCounts` / `completenessCounts` / `clarityCounts` in `summary.summary`; `factual_correctness_grade_counts` / `completeness_grade_counts` / `clarity_grade_counts` in `summary.actionable`) and the markdown regexes MUST become `/Factual Correctness/i`, `/Completeness/i`, `/Clarity/i`. Root-cause assertions on `synthesis.fixture.json` (lines 78-109) MUST continue to pass — they are orthogonal to the axis split.
   - Regenerate `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` (or write a sibling re-grade artifact at `diagnostic/artifacts/healthcheck/11-multi-axis-regrade_<YYYY-MM-DD>.json`) by running `node web/scripts/chat-health-check-grade.mjs` against the existing input rows so the artifact-on-disk matches the new schema. Reference the regenerated path under `## Artifact paths` below.
   - **Pin newest-by-mtime**: at gate time, `scripts/loop/update_state.sh:45-53` (`latest_file`) selects the healthcheck artifact via `ls -t`. The current latest-by-mtime file is `diagnostic/artifacts/healthcheck/11-valid-lap-policy-v2_2026-05-01.json` (legacy schema). Either (a) regenerate the new multi-axis artifact with a `_2026-05-NN.json` filename whose mtime is fresher than every other file in `diagnostic/artifacts/healthcheck/*.json` at gate time, AND additionally re-shape `11-valid-lap-policy-v2_2026-05-01.json` and `11-rerun_2026-04-30.json` to the new schema (they remain in-tree and would otherwise break if `update_state.sh` ever falls back to them), OR (b) move the legacy `11-valid-lap-policy-v2_2026-05-01.json` to an archived path under `diagnostic/artifacts/healthcheck/legacy/` so it no longer matches the `*.json` glob, leaving only the new multi-axis artifact in the live directory. Option (a) is the default; the schema-consumer gate below explicitly asserts the newest match equals the regenerated artifact.
4. Re-grade just the target question IDs (from step 1) using the legacy→new axis mapping declared in `## Decisions` (`answer_grade` → `factual_correctness`; `semantic_conformance_grade` → `completeness`; `clarity` is newly introduced) and verify each previously-failing axis improves in the regenerated artifact while previously-passing questions in the same category retain their grades. Use the legacy-baseline snapshot from step 1 to compute per-ID, per-mapped-axis diffs and record them in the slice-completion note.
5. Run the gate commands listed below and ensure each exits 0.

## Decisions
- _Filled by implementer in step 1, one line per target ID, in the form `- id=<N> legacy_axis=<answer_grade|semantic_conformance_grade> from=<A|B|C>` (e.g. `- id=12 legacy_axis=semantic_conformance_grade from=C`). The acceptance-criteria gate `grep -E '^- id=[0-9]+ legacy_axis=' diagnostic/slices/11-multi-axis-grader-redesign.md` must return at least one line._
- **Legacy → new axis mapping** (binding for "previously-failing axis improves" and "category-mate non-regression" criteria):
  - legacy `answer_grade` → new `factual_correctness`
  - legacy `semantic_conformance_grade` → new `completeness`
  - new `clarity` is **net-new** in this slice and is exempt from per-step improvement and category-mate non-regression criteria (no legacy baseline exists to compare against). It is held to an absolute target: every regenerated row must have `clarity.grade` ∈ `{A, B}` (i.e. no `C`).
- The healthcheck artifact rewrite is **not backwards-compatible**: consumers must be updated in the same slice. Repo-wide grep on 2026-05-01 (rerun this round after the round-2 audit) surfaces these files outside the original list — they are now in scope and listed under `## Changed files expected`:
  - `scripts/loop/update_state.sh` (lines 109-113)
  - `web/scripts/chat-health-check.mjs` (live healthcheck runner — the round-1 plan missed this; lines 87-88 emit `answer_grade_counts`, lines 217-222 render `Answer grades` / `Semantic conformance grades`, lines 253, 271-273 render per-row `Answer grade` / `Semantic conformance grade`)
  - `web/scripts/build-rerun-comparison-md.mjs` (the deterministic `.md` generator from slice 11-rerun-benchmark-baseline; lines 139-153 read `r.answer_grade` / `r.semantic_conformance_grade`, lines 172-173 read `summary.answerGradeCounts` / `semanticConformanceGradeCounts`, line 222 writes a `Source:` string referencing those keys)
  - `web/scripts/chat-health-check-grading.md` (doc — lines 5-6, 10-11)
  - `docs/prompt_outcomes_summary.md` (doc — lines 124-125)
  - `web/scripts/tests/grading-regression.test.mjs` plus all four fixture pairs in `web/scripts/tests/fixtures/` (`clarification.{fixture,rubric}.json`, `semantic.{fixture,rubric}.json`, `report.{fixture,rubric}.json`, `synthesis.{fixture,rubric}.json`)
  
  If implementation finds another consumer not enumerated here, address it in this slice rather than deferring.
- **Test-grading baseline policy**: at author time, `scripts/loop/state/test_grading_baseline.txt` does not exist on disk (only `line_count_baseline.txt` is present), so the gate wrapper at `scripts/loop/test_grading_gate.sh` falls back to strict "exit 0 only" semantics. After this slice rewrites `grading-regression.test.mjs` and the four fixture pairs to the new axis schema, those tests must continue to pass under `npm run test:grading` — i.e. the rewrite must be self-consistent (assertions match the regraded fixtures). The slice does NOT regenerate `test_grading_baseline.txt`. If the gate fails, the implementer fixes the test+fixture mismatch rather than refreshing the baseline. (Listed in `## Changed files expected` only because regeneration is theoretically possible if `bash scripts/loop/refresh_test_grading_baseline.sh` exists and the failure set is not fixable; default expectation is that the file is NOT touched.)
- **Runtime grader scope (High-2 resolution)**: this slice does NOT modify `web/src/lib/chatQuality.ts` or any of the ~40+ runtime call sites in `web/src/app/api/chat/orchestration.ts` (the 5 `assessChatQuality(` invocations PLUS all downstream reads of `quality.grade`, `quality.reason`, `responseGrade`, `gradeReason`, `adequacyGrade`, `adequacyReason`, and `cachedAnswer.gradeReason`). The runtime grader's `ChatQualityAssessment` interface uses `grade` / `reason` (NOT `answer_grade` / `semantic_conformance_grade`), so leaving it unchanged does not surface in the risk-section grep. Multi-axis runtime grading + cache-record migration is deferred to a future slice. See `## Out of scope`.
- **Pre-rewrite legacy snapshot (Medium-1 resolution)**: step 1 mandates capturing the pre-rewrite `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` (whether by `cp` to a temp file or by relying on `git show HEAD:...` later) BEFORE step 3 rewrites that artifact in place. The slice-completion note records the per-ID, per-mapped-axis legacy→new diff drawn from this snapshot, so the category-mate non-regression criterion remains computable post-rewrite.
- **`summary.gradeCounts` retention (Low-1 resolution)**: the `summary.gradeCounts` overall A/B/C aggregate of `baselineGrade` is **kept unchanged** under the new schema. It is orthogonal to the per-axis split (the per-axis `factualCorrectnessCounts` / `completenessCounts` / `clarityCounts` are net-additive), and `scripts/loop/update_state.sh:106-108` continues to read it for the `Overall A/B/C:` headline render. Implementer must NOT drop, rename, or repurpose this key.
- **`update_state.sh` line-range reconciliation (Medium-2 resolution)**: the canonical line range for the legacy-key reads inside `render_benchmark_headline` is **lines 109-113**. The function as a whole spans roughly lines 92-124, but the implementer only needs to edit the legacy-key read block at 109-113. All references to this section use the 109-113 range.

## Changed files expected
- `web/scripts/chat-health-check-baseline.mjs` (offline grader: per-axis grading + summary counts)
- `web/scripts/chat-health-check-grade.mjs` (CLI entrypoint + markdown report)
- `web/scripts/chat-health-check.mjs` (live healthcheck runner — emits `*_counts` and renders per-row markdown rows; missed in round 1)
- `web/scripts/build-rerun-comparison-md.mjs` (rerun-comparison generator — reads `r.answer_grade` / `r.semantic_conformance_grade` and the prior summary's `answerGradeCounts` / `semanticConformanceGradeCounts`; missed in round 1)
- `web/scripts/chat-health-check.rubric.json`
- `web/scripts/chat-health-check.rubric.intense.json`
- `web/scripts/chat-health-check-grading.md` (doc the new axes; lines 5-6, 10-11 reference legacy field names)
- `docs/prompt_outcomes_summary.md` (doc — lines 124-125 reference legacy field names; either update or carve out from the risk-section grep — see `## Risk / rollback`)
- `web/scripts/tests/grading-regression.test.mjs` (assertions against new axis fields, including `summary.summary.factualCorrectnessCounts` / `summary.summary.completenessCounts` / `summary.summary.clarityCounts`, `summary.actionable.factual_correctness_grade_counts` / `summary.actionable.completeness_grade_counts` / `summary.actionable.clarity_grade_counts`, per-row `factual_correctness` / `completeness` / `clarity`, and the markdown regexes `/Factual Correctness/i`, `/Completeness/i`, `/Clarity/i`)
- `web/scripts/tests/fixtures/clarification.fixture.json`
- `web/scripts/tests/fixtures/clarification.rubric.json`
- `web/scripts/tests/fixtures/semantic.fixture.json` (the on-disk filename; there is no `semantic-conformance.fixture.json`)
- `web/scripts/tests/fixtures/semantic.rubric.json`
- `web/scripts/tests/fixtures/report.fixture.json` (in scope: the test asserts row-level + summary-level legacy fields against this fixture)
- `web/scripts/tests/fixtures/report.rubric.json`
- `web/scripts/tests/fixtures/synthesis.fixture.json` (in scope: the test asserts root-cause fields against this fixture; the per-row axis grades inside it must also be re-shaped so it round-trips through the new grader)
- `web/scripts/tests/fixtures/synthesis.rubric.json`
- `scripts/loop/update_state.sh` (`render_benchmark_headline` reads new count keys; lines 109-113)
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` regenerated, OR new artifact `diagnostic/artifacts/healthcheck/11-multi-axis-regrade_<YYYY-MM-DD>.json`. Per `## Decisions` option (a), `diagnostic/artifacts/healthcheck/11-valid-lap-policy-v2_2026-05-01.json` is ALSO re-shaped to the new schema (or moved to `diagnostic/artifacts/healthcheck/legacy/` under option (b)) so the `update_state.sh` `latest_file` selection cannot fall back to a legacy artifact.
- `scripts/loop/state/test_grading_baseline.txt` (regenerated only if `bash scripts/loop/test_grading_gate.sh` reports a non-empty `slice_fails` set after the rewrite that is not a strict subset of the existing baseline; see Decisions note below).

## Artifact paths
- Regenerated/new healthcheck artifact written in step 3 (path declared in the slice-completion note).

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh

# Decisions-block gate: prove step 1 was actually performed and the
# target IDs were recorded in the canonical `- id=<N> legacy_axis=...`
# form. An empty Decisions block means the slice has no auditable scope.
grep -E '^- id=[0-9]+ legacy_axis=(answer_grade|semantic_conformance_grade) from=[ABC]$' \
  diagnostic/slices/11-multi-axis-grader-redesign.md \
  || { echo "FAIL: Decisions block missing target ID lines (expected '- id=<N> legacy_axis=... from=<A|B|C>')"; exit 1; }

# mtime-pin gate: the regenerated multi-axis artifact MUST be the newest
# *.json under diagnostic/artifacts/healthcheck/ at gate time, so
# update_state.sh's `latest_file` (ls -t) selects it. Replace
# $REGRADE_ARTIFACT with the actual path declared in `## Artifact paths`.
REGRADE_ARTIFACT="$(ls -t diagnostic/artifacts/healthcheck/11-multi-axis-regrade_*.json 2>/dev/null | head -1)"
[[ -n "$REGRADE_ARTIFACT" ]] || { echo "FAIL: no 11-multi-axis-regrade_*.json artifact present"; exit 1; }
NEWEST="$(ls -t diagnostic/artifacts/healthcheck/*.json 2>/dev/null | head -1)"
[[ "$NEWEST" = "$REGRADE_ARTIFACT" ]] || { echo "FAIL: newest healthcheck artifact ($NEWEST) is not the regenerated multi-axis artifact ($REGRADE_ARTIFACT). Either touch the regrade artifact's mtime or move legacy artifacts to diagnostic/artifacts/healthcheck/legacy/."; exit 1; }

# Schema-consumer gate: prove update_state.sh still parses the new artifact
# without falling through to the "could not parse" branch and that the
# benchmark headline includes at least one of the new axis labels.
# (Explicit if/elif form for shell-rewrite portability; ERE alternation
# for BSD grep portability — stock macOS grep treats `\|` as a literal.)
tmp=$(mktemp)
scripts/loop/update_state.sh > "$tmp" 2>&1
if grep -q "could not parse" "$tmp"; then
  echo "FAIL: update_state.sh could not parse new artifact"
  cat "$tmp"
  exit 1
elif ! grep -qE "Factual correctness|Completeness|Clarity" "$tmp"; then
  echo "FAIL: new axis headline missing from _state.md render"
  cat "$tmp"
  exit 1
fi

# Risk-section grep: legacy field names must not appear in source/test/
# docs paths the slice deliberately edits. Scope is restricted to
# positive paths (web/, scripts/loop/, docs/) so historical slice plans
# under diagnostic/slices/ and benchmark snapshots in diagnostic/_state.md
# (which legitimately record what the codebase USED to look like) are
# not surfaced. The legacy artifacts under diagnostic/artifacts/healthcheck/
# are handled by step 3 (regenerate or move to legacy/), not by this grep.
# scripts/loop/test_grading_gate.sh is excluded because it references the
# legacy field names as match patterns, not as field names.
! git grep -nE 'answer_grade|semantic_conformance_grade|answerGradeCounts|semanticConformanceGradeCounts' \
  -- 'web/' 'scripts/loop/' 'docs/' \
  ':!scripts/loop/test_grading_gate.sh' \
  || { echo "FAIL: legacy field names still present in tree — see grep output above"; exit 1; }
```

## Acceptance criteria
- [ ] Every row in the regenerated healthcheck artifact (path declared in the slice-completion note) contains `factual_correctness`, `completeness`, and `clarity` objects, each with a `grade` (one of `A`/`B`/`C`) and a non-empty `reason` string; the legacy `answer_grade` / `semantic_conformance_grade` fields are absent (no transitional alias — the slice's risk-section grep enforces this).
- [ ] The regenerated artifact's `summary` object contains `factualCorrectnessCounts`, `completenessCounts`, and `clarityCounts` count maps; the regenerated artifact's `summary.actionable` object contains `factual_correctness_grade_counts`, `completeness_grade_counts`, and `clarity_grade_counts`; `update_state.sh` consumes them without hitting its `could not parse` branch (verified by the schema-consumer gate above).
- [ ] The Decisions block lists at least one target ID line in the canonical form `- id=<N> legacy_axis=<answer_grade|semantic_conformance_grade> from=<A|B|C>` (verified by the Decisions-block gate above).
- [ ] For each target question ID listed in the `Decisions` block, the **mapped** new axis (per the Decisions mapping: `answer_grade` → `factual_correctness`, `semantic_conformance_grade` → `completeness`) improves by at least one grade step in the regenerated artifact versus the recorded `from=` baseline (e.g. `C → B` or `B → A`); the regenerated artifact path and the per-ID before/after axis grades are recorded in the slice-completion note. The `clarity` axis is exempt from this criterion (see Decisions).
- [ ] **`clarity` absolute target**: every row in the regenerated artifact has `clarity.grade` ∈ `{A, B}`. Any `C` on `clarity` fails this criterion.
- [ ] No category-mate regression on the **mapped** axes: for every other question ID in the same `category` as a target ID, the mapped new-axis grade (legacy `answer_grade` → `factual_correctness`; legacy `semantic_conformance_grade` → `completeness`) does not decrease versus the same legacy field's grade in `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json`. `clarity` is exempt (no legacy baseline). The slice-completion note records the diff (per-ID, per-mapped-axis) used to verify this.
- [ ] The newest `*.json` under `diagnostic/artifacts/healthcheck/` is the regenerated multi-axis artifact (verified by the mtime-pin gate above), so `scripts/loop/update_state.sh` selects it via `ls -t`.
- [ ] `web/scripts/tests/grading-regression.test.mjs` asserts the three new axis fields on every fixture row it currently asserts (`id=101`, `id=102` in `clarification.fixture.json`; `id=201` in `semantic.fixture.json`; the sample row in `report.fixture.json`; and the root-cause assertions on `synthesis.fixture.json` continue to pass) and exits 0 under `bash scripts/loop/test_grading_gate.sh`. The test's markdown regexes are `/Factual Correctness/i`, `/Completeness/i`, and `/Clarity/i` (replacing `/Answer Grade/i` and `/Semantic Grade/i`).
- [ ] The risk-section grep (`! git grep -nE 'answer_grade|semantic_conformance_grade|answerGradeCounts|semanticConformanceGradeCounts' -- 'web/' 'scripts/loop/' 'docs/' ':!scripts/loop/test_grading_gate.sh'`) returns zero hits — i.e. no legacy field names remain in source/test/docs paths (including `docs/prompt_outcomes_summary.md` and `web/scripts/chat-health-check-grading.md`). Historical slice plans under `diagnostic/slices/` and benchmark snapshots in `diagnostic/_state.md` are out of grep scope by design.

## Out of scope
- Changing the rubric's *content* beyond the structural per-axis split (no new rubric questions, no question rewrites).
- Re-running the live chat health check against the running web app (only re-grading existing healthcheck inputs is in scope).
- **Runtime grader changes**: `web/src/lib/chatQuality.ts` (the `ChatQualityAssessment` shape and `assessChatQuality` return branches) and **all** of its consumers in `web/src/app/api/chat/orchestration.ts` (the 5 `assessChatQuality(` invocation lines AND the ~40+ downstream reads of `quality.grade` / `quality.reason` / `responseGrade` / `gradeReason` / `adequacyGrade` / `adequacyReason` plus `cachedAnswer.gradeReason`). The runtime grader uses field names `grade` / `reason` (not `answer_grade` / `semantic_conformance_grade`), so leaving it unchanged does NOT cause the risk-section grep to fire. A future slice may introduce a multi-axis runtime grader, including a cache-record migration plan; this slice does not.

## Risk / rollback
- Risk: downstream consumers we haven't enumerated may parse the legacy keys. Mitigation: the schema-consumer gate above proves `update_state.sh` is happy, and the final risk-section grep gate (`! git grep -nE 'answer_grade|semantic_conformance_grade|answerGradeCounts|semanticConformanceGradeCounts' -- 'web/' 'scripts/loop/' 'docs/' ':!scripts/loop/test_grading_gate.sh'`) returns zero hits — i.e. no legacy field names remain in source/test/docs paths. The grep is scoped to positive paths (`web/`, `scripts/loop/`, `docs/`) so historical slice plans under `diagnostic/slices/` and benchmark snapshots in `diagnostic/_state.md` are not surfaced. Legacy artifacts under `diagnostic/artifacts/healthcheck/` are handled by step 3 (regenerate the new artifact + re-shape or move legacy artifacts), not by this grep. The grep is ERE-based for BSD/macOS grep portability.
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
- [x] Fix the fixture filename: step 4 and `## Changed files expected` reference `web/scripts/tests/fixtures/semantic-conformance.fixture.json`, but the actual file on disk is `web/scripts/tests/fixtures/semantic.fixture.json` (sibling rubric `semantic.rubric.json`). The implementer will fail to find the named file.
- [x] Enumerate the missed in-tree consumers of the legacy fields and add them to step 3/4 and `## Changed files expected`: `web/scripts/chat-health-check.mjs` (live healthcheck runner — emits `answer_grade_counts` / `semantic_conformance_grade_counts` at lines 87-88, renders `Answer grade` / `Semantic conformance grade` markdown rows at 253 and 271-273) and `web/scripts/build-rerun-comparison-md.mjs` (the deterministic `.md` generator from slice 11-rerun-benchmark-baseline; lines 139-153 read `r.answer_grade` / `r.semantic_conformance_grade`). The slice's Decisions claim that "no other repo-wide consumer of `answer_grade` / `semantic_conformance_grade` exists" is incorrect — `git grep` still surfaces these two on author day.
- [x] Bring `report.fixture.json`, `report.rubric.json`, `synthesis.fixture.json`, and `synthesis.rubric.json` into scope: `web/scripts/tests/grading-regression.test.mjs` lines 78-109 assert root-cause fields on `synthesis.fixture.json`, and lines 111-171 assert `summary.summary.answerGradeCounts`, `summary.summary.semanticConformanceGradeCounts`, `summary.actionable.answer_grade_counts`, `summary.actionable.semantic_conformance_grade_counts`, and per-row `answer_grade` / `semantic_conformance_grade` / `semantic_conformance_reason` against `report.fixture.json`. The slice's step 4 only edits the clarification + semantic fixtures, so the report-fixture test will fail under the new schema.
- [x] Cover the markdown-report assertions in the same test (`grading-regression.test.mjs:167-168` — `assert.match(markdown, /Answer Grade/i)` and `/Semantic Grade/i`). When the offline grader's markdown builder is rebuilt around the three new axes, these regex assertions break unless the test (or the report header strings) is updated. Add an explicit step + acceptance criterion for this.
- [x] The "previously-failing axis improves by at least one grade step (e.g. C → B or B → A)" acceptance criterion has no defined mapping from the legacy single-field grades (`answer_grade`, `semantic_conformance_grade`) to one of the three new axes (`factual_correctness`, `completeness`, `clarity`). A single legacy `answer_grade=B` row gets split into three independent axis grades; "the previously-failing axis" is undefined. Either (a) declare a deterministic mapping in `## Decisions` (e.g. legacy `answer_grade` → `factual_correctness`, legacy `semantic_conformance_grade` → `completeness`, with `clarity` newly introduced and exempt from the improvement criterion), or (b) drop the per-step "improves" framing and replace it with an absolute axis-grade target (e.g. "the regenerated row has at least two A-grade axes").

### Medium
- [x] Pin the regrade artifact's mtime/discoverability: `scripts/loop/update_state.sh:45-53` (`latest_file`) selects the healthcheck artifact via `ls -t`. The legacy `diagnostic/artifacts/healthcheck/11-valid-lap-policy-v2_2026-05-01.json` is currently the latest by mtime and is in legacy schema (current `_state.md` benchmark headline says `(could not parse: 'list' object has no attribute 'get')`). The schema-consumer gate only passes if the regenerated/new regrade artifact is newest by mtime at gate time. Add an explicit pre-gate assertion (e.g. `test "$(ls -t diagnostic/artifacts/healthcheck/*.json | head -1)" = "$ARTIFACT"`) or move/rename the legacy file in scope.
- [x] The category-mate non-regression criterion ("for every other question ID in the same category as a target ID, no axis grade decreases versus `11-rerun_2026-04-30.json`") inherits the same legacy-vs-new-axis mapping gap as the High item above and is non-testable as written. Resolve via the same mapping rule, or reframe as e.g. "no row drops below absolute axis-grade `B` on any axis".
- [x] Address test-grading baseline drift: rewriting `grading-regression.test.mjs` may change `slice_fails` vs the pinned 39 baseline in `scripts/loop/state/test_grading_baseline.txt`. State explicitly whether that baseline file must be regenerated — if yes, add it to `## Changed files expected` with the regeneration command; if no, justify why the new failure set is a strict subset of the baseline.
- [x] Step 1's "Record the IDs in the Decisions subsection" is unenforced — no gate fails when the Decisions block is empty. Either add a gate command (e.g. `grep -E '^- id=[0-9]+' diagnostic/slices/11-multi-axis-grader-redesign.md`) or fold the requirement into an acceptance criterion that the audit can verify.
- [x] `docs/prompt_outcomes_summary.md:124-125` references `answer_grade` and `semantic_conformance_grade` as documented field names. The slice's risk-section grep (`answer_grade\|semantic_conformance_grade\|...`) will still surface this file. Either add it to `## Changed files expected` so the doc gets refreshed, or carve it out explicitly (e.g. limit the grep to source/test/fixture/artifact paths).

### Low
- [x] Schema-consumer gate's `grep -q "Factual correctness\|Completeness\|Clarity"` uses BRE `\|` for alternation. This works under GNU grep / ugrep but on stock BSD grep (default macOS) it matches the literal string `\|`. Switch to `grep -qE "Factual correctness|Completeness|Clarity"` for portability across the developer fleet.
- [x] The compound `A && B || C` boolean in the schema-consumer gate is hard to read and easy to break under shell rewrites. Consider an explicit `if grep -q "could not parse" "$tmp"; then …; elif ! grep -qE "..."; then …; fi` form.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T18:26:26Z`).
- Round 1 already addressed the goal/acceptance schema rewrite. The round-2 findings above are net-new — they surface during a fresh repo-wide grep for legacy field consumers and a careful read of `web/scripts/tests/grading-regression.test.mjs`.

## Plan-audit verdict (round 3)

**Status: REVISE**
**Auditor: claude-plan-audit (round-3 forced-findings ratchet: not applicable — final claude self-audit round; substantive findings present)**

### High
- [x] The risk-section grep (`! git grep -nE 'answer_grade|semantic_conformance_grade|answerGradeCounts|semanticConformanceGradeCounts' -- ':!diagnostic/slices/11-multi-axis-grader-redesign.md' ':!scripts/loop/test_grading_gate.sh'`) cannot return zero hits as written. On 2026-05-01 in this worktree, `git grep` of those four patterns matches at least: `diagnostic/slices/00-fresh-benchmark.md:92-93` (`answerGradeCounts`, `semanticConformanceGradeCounts`), `diagnostic/slices/11-rerun-benchmark-baseline.md:41-42` (`r.answer_grade`, `r.semantic_conformance_grade`, `summary.answerGradeCounts`, `summary.semanticConformanceGradeCounts`), and `diagnostic/slices/11-residual-raw-table-regressions.md:37, 192, 193` (`answer_grade_reason`, which substring-matches `answer_grade`). These are historical slice plans that must NOT be rewritten — they record what the codebase used to look like. Either (a) extend the exclusion list to `':!diagnostic/slices/'` (or an enumerated list of past plan files), (b) scope the grep to source/test/docs/fixtures via positive paths (e.g. `-- web/ scripts/loop/ docs/`), or (c) limit the patterns to whole-word matches AND add slice-plan exclusion. Without one of these, the slice's own gate fails and the implementer cannot make it pass without corrupting the historical record.
- [x] Step 2's runtime grader scope is materially under-specified for `web/src/app/api/chat/orchestration.ts`. The slice lists 5 "call sites" at lines 415, 483, 993, 1126, 1191 — those are the 5 `assessChatQuality(` invocation lines. But the produced `quality` value is read at ~40+ downstream lines (`quality.grade` / `quality.reason` at 426-429, 462-465, 498-501, 535-538, 1010, 1021-1024, 1087-1090, 1109-1112, 1140-1143, 1179-1182, 1205-1208, 1244-1247), and the values flow further into persisted / cached fields (`responseGrade`, `gradeReason`, `adequacyGrade`, `adequacyReason`, plus `cachedAnswer.gradeReason` reads at lines 685, 734) — `grep -rn 'responseGrade\|gradeReason\|adequacyGrade' web/src/` returns 54 lines. Step 2 instructs "consume the new shape **instead of** the single `grade` field", which is a removal, but: (i) the step lists only the 5 invocation lines so the implementer will miss the ~40+ downstream reads, (ii) the slice never says how `responseGrade` / `gradeReason` / `adequacyGrade` map under the new schema (composite of three axes? one chosen axis? removed entirely?), and (iii) the cache-shape question (`cachedAnswer.gradeReason`) is unaddressed — that field flows from prior persisted records, so a one-version compatibility plan or cache-invalidation plan is needed. Resolve by either (a) declaring runtime grader changes out of scope and limiting step 2 to the offline pipeline (matching the "Required services / env: None ... offline" claim), or (b) explicitly enumerating the full read-site set + the legacy→new mapping for `responseGrade` / `gradeReason` / `adequacyGrade` and the cache-record migration.

### Medium
- [x] The category-mate non-regression acceptance criterion needs the legacy per-axis grades from `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` to compute the diff, but step 4 (option a) instructs the implementer to **rewrite that file in place** to the new schema. Once rewritten, the legacy `answer_grade` / `semantic_conformance_grade` per-row values are lost (only the targets' baselines are captured in the Decisions block, not all category mates). Add an explicit instruction in step 4 to (a) snapshot the pre-rewrite legacy grades from `git show HEAD:diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` (or a temp-file copy taken before the rewrite) and (b) record the per-ID, per-mapped-axis diff in the slice-completion note. Without this, the criterion is non-verifiable post-rewrite.
- [x] Step 4 says "`scripts/loop/update_state.sh` (`render_benchmark_headline`, lines 99–122)" but `## Decisions` and `## Changed files expected` say "lines 109-113". The function actually spans roughly lines 92-124 with the legacy-key reads at 109-113. Pick one canonical range so the implementer doesn't have to reconcile two pointers.

### Low
- [x] `summary.gradeCounts` (overall A/B/C aggregate of `baselineGrade`) is read by `update_state.sh:106-108` and emitted by `web/scripts/chat-health-check-baseline.mjs`, but the slice never says whether it is kept, removed, or repurposed under the new schema. Likely keep-as-is (the per-axis counts are orthogonal to overall baseline quality), but state this explicitly so the implementer doesn't accidentally drop it and break the existing `Overall A/B/C:` headline render.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T18:26:26Z`).
- This is round 3 — the claude self-audit cap. Per dispatcher contract, the reviser will set `owner: codex` after addressing these items, and codex's external plan audit becomes the next gatekeeper. The High items above are concrete enough for the reviser to act on in one pass; codex will see whatever lands.
- The Decisions-block gate is correctly enforced: the placeholder italic text in `## Decisions` does not begin with `- id=`, and the example in backticks `(e.g. \`- id=12 ...\`)` is preceded by `(e.g. ` so does not anchor at `^- id=`. Verified via the slice file body.
- The `Notes for auditors` section in `diagnostic/_state.md` already has 11 entries (lines 55-65) against the documented cap of 10. Not appending a new lesson this round to avoid a drop+add edit; if a future auditor wants to carry forward the lesson "When a slice declares a repo-wide grep gate, exclude `diagnostic/slices/` or scope to positive source/test/docs paths so historical plan records do not surface legacy field names", they can add it then.
