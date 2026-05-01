---
slice_id: 11-rerun-benchmark-baseline
phase: 11
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T22:24:11-04:00
---

## Goal
Re-run the full chat-quality benchmark against the post-Phase-10 build to capture a new healthcheck baseline and document the A/B/C delta vs the prior baseline.

## Inputs
- `web/scripts/chat-health-check.mjs`
- `web/scripts/chat-health-check.questions.json`
- `web/scripts/chat-health-check.rubric.json`
- `diagnostic/artifacts/healthcheck/`

## Prior context
- `diagnostic/_state.md`
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json` (prior baseline; A/B/C = 24 / 11 / 15 per `_state.md`)
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md`

## Required services / env
- `DATABASE_URL` (pooled, Phase 6 production env)
- `ANTHROPIC_API_KEY`
- `OPENF1_CHAT_BASE_URL` pointed at a running web instance (default `http://127.0.0.1:3000`); start `npm run dev` (or equivalent) in `web/` before running the benchmark gate so the chat route answers questions.

## Decisions
- The benchmark itself is the deliverable for this slice. No source code changes; gates focus on (a) running the benchmark, (b) confirming the artifact captures all 50 answers, and (c) verifying no test-grading regressions slipped through.
- Filename convention is **date-stamped to slice `updated:` date** (`11-rerun_2026-04-30.json`). If the benchmark is actually run on a different date, rename to that date and update `updated:` accordingly.
- A regression in A/B counts vs the prior baseline does NOT auto-fail the slice — it is a finding to record. The slice's purpose is to *capture* the new baseline and *document* the delta; what acts on a regression is a follow-up slice, not this one.

## Steps
1. Ensure required services are up (DB pooled URL reachable, web dev server running, `ANTHROPIC_API_KEY` exported).
2. Run the healthcheck suite end-to-end (50 questions across categories) via `cd web && npm run healthcheck:chat`. The script writes the graded 50-row JSON array to `web/logs/chat_health_check_<stamp>.json` and a separate aggregate object to `web/logs/chat_health_check_<stamp>.summary.json` — only the former is the slice artifact.
3. Copy the most recent **raw** `web/logs/chat_health_check_*.json` (excluding any `*.summary.json` sidecar, which is the aggregate object and not the 50-row array) to `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` (the slice artifact).
4. Generate a sibling `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md` summary file containing:
   - **New-run per-category A/B/C counts** — derived from the per-question rows in `11-rerun_2026-04-30.json` (each row exposes `id` and the graded fields written by `gradeHealthCheckResults`).
   - **Prior-baseline per-category A/B/C counts** — copied from `00-fresh-benchmark_2026-04-26.json`'s `summary.gradeCounts` / `summary.answerGradeCounts` / `summary.semanticConformanceGradeCounts` aggregates.
   - **Per-question delta table (improved / unchanged / regressed)** — built by joining each `id` in `11-rerun_2026-04-30.json` against the per-question matrix in `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md` (the `| ID | Baseline | Answer Grade | Semantic Grade | …` table — that is the only per-question record of the prior baseline; the prior `.json` is summary-aggregate-only and cannot drive a question-level diff).
5. Commit both artifacts.

## Changed files expected
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` (50-row graded result set)
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md` (comparison summary required by step 4)

## Artifact paths
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json`
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md`

