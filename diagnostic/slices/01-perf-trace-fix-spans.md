---
slice_id: 01-perf-trace-fix-spans
phase: 1
status: pending
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T03:46:40Z
---

## Goal
Fix the span-boundary bug where `runtime_classify` and `resolve_db` report numerically identical p50/p95 latencies (`p50=7190.91ms`, `p95=16718.68ms`, n=50 each) in `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.json`. The cause is documented in `01-route-stage-timings.md` step 2: both spans are started immediately before `buildChatRuntime` and ended immediately after it, intentionally as concurrent spans wrapping the same call (because `buildChatRuntime` does both classification and DB resolution internally). That slice deferred the split as out-of-scope. **This slice does the split**: move the spans *inside* `buildChatRuntime` so `runtime_classify` covers only the local `classifyQuestion` work and `resolve_db` covers only the DB-resolution work. After the fix, re-capture the Phase 1 baseline so Phase 2/3 measurements have a trustworthy "before" number that doesn't alias the two stages.

## Inputs
- `web/src/lib/perfTrace.ts` (span helpers; idempotent `Span.end()`; `flushTrace` writes to `web/logs/chat_query_trace.jsonl`).
- `web/src/app/api/chat/route.ts` (where the two concurrent spans currently wrap `buildChatRuntime`; see lines ~209–221).
- `web/src/lib/chatRuntime.ts` (`classifyQuestion` at ~line 516 and the entity-resolution work that follows in `buildChatRuntime`).
- `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.json` (the misleading baseline; aliased stages are documented in its companion `.md`).
- `diagnostic/slices/01-route-stage-timings.md` (the slice that introduced the concurrent-span workaround and explicitly deferred the split).
- `diagnostic/slices/01-baseline-snapshot.md` (the canonical procedure for capturing a Phase 1 perf baseline — re-used verbatim in Steps below).

## Prior context

Read these before triaging or implementing:

- `diagnostic/_state.md` — current phase counts, "Latest perf baseline" headline, recent merges, accumulated auditor notes.
- `diagnostic/slices/01-baseline-snapshot.md` — canonical baseline procedure: trace-isolation rotation, full 50-question benchmark, `?n=50` window check, repo-root subshell gate pattern, exact artifact path convention `diagnostic/artifacts/perf/<slice>_<UTC-date>.{json,md}`. This slice's re-baseline reuses that procedure with only the slice prefix changed.
- `diagnostic/slices/01-route-stage-timings.md` — defines the 10 stage names and the existing concurrent-span workaround for `runtime_classify` / `resolve_db`. The Steps and acceptance criteria here MUST keep the `route-trace.test.mjs` static-analysis assertions passing (all 10 `startSpan("<stage>")` call sites must still appear somewhere reachable from the route — moving them into `chatRuntime.ts` is allowed only if the spans are still sourced from `@/lib/perfTrace`).
- `diagnostic/slices/01-perf-trace-helpers.md` — the `startSpan` / `Span.end` / `flushTrace` API contract (`Span.end()` returns a `SpanRecord`; `flushTrace(requestId, SpanRecord[])`).
- `web/src/app/api/chat/route.ts` (lines ~205–225) — the current concurrent-span block, which this slice replaces with a single delegate that lets `buildChatRuntime` start/end the two spans internally.
- `web/src/lib/chatRuntime.ts` (the `buildChatRuntime` body and `classifyQuestion` at ~line 516) — confirms the natural split point: `classifyQuestion` is synchronous and local; the entity-resolution / DB-touching work happens after it.

## Required services / env

The implementation work (span split + new perf-trace span unit test) does not require live services. The re-baseline run does. Environment for the **re-baseline only**:

