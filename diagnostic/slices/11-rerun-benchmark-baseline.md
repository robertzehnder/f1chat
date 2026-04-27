---
slice_id: 11-rerun-benchmark-baseline
phase: 11
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
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