## Gate commands
```bash
# Build / typecheck sanity (no source changes expected, so these should pass trivially)
cd web && npm run build
cd web && npm run typecheck

# Test-grading gate (uses the loop baseline wrapper per auditor note in _state.md)
bash scripts/loop/test_grading_gate.sh

# Benchmark gate: produce the artifact and verify all 50 questions answered.
# Assumes web dev server is running and OPENF1_CHAT_BASE_URL / ANTHROPIC_API_KEY / DATABASE_URL are set.
# Subshell so cwd stays at worktree root for the subsequent `web/logs/...` lookup.
( cd web && npm run healthcheck:chat )
# Exclude *.summary.json (aggregate sidecar) so we always pick the raw 50-row
# graded array, not the summary object that the script writes alongside it.
LATEST_JSON=$(ls -t web/logs/chat_health_check_*.json 2>/dev/null | grep -v '\.summary\.json$' | head -1)
test -n "$LATEST_JSON" || { echo "no raw chat_health_check_<stamp>.json produced"; exit 1; }
ARTIFACT=diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json
cp "$LATEST_JSON" "$ARTIFACT"
node -e '
  const rows = require("./'"$ARTIFACT"'");
  if (!Array.isArray(rows)) { console.error("artifact is not an array"); process.exit(1); }
  if (rows.length !== 50) { console.error("expected 50 rows, got " + rows.length); process.exit(1); }
  const missing = rows.filter(r => !r || typeof r.answer !== "string" || r.answer.trim() === "");
  if (missing.length) { console.error("rows with missing answer: " + missing.length); process.exit(1); }
  console.log("OK: 50/50 answered");
'

# Comparison-summary gate: assert the .md deliverable from step 4 exists and
# carries each required section (new-run counts, prior-baseline counts, and
# the improved/unchanged/regressed per-question delta produced by joining
# 11-rerun_2026-04-30.json against 00-fresh-benchmark_2026-04-26.md).
ARTIFACT_MD=diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md
test -f "$ARTIFACT_MD" || { echo "missing $ARTIFACT_MD"; exit 1; }
grep -qiE "new[ -]run.*(A/B/C|grade)" "$ARTIFACT_MD" \
  || { echo "$ARTIFACT_MD missing new-run per-category A/B/C counts"; exit 1; }
grep -qiE "prior[ -]baseline.*(A/B/C|grade|00-fresh-benchmark)" "$ARTIFACT_MD" \
  || { echo "$ARTIFACT_MD missing prior-baseline per-category A/B/C counts"; exit 1; }
grep -qi "improved" "$ARTIFACT_MD" \
  && grep -qi "unchanged" "$ARTIFACT_MD" \
  && grep -qi "regressed" "$ARTIFACT_MD" \
  || { echo "$ARTIFACT_MD missing improved/unchanged/regressed delta listing"; exit 1; }
# At least one explicit question-id reference (e.g. "Q6" / "id 6") in the
# delta listing — proves the delta was actually computed per-question, not
# left as a placeholder header.
grep -qiE "(^|[^A-Za-z])(Q[0-9]+|id[ _]?[0-9]+)" "$ARTIFACT_MD" \
  || { echo "$ARTIFACT_MD delta does not list any per-question ids"; exit 1; }
echo "OK: $ARTIFACT_MD has new-run counts, prior-baseline counts, and per-question delta"
```

## Acceptance criteria
- [ ] `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` exists and contains 50 rows, each with a non-empty `answer`.
- [ ] `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md` exists and contains: per-category A/B/C counts for the new run, the same for `00-fresh-benchmark_2026-04-26.json`, and an explicit improved / unchanged / regressed delta listing.
- [ ] Test-grading gate (`bash scripts/loop/test_grading_gate.sh`) exits 0 (no new failures vs the loop baseline).
- [ ] Build and typecheck gates exit 0.
- [ ] Comparison vs prior baseline is documented in the `.md` artifact regardless of direction (improvement, unchanged, or regression). Regression alone does not fail this slice — it must merely be recorded.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

Branch: `slice/11-rerun-benchmark-baseline` (off `integration/perf-roadmap`, base `8b3ff71`).

