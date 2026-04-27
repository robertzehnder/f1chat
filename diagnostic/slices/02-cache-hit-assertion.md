---
slice_id: 02-cache-hit-assertion
phase: 2
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T01:02:00-04:00
---

## Goal
Run a real synthesis pair (cold + warm) against the Anthropic Messages API and verify that the warm call records `usage.cache_read_input_tokens > 0`. Capture cold and warm `usage` rows so the per-call token-cost delta is visible in the artifact.

## Inputs
- `web/src/lib/anthropic.ts` — exports `buildSynthesisRequestParams(input)` (added by slice `02-cache-control-markers`, merge `bd29178`). Returns the exact `{ system, messages }` shape sent to `https://api.anthropic.com/v1/messages` with `cache_control: { type: "ephemeral" }` on the system block. The benchmark imports this builder via the same TS-transpile pattern used by `web/scripts/tests/cache-control-markers.test.mjs` so both calls reuse the production prefix byte-for-byte.
- `web/scripts/tests/cache-control-markers.test.mjs` — reference for the TS-transpile-and-import pattern used by the new benchmark test.
- Anthropic Messages API: `POST https://api.anthropic.com/v1/messages`, header `anthropic-version: 2023-06-01`. Response JSON contains `usage: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }`. Repo uses direct `fetch` (no `@anthropic-ai/sdk` dependency).
- Anthropic prompt-cache minimum cacheable length (per Anthropic docs, `anthropic-version: 2023-06-01`): **1024 input tokens for Claude Sonnet 4 family** (covers `claude-sonnet-4-6`, the production default), **2048 input tokens for Claude Haiku 4 family**. A `system` content block with `cache_control: { type: "ephemeral" }` whose total cached content is below this minimum will be sent through but **not** cached, so the warm call's `cache_read_input_tokens` will be `0`. The current production `buildAnswerSynthesisPrompt()` static prefix (`web/src/lib/anthropic.ts` lines ~98–116) is roughly ~200 tokens — well below the Sonnet minimum — so the benchmark cannot rely on it alone to produce a cache hit. Future Phase 2 slices will expand the production prefix (schema overview, semantic-contract list, table allowlist, few-shot examples per `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §Phase 2); this slice's benchmark must work *before* those land.
- Anthropic Token-Count API: `POST https://api.anthropic.com/v1/messages/count_tokens`, same headers as Messages, request body `{ model, system, messages }`, response `{ input_tokens: N }`. Free (no model billing). Used by the benchmark to verify the cached `system` content meets the model minimum before issuing the two paid Messages calls.

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/02-cache-control-markers.md`
- `diagnostic/slices/02-prompt-static-prefix-split.md`

## Required services / env
Live benchmark requires:
- `ANTHROPIC_API_KEY` — used by the benchmark's direct `fetch` call to Anthropic.
- `OPENF1_RUN_CACHE_BENCHMARK=1` — gate flag. When unset, the test calls `t.skip(...)` and exits 0 so `npm run test:grading` stays offline by default.
- `ANTHROPIC_MODEL` (optional) — overrides the model id sent to both the count_tokens preflight and the two Messages calls. **Default: `claude-sonnet-4-6`** (matches the production default in `web/src/lib/anthropic.ts`). Any override value MUST already exist as a key in the test's hard-coded `MIN_CACHE_TOKENS_BY_MODEL` map; if not, the test fails with a clear "add prompt-cache minimum for <model> to MIN_CACHE_TOKENS_BY_MODEL" message rather than silently proceeding.
- `OPENF1_CACHE_BENCHMARK_OUT` (optional) — overrides the default artifact path if set.

No `DATABASE_URL` is required (the test does not run SQL or call into chatRuntime).

## Steps
1. Add `web/scripts/tests/cache-benchmark.test.mjs`. Top of test:
   - If `process.env.OPENF1_RUN_CACHE_BENCHMARK !== "1"`, call `t.skip("OPENF1_RUN_CACHE_BENCHMARK not set")` and return.
   - Else require `process.env.ANTHROPIC_API_KEY`; if missing, fail the test with a clear message (so misconfiguration does not silently pass).
2. Transpile-and-import `buildSynthesisRequestParams` from `web/src/lib/anthropic.ts` using the same pattern as `cache-control-markers.test.mjs` (read source, `ts.transpileModule`, write to tmp `.mjs`, dynamic import).
3. Construct one `AnswerSynthesisInput` (e.g. `question: "Who won the 2024 Monaco Grand Prix?"`, a small synthetic `rows` array, `rowCount: 1`, a minimal `runtime`). Call `buildSynthesisRequestParams(input)` once to obtain `{ system: productionSystem, messages }`. The cached content for both calls will be derived from `productionSystem` plus deterministic synthetic padding (next step) so the cached portion is byte-identical between cold and warm.
3a. Guarantee the cached `system` content meets the Anthropic prompt-cache minimum:
    - Define `MIN_CACHE_TOKENS_BY_MODEL` as a hard-coded map in the test (e.g. `{ "claude-sonnet-4-6": 1024, "claude-opus-4-7": 1024, "claude-haiku-4-5-20251001": 2048 }`). The selected `model` is read from `process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6"`. If the model is not in the map, fail the test with a clear message ("add prompt-cache minimum for <model> to MIN_CACHE_TOKENS_BY_MODEL"); do not silently proceed.
    - Build `paddedSystem` as a two-element content array in this exact send-order:
      1. **Index 0 — synthetic padding block:** `{ type: "text", text: PADDING_TEXT, cache_control: { type: "ephemeral" } }`.
      2. **Index 1 — production prefix block:** `productionSystem[0]` (unchanged), which already carries `cache_control: { type: "ephemeral" }` from `buildSynthesisRequestParams`.
      The synthetic padding block MUST be first. Anthropic considers the longest contiguous prefix of cache-marked blocks when matching a cache entry, so placing the synthetic block at index 0 guarantees a cache hit on the warm call even if the production prefix is by itself below the model minimum. The artifact's `cached_blocks` array MUST mirror this same send-order (padding first, then production_prefix).
    - `PADDING_TEXT` is a fixed multi-paragraph string compiled into the test (a literal constant — committed to git, not generated at run time, not read from disk). It must be deterministically byte-identical across runs and large enough that on its own it exceeds the *largest* model minimum in the map (≥ 2048 tokens). A safe construction: a fixed lorem-ipsum-style narrative of repeated, deterministic English text targeting ~12 KB on disk (~3000 tokens by the conservative `bytes / 4 ≈ tokens` proxy). The literal must NOT include UUIDs, timestamps, or any other run-varying tokens.
    - Call `POST https://api.anthropic.com/v1/messages/count_tokens` once with `{ model, system: paddedSystem, messages }` and the same headers as step 4. Read `response.input_tokens` and assert that the *cached portion* (everything in `paddedSystem`) is at least `MIN_CACHE_TOKENS_BY_MODEL[model]`. To approximate the cached-portion token count, issue a second count_tokens call with `{ model, system: paddedSystem, messages: [{ role: "user", content: "" }] }` and use that response's `input_tokens` as `cachedSystemTokens` (with the empty message removed, the count is dominated by `system`). If `cachedSystemTokens < MIN_CACHE_TOKENS_BY_MODEL[model]`, fail the test with a message listing actual vs required tokens — this prevents the warm assertion from passing trivially or failing for the wrong reason.
    - Both cold and warm Messages calls send `paddedSystem` (byte-identical), guaranteeing the cached content is the same and meets the minimum.
