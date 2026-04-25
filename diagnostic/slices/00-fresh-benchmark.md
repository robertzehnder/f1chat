---
slice_id: 00-fresh-benchmark
phase: 0
status: pending
owner: claude
user_approval_required: no
created: 2026-04-25
updated: 2026-04-25
---

## Goal
Rerun the intense benchmark and grader so all later quality work targets current numbers, not the stale 2026-03-17 baseline. Promote results to tracked artifact paths.

## Inputs
- `web/scripts/chat-health-check.mjs`
- `web/scripts/chat-health-check-grade.mjs`
- `web/scripts/chat-health-check.questions.json`
- `web/scripts/chat-health-check.rubric.intense.json`

## Required services / env
- Postgres reachable (`NEON_DATABASE_URL` or local Docker).
- `ANTHROPIC_API_KEY` set.
- `OPENF1_CHAT_BASE_URL=http://127.0.0.1:3000` (or the deployed URL).
- **Dev server running** in another terminal: `cd web && npm run dev` (start before slice begins; teardown after).

## Steps
1. Start dev server (or confirm deployed URL responds).
2. Run `cd web && npm run healthcheck:chat:intense`. Note the produced log filename.
3. Run `cd web && npm run healthcheck:grade:intense` against the latest log.
4. Promote both files to `diagnostic/artifacts/healthcheck/00-fresh-benchmark_<UTC-date>.{json,md}`.
5. Stop dev server in teardown.
6. Append a short summary to the slice-completion note: A/B/C counts on each axis.

## Changed files expected
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_<date>.json`
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_<date>.md`

(Runtime files in `web/logs/` remain dev-sink only; they are git-ignored and do not count as scope changes.)

## Artifact paths
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_<date>.json` — the grader's machine-readable summary.
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_<date>.md` — the human-readable report.

## Gate commands
```bash
ls diagnostic/artifacts/healthcheck/00-fresh-benchmark_*.json | head -1 | xargs test -f
ls diagnostic/artifacts/healthcheck/00-fresh-benchmark_*.md   | head -1 | xargs test -f
```

## Acceptance criteria
- [ ] Both artifact files exist under tracked paths.
- [ ] Summary in slice-completion note quotes overall, answer, and semantic-conformance A/B/C counts.
- [ ] Dev server stopped in teardown (no orphan process).

## Out of scope
- Acting on the new failure list — Phase 11 does that.

## Risk / rollback
Rollback: `git revert <commit>` (artifact files removed).

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by auditor)
