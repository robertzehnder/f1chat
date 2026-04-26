---
slice_id: 01-baseline-snapshot
phase: 1
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
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
1. Confirm dev server is up: `curl -fsS http://127.0.0.1:3000/api/admin/perf-summary` returns a 200 JSON response.
2. Run a fixed 10–20-question benchmark against the chat endpoint (subset of `chat-health-check.questions.json` is fine; full 50 is ok if you have time). Each request will populate `web/logs/chat_query_trace.jsonl` with stage timings.
3. After the benchmark, GET `/api/admin/perf-summary` to fetch the aggregated p50/p95 per stage.
4. Save the perf-summary JSON to `diagnostic/artifacts/perf/01-baseline-snapshot_<UTC-date>.json`.
5. Generate a short human-readable companion `diagnostic/artifacts/perf/01-baseline-snapshot_<UTC-date>.md` with:
   - One-line overall median request time
   - Per-stage p50 / p95 table
   - Notes section with anything notable (cold-start spikes, outliers).
6. The slice-completion note records the headline numbers (p50 / p95 totals) so the audit can verify against the artifacts.

## Changed files expected
- `diagnostic/artifacts/perf/01-baseline-snapshot_<UTC-date>.json`
- `diagnostic/artifacts/perf/01-baseline-snapshot_<UTC-date>.md`
- `diagnostic/slices/01-baseline-snapshot.md` (slice-completion note + audit verdict; always implicitly allowed)

## Artifact paths
- `diagnostic/artifacts/perf/01-baseline-snapshot_<UTC-date>.json` — machine-readable per-stage summary.
- `diagnostic/artifacts/perf/01-baseline-snapshot_<UTC-date>.md` — human-readable summary.

## Gate commands
```bash
# Verify the dev server is up (slice-blocking precondition)
curl -fsS http://127.0.0.1:3000/api/admin/perf-summary >/dev/null

cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading

# Verify both artifact files exist on tracked paths
ls diagnostic/artifacts/perf/01-baseline-snapshot_*.json | head -1 | xargs test -f
ls diagnostic/artifacts/perf/01-baseline-snapshot_*.md   | head -1 | xargs test -f
```

## Acceptance criteria
- [ ] Both artifact files exist under `diagnostic/artifacts/perf/`.
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