- **Postgres reachable** — `NEON_DATABASE_URL` (or local Docker) set in the dev server's environment, exactly as `01-baseline-snapshot` requires. The 50-question benchmark exercises real DB queries via `/api/chat`.
- **Anthropic API access** — `ANTHROPIC_API_KEY` set in the dev server's environment. The benchmark exercises `sqlgen_llm`, `synthesize_llm`, and possibly `repair_llm`.
- **Dev server running** in another terminal: `cd web && npm run dev` (Next binds by default to `http://127.0.0.1:3000`; if port 3000 is occupied, it picks the next free port — confirm where it actually bound).
- **Export `OPENF1_CHAT_BASE_URL`** in the parent shell that runs the slice steps to match the actual dev-server port (e.g. `export OPENF1_CHAT_BASE_URL=http://127.0.0.1:3001`). All re-baseline steps and the corresponding gate checks read this variable verbatim — do not hardcode a port.
- `OPENF1_RUN_BENCHMARKS` is **not** required by `npm run healthcheck:chat:intense` (this slice does not introduce a new gate); do not export it unless an unrelated script needs it.

Verify the dev server responds before running the benchmark; abort the slice with `status=blocked` if `curl -fsS "${OPENF1_CHAT_BASE_URL}/api/admin/perf-summary"` does not return 200 JSON.

