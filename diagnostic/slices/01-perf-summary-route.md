---
slice_id: 01-perf-summary-route
phase: 1
status: revising
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26T10:18:14-04:00
---

## Goal
Add a local/dev-only API route that aggregates the most recent perfTrace records from the same JSONL file the existing writer (`web/src/lib/perfTrace.ts`) appends to — i.e. `<base>/chat_query_trace.jsonl` where `<base>` is `process.env.OPENF1_WEB_LOG_DIR ?? path.join(process.cwd(), "logs")` (matching `getTraceFilePath` in `perfTrace.ts` and `serverLog.ts`; resolves to `web/logs/...` when the Next app and gates run from `web/`) — and returns a p50 / p95 summary per stage. Used to inspect the loop's perf state without grepping JSONL by hand. The window size defaults to the 200 most recent perfTrace records (records carrying a top-level `spans` array — see step 5 below) and is overridable with an `?n=<int>` query parameter. Accepted range: integers in `[1, 1000]` are honored as-is; any other value (non-numeric, NaN, non-integer, `<= 0`, `> 1000`) falls back to the default of 200 — there is no clamping (e.g. `?n=5000` returns 200, not 1000). All non-trivial behavior (parsing, filtering, percentile math, the production gate) lives in a plain JS helper `web/src/lib/perfSummary.mjs` so the existing `node --test scripts/tests/*.test.mjs` gate can exercise it without a TypeScript loader; the `route.ts` file is a thin shim around the helper. Sanitization of `n` is the sole responsibility of `parseN`; `aggregatePerfTraces` trusts its caller and assumes `n` is already a positive integer.

