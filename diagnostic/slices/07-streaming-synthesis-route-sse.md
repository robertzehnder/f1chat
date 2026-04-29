---
slice_id: 07-streaming-synthesis-route-sse
phase: 7
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-29
updated: 2026-04-29T16:40:40-04:00
---

## Goal
Wire the streaming primitive added by `07-streaming-synthesis-server` into the `/api/chat` route. When the request carries `Accept: text/event-stream`, the route emits Server-Sent Events; otherwise it preserves today's JSON response exactly. Specify behavior for EVERY route exit branch — synthesis path AND non-LLM short-circuits — so the SSE-opted client never receives a non-SSE response on a request it asked to stream. This is the integration concern codex's round-11 audit on the predecessor slice surfaced.

## Inputs
- `web/src/app/api/chat/route.ts` — route entry. Today there are at least 6 distinct exit branches: clarification, completeness-blocked, answer-cache-hit, validation-error, deterministic synthesis, LLM synthesis. Every branch must be auditable for SSE compatibility.
- `web/src/lib/anthropic.ts` — `synthesizeAnswerStream` from `07-streaming-synthesis-server` (prerequisite).
- `diagnostic/_state.md`

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/07-streaming-synthesis.md` — predecessor's round-9, round-10, round-11 audit verdicts catalog the route-side integration issues this slice's narrower scope must cover end-to-end.
- `diagnostic/slices/07-streaming-synthesis-server.md` — sibling slice that adds the streaming primitive this slice consumes.

## Required services / env
- Same as today's chat route. Tests use the existing in-process stub harness pattern from `web/scripts/tests/answer-cache.test.mjs`.

## Steps
1. **Define the SSE frame contract** at the top of `web/src/app/api/chat/route.ts` (or a small helper in the same file). Frames:
   - `event: answer_delta\ndata: {"text": "..."}\n\n` — incremental answer text from the streaming synthesizer.
   - `event: reasoning_delta\ndata: {"text": "..."}\n\n` — optional reasoning chunks (empty for non-LLM branches).
   - `event: final\ndata: <full response payload, identical to today's JSON>\n\n` — terminal frame for both synthesis and non-LLM branches; payload mirrors the JSON the route currently returns.
   - `event: error\ndata: {"message": "...", "code": "..."}\n\n` — terminal frame on any thrown error.
   Document the contract in code comments so the client (next slice) implements against the same shape.
