---
slice_id: 11-rerun-benchmark-baseline
phase: 11
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
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
2. Run the healthcheck suite end-to-end (50 questions across categories) via `cd web && npm run healthcheck:chat`. The script writes the graded JSON to `web/logs/chat_health_check_<stamp>.json`.
3. Copy the most recent `web/logs/chat_health_check_*.json` to `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` (the slice artifact).
4. Generate a sibling `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md` summary file containing: per-category A/B/C counts for the new run, per-category A/B/C counts for the prior baseline (`00-fresh-benchmark_2026-04-26.json`), and an explicit delta table (improved / unchanged / regressed question IDs).
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
cd web && npm run healthcheck:chat
LATEST_JSON=$(ls -t web/logs/chat_health_check_*.json | head -1)
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
(filled by Claude)

## Audit verdict
(filled by Codex)

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
- [ ] Add a gate command that generates `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md` and asserts it contains the required new-run counts, prior-baseline counts, and improved / unchanged / regressed question IDs, because the current gate block never produces or validates that required deliverable.
- [ ] Specify the row-level source for step 4’s improved / unchanged / regressed question-ID delta by referencing `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md` or another per-question artifact, because `00-fresh-benchmark_2026-04-26.json` only exposes summary/actionable aggregates and cannot support question-level comparison by itself.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-04-30T23:32:00Z`).