## Inputs
- `<base>/chat_query_trace.jsonl` where `<base>` = `process.env.OPENF1_WEB_LOG_DIR ?? path.join(process.cwd(), "logs")` (resolves to `web/logs/chat_query_trace.jsonl` in dev when running from `web/`; this is the dev sink populated by `01-route-stage-timings` via `web/src/lib/perfTrace.ts`'s `getTraceFilePath`).
- [roadmap §4 Phase 1 step 3](../roadmap_2026-04_performance_and_upgrade.md)

## Prior context

Read these before triaging or implementing:

- `diagnostic/_state.md` — current phase counts, recent merges, accumulated auditor notes.
- `diagnostic/slices/01-route-stage-timings.md` — defines the JSONL trace shape this route reads. The aggregator must parse the same fields the writer emits.

## Required services / env
None at author time.

## Steps
1. Create plain JS helper module `web/src/lib/perfSummary.mjs` (extension `.mjs` so the existing `node --test scripts/tests/*.test.mjs` gate can import it directly without a TypeScript compile step). Because `web/tsconfig.json` sets `allowJs: false`, also create a sibling ambient declaration file `web/src/lib/perfSummary.d.mts` so a strict TypeScript file (`route.ts`) can import the helper and `npm run typecheck` resolves the exports' types. With `moduleResolution: bundler` (already set in `web/tsconfig.json`), TypeScript pairs `import ... from './perfSummary.mjs'` with the sibling `perfSummary.d.mts` automatically — no `tsconfig.json` change is needed and `allowJs` stays `false`. The `.d.mts` declares (using TypeScript syntax):
   - `export type PerfSpan = { name: string; elapsedMs: number };`
   - `export type PerfTraceRecord = { spans: PerfSpan[] };`
   - `export type StageStats = { count: number; p50_ms: number; p95_ms: number; max_ms: number };`
   - `export type PerfSummary = { window: { requested: number; returned: number }; stages: Record<string, StageStats> };`
   - `export function aggregatePerfTraces(records: PerfTraceRecord[], n: number): PerfSummary;`
   - `export function parseN(rawValue: unknown): number;`
   - `export function handlePerfSummaryRequest(args: { env: string | undefined; traceFilePath: string; n: number; readFile: (path: string, encoding: 'utf8') => Promise<string> }): Promise<{ status: 200; body: PerfSummary } | { status: 404; body: string }>;`

   The `.mjs` exports:
   - `aggregatePerfTraces(records, n)` — pure function. `records` is an array of already-parsed perfTrace entries (each `{ spans: [...] }`); `n` is the window size. **Trusts its caller**: assumes `n` is a positive integer; does no clamping or sanitization itself (that responsibility lives entirely in `parseN`). Takes the last `n` records, groups by `spans[].name`, computes `count`, `p50_ms`, `p95_ms`, `max_ms` (numbers, milliseconds, rounded to 2 decimals), and returns `{ window: { requested: <n>, returned: <records.length capped at n> }, stages: { [name]: { count, p50_ms, p95_ms, max_ms } } }`. Stages not present are omitted (no zero-count entries). **Percentile algorithm** (nearest-rank, ceiling): for a stage with collected `elapsedMs` values sorted ascending as `vals`, `p50_ms = vals[Math.ceil(vals.length * 0.50) - 1]` and `p95_ms = vals[Math.ceil(vals.length * 0.95) - 1]`; both rounded to 2 decimal places via `Math.round(x * 100) / 100`. A stage with exactly one value has `p50_ms === p95_ms === max_ms === that value` (rounded).
   - `parseN(rawValue)` — **sole sanitizer** for the window size. Parses a query-string `n` value: returns the integer if it parses to a finite integer in the accepted range `[1, 1000]`; otherwise returns `200`. **No clamping** — out-of-range values (e.g. `'5000'`, `'-5'`, `'0'`) fall back to `200`, they are not pinned to `1000` or `1`. Every code path that supplies `n` to `aggregatePerfTraces` (the route's GET handler, tests) routes through `parseN` first.
   - `handlePerfSummaryRequest({ env, traceFilePath, n, readFile })` — orchestrator with **dependency-injected** `readFile` (the route passes `fs.promises.readFile`; tests pass a stub that records call counts so the production no-IO check is observable). Behavior:
     - If `env === 'production'`, return `{ status: 404, body: 'Not Found' }` **before calling `readFile`** (the test asserts `readFile` was never invoked in this branch — see Acceptance criteria).
     - Else, call `readFile(traceFilePath, 'utf8')`. On rejection with `code === 'ENOENT'`, return `{ status: 200, body: { window: { requested: n, returned: 0 }, stages: {} } }`. Other rejections also return that empty 200 shape (the route never 5xxs for IO/parse failures).
     - Split content on `\n`, drop empty lines, parse each line with `JSON.parse` inside a `try/catch` (silently skip malformed lines — see step 5). Filter to entries where `Array.isArray(entry.spans)` is true. Call `aggregatePerfTraces(filtered, n)` and return `{ status: 200, body: <result> }`.
2. Create `web/src/app/api/admin/perf-summary/route.ts` as a thin Next.js wrapper. It imports `aggregatePerfTraces`, `parseN`, and `handlePerfSummaryRequest` from `'@/lib/perfSummary.mjs'`; under strict `allowJs: false`, the sibling `perfSummary.d.mts` (step 1) supplies the types so `npm run typecheck` resolves the imports without errors. Its `GET` handler:
   - Reads `?n=` from the request URL and passes the raw value through `parseN` (imported from the helper).
   - Resolves the default trace file path the same way the writer (`web/src/lib/perfTrace.ts::getTraceFilePath`) does: `const baseDir = process.env.OPENF1_WEB_LOG_DIR ?? path.join(process.cwd(), 'logs'); const traceFilePath = path.join(baseDir, 'chat_query_trace.jsonl');` — no separate env var, so flipping `OPENF1_WEB_LOG_DIR` redirects the writer and the reader together.
   - Calls `handlePerfSummaryRequest({ env: process.env.NODE_ENV, traceFilePath, n, readFile: fs.promises.readFile })`.
   - Wraps the returned `{ status, body }` in a `Response` (`Response.json(body, { status })` for status 200; `new Response('Not Found', { status: 404 })` for status 404). Contains no aggregation, parsing, or filtering logic of its own — all behavior the gate test must exercise lives in the helper.
3. Window-size policy lives in `parseN`: defaults to 200, accepts `?n=<int>` only when it parses to a finite integer in `[1, 1000]` (returned verbatim); every other value — non-numeric, NaN, non-integer (`'1.5'`), `<= 0`, or `> 1000` — falls back to 200. This is fallback, not clamp: `?n=5000` returns 200, not 1000; `?n=-5` returns 200, not 1.
4. Mark this route as **local/dev only**: in production it must not run, since trace data lives elsewhere (a future production sink, see roadmap §6 / Phase 12). The production gate is the very first statement of `handlePerfSummaryRequest` (step 1) and runs before the injected `readFile` is called; the test verifies non-invocation of the `readFile` stub.
5. Coexistence with `appendQueryTrace` + malformed-line resilience (handled inside `handlePerfSummaryRequest`):
   - Lines that fail `JSON.parse` are silently skipped (no throw, no log).
   - Parsed entries where `Array.isArray(entry.spans)` is false are silently skipped (the `appendQueryTrace` rows from `01-route-stage-timings` coexist in the same JSONL but do not carry a top-level `spans` array).
   - Span entries within an otherwise-valid perfTrace record that are not `{ name: string, elapsedMs: number }` — including `NaN`, non-finite, or negative `elapsedMs` — are skipped individually; the rest of the record's spans still aggregate.
   - The helper always returns `status: 200` or `status: 404`; it never throws or returns 5xx for parse / shape / IO failures.

## Changed files expected
- `web/src/lib/perfSummary.mjs` — new plain JS helper (~120 LOC) holding all parsing, filtering, percentile, and prod-gate logic. Plain JS (not TypeScript) so the `.mjs` gate test can `import` it directly without a build step.
- `web/src/lib/perfSummary.d.mts` — new sibling ambient TS declaration (~20 LOC) declaring the helper's exports (`aggregatePerfTraces`, `parseN`, `handlePerfSummaryRequest`, plus the `PerfSpan` / `PerfTraceRecord` / `StageStats` / `PerfSummary` types). Required because `web/tsconfig.json` sets `allowJs: false`; with `moduleResolution: bundler` TypeScript pairs the `.mjs` import in `route.ts` with this declaration automatically. No `tsconfig.json` edit is required.
- `web/src/app/api/admin/perf-summary/route.ts` — thin Next.js shim (~30 LOC) that resolves the trace file path via `process.env.OPENF1_WEB_LOG_DIR ?? path.join(process.cwd(), 'logs')` joined with `chat_query_trace.jsonl` (matching `web/src/lib/perfTrace.ts::getTraceFilePath`) and wires `process.env.NODE_ENV`, the request URL, and `fs.promises.readFile` into `handlePerfSummaryRequest`. Imports from `'@/lib/perfSummary.mjs'`; types resolve via the sibling `perfSummary.d.mts`.
- `web/scripts/tests/perf-summary-route.test.mjs` — new (~120 LOC) gate test. Picked up by the existing `node --test scripts/tests/*.test.mjs` glob in `npm run test:grading`, so no `package.json` change is needed. The test does NOT import `route.ts` (TypeScript cannot be loaded under the plain `node --test` runner without an extra loader) — it imports the plain JS helper `web/src/lib/perfSummary.mjs` directly and exercises `aggregatePerfTraces`, `parseN`, and `handlePerfSummaryRequest`. Coverage:
  - Writes a fixture JSONL in `os.tmpdir()` containing an `appendQueryTrace`-shaped entry (no top-level `spans`), a perfTrace entry (with `spans`), and one malformed line; passes the path to `handlePerfSummaryRequest` along with a stub `readFile` that wraps the real `fs.promises.readFile` and records call counts. Asserts dev-mode response shape, that only the perfTrace entry contributes to `stages`, and that the malformed line is silently skipped.
  - Calls `handlePerfSummaryRequest({ env: 'production', traceFilePath: <fixture path>, n: 200, readFile: stub })` with the same fixture and asserts `status === 404` AND `stub.callCount === 0` — this is the observable proof the production branch performed no file I/O (replaces the previous "404 with a missing path" check, which only proved an absent file, not absent IO).
  - Calls `aggregatePerfTraces` directly with hand-built record arrays to verify percentile math, rounding to 2 decimals, omission of absent stages, and that `window.returned` equals `min(records.length, n)` when called with valid positive integers (no n-sanitization tests here — those live under `parseN`).
  - Calls `parseN` directly to verify the accepted-range / 200-fallback policy (no clamping). Cases: returns 200 for `null`, `undefined`, `''`, `'abc'`, `NaN`, `'-5'`, `'0'`, `'5000'`, `'1.5'` (note `'5000'` falls back to 200, it is *not* clamped to 1000); returns the integer for `'1'`, `'500'`, `'1000'`. This is the **only** place invalid-`n` handling is tested.
- `diagnostic/slices/01-perf-summary-route.md` (slice-completion note + audit verdict; always implicitly allowed)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Helper module exists at `web/src/lib/perfSummary.mjs` exporting `aggregatePerfTraces`, `parseN`, and `handlePerfSummaryRequest`.
- [ ] Sibling ambient declaration exists at `web/src/lib/perfSummary.d.mts` declaring the three exports plus the `PerfSpan` / `PerfTraceRecord` / `StageStats` / `PerfSummary` types, so that `route.ts` can import the helper under `allowJs: false` without `noImplicitAny` or "module has no declarations" errors.
- [ ] Route exists at `web/src/app/api/admin/perf-summary/route.ts`, imports `aggregatePerfTraces`, `parseN`, and `handlePerfSummaryRequest` from `'@/lib/perfSummary.mjs'`, and `npm run typecheck` resolves the imports via `perfSummary.d.mts` without modifying `web/tsconfig.json` (in particular, `allowJs` stays `false`).
- [ ] `web/scripts/tests/perf-summary-route.test.mjs` exists, is executed by `npm run test:grading` (via the existing `node --test scripts/tests/*.test.mjs` glob without any TS loader), imports `web/src/lib/perfSummary.mjs` directly, and asserts:
  - `handlePerfSummaryRequest` invoked with `env: 'development'` and a fixture JSONL containing both an `appendQueryTrace`-shaped entry (no `spans`), a perfTrace entry (with `spans`), and one malformed line returns `{ status: 200, body: { window: { requested: number, returned: number }, stages: { [stageName]: { count: number, p50_ms: number, p95_ms: number, max_ms: number } } } }`; only the perfTrace entry's spans contribute to `stages`; the malformed line is silently skipped.
  - `handlePerfSummaryRequest` invoked with `env: 'production'`, the same fixture path, and a `readFile` stub that records call counts returns `{ status: 404 }` AND the stub's call count is `0` — directly observable proof the production branch performed no file I/O.
  - `handlePerfSummaryRequest` invoked with a `traceFilePath` that does not exist (in dev mode) returns `{ status: 200, body: { window: { requested, returned: 0 }, stages: {} } }`.
  - `aggregatePerfTraces` with hand-built records produces correct `p50_ms`, `p95_ms`, `max_ms` values using the nearest-rank ceiling algorithm (`vals[Math.ceil(vals.length * P) - 1]`, sorted ascending, rounded to 2 decimals via `Math.round(x * 100) / 100`) and omits stages not present in the window.
  - `parseN` returns 200 for `null`, `undefined`, `''`, `'abc'`, `NaN`, `'-5'`, `'0'`, `'5000'`, and `'1.5'`; returns the integer for `'1'`, `'500'`, `'1000'`. (This is the only invalid-`n` coverage; `aggregatePerfTraces` is not tested with invalid `n`.)
  - The route's default `traceFilePath` resolution matches `web/src/lib/perfTrace.ts::getTraceFilePath` (same env var `OPENF1_WEB_LOG_DIR`, same `chat_query_trace.jsonl` filename) — verified by code review during implementation, since the path resolution itself is in `route.ts` and not directly exercised by the helper tests.
- [ ] All gates exit 0.

## Out of scope
- A real production perf sink (deferred to Phase 6 or 12).
- Authentication on the dev route (it's gated by NODE_ENV; that's enough for now).

## Risk / rollback
Rollback: `git revert <commit>`. Route is local-dev only; no persistent state at risk.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

**[protocol-repair]** Plan-revise loop escalated (4 iterations) with one open Medium: undefined percentile algorithm. Repair: added nearest-rank ceiling definition (`vals[Math.ceil(vals.length * P) - 1]`, sorted ascending, rounded `Math.round(x*100)/100`) to Steps §1 `aggregatePerfTraces` and to the `aggregatePerfTraces` acceptance criterion. Status flipped to revising so implementer can retry.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Specify that the aggregator must ignore non-perfTrace JSONL entries and only summarize records where `Array.isArray(entry.spans)`, because the referenced timing slice says `appendQueryTrace` entries coexist in the same file.
- [x] Add an executable verification path for the dev JSON shape and production 404 behavior, or rewrite those acceptance criteria so they are checked by the listed gates.

### Medium
- [x] Define the request parameter or fixed policy for "most recent N" trace lines, since step 1 hard-codes the last 200 lines while the goal says the route aggregates the most recent N.
- [x] State how malformed JSONL lines or malformed perfTrace records should be handled so one bad log line does not make the dev summary route fail unexpectedly.

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T13:47:29Z`, which is less than 24 hours old at audit time.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Replace the direct `.mjs` import of `web/src/app/api/admin/perf-summary/route.ts` with an executable test strategy that works under the listed `node --test scripts/tests/*.test.mjs` gate, such as importing the built route artifact after `npm run build` or testing a plain JS helper exported from an importable module.
- [x] Make the production "no file I/O" acceptance check actually observable, because asserting 404 with a missing path does not prove the handler returned before attempting to read the trace file.

### Medium

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T13:47:29Z`, which is less than 24 hours old at audit time.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Align the route's default trace path with the existing writers in `web/src/lib/perfTrace.ts` and `web/src/lib/serverLog.ts`: read from `process.env.OPENF1_WEB_LOG_DIR ?? path.join(process.cwd(), "logs")` plus `chat_query_trace.jsonl`, or otherwise explicitly document and test why `path.join(process.cwd(), "web/logs/chat_query_trace.jsonl")` is correct when gates and the Next app run from `web/`.

### Medium
- [x] Resolve the `n`-policy ambiguity by stating whether `aggregatePerfTraces(records, n)` must sanitize invalid/out-of-range `n` values itself, or remove the direct aggregate "n-clamp" test coverage and leave all invalid query handling to `parseN`.

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T13:47:29Z`, which is less than 24 hours old at audit time.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [x] Add an explicit TypeScript typing strategy for `route.ts` importing `web/src/lib/perfSummary.mjs` under the current strict `allowJs: false` `web/tsconfig.json`, and include any required declaration file in Changed files expected and acceptance criteria so `npm run typecheck` can pass.

### Medium
- [x] Replace the remaining "clamped to `[1, 1000]`" wording for `?n=` with unambiguous accepted-range/fallback wording, because the plan also requires out-of-range values such as `5000` to return the default `200` rather than clamp to `1000`.

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T13:47:29Z`, which is less than 24 hours old at audit time.

## Plan-audit verdict (round 5)

**Status: REVISE**

### High

### Medium
- [ ] Define the exact percentile algorithm for `p50_ms` and `p95_ms` (for example nearest-rank vs interpolated, including index/rounding rules) so the implementation and "correct percentile math" test have a deterministic target.

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T13:47:29Z`, which is less than 24 hours old at audit time.

## Plan-revise escalation

Hit `LOOP_MAX_PLAN_ITERATIONS=4` without converging on APPROVED. Latest audit verdict still has open items. User intervention required.
