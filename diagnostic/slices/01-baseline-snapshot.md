---
slice_id: 01-baseline-snapshot
phase: 1
status: ready_to_merge
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26T11:23:00-04:00
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
- **Dev server running** in another terminal: `cd web && npm run dev` (binds by default to `http://127.0.0.1:3000`; if another process occupies port 3000, start it on a free port instead).
- **Export `OPENF1_CHAT_BASE_URL`** to match the actual dev-server port before starting this slice (e.g., `export OPENF1_CHAT_BASE_URL=http://127.0.0.1:3000` or `…:3001`). All steps and gate commands read this variable — do not hardcode a port.

Verify the dev server responds before running the benchmark; abort the slice with status=blocked if not.

## Steps
1. Capture the UTC date token at slice start: `DATE=$(date -u +%Y-%m-%d)`. Use this exact value for every artifact path produced by this slice (no wildcards, no re-deriving later).
2. Confirm dev server is up: `curl -fsS "${OPENF1_CHAT_BASE_URL}/api/admin/perf-summary"` returns a 200 JSON response.
3. **Isolate the trace file before running the benchmark** so the perf-summary fetch in step 5 sees only the 50 requests from this slice's run. The endpoint defaults to summarizing the most recent 200 perfTrace records (records with a top-level `spans` array; see `01-perf-summary-route.md`), so any stale traces left in `web/logs/chat_query_trace.jsonl` from earlier benchmark / dev-server activity would otherwise contaminate the baseline. From the repo root, atomically move any existing trace file aside before the benchmark starts:
   ```bash
   mkdir -p web/logs
   if [ -f web/logs/chat_query_trace.jsonl ]; then
     mv web/logs/chat_query_trace.jsonl "web/logs/chat_query_trace.jsonl.pre-${DATE}"
   fi
   ```
   The dev server will recreate the file on the first traced request. Do not delete the rotated `*.pre-${DATE}` backup; leave it in `web/logs/` (gitignored) for inspection if anomalies appear.
4. Run the canonical fixed benchmark — the full 50-question intense set — against the chat endpoint. Run from repo root: `(cd web && npm run healthcheck:chat:intense)` (`OPENF1_CHAT_BASE_URL` is inherited from the parent shell — do not inline-set it here, as that would shadow the exported value). This MUST be the exact script + question file (`web/scripts/chat-health-check.questions.json`, all 50 entries) and rubric (`web/scripts/chat-health-check.rubric.intense.json`); do not pass `--questions` to subset, and do not invoke `chat-health-check.mjs` directly with a different file. Each request appends one perfTrace record (with a top-level `spans` array) to the freshly recreated `web/logs/chat_query_trace.jsonl`, so the benchmark run produces exactly 50 perfTrace records in that file.
5. After the benchmark, fetch the aggregated p50/p95 per stage with an explicit window of 50: `curl -fsS "${OPENF1_CHAT_BASE_URL}/api/admin/perf-summary?n=50"`. Verify the response's `window.returned === 50` before continuing — if it is not 50, abort the slice with status=blocked and document which step (rotation, benchmark, or fetch) leaked. (`?n=50` is within the endpoint's accepted `[1, 1000]` range and is honored verbatim — no fallback to the 200 default.)
6. Save the perf-summary JSON to the exact path `diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.json`.
7. Generate a short human-readable companion at the exact path `diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.md` with:
   - One-line overall median request time
   - Per-stage p50 / p95 table
   - Notes section with anything notable (cold-start spikes, outliers).
8. Record `${DATE}` in the slice-completion note alongside the headline numbers (p50 / p95 totals) and the confirmed `window.returned` value (must equal 50) so the audit can verify against the exact artifact paths and the trace-isolation invariant.

## Changed files expected
- `diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.json` (exact `${DATE}` from step 1)
- `diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.md` (exact `${DATE}` from step 1)
- `diagnostic/slices/01-baseline-snapshot.md` (slice-completion note + audit verdict; always implicitly allowed)

## Artifact paths
- `diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.json` — machine-readable per-stage summary, where `${DATE}` is the UTC date token captured in step 1.
- `diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.md` — human-readable summary, same `${DATE}`.

