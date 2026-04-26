---
slice_id: 01-baseline-snapshot
phase: 1
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26T14:41:51Z
---

## Goal
Capture a Phase 1 perf baseline: with stage timings now wired (slice `01-route-stage-timings`) and the perf-summary route live (slice `01-perf-summary-route`), run a small fixed benchmark and promote per-stage p50/p95 numbers to a tracked artifact. This is the latency baseline every later phase (caching, materialization, Neon work) measures itself against.

## Inputs
- `web/scripts/chat-health-check.mjs` (existing — reuses 50-question intense set or a subset)
- `web/scripts/chat-health-check.questions.json`
- `web/src/app/api/admin/perf-summary/route.ts` (perf-summary endpoint from prior slice)
- [roadmap §4 Phase 1 step 4](../roadmap_2026-04_performance_and_upgrade.md)

## Prior context

Read these before triaging or implementing:

- `diagnostic/_state.md` — current phase counts, recent merges, accumulated auditor notes.
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.{md,json}` — the most recent benchmark baseline. The artifact-naming convention here (`<slice>_<UTC-date>.{json,md}`) is what this slice's "Prior context" expects you to match for `01-baseline-snapshot_<UTC-date>.{json,md}`.
- `diagnostic/slices/01-perf-summary-route.md` — the aggregator endpoint shape this slice queries; if its response shape differs from `{ stages: { name: { count, p50_ms, p95_ms, max_ms } } }`, raise a Medium audit item.
- `diagnostic/slices/00-fresh-benchmark.md` — pattern for "slice depends on running services" — the Required services / env block here must mirror that one's structure (dev server up + Postgres + ANTHROPIC_API_KEY + verify-before-run).

## Required services / env
- Postgres reachable (`NEON_DATABASE_URL` or local Docker).
- `ANTHROPIC_API_KEY` set (in dev server's env).
- **Dev server running** in another terminal: `cd web && npm run dev` on `http://127.0.0.1:3000`.
- `OPENF1_CHAT_BASE_URL=http://127.0.0.1:3000` for the benchmark script.

Verify the dev server responds before running the benchmark; abort the slice with status=blocked if not.

## Steps
1. Capture the UTC date token at slice start: `DATE=$(date -u +%Y-%m-%d)`. Use this exact value for every artifact path produced by this slice (no wildcards, no re-deriving later).
2. Confirm dev server is up: `curl -fsS http://127.0.0.1:3000/api/admin/perf-summary` returns a 200 JSON response.
3. Run a fixed 10–20-question benchmark against the chat endpoint (subset of `chat-health-check.questions.json` is fine; full 50 is ok if you have time). Each request will populate `web/logs/chat_query_trace.jsonl` with stage timings.
4. After the benchmark, GET `/api/admin/perf-summary` to fetch the aggregated p50/p95 per stage.
5. Save the perf-summary JSON to the exact path `diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.json`.
6. Generate a short human-readable companion at the exact path `diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.md` with:
   - One-line overall median request time
   - Per-stage p50 / p95 table
   - Notes section with anything notable (cold-start spikes, outliers).
7. Record `${DATE}` in the slice-completion note alongside the headline numbers (p50 / p95 totals) so the audit can verify against the exact artifact paths.

## Changed files expected
- `diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.json` (exact `${DATE}` from step 1)
- `diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.md` (exact `${DATE}` from step 1)
- `diagnostic/slices/01-baseline-snapshot.md` (slice-completion note + audit verdict; always implicitly allowed)

## Artifact paths
- `diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.json` — machine-readable per-stage summary, where `${DATE}` is the UTC date token captured in step 1.
- `diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.md` — human-readable summary, same `${DATE}`.

## Gate commands
```bash
# Use the SAME UTC date token captured at slice start (step 1).
# Do not re-derive with `date` here; export DATE explicitly so the gates
# fail loudly if the artifacts were written under a different date.
: "${DATE:?must export DATE=<UTC-date> matching the artifacts written in steps 5–6}"

# Verify the dev server is up (slice-blocking precondition)
curl -fsS http://127.0.0.1:3000/api/admin/perf-summary >/dev/null

cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading

# Verify both artifact files exist at the EXACT paths produced by this slice
# (no wildcards — wildcards can match stale 01-baseline-snapshot_* files).
test -f "diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.json"
test -f "diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.md"
```

## Acceptance criteria
- [ ] Both artifact files exist at the exact paths `diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.{json,md}` where `${DATE}` is the UTC date captured at slice start (step 1).
- [ ] Slice-completion note records `${DATE}` so the audit can verify the exact artifact paths (no wildcard matching).
- [ ] Companion markdown contains a per-stage p50/p95 table (not just raw JSON).
- [ ] Slice-completion note quotes overall median and at least three highest-latency stages.
- [ ] All gates exit 0.

## Out of scope
- Reducing latency (every later phase does that).
- Production perf sink (Phase 6 / 12).

## Risk / rollback
Rollback: `git revert <commit>` removes the artifact files. Runtime trace in `web/logs/` is dev-sink only.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High

### Medium
- [x] Tie the artifact existence gates and acceptance criterion to the UTC date token or exact artifact paths produced by this slice, instead of using broad wildcards that can pass against stale `01-baseline-snapshot_*` files.

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T14:31:44Z`, which is less than 24 hours old at audit time.
- The declared prior-context paths all exist, and `01-perf-summary-route.md` documents the expected `{ stages: { [name]: { count, p50_ms, p95_ms, max_ms } } }` shape.