## Steps
1. **Confirm the bug shape** — read `web/src/app/api/chat/route.ts:205–225` and `web/src/lib/chatRuntime.ts` (`classifyQuestion` ~line 516, then the entity-resolution body). Confirm the two spans currently bracket the same `buildChatRuntime` call concurrently (matching the comment at route.ts:209). No edits in this step; it just locks in the diagnosis.
2. **Move the span boundaries inside `buildChatRuntime`** — in `web/src/lib/chatRuntime.ts`, import `startSpan` and the `SpanRecord` type from `@/lib/perfTrace`. Extend `BuildChatRuntimeInput` (or the call signature of `buildChatRuntime`) to accept an optional `recordSpan?: (record: SpanRecord) => void` callback supplied by the caller. Wrap only `classifyQuestion(input.message)` (synchronous, local) in a `try { startSpan("runtime_classify") ... } finally { recordSpan?.(span.end()) }` block so the `SpanRecord` is pushed to the caller's accumulator **before any error propagates**. Repeat the same `try/finally` pattern around the DB / entity-resolution block with `startSpan("resolve_db")`. The two spans are **sequential and non-overlapping**, not concurrent. Do **not** return spans on `ChatRuntimeResult` — the result-only handoff would lose records when `buildChatRuntime` throws (the route's outer `flushTrace` still runs in its `finally`, but it would see an empty `runtimeSpans`). Sourcing the spans through a callback into the route's existing `traceRecords: SpanRecord[]` accumulator (see route.ts:141) makes the records error-safe by construction.
3. **Update `web/src/app/api/chat/route.ts`** — remove the concurrent `runtime_classify` / `resolve_db` `startSpan` calls at lines ~211–212 and the matching `endTrackedSpan` calls at ~219–220, plus the inner `try { ... } finally { ... }` block that bracketed `buildChatRuntime`. Replace them with a single `await buildChatRuntime({ message, context: body.context, recordSpan: (record) => { traceRecords.push(record); } })`. Because `buildChatRuntime` now ends each span inside its own `try/finally`, an exception inside it still pushes whatever spans completed onto `traceRecords` before propagating; the route's outer `} finally { ... await flushTrace(requestId, traceRecords); }` at ~line 871/883 then flushes them on the error path exactly as it does today for `request_intake` etc. Confirm the static-analysis test `web/scripts/tests/route-trace.test.mjs` still passes — its assertion is "at least one `startSpan("<stage>")` call appears in `route.ts`"; since both `runtime_classify` and `resolve_db` `startSpan` call sites have moved to `chatRuntime.ts`, the test must be updated in step 4 to scan both files (not relax the assertion).
4. **Update `web/scripts/tests/route-trace.test.mjs`** — change the static-analysis target from "read `route.ts`" to "read `route.ts` AND `chatRuntime.ts`, concatenate, then run the existing `startSpan("<stage>")` regex against the union". Keep all 10 stage names required. The `flushTrace(` and `} finally {` assertions stay scoped to `route.ts` only (those genuinely live there). This change is mechanical; the test file remains a static-analysis test (no live services).
5. **Add a new perf-trace span unit test** at `web/scripts/tests/perf-trace-spans.test.mjs` using the existing `node:test` + `node:assert/strict` pattern (see `web/scripts/tests/perf-trace.test.mjs` and `route-trace.test.mjs`). The test runs under the existing `npm run test:grading` (`node --test scripts/tests/*.test.mjs`); **no new test runner, no new dev-dep, no path-alias resolver, no `chatRuntime.ts` import**. It asserts the span-boundary contract via two complementary halves: static analysis of `chatRuntime.ts` source text (proves the *real* code has the pattern), and behavioral execution of the *pattern itself* using only `perfTrace.ts` (which `perf-trace.test.mjs` already demonstrates is transpilable in isolation via the `typescript` package). Both halves run without live DB or LLM services.
   - **Static-analysis half** — read `web/src/lib/chatRuntime.ts` as text (no transpile, no import). Locate `startSpan("runtime_classify")` and its matching `.end()`, then `startSpan("resolve_db")` and its matching `.end()`. Assert: (a) the `runtime_classify` block (between its `startSpan(` and `.end()`) contains no `await ` token, confirming `classifyQuestion` is invoked synchronously inside the span; (b) the `runtime_classify` `.end()` source position is strictly less than the `resolve_db` `startSpan(` source position, confirming the spans are sequential and non-overlapping; (c) each of the two spans appears inside a `try { ... } finally { ... recordSpan?.( ... .end()) ... }` shape (regex-match `recordSpan?.(` or `recordSpan(` within the same `finally` block); (d) the `buildChatRuntime` signature accepts a `recordSpan` parameter (regex `recordSpan\??:\s*\(record:\s*SpanRecord\)\s*=>\s*void` or equivalent in the input type). Assertions (c) and (d) lock in the error-safe pattern by source structure rather than runtime execution, which is what makes this test runnable without resolving `@/lib/queries`.
   - **Behavioral half** — re-use the `transpileAndImportPerfTrace()` helper pattern from `perf-trace.test.mjs` to load `perfTrace.ts` in isolation (it has zero path-aliased imports and zero DB/LLM deps, so plain `ts.transpileModule` + `import()` from a temp dir works as already proven). With `{ startSpan }` in hand, define a local async `simulateRuntime(recordSpan, { rejectOnDb })` that mirrors the production pattern: `try { const s = startSpan("runtime_classify"); await new Promise(r => setTimeout(r, 5)); recordSpan(s.end()); } { ... }` and similarly for `resolve_db` with an 80ms sleep, optionally throwing inside its `try` after starting the span. Run two scenarios:
     - **Happy path**: call `simulateRuntime(records.push.bind(records), { rejectOnDb: false })`. Assert the collected `records` array has length 2, `records[0].name === "runtime_classify"` with `elapsedMs < 50`, `records[1].name === "resolve_db"` with `elapsedMs >= 5 × records[0].elapsedMs`. The fixed sleep budget keeps this deterministic on CI without real DB timing.
     - **Error path**: call `simulateRuntime(records.push.bind(records), { rejectOnDb: true })` inside `assert.rejects(...)`. After the rejection, assert the collected `records` contains BOTH a `runtime_classify` entry AND a `resolve_db` entry, proving that the inner `try/finally` + `recordSpan` callback pushes each `SpanRecord` *before* the exception propagates — exactly the round-2 guarantee. This validates the *pattern*; the static-analysis half above proves `chatRuntime.ts` uses that same pattern.
   - The test does **not** assert the live benchmark numbers — those are checked separately in step 8 by inspecting the re-baseline artifact. The test does **not** import `@/lib/chatRuntime`, does **not** spawn the dev server, and does **not** require any environment variables.
