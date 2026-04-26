---
slice_id: 00-fresh-benchmark
phase: 0
status: ready_to_merge
owner: user
user_approval_required: no
created: 2026-04-25
updated: 2026-04-26T03:44:43Z
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

- Branch: `slice/00-fresh-benchmark` (branched from `integration/perf-roadmap` at `c53ec22`).
- Service lifecycle: a local OpenF1 dev server (`next dev`, PID 89342) was already running on `*:3000` (IPv6) before the slice started; this slice did **not** start it and therefore does **not** stop it (per step 5).
- Base URL: `OPENF1_CHAT_BASE_URL=http://localhost:3000` was used so the benchmark routed to the OpenF1 next-server (IPv6 ::1) instead of an unrelated Vite app on IPv4 127.0.0.1:3000. Verified before the run with `curl http://localhost:3000/api/chat`.
- UTC date token (from `date -u +%F`): `2026-04-26`.

### Step 2 — `npm run healthcheck:chat:intense`
- Produced benchmark log: `web/logs/chat_health_check_2026-04-26T03-37-13-005Z.json` (and matching `.summary.json` / `.md`).
- All 50 questions ran to completion (no early stop, no fatal-server-failure exit).

### Step 3 — `npm run healthcheck:grade:intense`
- The script's auto-pick of "latest health-check JSON" matched stale `chat_health_check_baseline_*.summary.json` files lexically (because the regex `chat_health_check_.*\.json` includes `_baseline_` and `.summary.json`). The first invocation therefore failed with `Input JSON must be an array of health-check result rows.` Fixing the auto-pick is out of scope for slice 00.
- Re-ran with `--input logs/chat_health_check_2026-04-26T03-37-13-005Z.json` so it graded the just-produced benchmark log, as the slice intends.
- Grader outputs:
  - `web/logs/chat_health_check_baseline_2026-04-26T03-37-41-247Z.json` (per-row graded results)
  - `web/logs/chat_health_check_baseline_2026-04-26T03-37-41-247Z.summary.json` (machine-readable summary — promoted as `.json` artifact)
  - `web/logs/chat_health_check_baseline_2026-04-26T03-37-41-247Z.md` (human-readable report — promoted as `.md` artifact)

### Step 4 — Promotion
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json` (copied from the grader `.summary.json`).
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md` (copied from the grader `.md`).

### Step 5 — Teardown
- Skipped: this slice did not start a local dev server, so there is nothing to stop. The pre-existing dev server is left untouched.

### Step 6 — Counts (quoted from `00-fresh-benchmark_2026-04-26.json` → `summary`)
- Total questions: 50
- Overall baseline grades (`gradeCounts`): A=24, B=11, C=15
- Answer grades (`answerGradeCounts`): A=44, B=6, C=0
- Semantic-conformance grades (`semanticConformanceGradeCounts`): A=29, B=6, C=15
- Answerability: `answerable_and_answered`=46, `expected_clarification_met`=4, `expected_clarification_missed`=0, `unnecessary_clarification`=0, `answerable_but_unanswered`=0
- Root causes flagged: `raw_table_regression`=1 (Q6), `semantic_contract_missed`=1 (Q6), `resolver_failure`=1 (Q26)

### Gate commands
- `test -f "diagnostic/artifacts/healthcheck/00-fresh-benchmark_$(date -u +%F).json"` → exit 0
- `test -f "diagnostic/artifacts/healthcheck/00-fresh-benchmark_$(date -u +%F).md"` → exit 0

### Self-check vs acceptance criteria
- [x] Both promoted artifact files exist at `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.{json,md}`.
- [x] Slice-completion note lists the promoted artifact paths and quotes overall, answer, and semantic-conformance A/B/C counts.
- [x] No local dev server was started by this slice, so no teardown was required (pre-existing server still running, untouched).

## Audit verdict
audit: PASS

[slice:00-fresh-benchmark][pass]

Gate commands re-run locally:
- `test -f "diagnostic/artifacts/healthcheck/00-fresh-benchmark_$(date -u +%F).json"` -> exit 0
- `test -f "diagnostic/artifacts/healthcheck/00-fresh-benchmark_$(date -u +%F).md"` -> exit 0

Scope diff:
- `git diff --name-only integration/perf-roadmap...HEAD` contains only `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json`, `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.md`, and `diagnostic/slices/00-fresh-benchmark.md`.
- This is a subset of "Changed files expected"; the slice file is also explicitly expected and implicitly allowed.

Acceptance criteria:
- PASS: Both promoted artifact files exist at `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.{json,md}`.
- PASS: The slice-completion note lists both promoted artifact paths and quotes overall A=24/B=11/C=15, answer A=44/B=6/C=0, and semantic-conformance A=29/B=6/C=15.
- PASS: The slice-completion note states this slice did not start the pre-existing local dev server, so no teardown was required.

Phase 0 merge status: `status=ready_to_merge`, `owner=user`.