## Gate commands
```bash
# Run all gates from the repo root. Each `web/` command uses a subshell
# `(cd web && ...)` so the cwd is restored to the repo root afterward —
# avoid bare `cd web && ...` chained across lines, which leaves you in
# `web/` and turns the next `cd web` into `web/web` (and the `test -f`
# checks below into `web/diagnostic/...`).

# Use the SAME UTC date token captured at slice start (step 1).
# Do not re-derive with `date` here; export DATE explicitly so the gates
# fail loudly if the artifacts were written under a different date.
: "${DATE:?must export DATE=<UTC-date> matching the artifacts written in steps 5–6}"
: "${OPENF1_CHAT_BASE_URL:?must export OPENF1_CHAT_BASE_URL=http://127.0.0.1:<PORT> matching the running dev server}"

# Verify the dev server is up (slice-blocking precondition)
curl -fsS "${OPENF1_CHAT_BASE_URL}/api/admin/perf-summary" >/dev/null

(cd web && npm run build)
(cd web && npm run typecheck)
(cd web && npm run test:grading)

# Verify both artifact files exist at the EXACT paths produced by this slice
# (no wildcards — wildcards can match stale 01-baseline-snapshot_* files).
# These run from the repo root because the subshells above did not change
# the parent shell's cwd.
test -f "diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.json"
test -f "diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.md"

# Verify the saved perf-summary window matches the 50-question benchmark
# exactly — direct evidence that the trace-isolation step (Steps §3) worked
# and the summary was not contaminated by stale perfTrace records. Uses
# node so this is portable without jq.
node -e '
  const j = require("./diagnostic/artifacts/perf/01-baseline-snapshot_'"${DATE}"'.json");
  if (j.window?.returned !== 50 || j.window?.requested !== 50) {
    console.error("window mismatch:", JSON.stringify(j.window));
    process.exit(1);
  }
'
```

## Acceptance criteria
- [ ] Both artifact files exist at the exact paths `diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.{json,md}` where `${DATE}` is the UTC date captured at slice start (step 1).
- [ ] Slice-completion note records `${DATE}` so the audit can verify the exact artifact paths (no wildcard matching).
- [ ] Saved JSON's `window.returned === 50` (and `window.requested === 50`) — direct evidence that the perf-summary fetch was isolated to the 50 requests from this slice's benchmark run, not contaminated by stale perfTrace records.
- [ ] Companion markdown contains a per-stage p50/p95 table (not just raw JSON).
- [ ] Slice-completion note quotes overall median, at least three highest-latency stages, and the confirmed `window.returned` value (= 50).
- [ ] All gates exit 0.

## Out of scope
- Reducing latency (every later phase does that).
- Production perf sink (Phase 6 / 12).

## Risk / rollback
Rollback: `git revert <commit>` removes the artifact files. Runtime trace in `web/logs/` is dev-sink only.

## Slice-completion note

- Branch: `slice/01-baseline-snapshot` (reset to `integration/perf-roadmap` @ `4b62346` to pick up the protocol-repair commit before doing slice work; the prior `935a870 [blocked]` slice-file edit is no longer on the branch).
- UTC date token (Step 1): `DATE=2026-04-26` (from `date -u +%Y-%m-%d`). Used verbatim for both artifact filenames and as the suffix on the rotated trace backup.
- Dev server / `OPENF1_CHAT_BASE_URL`: an OpenF1 `next-server` (PID `97713`) was already listening on `*:3001`; an unrelated Vite dev server (PID `61936`) holds `[::1]:3000`. Per the revised Required-services block, exported `OPENF1_CHAT_BASE_URL=http://127.0.0.1:3001` for the entire slice (steps + gates). Step 2 verification: `curl -fsS "${OPENF1_CHAT_BASE_URL}/api/admin/perf-summary"` returned `200 {"window":{"requested":200,"returned":0},"stages":{}}` — the empty `stages` is the expected post-rotation pre-benchmark state, not a failure.
- Trace isolation (Step 3): `web/logs/chat_query_trace.jsonl` (58 records, last modified `Apr 26 10:29`, all from earlier dev-server activity) was atomically renamed to `web/logs/chat_query_trace.jsonl.pre-2026-04-26` before the benchmark. The dev server recreated the file on the first traced request; final line count after the run was exactly **50**, confirming clean isolation. The `.pre-2026-04-26` backup is gitignored and left in place for inspection.
- Benchmark (Step 4): ran from repo root as `(cd web && npm run healthcheck:chat:intense)`, with `OPENF1_CHAT_BASE_URL` inherited from the parent shell (no inline shadowing). The unmodified `web/scripts/chat-health-check.questions.json` (50 entries) and `web/scripts/chat-health-check.rubric.intense.json` rubric were used; no `--questions` flag was passed. All 50/50 ran to completion, exit code `0`. Output logs:
  - `web/logs/chat_health_check_2026-04-26T15-18-09-530Z.json`
  - `web/logs/chat_health_check_2026-04-26T15-18-09-530Z.summary.json`
  - `web/logs/chat_health_check_2026-04-26T15-18-09-530Z.md`