6. **Capture UTC date token** at re-baseline start: `DATE=$(date -u +%Y-%m-%d)`. Use this exact value for both slice-prefixed artifact paths in step 7e–7f (`diagnostic/artifacts/perf/01-perf-trace-fix-spans_${DATE}.json` and `.md` — no `-v2` suffix).
7. **Re-baseline (mirror `01-baseline-snapshot` Steps 2–7 verbatim, with only the artifact prefix changed)**:
   - 7a. Confirm dev server is up: `curl -fsS "${OPENF1_CHAT_BASE_URL}/api/admin/perf-summary"` returns 200 JSON. Abort with `status=blocked` otherwise.
   - 7b. **Trace isolation** — from the repo root, atomically rotate any existing `web/logs/chat_query_trace.jsonl` aside before the benchmark so the perf-summary fetch sees only this run's 50 records:
     ```bash
     mkdir -p web/logs
     if [ -f web/logs/chat_query_trace.jsonl ]; then
       mv web/logs/chat_query_trace.jsonl "web/logs/chat_query_trace.jsonl.pre-fix-${DATE}"
     fi
     ```
     Leave the `.pre-fix-${DATE}` backup in place (gitignored) for inspection.
   - 7c. **Run the canonical fixed benchmark** — the full 50-question intense set, not a subset — from the repo root: `(cd web && npm run healthcheck:chat:intense)`. Inherit `OPENF1_CHAT_BASE_URL` from the parent shell (do not inline-set it). Use the unmodified `web/scripts/chat-health-check.questions.json` (50 entries) and `web/scripts/chat-health-check.rubric.intense.json` rubric. No `--questions` flag.
   - 7d. **Fetch the aggregated summary with explicit window**: `curl -fsS "${OPENF1_CHAT_BASE_URL}/api/admin/perf-summary?n=50"`. Verify `window.requested === 50` AND `window.returned === 50` before continuing — abort with `status=blocked` otherwise (document which step leaked: rotation, benchmark, or fetch).
   - 7e. Save the JSON to the exact path `diagnostic/artifacts/perf/01-perf-trace-fix-spans_${DATE}.json` (slice-prefixed, mirroring the baseline-snapshot convention; **not** a `-v2` suffix).
   - 7f. Generate a companion markdown at `diagnostic/artifacts/perf/01-perf-trace-fix-spans_${DATE}.md` with one-line overall median, per-stage p50/p95/max table sorted by p95 desc, and a Notes section that explicitly calls out the now-separated `runtime_classify` vs `resolve_db` numbers (this is the headline result of the slice).
8. **Verify the alias is gone** — inspect the new JSON: `runtime_classify.p50_ms` MUST be `< 50` (local logic), and `runtime_classify.p50_ms` and `resolve_db.p50_ms` MUST differ by at least 10× (i.e. they no longer report identical numbers). If either fails, the span fix is incomplete; do not promote — abort with `status=blocked` and document.
9. **Promote** — update `diagnostic/_state.md`'s "Latest perf baseline" block to reference `diagnostic/artifacts/perf/01-perf-trace-fix-spans_${DATE}.json` and re-list the slowest stages by p50 from the new artifact. Keep the previous baseline artifact files in place (additive).

## Changed files expected
- `web/src/lib/chatRuntime.ts` (move `runtime_classify` and `resolve_db` spans here; sequential, non-overlapping; each wrapped in its own `try/finally` that pushes the `SpanRecord` to a caller-supplied `recordSpan` callback before exceptions propagate)
- `web/src/app/api/chat/route.ts` (drop the concurrent `runtime_classify` / `resolve_db` spans and their wrapping `try/finally`; pass `recordSpan: (record) => { traceRecords.push(record); }` to `buildChatRuntime` so error-path spans still reach the existing outer `flushTrace`)
- `web/scripts/tests/route-trace.test.mjs` (broaden the static-analysis target to `route.ts ∪ chatRuntime.ts`; keep all 10 stages required)
- `web/scripts/tests/perf-trace-spans.test.mjs` (new — static-analysis + behavioral test, no live services)
- `diagnostic/artifacts/perf/01-perf-trace-fix-spans_${DATE}.json` (new re-baseline JSON; exact `${DATE}` from step 6)
- `diagnostic/artifacts/perf/01-perf-trace-fix-spans_${DATE}.md` (new companion markdown; exact `${DATE}` from step 6)
- `diagnostic/_state.md` ("Latest perf baseline" headline updated in step 9)
- `diagnostic/slices/01-perf-trace-fix-spans.md` (slice-completion note + audit verdict; always implicitly allowed)