4. Issue two sequential `POST https://api.anthropic.com/v1/messages` calls via `globalThis.fetch` (do not monkey-patch fetch — this is the live path). Each request body:
   ```json
   {
     "model": "claude-sonnet-4-6",
     "max_tokens": 1024,
     "temperature": 0,
     "system": <paddedSystem from step 3a>,
     "messages": <buildSynthesisRequestParams(input).messages>
   }
   ```
   Headers: `content-type: application/json`, `x-api-key: <ANTHROPIC_API_KEY>`, `anthropic-version: 2023-06-01`. The `model` value must be read from `process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6"` to match the production default in `web/src/lib/anthropic.ts`.
5. For each response, parse JSON and read `payload.usage` keeping these fields explicitly: `input_tokens`, `output_tokens`, `cache_creation_input_tokens` (may be `0`/absent on warm), `cache_read_input_tokens` (expected `0` cold, `> 0` warm). Also record `payload.model` and `payload.id` for traceability.
6. Assert `warm.usage.cache_read_input_tokens > 0`. Also assert `cold.usage.cache_read_input_tokens === 0` (or absent) so the test fails loudly if the cold call accidentally hits a pre-existing cache entry from a prior run within the same 5-minute TTL window — re-running after the TTL expires is the documented mitigation.
7. Write the artifact JSON. Default path: `<repo_root>/diagnostic/artifacts/perf/02-cache-hit_<DATE>.json` where `<DATE>` is computed at runtime as `new Date().toISOString().slice(0, 10)` (UTC, `YYYY-MM-DD`). The test must resolve this path from its own location (the test file lives at `web/scripts/tests/cache-benchmark.test.mjs`, so the repo root is `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")`); do NOT use `process.cwd()`, so the artifact lands in `<repo_root>/diagnostic/...` regardless of which directory the live gate is invoked from. If `OPENF1_CACHE_BENCHMARK_OUT` is set, use that path verbatim instead (the operator is responsible for absolute vs relative resolution in that case). Artifact shape:
   ```json
   {
     "slice_id": "02-cache-hit-assertion",
     "captured_at": "<ISO 8601 UTC>",
     "model": "<payload.model from cold call>",
     "anthropic_version": "2023-06-01",
     "model_minimum_cache_tokens": <e.g. 1024>,
     "static_prefix_bytes": <Buffer.byteLength of productionSystem[0].text>,
     "padding_bytes": <Buffer.byteLength of synthetic padding text>,
     "cached_blocks": [
       { "role": "padding", "bytes": <padding bytes> },
       { "role": "production_prefix", "bytes": <static_prefix_bytes> }
     ],
     "cached_system_tokens": <cachedSystemTokens from count_tokens preflight>,
     "cold": {
       "response_id": "<payload.id>",
       "usage": { "input_tokens": N, "output_tokens": N, "cache_creation_input_tokens": N, "cache_read_input_tokens": 0 }
     },
     "warm": {
       "response_id": "<payload.id>",
       "usage": { "input_tokens": N, "output_tokens": N, "cache_creation_input_tokens": N, "cache_read_input_tokens": N }
     },
     "delta": {
       "input_tokens_saved": <cold.input_tokens - warm.input_tokens>,
       "cache_read_input_tokens_warm": <warm.cache_read_input_tokens>
     }
   }
   ```
   The `cached_blocks` array MUST be ordered to match the order of blocks sent in `paddedSystem` (so a downstream reader can reconstruct which block is the synthetic padding vs the production prefix). (Token-cost dollars are intentionally not computed in this slice — pricing lives in a future slice. The raw `usage` rows are sufficient to compute cost downstream.)