### Decisions
- No source code changes. The deliverable is purely the two artifacts under `diagnostic/artifacts/healthcheck/`. Filename stays date-stamped to the slice `updated:` date (2026-04-30); the actual benchmark run is in EDT day 2026-04-30 (`web/logs/chat_health_check_2026-05-01T02-30-00-837Z.json` UTC ≡ 2026-04-30 22:30 EDT), so no rename was needed.
- Revision pass (round 5): addressed the round-4 audit finding that the checked-in `.md` summary did not derive from the fresh gate-4 rerun observed by the auditor. Fresh benchmark rerun executed end-to-end this revision (after `PORT=3001 npm run dev` started in this worktree's `web/` and a verified `HTTP 200` on `http://127.0.0.1:3001/`; `OPENF1_CHAT_BASE_URL=http://127.0.0.1:3001` exported for gate 4). Both `11-rerun_2026-04-30.json` and `11-rerun_2026-04-30.md` were regenerated against that rerun in a single pass, so the comparison artifact is fully in sync with the artifact JSON.
- The benchmark is non-deterministic (LLM-graded), so per-question grades vary between runs. Across the runs observed on this branch the aggregate direction is consistently a clear improvement vs the 2026-04-26 baseline (semantic conformance always lifts to 50/0/0 A/B/C; baseline-grade A count consistently in the mid-40s out of 50, vs prior 24/50). Per-question deltas may differ between reruns; the aggregate direction is the load-bearing signal documented by the slice.
- Per slice Decisions, regressions in A/B counts vs the prior baseline are findings to record, not auto-fails. This rerun records **zero** per-question baseline-grade regressions vs the 2026-04-26 per-question matrix; all 4 `B` rows in the new run are accounted for as improvements (Q30 C→B) or unchanged (Q5, Q12, Q18 — all already B in the prior baseline). The `.md` retains the empty `Regressed (0)` section so the deliverable's improved / unchanged / regressed structure stays consistent across reruns.

### New-run results (recorded for auditability)
- Source raw log: `web/logs/chat_health_check_2026-05-01T02-30-00-837Z.json`
- Generated at: `2026-05-01T02:30:00.856Z`
- Baseline grade A/B/C: **46 / 4 / 0**
- Answer grade A/B/C: **46 / 4 / 0**
- Semantic conformance A/B/C: **50 / 0 / 0**
- Per-question delta vs `00-fresh-benchmark_2026-04-26.md`: **23 improved, 27 unchanged, 0 regressed** (baseline-grade dimension).
- Root causes (rerun): `sector_summary_matches_metrics=1` (Q30), `synthesis_contradiction=1` (Q30) — down from prior 3 distinct causes (`raw_table_regression`, `semantic_contract_missed`, `resolver_failure`).

### Gate command exit codes (run from worktree root unless noted)

| Gate | Command | Exit code |
|---|---|---:|
| 1 | `cd web && npm run build` | 0 |
| 2 | `cd web && npm run typecheck` (after gate 1 generated `.next/types/`) | 0 |
| 3 | `bash scripts/loop/test_grading_gate.sh` | 0 (`slice_fails=39 baseline_fails=39 baseline_failures_fixed=0`) |
| 4 | `( cd web && OPENF1_CHAT_BASE_URL=http://127.0.0.1:3001 npm run healthcheck:chat )` (after `PORT=3001 npm run dev` started in `web/` and verified `HTTP 200` on `http://127.0.0.1:3001/`; non-default port chosen because port 3000 was held by an unrelated Vite process) | 0 (50/50 questions answered, raw output `web/logs/chat_health_check_2026-05-01T02-30-00-837Z.json`) |
| 5 | benchmark gate copy + 50-row validation (`node -e ...`) | 0 (`OK: 50/50 answered`) |
| 6 | comparison-summary gate (grep checks on `11-rerun_2026-04-30.md`) | 0 (`OK: ... has new-run counts, prior-baseline counts, and per-question delta`) |

### Self-check vs acceptance criteria
- [x] `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` exists, contains 50 rows, every row has a non-empty `answer` (asserted by gate 5).
- [x] `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md` exists; contains: per-aspect/per-category A/B/C counts for the new run (46/4/0 baseline, 46/4/0 answer, 50/0/0 semantic), prior-baseline A/B/C counts derived from `00-fresh-benchmark_2026-04-26.json` and `.md`, and explicit Improved (23) / Unchanged (27) / Regressed (0) sections with per-question IDs (asserted by gate 6).
- [x] Test-grading gate (gate 3) exits 0; no new failures vs the loop integration baseline.
- [x] Build and typecheck gates (gates 1 and 2) exit 0 when run in the order declared by the slice (`build` first to populate `.next/types/`, then `typecheck`).
- [x] Comparison vs prior baseline is documented in the `.md` artifact (clear improvement direction at aggregate; per-question deltas enumerated; zero regressions this rerun).

### Files changed
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` (regenerated 50-row graded result set from the 2026-04-30 EDT rerun, source `web/logs/chat_health_check_2026-05-01T02-30-00-837Z.json`)
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md` (regenerated comparison summary aligned to the new JSON)
- `diagnostic/slices/11-rerun-benchmark-baseline.md` (frontmatter status and this note)

Commit hashes:
- `f4b1cd1` — initial submission of artifacts and note (superseded).
- `1338130` — first revision (superseded).
- `ac87b59` — revision round 2: subshell-wrap gate 5, fresh benchmark rerun.
- `8a8c1a4` — note-only follow-up to record the `ac87b59` hash inline.
- `e118b20` — revision round 3: fresh benchmark rerun (`web/logs/chat_health_check_2026-05-01T02-01-45-454Z.json`), regenerated `.json` + `.md` artifacts so the comparison artifact matches the rerun, restated build→typecheck ordering.
- `65800c5` — revision round 4: fresh benchmark rerun (`web/logs/chat_health_check_2026-05-01T02-14-19-591Z.json`) executed in this worktree against `PORT=3001` dev server, regenerated `.json` + `.md` so the comparison artifact derives from this rerun.
- _this commit_ — revision round 5: fresh benchmark rerun (`web/logs/chat_health_check_2026-05-01T02-30-00-837Z.json`) executed in this worktree against `PORT=3001` dev server, regenerated `.json` + `.md` together so the comparison artifact (46/4/0; 23 improved / 27 unchanged / 0 regressed) is derived directly from this rerun.

## Audit verdict

**Status: REVISE**

- Gate 1 `cd web && npm run build` -> exit `0`
- Gate 2 `cd web && npm run typecheck` -> exit `0`
- Gate 3 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
- Gate 4 `( cd web && OPENF1_CHAT_BASE_URL=http://127.0.0.1:3001 npm run healthcheck:chat )` -> exit `0`
- Gate 5 benchmark copy + 50-row validation -> exit `0`
- Gate 6 comparison-summary grep gate -> exit `0`
- Scope diff: PASS — `git diff --name-only integration/perf-roadmap...HEAD` is limited to the two declared artifacts plus `diagnostic/slices/11-rerun-benchmark-baseline.md`.
- Criterion `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` exists with 50 non-empty answers: PASS.
- Criterion `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md` exists and contains the required sections: FAIL. `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md:11`-`diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md:15` and `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md:21`-`diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md:26` still describe the earlier rerun (`46 / 4 / 0` overall, head-to-head `8/1/0`), but the fresh gate-4 rerun copied by gate 5 yields `47 / 3 / 0` overall and head-to-head `9/0/0`.
- Criterion `bash scripts/loop/test_grading_gate.sh` exits `0`: PASS.
- Criterion build and typecheck gates exit `0`: PASS.
- Criterion comparison vs prior baseline is documented regardless of direction: FAIL. `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md:55`-`diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md:107` reports `24 improved, 25 unchanged, 1 regressed`, but the fresh gate-4 rerun joined against `00-fresh-benchmark_2026-04-26.md` yields `25 improved, 24 unchanged, 1 regressed`.
- Decision: REVISE.
- Rationale: the benchmark gates pass, but the checked-in `.md` artifact is stale relative to the fresh rerun and therefore does not satisfy the slice’s comparison-summary deliverable.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Add an explicit benchmark/healthcheck gate command that produces `diagnostic/artifacts/healthcheck/11-rerun_<date>.json` and validates all 50 answers, because the current gate block never runs the benchmark whose artifact and acceptance criteria this slice require.
- [x] Replace `cd web && npm run test:grading` with `cd web && bash scripts/loop/test_grading_gate.sh` per the loop audit protocol, or remove the grading gate if this slice does not need it.

### Medium
- [x] Add the prior baseline artifact path to `## Prior context` so the claimed A/B/C comparison target is explicit and auditable.
- [x] Resolve the contradiction between the goal of capturing a new baseline and the acceptance criterion `Run did NOT regress`; if regression is possible, require documenting the comparison result rather than treating any regression as an automatic plan failure.
- [x] Specify where step 3’s comparison output is recorded and include that file in `## Changed files expected` if it is part of the required deliverable.

### Low
- [x] Align the dated filename in `## Changed files expected` and `## Artifact paths` with the slice `updated` date or make the filename convention explicitly date-agnostic.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-04-30T23:32:00Z`).

## Plan-audit verdict (round 2)

**Status: REVISE**

### High

### Medium
- [x] Add a gate command that generates `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md` and asserts it contains the required new-run counts, prior-baseline counts, and improved / unchanged / regressed question IDs, because the current gate block never produces or validates that required deliverable.
- [x] Specify the row-level source for step 4’s improved / unchanged / regressed question-ID delta by referencing `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md` or another per-question artifact, because `00-fresh-benchmark_2026-04-26.json` only exposes summary/actionable aggregates and cannot support question-level comparison by itself.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-04-30T23:32:00Z`).

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Narrow step 3 and the benchmark gate copy command to the raw results file (`web/logs/chat_health_check_<stamp>.json`) and exclude `*.summary.json`, because `ls -t web/logs/chat_health_check_*.json` will usually pick the later-written summary object instead of the 50-row graded array and make the artifact copy/validation fail.

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-04-30T23:32:00Z`).

## Plan-audit verdict (round 4)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-04-30T23:32:00Z`).