## Artifact paths
- `diagnostic/artifacts/perf/01-perf-trace-fix-spans_${DATE}.json` — machine-readable per-stage summary, slice-prefixed (matches the convention established by `01-baseline-snapshot_${DATE}.json`).
- `diagnostic/artifacts/perf/01-perf-trace-fix-spans_${DATE}.md` — human-readable companion, same `${DATE}`. The `.md` companion is required (not optional): `01-baseline-snapshot` produces both, and downstream slices that read perf artifacts (Phase 2/3) inspect the `.md` Notes section for caveats.

## Gate commands
```bash
# Run all gates from the repo root. Each `web/` command uses a subshell
# `(cd web && ...)` so the cwd is restored to the repo root afterward —
# avoid bare `cd web && ...` chained across lines, which leaves you in
# `web/` and turns the next `cd web` into `web/web` (and the artifact
# `test -f` checks below into `web/diagnostic/...`).

# DATE must match the UTC date token captured in step 6, used verbatim in
# both slice-prefixed artifact paths (`01-perf-trace-fix-spans_${DATE}.{json,md}`).
# Fail loudly if the implementer forgot to export it.
: "${DATE:?must export DATE=<UTC-date> matching the artifacts written in steps 7e–7f}"
: "${OPENF1_CHAT_BASE_URL:?must export OPENF1_CHAT_BASE_URL=http://127.0.0.1:<PORT> matching the running dev server}"

# Verify the dev server is up (slice-blocking precondition for the re-baseline)
curl -fsS "${OPENF1_CHAT_BASE_URL}/api/admin/perf-summary" >/dev/null

(cd web && npm run build)
(cd web && npm run typecheck)
(cd web && npm run test:grading)

# Verify both new artifact files exist at the EXACT slice-prefixed paths
# (no wildcards — wildcards can match stale `01-baseline-snapshot_*` files
# from prior slices). These run from the repo root because the subshells
# above did not change the parent shell's cwd.
test -f "diagnostic/artifacts/perf/01-perf-trace-fix-spans_${DATE}.json"
test -f "diagnostic/artifacts/perf/01-perf-trace-fix-spans_${DATE}.md"

# Verify the new artifact's window matches the 50-question benchmark — direct
# evidence that the trace-isolation rotation worked and the summary was not
# contaminated by stale perfTrace records. Uses node so this is portable
# without jq.
node -e '
  const j = require("./diagnostic/artifacts/perf/01-perf-trace-fix-spans_'"${DATE}"'.json");
  if (j.window?.returned !== 50 || j.window?.requested !== 50) {
    console.error("window mismatch:", JSON.stringify(j.window));
    process.exit(1);
  }
'

# Verify the alias is gone — the headline result of the slice. Both checks
# read the new artifact directly so the gate fails loudly if the span split
# did not actually reduce `runtime_classify.p50_ms` and de-alias it from
# `resolve_db.p50_ms`.
node -e '
  const j = require("./diagnostic/artifacts/perf/01-perf-trace-fix-spans_'"${DATE}"'.json");
  const rc = j.stages?.runtime_classify?.p50_ms;
  const rd = j.stages?.resolve_db?.p50_ms;
  if (typeof rc !== "number" || typeof rd !== "number") {
    console.error("missing stages:", JSON.stringify({ rc, rd }));
    process.exit(1);
  }
  if (rc >= 50) {
    console.error("runtime_classify.p50_ms >= 50:", rc);
    process.exit(1);
  }
  if (rd / Math.max(rc, 0.001) < 10) {
    console.error("runtime_classify and resolve_db p50 differ by < 10x:", { rc, rd });
    process.exit(1);
  }
'

# Verify _state.md was updated to point at the new artifact (step 9).
grep -F "diagnostic/artifacts/perf/01-perf-trace-fix-spans_${DATE}.json" diagnostic/_state.md >/dev/null
```