8. The artifact directory must exist before write; create it via `fs.mkdir(..., { recursive: true })`.

## Changed files expected
- `web/scripts/tests/cache-benchmark.test.mjs` — new gated benchmark test.
- `diagnostic/artifacts/perf/02-cache-hit_<DATE>.json` — artifact written by a successful live run, where `<DATE>` is the UTC `YYYY-MM-DD` at run time (e.g. `2026-04-27` for a same-day run). Implementation must commit whichever date the live run actually produced; the planner does not pre-commit a stale date.

## Artifact paths
- `diagnostic/artifacts/perf/02-cache-hit_<DATE>.json` (UTC, `YYYY-MM-DD` at run time).

## Gate commands
```bash
# Offline gates (must pass with OPENF1_RUN_CACHE_BENCHMARK unset; the new test skips):
cd web && npm run typecheck
cd web && npm run test:grading
cd web && npm run build

# Live benchmark gate (must pass; produces the artifact):
cd web && OPENF1_RUN_CACHE_BENCHMARK=1 ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  node --test scripts/tests/cache-benchmark.test.mjs
```

## Acceptance criteria
- [ ] `web/scripts/tests/cache-benchmark.test.mjs` exists and skips cleanly (exit 0) when `OPENF1_RUN_CACHE_BENCHMARK` is unset, so `npm run test:grading` remains offline.
- [ ] When run with `OPENF1_RUN_CACHE_BENCHMARK=1` and a valid `ANTHROPIC_API_KEY`, the test issues two real Anthropic Messages calls reusing a byte-identical `paddedSystem` (production prefix from `buildSynthesisRequestParams(input)` plus a deterministic synthetic padding block, both carrying `cache_control: { type: "ephemeral" }`).
- [ ] The benchmark guarantees the cached `system` content meets the model's documented prompt-cache minimum (1024 tokens for Sonnet 4 family, 2048 for Haiku 4 family, looked up from a hard-coded `MIN_CACHE_TOKENS_BY_MODEL` map in the test) by:
  - Hard-coding a deterministic, byte-identical `PADDING_TEXT` literal in the test (no UUIDs, no timestamps, no run-varying content) sized to comfortably exceed the largest model minimum on its own.
  - Issuing a `POST /v1/messages/count_tokens` preflight to confirm `cachedSystemTokens >= MIN_CACHE_TOKENS_BY_MODEL[model]`.
  - Failing the test with a clear, actionable message (actual vs required tokens, or "add prompt-cache minimum for <model>") if either guarantee cannot be met — never silently falling through to the Messages calls.
