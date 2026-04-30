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
Re-run the full chat-quality benchmark against the post-Phase-10 build to capture a new healthcheck baseline.

## Inputs
- `web/scripts/healthcheck.mjs`
- `diagnostic/artifacts/healthcheck/`

## Prior context
- `diagnostic/_state.md`

## Required services / env
All Phase 6 production env (DATABASE_URL pooled, ANTHROPIC_API_KEY).

## Steps
1. Run the healthcheck suite end-to-end (50 questions across categories).
2. Save artifact to `diagnostic/artifacts/healthcheck/11-rerun_<date>.json`.
3. Compare A/B/C grade counts vs the prior baseline; document changes.

## Changed files expected
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-26.json`

## Artifact paths
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-26.json`

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Artifact present with all 50 questions answered.
- [ ] Run did NOT regress (A/B count not lower than prior baseline).

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
- [ ] Add an explicit benchmark/healthcheck gate command that produces `diagnostic/artifacts/healthcheck/11-rerun_<date>.json` and validates all 50 answers, because the current gate block never runs the benchmark whose artifact and acceptance criteria this slice require.
- [ ] Replace `cd web && npm run test:grading` with `cd web && bash scripts/loop/test_grading_gate.sh` per the loop audit protocol, or remove the grading gate if this slice does not need it.

### Medium
- [ ] Add the prior baseline artifact path to `## Prior context` so the claimed A/B/C comparison target is explicit and auditable.
- [ ] Resolve the contradiction between the goal of capturing a new baseline and the acceptance criterion `Run did NOT regress`; if regression is possible, require documenting the comparison result rather than treating any regression as an automatic plan failure.
- [ ] Specify where step 3’s comparison output is recorded and include that file in `## Changed files expected` if it is part of the required deliverable.

### Low
- [ ] Align the dated filename in `## Changed files expected` and `## Artifact paths` with the slice `updated` date or make the filename convention explicitly date-agnostic.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-04-30T23:32:00Z`).