## Acceptance criteria
- [ ] `runtime_classify` and `resolve_db` spans live in `web/src/lib/chatRuntime.ts` and are sequential / non-overlapping (verified by the static-analysis half of `web/scripts/tests/perf-trace-spans.test.mjs`).
- [ ] Each span inside `chatRuntime.ts` is wrapped in its own `try { ... } finally { recordSpan?.(span.end()) }` block so completed `SpanRecord`s reach the route's `traceRecords` accumulator before any thrown exception propagates; verified by the error-path assertion in `web/scripts/tests/perf-trace-spans.test.mjs`.
- [ ] `web/src/app/api/chat/route.ts` no longer holds standalone `startSpan("runtime_classify")` / `startSpan("resolve_db")` calls; instead it passes a `recordSpan` callback into `buildChatRuntime` that pushes each record onto the existing `traceRecords` array, so the route's outer `} finally { ... await flushTrace(requestId, traceRecords); }` flushes runtime-stage spans on both success and error paths.
- [ ] The behavioral half of `web/scripts/tests/perf-trace-spans.test.mjs` (deterministic `setTimeout`-based, no live services) asserts `runtime_classify.elapsedMs < 50` and `resolve_db.elapsedMs >= 5 × runtime_classify.elapsedMs`. The test passes under `npm run test:grading`.
- [ ] `web/scripts/tests/route-trace.test.mjs` still passes after broadening its static-analysis target to `route.ts ∪ chatRuntime.ts`; all 10 stage `startSpan` call sites are present in the union.
- [ ] Both re-baseline artifact files exist at the exact slice-prefixed paths `diagnostic/artifacts/perf/01-perf-trace-fix-spans_${DATE}.{json,md}` where `${DATE}` is the UTC date captured in step 6.
- [ ] The new JSON's `window.requested === 50` AND `window.returned === 50` — direct evidence the perf-summary fetch was isolated to this run's 50 perfTrace records.
- [ ] The new JSON's `stages.runtime_classify.p50_ms < 50` (local logic now actually measured locally).
- [ ] The new JSON's `stages.runtime_classify.p50_ms` and `stages.resolve_db.p50_ms` differ by at least 10× (the alias is gone).
- [ ] Companion markdown contains a per-stage p50/p95/max table and a Notes section that explicitly contrasts the new (separated) `runtime_classify` vs `resolve_db` numbers against the prior baseline's aliased numbers.
- [ ] `diagnostic/_state.md` "Latest perf baseline" block points at `diagnostic/artifacts/perf/01-perf-trace-fix-spans_${DATE}.json` and lists the slowest stages by p50 from that file.
- [ ] Slice-completion note records `${DATE}` and quotes the new `runtime_classify` p50, `resolve_db` p50, and overall `total` p50/p95.
- [ ] All gate commands exit `0`.

## Out of scope
- Reducing `resolve_db` latency (Phase 2/3 caching/materialization work).
- Changing what `classifyQuestion` or the entity-resolution body actually do — only the timing boundary.
- Splitting `buildChatRuntime` into separate exported functions (the span split is internal; the public signature only grows by the new optional `recordSpan?: (record: SpanRecord) => void` parameter — `ChatRuntimeResult` is **not** extended with a `runtimeSpans` field, since the round-2 design routes spans through the callback, not the result).
- Phase 2 prompt-caching work.