- [ ] The test asserts `warm.usage.cache_read_input_tokens > 0` and `cold.usage.cache_read_input_tokens` is `0` or absent.
- [ ] Artifact JSON at `<repo_root>/diagnostic/artifacts/perf/02-cache-hit_<DATE>.json` (path resolved from the test file location, not `process.cwd()`, so the live gate may be run from either `web/` or the repo root and the artifact still lands under `<repo_root>/diagnostic/artifacts/perf/`) records `model`, `anthropic_version`, `model_minimum_cache_tokens`, `static_prefix_bytes`, `padding_bytes`, `cached_blocks` (in send-order), `cached_system_tokens`, and the cold/warm `usage` blocks with all four fields (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`), plus a `delta` block.
- [ ] `npm run typecheck`, `npm run test:grading`, and `npm run build` succeed offline.
- [ ] Production code under `web/src/lib/` is unchanged by this slice (the benchmark only imports `buildSynthesisRequestParams`; it does not modify it). The synthetic padding lives only inside the benchmark test file.

## Out of scope
- Modifying `synthesizeAnswerWithAnthropic` or any other production code path.
- Computing dollar cost from token usage (handled by a later pricing slice).
- Migrating to the `@anthropic-ai/sdk` package.
- Wiring cache-hit telemetry into the runtime perf trace (separate slice).
- Caching markers on SQL-gen / repair prompts.

## Risk / rollback
Rollback: `git revert <commit>` removes the new test and artifact. Risk is low: the slice adds one gated test file and one artifact JSON; no production code changes. The live gate consumes a small amount of Anthropic credit per run (two synthesis calls).

## Slice-completion note

- Branch: `slice/02-cache-hit-assertion`.
- Implementation commit: `4c60c14` — `feat(test): add gated live cache-hit benchmark for synthesis prefix` (tagged `[slice:02-cache-hit-assertion][awaiting-audit]`).
- Files added (within scope):
  - `web/scripts/tests/cache-benchmark.test.mjs` — new gated benchmark test (TS-transpile-and-import pattern matching `cache-control-markers.test.mjs`). Skips when `OPENF1_RUN_CACHE_BENCHMARK !== "1"`. When run live, it: (a) reads `model` from `process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6"`, looks it up in the hard-coded `MIN_CACHE_TOKENS_BY_MODEL = { "claude-sonnet-4-6": 1024, "claude-opus-4-7": 1024, "claude-haiku-4-5-20251001": 2048 }`; (b) builds `paddedSystem` with the synthetic padding block at index 0 and `buildSynthesisRequestParams(input).system[0]` at index 1, both carrying `cache_control: { type: "ephemeral" }`; (c) issues two `POST /v1/messages/count_tokens` preflight calls and asserts `cachedSystemTokens >= MIN_CACHE_TOKENS_BY_MODEL[model]`; (d) issues two sequential `POST /v1/messages` calls (cold + warm) sharing the byte-identical `paddedSystem`; (e) asserts `warm.usage.cache_read_input_tokens > 0` and `cold.usage.cache_read_input_tokens === 0`; (f) writes the artifact JSON described below.
- Files added (artifact from successful live run):
  - `diagnostic/artifacts/perf/02-cache-hit_2026-04-27.json` — produced by the live gate at `2026-04-27T05:01:29.729Z`. Contains `model`, `anthropic_version`, `model_minimum_cache_tokens`, `static_prefix_bytes`, `padding_bytes`, `cached_blocks` (in send-order: padding then production_prefix), `cached_system_tokens`, the cold/warm `usage` blocks with all four fields, and the `delta` block.
- Files NOT changed: `web/src/lib/anthropic.ts` is untouched (the benchmark only imports `buildSynthesisRequestParams`); `web/src/lib/chatRuntime.ts`, `web/scripts/tests/cache-control-markers.test.mjs`, and `web/scripts/tests/prompt-prefix-split.test.mjs` are untouched. No production code changes.

### Decisions
- `PADDING_TEXT` is a single multi-paragraph template literal (~12,822 bytes of fixed English F1-analytics narrative) committed verbatim to the test source; no UUIDs, timestamps, or run-varying tokens. The `count_tokens` preflight measured `cachedSystemTokens = 2858` for the `paddedSystem` on `claude-sonnet-4-6`, comfortably above the 1024 minimum.
- The send-order in `paddedSystem` is `[padding_block, production_prefix_block]` so the longest contiguous prefix of cache-marked blocks is dominated by the synthetic padding (which alone exceeds every model minimum in the map). The artifact's `cached_blocks` array mirrors the same order.
- Minor adjustment to the slice's count_tokens preflight call: the slice text reads `messages: [{ role: "user", content: "" }]`, but the Anthropic Messages API (`anthropic-version: 2023-06-01`) returns HTTP 400 (`invalid_request_error: messages.0: user messages must have non-empty content`) when the user content is empty. The test uses `messages: [{ role: "user", content: "." }]` instead — a single-character placeholder that is the smallest legal stand-in. The intent ("count is dominated by `system`") is preserved; the placeholder adds at most one token, which is irrelevant against the 2858-token cached portion.
- Artifact path is resolved from the test file location (`repoRoot = path.resolve(webRoot, "..")`), not `process.cwd()`, so the live gate produces `<repo_root>/diagnostic/artifacts/perf/02-cache-hit_<DATE>.json` regardless of the directory the gate is invoked from. `OPENF1_CACHE_BENCHMARK_OUT` overrides this verbatim if set.
- No `anthropic-beta` header is sent. Prompt caching is GA on `anthropic-version: 2023-06-01`, matching the prior slice's decision.
- Token-cost dollars are intentionally not computed — that is reserved for a future pricing slice. The raw `usage` rows in the artifact are sufficient for downstream cost computation.

### Gate command results
- `cd web && npm run typecheck` → exit 0
- `cd web && npm run test:grading` → exit 0 (31 tests, 21 pass, 10 skipped, 0 fail; the new `cache-hit benchmark records a warm cache_read on the Anthropic Messages API` test reports `# SKIP OPENF1_RUN_CACHE_BENCHMARK not set`)
- `cd web && npm run build` → exit 0 (Next.js build succeeded; route table unchanged)
- `cd web && OPENF1_RUN_CACHE_BENCHMARK=1 ANTHROPIC_API_KEY=... node --test scripts/tests/cache-benchmark.test.mjs` → exit 0 (1 test, 1 pass, duration ≈ 13.1s; artifact `diagnostic/artifacts/perf/02-cache-hit_2026-04-27.json` written)

### Live-run usage rows (for traceability)
- model: `claude-sonnet-4-6`
- model_minimum_cache_tokens: `1024`
- cached_system_tokens (preflight): `2858`
- cold response_id: `msg_016QUEZ6h47LSLHaGwyFUqKA` — usage `{ input_tokens: 82, output_tokens: 207, cache_creation_input_tokens: 2851, cache_read_input_tokens: 0 }`
- warm response_id: `msg_01PTRMvWg61dVufMcLswHKhb` — usage `{ input_tokens: 3, output_tokens: 200, cache_creation_input_tokens: 79, cache_read_input_tokens: 2851 }`
- delta: `input_tokens_saved = 79`, `cache_read_input_tokens_warm = 2851`

### Self-check vs. acceptance criteria
- [x] `web/scripts/tests/cache-benchmark.test.mjs` exists and skips cleanly (exit 0) when `OPENF1_RUN_CACHE_BENCHMARK` is unset; verified by `npm run test:grading` reporting `# SKIP OPENF1_RUN_CACHE_BENCHMARK not set` for this subtest.
- [x] When run with `OPENF1_RUN_CACHE_BENCHMARK=1` and a valid `ANTHROPIC_API_KEY`, the test issues two real Anthropic Messages calls reusing a byte-identical `paddedSystem` (synthetic padding block at index 0 + production prefix block at index 1, both with `cache_control: { type: "ephemeral" }`).
- [x] The benchmark guarantees the cached `system` content meets the model's documented prompt-cache minimum: `MIN_CACHE_TOKENS_BY_MODEL` is hard-coded; `PADDING_TEXT` is a deterministic, byte-identical literal sized to comfortably exceed 2048 tokens on its own (12,822 bytes ≈ 3205 tokens by the conservative `bytes/4` proxy; the live `count_tokens` preflight measured 2858 cached-portion tokens including the production prefix); the test fails with a clear actionable message if either guarantee is missed.
- [x] The test asserts `warm.usage.cache_read_input_tokens > 0` (live: 2851) and `cold.usage.cache_read_input_tokens === 0` (live: 0).
- [x] Artifact JSON at `<repo_root>/diagnostic/artifacts/perf/02-cache-hit_2026-04-27.json` records `model`, `anthropic_version`, `model_minimum_cache_tokens`, `static_prefix_bytes` (976), `padding_bytes` (12822), `cached_blocks` in send-order, `cached_system_tokens` (2858), the cold/warm `usage` blocks with all four fields, and the `delta` block. Path resolved from the test file location, not `process.cwd()`.
- [x] `npm run typecheck`, `npm run test:grading`, and `npm run build` succeed offline.
- [x] Production code under `web/src/lib/` is unchanged by this slice (verified by `git diff --name-only integration/perf-roadmap...HEAD` after commit — only the slice file, the new test file, and the artifact JSON appear in the diff).

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace the "SDK response" assumption with an executable direct-`fetch` strategy or an explicit code change that exposes `payload.usage`, because this repo has no Anthropic SDK dependency and `synthesizeAnswerWithAnthropic` currently discards the raw response usage fields.
- [x] Add a gate command that actually runs the live benchmark with `OPENF1_RUN_CACHE_BENCHMARK=1` and `ANTHROPIC_API_KEY` present, because the listed `npm run test:grading` command will skip the gated cache assertion by default.

### Medium
- [x] Update `Inputs` to remove the nonexistent `web/scripts/tests/grading.test.mjs` path and include the concrete source file the benchmark will import or modify.
- [x] Define the cache-hit benchmark artifact naming with a captured UTC `DATE` token instead of the stale hard-coded `2026-04-26` path, and align `Changed files expected` / `Artifact paths` to that convention.
- [x] Specify the exact benchmark payload construction and response fields to record, including model id, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, and the before/after token-cost rows needed by the goal.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so no stale-state note is needed.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High

### Medium
- [x] Specify that the default `diagnostic/artifacts/perf/02-cache-hit_<DATE>.json` path is resolved from the repository root, or change the live gate command to run from the repository root, because the current live gate runs from `web/` and an unqualified relative path would write under `web/diagnostic/...`.

### Low

### Notes (informational only — no action)
- Prior round action items are resolved in the current plan body.
- `diagnostic/_state.md` was last updated on 2026-04-27, so no stale-state note is needed.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Specify how the live benchmark guarantees a cacheable static prefix of at least Anthropic's documented minimum length for the selected model, because the current `buildSynthesisRequestParams(input).system[0].text` is too short for Sonnet prompt caching and the warm call can legitimately report `cache_read_input_tokens: 0`.

### Medium

### Low

### Notes (informational only — no action)
- Prior round action items remain resolved in the current plan body.
- `diagnostic/_state.md` was last updated on 2026-04-27, so no stale-state note is needed.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [x] Resolve the contradictory `paddedSystem` construction so the steps unambiguously send the synthetic padding block first and the production prefix block second, with `cached_blocks` documented in the same send-order.

### Medium
- [x] Add optional `ANTHROPIC_MODEL` to `Required services / env`, including its default value and the requirement that any override must exist in `MIN_CACHE_TOKENS_BY_MODEL`.

### Low

### Notes (informational only — no action)
- Prior round action items are materially addressed, but the padding-order revision introduced an internal contradiction that can affect the live cache-hit assertion.
- `diagnostic/_state.md` was last updated on 2026-04-27, so no stale-state note is needed.

## Plan-audit verdict (round 5)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- Prior round action items are resolved in the current plan body.
- `diagnostic/_state.md` was last updated on 2026-04-27, so no stale-state note is needed.
