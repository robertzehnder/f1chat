---
slice_id: 00-fresh-benchmark
phase: 0
status: pending
owner: claude
user_approval_required: no
created: 2026-04-25
updated: 2026-04-26T02:25:42Z
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
- `OPENF1_CHAT_BASE_URL` set to either `http://127.0.0.1:3000` or the deployed URL being benchmarked.
- If using the local URL, start `cd web && npm run dev` in another terminal before the benchmark and stop it in teardown.
- If using a deployed URL, confirm it responds before the benchmark; no local dev-server lifecycle is required.

## Steps
1. If benchmarking locally, start the dev server in another terminal. If benchmarking a deployed URL, confirm that URL responds before continuing.
2. Run `cd web && npm run healthcheck:chat:intense`. Record the produced benchmark log filename and the UTC date token for promotion (`YYYY-MM-DD`, from `date -u +%F`).
3. Run `cd web && npm run healthcheck:grade:intense` immediately after step 2 so it grades the just-produced benchmark log. Record the generated JSON summary and Markdown report filenames.
4. Promote the grader outputs from step 3 to `diagnostic/artifacts/healthcheck/00-fresh-benchmark_<YYYY-MM-DD>.json` and `diagnostic/artifacts/healthcheck/00-fresh-benchmark_<YYYY-MM-DD>.md`, using the UTC date token recorded in step 2 for both filenames.
5. If this slice started a local dev server, stop it in teardown.
6. Append a short summary to the slice-completion note: promoted artifact paths plus overall, answer, and semantic-conformance A/B/C counts.

## Changed files expected
- `diagnostic/slices/00-fresh-benchmark.md`
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_<YYYY-MM-DD>.json`
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_<YYYY-MM-DD>.md`

(Runtime files in `web/logs/` remain dev-sink only; they are git-ignored and do not count as scope changes.)

## Artifact paths
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_<YYYY-MM-DD>.json` — the grader's machine-readable summary.
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_<YYYY-MM-DD>.md` — the human-readable report.

## Gate commands
```bash
test -f "diagnostic/artifacts/healthcheck/00-fresh-benchmark_$(date -u +%F).json"
test -f "diagnostic/artifacts/healthcheck/00-fresh-benchmark_$(date -u +%F).md"
```

## Acceptance criteria
- [ ] Both promoted artifact files exist at `diagnostic/artifacts/healthcheck/00-fresh-benchmark_$(date -u +%F).{json,md}`.
- [ ] The slice-completion note lists the promoted artifact paths and quotes overall, answer, and semantic-conformance A/B/C counts.
- [ ] If this slice started a local dev server, it is stopped in teardown (no orphan process).

## Out of scope
- Acting on the new failure list — Phase 11 does that.

## Risk / rollback
Rollback: `git revert <commit>` (artifact files removed).

## Slice-completion note
(filled by Claude)

## Audit verdict
PASS-WITH-FIXES — clarified local-vs-deployed service handling, made promoted artifact naming and gate checks deterministic, and added the slice file to expected scope because the completion note must be updated.