## Risk / rollback
- **Rollback**: `git revert <commit>`. The previous baseline artifact (`01-baseline-snapshot_2026-04-26.{json,md}`) is preserved untouched; the new `01-perf-trace-fix-spans_${DATE}.{json,md}` artifacts are additive. Reverting also restores the previous `_state.md` "Latest perf baseline" headline (it was edited in this slice's commit).
- **Risk**: if the span split inside `buildChatRuntime` accidentally double-counts (e.g. starts `resolve_db` while `runtime_classify` is still open), the alias would persist and the gate `node -e` checks above would fail — caught before commit.
- **Risk (error-path span loss)**: a result-only handoff (`runtime.runtimeSpans`) would silently drop runtime-stage records whenever `buildChatRuntime` threw, since the rejected promise has no usable result. The plan therefore uses an inner `try/finally` + caller-supplied `recordSpan` callback that writes into the route's existing `traceRecords` accumulator, so the outer `flushTrace` (which already runs in the route's top-level `finally`) sees every span that managed to end before the throw. The error-path assertion in `perf-trace-spans.test.mjs` locks this in.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace the repeated `cd web && ...` gate block with commands that preserve the intended working directory, such as repo-root subshells `(cd web && npm run build)`, `(cd web && npm run typecheck)`, and `(cd web && npm run test:grading)`.
- [x] Specify the exact re-baseline command, benchmark size, trace-isolation procedure, required `OPENF1_CHAT_BASE_URL`, and window validation so the v2 baseline is reproducible and cannot pass using stale perfTrace records.

### Medium
- [x] Add `diagnostic/_state.md` to "Changed files expected" because step 6 and the acceptance criteria require updating the "Latest perf baseline" headline.
- [x] Tighten `Required services / env` to include every service and secret needed for the re-baseline run, including the running dev server URL and LLM/database environment variables required by the benchmark path.
- [x] Decide whether the v2 baseline should follow the existing perf artifact convention by producing both `.json` and `.md`; if not, state explicitly why this repair slice only promotes the JSON artifact.
- [x] Make the new perf-trace span test acceptance testable without live DB timing assumptions, or document the exact service dependency and deterministic assertions it will use when `resolve_db` reflects actual DB time.

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T15:24:13Z`, which is less than 24 hours old at audit time.
- Prior context was read; the previous baseline slice's gate block documents the same repo-root subshell pattern needed here, and its benchmark steps show the trace-isolation/window checks this plan should reuse for the v2 baseline.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Preserve runtime span records when `buildChatRuntime` throws: replace the result-only `runtimeSpans` handoff with an error-safe mechanism, such as passing the request's `SpanRecord[]` accumulator into `buildChatRuntime` or otherwise guaranteeing ended `runtime_classify` / `resolve_db` records are appended before the route's existing error-path `flushTrace`.

### Medium

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T15:24:13Z`, which is less than 24 hours old at audit time.
- Prior context was read; the prior route-stage-timings slice requires the route to flush trace records on generic error paths, so this split must not make `buildChatRuntime` failures lose the runtime-stage records.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Specify an executable strategy for `web/scripts/tests/perf-trace-spans.test.mjs` to load `web/src/lib/chatRuntime.ts` under the existing plain `node --test` runner, including how it will transpile TypeScript and resolve or stub path-alias/database dependencies without requiring live DB or LLM services.

### Medium
- [x] Fix the `Out of scope` contradiction that says the public signature grows by a new `runtimeSpans` field; this plan now requires a `recordSpan` callback and explicitly forbids returning spans on `ChatRuntimeResult`.

### Low
- [x] Rename the gate-command comments that still refer to "v2 artifact paths" so they match the exact non-v2 artifact paths required by Steps 7e-7f.

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T15:24:13Z`, which is less than 24 hours old at audit time.
- Prior context was read; the previous round's error-safe span handoff is addressed by the `recordSpan` callback design, but the proposed direct `@/lib/chatRuntime` test import is not yet runnable as specified under the current test harness.

## Plan-audit verdict (round 4)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T15:24:13Z`, which is less than 24 hours old at audit time.
- Prior context was read; the round 3 test-harness issue is addressed by combining source-text assertions for `chatRuntime.ts` with isolated `perfTrace.ts` behavioral execution, avoiding live DB/LLM dependencies and path-alias imports.