- Perf-summary fetch (Step 5): `curl -fsS "${OPENF1_CHAT_BASE_URL}/api/admin/perf-summary?n=50"` returned `window.requested === 50` AND `window.returned === 50`. The trace-isolation invariant held; no abort.
- Artifacts (Steps 6 / 7) — exact paths, both committed:
  - `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.json` — pretty-printed perf-summary JSON; 11 stages including `total`.
  - `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.md` — companion with one-line headline (`total.p50_ms = 12603.28 ms`), per-stage p50 / p95 / max table sorted by `p95_ms` desc, and a Notes section flagging (a) `runtime_classify` and `resolve_db` reporting identical numbers across all 50 records (likely nested-span artifact, worth confirming in a later slice); (b) `sqlgen_llm` only firing on 12/50 requests because `template_match` short-circuited the rest; (c) `repair_llm` firing only twice; (d) `execute_db` being the only non-LLM stage with seconds-scale latency.

### Headline numbers (Step 8)

- `${DATE}` = `2026-04-26` (used for both artifact paths).
- `window.requested` = `50`, `window.returned` = `50` (acceptance criterion #3 satisfied).
- Overall median (`total.p50_ms`): **12603.28 ms** (~12.6 s).
- Overall p95 (`total.p95_ms`): **26310.01 ms** (~26.3 s).
- Three highest-latency stages by `p95_ms` (excluding the `total` umbrella):
  1. `runtime_classify` — count 50, p50 7190.91 ms, p95 16718.68 ms, max 17967.61 ms.
  2. `resolve_db` — count 50, p50 7190.91 ms, p95 16718.68 ms, max 17967.61 ms (numerically identical to `runtime_classify` across all 50 records — see Notes).
  3. `sqlgen_llm` — count 12, p50 3807.30 ms, p95 7650.41 ms, max 7650.41 ms.

### Gate command results (slice-specified order, run from repo root)

- `: "${DATE:?…}"` / `: "${OPENF1_CHAT_BASE_URL:?…}"` — exit `0` (both exported).
- `curl -fsS "${OPENF1_CHAT_BASE_URL}/api/admin/perf-summary" >/dev/null` — exit `0`.
- `(cd web && npm run build)` — exit `0`. Next 15 production build, all 4 static pages generated, `/api/admin/perf-summary` listed as `ƒ` (dynamic).
- `(cd web && npm run typecheck)` — exit `0`. `tsc --noEmit` clean.
- `(cd web && npm run test:grading)` — exit `0`. TAP `1..26`; `# pass 17 # fail 0 # skipped 9` (the 9 chat-integration tests skip as designed without `OPENF1_RUN_CHAT_INTEGRATION_TESTS=1`).
- `test -f "diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.json"` — exit `0`.
- `test -f "diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.md"` — exit `0`.
- `node -e '... j.window?.returned !== 50 || j.window?.requested !== 50 ...'` — exit `0`; printed `WINDOW_OK requested=50 returned=50`.

### Self-checks vs acceptance criteria

- [x] Both artifact files exist at `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.{json,md}` (the exact `${DATE}` from Step 1).
- [x] Slice-completion note records `${DATE}=2026-04-26` so the audit can match the exact artifact paths without wildcards.
- [x] Saved JSON's `window.returned === 50` AND `window.requested === 50` — direct evidence the perf-summary fetch saw only this slice's 50 perfTrace records.
- [x] Companion markdown contains a per-stage p50 / p95 (and max) table, not just raw JSON.
- [x] Slice-completion note quotes overall median (`total.p50_ms = 12603.28 ms`), the three highest-latency stages by p95 (`runtime_classify`, `resolve_db`, `sqlgen_llm`), and the confirmed `window.returned = 50`.
- [x] All gates exit `0`.

## Audit verdict
audit: PASS

[slice:01-baseline-snapshot][pass]

Gate commands re-run locally from repo root / `web/` as specified:
- `curl -fsS "${OPENF1_CHAT_BASE_URL}/api/admin/perf-summary" >/dev/null` with `OPENF1_CHAT_BASE_URL=http://127.0.0.1:3001` — exit `0`.
- `(cd web && npm run build)` — exit `0`; Next production build completed and listed `/api/admin/perf-summary` as dynamic.
- `(cd web && npm run typecheck)` — exit `0`; `tsc --noEmit` clean.
- `(cd web && npm run test:grading)` — exit `0`; TAP `1..26`, `# pass 17`, `# fail 0`, `# skipped 9`.
- `test -f "diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.json"` with `DATE=2026-04-26` — exit `0`.
- `test -f "diagnostic/artifacts/perf/01-baseline-snapshot_${DATE}.md"` with `DATE=2026-04-26` — exit `0`.
- `node -e '...'` window check against `01-baseline-snapshot_2026-04-26.json` — exit `0`; `window.requested === 50` and `window.returned === 50`.

Scope diff:
- `git diff --name-only integration/perf-roadmap...HEAD` returned only `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.json`, `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.md`, and `diagnostic/slices/01-baseline-snapshot.md`.
- Scope check passes. The two artifact files are listed under "Changed files expected"; this slice file is explicitly expected and implicitly allowed.

Acceptance criteria:
- PASS: Both artifact files exist at `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.{json,md}`, matching the recorded UTC date token.
- PASS: Slice-completion note records `DATE=2026-04-26` for exact artifact verification.
- PASS: Saved JSON has `window.requested === 50` and `window.returned === 50`.
- PASS: Companion markdown contains a per-stage p50 / p95 / max table, not raw JSON only.
- PASS: Slice-completion note quotes overall median `12603.28 ms`, overall p95 `26310.01 ms`, the three highest-latency stages by p95 (`runtime_classify`, `resolve_db`, `sqlgen_llm`), and confirmed `window.returned = 50`.
- PASS: All gates exit `0`.

Phase 1 merge status: `status=ready_to_merge`, `owner=codex`.

[protocol-repair 2026-04-26] Implementer self-blocked because slice hardcoded port 3000 throughout Steps §2/§4/§5 and Gate commands, while the OpenF1 dev server was bound to port 3001 by a port conflict. Fixed by replacing all four literal `:3000` URLs with `${OPENF1_CHAT_BASE_URL}` and adding a Required-services note to export the variable before running the slice. Status flipped to revising/claude for retry.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High

### Medium
- [x] Tie the artifact existence gates and acceptance criterion to the UTC date token or exact artifact paths produced by this slice, instead of using broad wildcards that can pass against stale `01-baseline-snapshot_*` files.

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T14:31:44Z`, which is less than 24 hours old at audit time.
- The declared prior-context paths all exist, and `01-perf-summary-route.md` documents the expected `{ stages: { [name]: { count, p50_ms, p95_ms, max_ms } } }` shape.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Fix the gate command working-directory flow so `npm run build`, `npm run typecheck`, `npm run test:grading`, and the root-relative artifact `test -f` checks all execute from the intended directories without repeated `cd web` causing `web/web` lookups or artifact checks from `web/`.

### Medium
- [x] Specify the exact fixed benchmark selection and command, such as full 50 or a named first-N subset, so the promoted perf baseline is reproducible instead of varying by implementer choice.

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T14:31:44Z`, which is less than 24 hours old at audit time.
- Prior context was read; the endpoint shape includes per-stage `count`, `p50_ms`, `p95_ms`, and `max_ms`, and the timing writer includes a `total` stage that can serve as the overall request-time median source.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Specify how the perf-summary fetch is isolated to the 50 requests from this slice's benchmark run, because the endpoint default summarizes the most recent 200 perfTrace records and can include stale traces from earlier runs.

### Medium

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T14:31:44Z`, which is less than 24 hours old at audit time.
- Prior context was read; prior round items are addressed by the current exact artifact paths, subshell gate cwd flow, and full 50-question benchmark command.

## Plan-audit verdict (round 4)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T14:31:44Z`, which is less than 24 hours old at audit time.
- Prior context was read; the round 3 trace-isolation item is addressed by rotating `web/logs/chat_query_trace.jsonl`, fetching `?n=50`, and gating on `window.requested === 50` and `window.returned === 50`.