2. **Branch on `Accept: text/event-stream`** at the top of the route handler. If absent, all paths return today's JSON unchanged. If present, every exit path emits SSE frames per the contract.
3. **Synthesis path SSE wiring.** Replace the `cachedSynthesize(...)` call (currently at `web/src/app/api/chat/route.ts:743` and surrounding lines) with `synthesizeAnswerStream(...)` when SSE is requested. Forward `answer_delta` and `reasoning_delta` chunks to the response body; on the streaming `final` frame, emit a `final` SSE frame whose data payload is identical to today's JSON return shape (caller-visible parity). Non-streaming requests continue to use `cachedSynthesize` unchanged.
4. **Non-LLM branch SSE wiring.** For each non-synthesis exit branch the route has today, when SSE is requested, emit a single `final` SSE frame whose data payload is the same JSON the branch returns today. The client perceives a one-frame stream. Branches to cover (cite line numbers in the slice-completion note):
   - clarification request (route's clarification branch)
   - completeness-blocked branch
   - answer-cache hit (warm) — the existing `web/src/app/api/chat/route.ts:467` short-circuit
   - validation-error branch
   - deterministic-template branch (post `07-zero-llm-path-tighten` — emits `final` directly without going through synthesis)
   - any other early-return path the implementer audits.
   For every branch, the data payload of the `final` frame MUST be byte-identical (modulo whitespace) to today's JSON return for that same branch.
5. **Error handling.** Any thrown error inside an SSE-opted request emits an `error` SSE frame and closes the stream cleanly. Today's non-SSE error path (HTTP 4xx/5xx with JSON body) is preserved for non-SSE requests.
6. Add an end-to-end route test at `web/scripts/tests/streaming-synthesis-route.test.mjs` that exercises EACH branch under both SSE and JSON modes:
   - Synthesis path: asserts ≥2 `answer_delta` frames + 1 `final` frame in SSE mode; asserts identical JSON body in non-SSE mode.
   - Each non-LLM branch: asserts exactly 1 `final` frame in SSE mode whose data equals the non-SSE mode's JSON body.
   - Error path: asserts `error` frame is emitted for SSE; asserts HTTP 4xx/5xx with JSON body for non-SSE.
   Reuse the `loadRouteHarness()` stub-harness pattern (the convention used by recent test files such as `web/scripts/tests/zero-llm-path.test.mjs` and `web/scripts/tests/skip-repair.test.mjs`; older `loadRouteAndCacheModule()` in `answer-cache.test.mjs` is the same pattern under an older name — the new test should adopt the newer name).
6a. **Extend the in-process ANTHROPIC_STUB** so the route's new `synthesizeAnswerStream` import resolves under the harness. The existing stub in `zero-llm-path.test.mjs` / `skip-repair.test.mjs` exports only `generateSqlWithAnthropic`, `repairSqlWithAnthropic`, and `synthesizeAnswerWithAnthropic`; the route under test will additionally `import { synthesizeAnswerStream } from "../../lib/anthropic"`. The new test's stub MUST add:
   - A `state.synthesizeStream` slot, a `__setSynthesizeStreamImpl(fn)` test hook, and reset both in `__resetAnthropic()`.
   - An `export async function* synthesizeAnswerStream(input)` async-generator wrapper that, when configured, yields whatever the test-supplied async iterable / generator yields (so a test can drive controllable `answer_delta`, `reasoning_delta`, and `final` chunks); when not configured, throws `"anthropic stub: synthesizeAnswerStream not configured"`.
   - **Discriminant + chunk shape (binding):** every chunk yielded by the stub MUST match the real `StreamChunk` type defined at `web/src/lib/anthropic.ts:520-523`. The discriminant field name is **`kind`** (NOT `type`). The three concrete shapes are:
     - `{ kind: "answer_delta", text: string }`
     - `{ kind: "reasoning_delta", text: string }`
     - `{ kind: "final", answer: string, reasoning?: string, model: string, rawText: string }`
     The route handler MUST switch on `chunk.kind` and, for the terminal `final` chunk, map `{ answer, reasoning, model, rawText }` onto the JSON response shape today's non-streaming branch returns (the field names differ — this mapping is the integration point and must be exercised by the test). Using `type` instead of `kind` in either the stub or the route is a bug class explicitly called out in `_state.md` Notes for auditors and would produce tests that pass internally yet fail against the real `synthesizeAnswerStream`.
   Without these additions, the SSE synthesis test cannot inject a deterministic stream and the route import will throw at load time.
6b. **SSE-reader helper pattern** for the test. The SSE-mode handler returns `new Response(new ReadableStream(...))` with `Content-Type: text/event-stream`, NOT a `NextResponse.json(...)` mock. **Default to option (a):** `const text = await response.text()` then split on the SSE record terminator `\n\n` and parse each block's `event:` / `data:` lines via a small `parseSseFrames(text)` helper that returns `[{event, data}, ...]`. The in-process stub-driven stream completes synchronously, so option (a) is the simpler and correct path for every test in this slice. Use option (b) — `response.body.getReader()` chunk decoding as in `web/scripts/tests/streaming-synthesis-server.test.mjs` — ONLY if a future test in this file specifically needs to observe intermediate-chunk timing (none of the cases in step 6 require it).

## Changed files expected
- `web/src/app/api/chat/route.ts` (additive: SSE frame helper, conditional branch on `Accept: text/event-stream`, per-branch SSE/JSON parity).
- `web/scripts/tests/streaming-synthesis-route.test.mjs` (new).
- `diagnostic/slices/07-streaming-synthesis-route-sse.md` (frontmatter + slice-completion note).

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/app/api/chat/route.ts` branches on `Accept: text/event-stream` at the top of the handler; non-SSE requests continue to return today's JSON byte-identically.
- [ ] Synthesis path emits `answer_delta` + (optional) `reasoning_delta` + `final` SSE frames; final-frame data equals non-SSE JSON shape.
- [ ] Every non-LLM exit branch emits a single `final` SSE frame whose data equals the non-SSE JSON for that branch. Branches enumerated in the slice-completion note with line citations.
- [ ] Error path emits `error` SSE frame for SSE, HTTP-error JSON for non-SSE.
- [ ] `web/scripts/tests/streaming-synthesis-route.test.mjs` covers all the above and exits 0 in `npm run test:grading`.
- [ ] All 3 gates pass.

## Out of scope
- Any change to `web/src/lib/anthropic.ts` (`07-streaming-synthesis-server` dependency — already merged before this slice).
- Any change to client code (`07-streaming-synthesis-client-wiring` follow-on).
- Refactoring the route's branch structure beyond what's required to add the SSE branch (no opportunistic cleanup).

## Risk / rollback
- Risk: a non-LLM branch's JSON shape doesn't round-trip through the SSE `final` frame data. Mitigation: per-branch test asserts byte-equality between SSE final-frame data and non-SSE JSON body.
- Risk: the route's existing JSON return semantics change subtly (e.g., header set or omitted). Mitigation: non-SSE test cases pin the existing behavior.
- Rollback: `git revert` removes the SSE branch entirely; non-SSE clients are unaffected.

## Slice-completion note

**Branch:** `slice/07-streaming-synthesis-route-sse` (pushed to origin)
**Implementer:** claude
**Implementation commits:** `dea59cd` (initial impl, parent: `73efb8e` plan-approved); `3e4b64a` (revise round — adds transient-DB-unavailable SSE/JSON parity test per audit AC-3/AC-5 finding).

### What changed

- `web/src/app/api/chat/route.ts` — refactored `POST` into a thin dispatcher
  that detects `Accept: text/event-stream` and either (a) returns today's
  JSON via `NextResponse.json(...)` or (b) returns a `Response` wrapping a
  `ReadableStream` whose chunks are SSE frames per the contract documented
  at the top of the file. The bulk of the route body moved into
  `runChatRoute(request, ctx) -> Promise<RouteOutcome>`. Each prior
  `return NextResponse.json(...)` became `return { payload, status, ...}`.
  - Synthesis path branches on `ctx.sseRequested`: when true, it iterates
    `synthesizeAnswerStream(...)` and forwards `answer_delta` /
    `reasoning_delta` chunks via `ctx.emitDelta(kind, text)`; the `final`
    chunk's `{ answer, reasoning }` populate `synth{Answer,Reasoning}`
    which flow into the route's existing JSON response shape unchanged.
    Discriminant is `kind` (NOT `type`) per `web/src/lib/anthropic.ts:520`.
  - Generic catch (`runChatRoute` outer catch) returns `RouteOutcome` with
    `asError: { message, code: "chat_query_failed" }`. The dispatcher
    emits an SSE `error` frame for SSE-opted requests; non-SSE returns
    HTTP 400 with the same JSON shape today's catch returned.
- `web/scripts/tests/streaming-synthesis-route.test.mjs` (new) — covers
  every exit branch under both modes:
  - validation-error (invalid JSON body) — `web/src/app/api/chat/route.ts:235-241`
  - validation-error (missing message) — `web/src/app/api/chat/route.ts:243-250`
  - clarification — `web/src/app/api/chat/route.ts:308-353`
  - completeness-blocked — `web/src/app/api/chat/route.ts:355-411`
  - answer-cache hit (warm) — `web/src/app/api/chat/route.ts:520-585`
  - deterministic-template (cold) — `web/src/app/api/chat/route.ts:780-786`
  - synthesis (LLM) — `web/src/app/api/chat/route.ts:786-862` (asserts
    >=2 `answer_delta` + 1 `final`; non-SSE body deep-equals SSE final-frame
    data modulo per-call dynamic fields `requestId` / `runtime.durationMs`)
  - transient-DB-unavailable — `web/src/app/api/chat/route.ts:1048-1113`
    (caller-visible non-LLM final-response branch; test drives
    `runReadOnlySql` to throw `"the database system is starting up"`,
    which `isTransientDatabaseAvailabilityError` at
    `web/src/app/api/chat/route.ts:110-119` recognizes; deterministic-template
    retry falls back to heuristic SQL which also throws, propagating to the
    transient-DB outer catch. Asserts SSE emits exactly 1 `final` frame whose
    data deep-equals the non-SSE JSON body — `generationSource =
    "runtime_transient_db_unavailable"`, `model = null`, `sql =
    "-- query not executed (database temporarily unavailable)"`.)
  - error path — generic catch at `web/src/app/api/chat/route.ts:1116-1179`
    (asserts `error` frame for SSE; HTTP 400 + JSON for non-SSE)
  - Accept-header gating — confirms the branching key is `Accept`, not body
- ANTHROPIC_STUB extended (step 6a): added `state.synthesizeStream`,
  `__setSynthesizeStreamImpl(fn)`, reset wired into `__resetAnthropic()`,
  and an `async function* synthesizeAnswerStream(input)` wrapper that
  yields whatever the test-supplied async iterable yields (chunks must use
  `kind` discriminant per `anthropic.ts:520-523`). Without this hook the
  route's new `synthesizeAnswerStream` import would throw at load time.
- `parseSseFrames(text)` helper (step 6b option (a)): splits on the SSE
  record terminator `\n\n`, parses each block's `event:` / `data:` lines,
  JSON-parses the joined data. The in-process stub-driven stream completes
  synchronously, so `await response.text()` is the correct consumption mode.

### Decisions

- **No opportunistic refactor.** The body restructure into `runChatRoute`
  was the minimum required to support the SSE branch (returns now produce
  outcomes the dispatcher renders). All log/trace/cache logic preserved
  verbatim. JSON response shape unchanged for every branch.
- **SSE bypasses the answer-synthesis cache (`cachedSynthesize`).** SSE
  calls `synthesizeAnswerStream` directly — `cachedSynthesize` only wraps
  the non-streaming `synthesizeAnswerWithAnthropic`. This matches the
  current (post `07-streaming-synthesis-server`) primitive surface and
  keeps the streaming bytes flowing without an extra accumulation hop.
  Non-SSE requests continue to hit the cache exactly as before.
- **Error frame `code` field.** Generic-catch errors emit
  `code: "chat_query_failed"` to give the client a stable identifier
  separate from the human-readable `message`. The `error` frame is only
  emitted for the generic catch — graceful exits (transient DB,
  validation, clarification, etc.) still emit `final`.

### Gate results

| Gate | Command | Exit |
|---|---|---|
| 1 | `cd web && npm run build` | 0 |
| 2 | `cd web && npm run typecheck` | 0 |
| 3 | `bash scripts/loop/test_grading_gate.sh` | 0 (PASS — no new failures vs integration baseline; slice_fails=28 baseline_fails=28) |

### Self-check

- [x] `Accept: text/event-stream` branching at top of handler; non-SSE returns identical JSON.
- [x] Synthesis path emits `answer_delta` + `reasoning_delta` + `final`; final-frame data deep-equal to non-SSE JSON (modulo per-call `requestId` / `runtime.durationMs`).
- [x] All non-LLM exit branches emit exactly 1 `final` frame whose data equals the non-SSE JSON for that same branch (line citations above).
- [x] Generic-catch error path emits `error` SSE frame; non-SSE returns HTTP 400 + JSON.
- [x] New test `streaming-synthesis-route.test.mjs` covers all the above and exits 0 in `npm run test:grading`.
- [x] All 3 gates pass with exit code 0.
- [x] Only the three files in `## Changed files expected` were modified.

## Audit verdict
**REVISE**

- Gate #1 `cd web && npm run build` -> exit `0`
- Gate #2 `cd web && npm run typecheck` -> exit `0`
- Gate #3 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
- Scope diff -> PASS: `git diff --name-only integration/perf-roadmap...HEAD` returned only `diagnostic/_state.md`, `diagnostic/slices/07-streaming-synthesis-route-sse.md`, `web/scripts/tests/streaming-synthesis-route.test.mjs`, `web/src/app/api/chat/route.ts`; `_state.md` is an in-scope append-only auditor note and the rest match declared scope.
- AC-1 PASS: `web/src/app/api/chat/route.ts:198-229` branches on `Accept: text/event-stream` before dispatch; non-SSE requests still render `NextResponse.json(outcome.payload, { status: outcome.status })`.
- AC-2 PASS: `web/src/app/api/chat/route.ts:858-876` switches on `chunk.kind`, emits `answer_delta` / `reasoning_delta`, and `web/scripts/tests/streaming-synthesis-route.test.mjs:576-660` verifies `>=2` answer deltas plus one `final` whose normalized payload matches the JSON path.
- AC-3 FAIL: `web/src/app/api/chat/route.ts:1100-1113` still has a distinct non-LLM `runtime_transient_db_unavailable` return path, but `web/scripts/tests/streaming-synthesis-route.test.mjs:394-719` never exercises it in either SSE or JSON mode, and the slice-completion note at `diagnostic/slices/07-streaming-synthesis-route-sse.md:119-132` claims “covers every exit branch” without a line-cited transient-DB entry. Add SSE/JSON parity coverage for this branch and update the note.
- AC-4 PASS: `web/src/app/api/chat/route.ts:221-229,1165-1179` emits SSE `error` frames for thrown errors while keeping non-SSE HTTP 400 JSON; `web/scripts/tests/streaming-synthesis-route.test.mjs:666-691` verifies that behavior.
- AC-5 FAIL: `cd web && node --test scripts/tests/streaming-synthesis-route.test.mjs` -> exit `0`, but the file does not cover every route branch required by the slice because the transient-DB final branch is missing.
- AC-6 PASS: all 3 declared gates exited `0`.

Transient database unavailability is a caller-visible non-LLM final-response branch; without a parity test, the slice has not verified that SSE-opted clients never receive a non-SSE response on that path.

## Plan-audit verdict (round 1)

**Status: REVISE**
**Auditor: claude-plan-audit (round-1 forced-findings ratchet: not applied — genuine Medium items found)**

### High
_(none)_

### Medium
- [x] Step 6 instructs the implementer to "reuse the existing `loadRouteAndCacheModule()` stub harness pattern" but the `ANTHROPIC_STUB` in `answer-cache.test.mjs` exports only `generateSqlWithAnthropic`, `repairSqlWithAnthropic`, and `synthesizeAnswerWithAnthropic` — it has no `synthesizeAnswerStream` async-generator stub. The plan must explicitly require the new test file to extend the ANTHROPIC_STUB with a `__setSynthesizeStreamImpl` hook and an async-generator `synthesizeAnswerStream` export; without it the synthesis SSE path test cannot inject a controllable stream and will throw at runtime.
- [x] Step 6 asserts "≥2 `answer_delta` frames + 1 `final` frame" from SSE mode, but no existing harness provides a pattern for reading a `ReadableStream` response body as SSE text. The SSE-mode route returns `new Response(new ReadableStream(...))`, not a `NextResponse.json(...)` mock object; the plan must specify that the new test needs an SSE-reader helper (e.g. `await response.text()` then split on `\n\n`) or cite the pattern from `streaming-synthesis-server.test.mjs` as the reference — otherwise the implementer has no unambiguous way to consume SSE frames in-process.

### Low
- [x] Step 6 references "the existing `loadRouteAndCacheModule()` stub harness pattern" (name from `answer-cache.test.mjs`); more recent test files (`zero-llm-path.test.mjs`, `skip-repair.test.mjs`) use `loadRouteHarness()`. Align the naming guidance to the newer convention to avoid inconsistency.

### Notes (informational only — no action)
- `synthesizeAnswerStream` confirmed exported at `anthropic.ts:566` — prerequisite slice is merged and the dependency is available.
- Gate ordering (build → typecheck) is correct and does not exhibit the typecheck-before-build anti-pattern from audit principles.
- All three `## Prior context` paths exist on disk.

## Plan-audit verdict (round 2)

**Status: REVISE**
**Auditor: claude-plan-audit (round-2 forced-findings ratchet: not applied — genuine Medium item found)**

### High
_(none)_

### Medium
- [x] Step 6a specifies that the `synthesizeAnswerStream` stub "yields whatever the test-supplied async iterable / generator yields" and mentions driving "controllable `answer_delta`, `reasoning_delta`, and `final` chunks" — but never names the discriminant field. The actual `StreamChunk` type at `web/src/lib/anthropic.ts:520-523` uses `kind` as the discriminant: `{ kind: "answer_delta"; text: string }`, `{ kind: "reasoning_delta"; text: string }`, `{ kind: "final"; answer: string; reasoning?: string; model: string; rawText: string }`. An implementer who writes the stub and route handler using `type` (a natural guess) instead of `kind` will produce tests that pass internally but fail against the real `synthesizeAnswerStream`. Fix: add a line to step 6a explicitly stating the discriminant is `kind`, reference `StreamChunk` at `anthropic.ts:520`, and note the final chunk's field names (`answer`, `reasoning`, `model`, `rawText`) so the route can map them to the JSON response shape.

### Low
- [x] Step 6b leaves the implementer to choose between option (a) (`response.text()` + split) and option (b) (`getReader()`) without a firm default; "pick (a) if the stream completes synchronously" is contingent on a property the implementer cannot easily verify in advance. Consider committing to option (a) as the default since a synchronous in-process stream is the standard test harness behavior.

### Notes (informational only — no action)
- Round-1 Medium items both resolved: step 6a now specifies `__setSynthesizeStreamImpl` hook; step 6b now specifies `parseSseFrames(text)` helper.
- Round-1 Low resolved: step 6 now names `loadRouteHarness()` consistently.
- `StreamChunk.kind` discriminant confirmed at `anthropic.ts:520-523`; final chunk shape is `{ kind: "final"; answer: string; reasoning?: string; model: string; rawText: string }` — distinct from the route's JSON response shape, so mapping is non-trivial.

## Plan-audit verdict (round 3)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-3 forced-findings ratchet: not applicable)**

### High
_(none)_

### Medium
_(none)_

### Low
_(none)_

### Notes (informational only — no action)
- All round-1 and round-2 items are resolved: ANTHROPIC_STUB extension (6a), SSE-reader `parseSseFrames` helper (6b), `loadRouteHarness()` naming (6), `kind` discriminant with explicit chunk shapes (6a), option (a) as default SSE reader (6b).
- Prerequisite `07-streaming-synthesis-server` confirmed merged (in `_state.md` recent merges); `synthesizeAnswerStream` available at `anthropic.ts:566`.
- Gate ordering (build → typecheck → test_grading_gate.sh) is correct.
- `## Changed files expected` covers all files touched by the steps; no package.json changes needed.
- `_state.md` Notes for auditors already carries the async-generator discriminant lesson appended in round 2; no new entry needed.

## Plan-audit verdict (round 4)

**Status: APPROVED**

### High
_(none)_

### Medium
_(none)_

### Low
_(none)_

### Notes (informational only — no action)
- `diagnostic/_state.md:1` is current enough for audit use (`last updated: 2026-04-29T20:07:35Z`); no staleness note applies.
- Prior-context review of `diagnostic/slices/07-streaming-synthesis.md` and `diagnostic/slices/07-streaming-synthesis-server.md` surfaced no unresolved dependency, scope, or gate-ordering issue that still applies to this narrowed route-only slice.
