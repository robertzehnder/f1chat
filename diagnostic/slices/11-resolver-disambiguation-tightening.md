---
slice_id: 11-resolver-disambiguation-tightening
phase: 11
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-05-01T17:53:32Z
---

## Goal
Tighten resolver disambiguation: when a query mentions "Verstappen", default to Max in 2024+ but resolve other Verstappens for historic seasons. Avoid silent wrong-driver answers.

## Inputs
- `diagnostic/artifacts/healthcheck/00-fresh-benchmark_2026-04-26.json` — original `resolver_failure` root-cause source (`actionable.root_cause_priority` lists Q26 as the only `resolver_failure`).
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` — most recent rerun (Q26 currently graded A; root-cause `resolver_failure` no longer appears).
- Target failing-question ID from those artifacts: **Q26**.

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/11-rerun-benchmark-baseline.md`

## Decisions
- **Input filename correction.** The original audit cited `11-rerun_2026-04-26.json`; that file does not exist in the repo. The actual rerun artifact is `11-rerun_2026-04-30.json`. Inputs above are corrected.
- **Slice is hardening, not repair.** Q26 (the only `resolver_failure` row in the 2026-04-26 baseline) already grades A in the 2026-04-30 rerun. We therefore replace the brittle "live re-grade Q26 over a running stack" workflow with deterministic unit tests against `web/src/lib/chatRuntime/resolution.ts`. The unit-test gate runs fully locally (no DB, no LLM, no dev server) and is the load-bearing acceptance signal. The optional live-regrade procedure is documented under **Optional live regrade** for reproducibility but is not a gate.
- **Why this preserves the auditor's intent.** The auditor's High-1 asked for an explicit command path that ties target IDs → re-run → A/B assertion. The deterministic unit test makes that path strictly tighter (no LLM grading variance) while still exercising the disambiguation rules that drove Q26's `resolver_failure`.

## Required services / env
- **Gate path (fully local, used in CI/loop):** none. Node 20 + repo dev deps (already installed in the worktree) are sufficient. No DB, no dev server, no env vars.
- **Optional live regrade (not a gate):** requires `OPENF1_DATABASE_URL` (Neon / local Postgres URL), `ANTHROPIC_API_KEY` (LLM grading), and a running `npm run dev` on `OPENF1_CHAT_BASE_URL` (default `http://127.0.0.1:3000`). Operator-only; not invoked by the loop.

## Steps
1. Identify the resolver-disambiguation surface area in `web/src/lib/chatRuntime/resolution.ts` (the `containsWholePhrase(... "max verstappen") && row.driver_number === 1` branch in `scoreDriverCandidate`) and its lone caller in `web/src/lib/chatRuntime.ts` around line 1290 (`scoredDrivers = driverRows.map(... scoreDriverCandidate ...)` → `driverCandidates`). Confirm that "Verstappen" alone (without "max") currently falls through to surname-only matching with no year-aware tiebreak.
2. Add a new exported pure function `disambiguateDrivers(rows: DriverResolutionRow[], normalizedMessage: string, sessionYear: number | null): { resolved: DriverResolutionRow; matchedOn: string[]; score: number } | { ambiguous: { row: DriverResolutionRow; matchedOn: string[]; score: number }[] }` in `web/src/lib/chatRuntime/resolution.ts`. This function is the **resolver entrypoint under test**: it scores each row via `scoreDriverCandidate`, then applies the disambiguation rules below and returns either a single resolved candidate or the ambiguity set. Rules:
   - A bare-"verstappen" mention with no first name and a `sessionYear >= 2024` resolves to Max Verstappen (driver_number 1) when Max is in the input rows. Returned `matchedOn` includes `bare_verstappen_2024_default`.
   - A bare-"verstappen" mention with `sessionYear < 2024` (or `sessionYear === null`) and multiple Verstappen surname matches returns `{ ambiguous: [...] }` containing every row whose `last_name` matches "verstappen" (case-insensitive) — it does not silently pick Max.
   - Explicit "max verstappen" returns `{ resolved: Max }` regardless of `sessionYear` (existing behavior preserved via the existing `canonical_full_name_match` boost).
   - When neither case fires, fall back to the current "highest score wins, ties → lowest driver_number" behavior already implemented inline in `chatRuntime.ts:1304`.
3. Refactor `web/src/lib/chatRuntime.ts:1291-1320` to call `disambiguateDrivers(driverRows, normalizedMessage, selectedSession?.year ?? null)` and use the returned `resolved` row (or build `driverCandidates` from the `ambiguous` set so downstream `forceDriverClarification` / `needsDriverPair` paths still trigger). Preserve the existing `explicitDriverNumbers` short-circuit at `chatRuntime.ts:1294` (explicit numbers still win unconditionally).
4. Add a deterministic Node test file `web/scripts/tests/resolver-disambiguation.test.mjs` that imports `disambiguateDrivers` directly from a TS-stripped entrypoint (use the existing pattern from `web/scripts/tests/grading-regression.test.mjs` or `resolver-lru.test.mjs` for how peer tests load `@/lib/chatRuntime/...` modules under `node --test`). The test asserts at the resolver entrypoint, not the score function:
   - **Case A — bare-Verstappen 2024+ resolves Max:** input rows = [Max(#1), Jos(#33-historic)], message "verstappen lap times", `sessionYear=2024` → result has `.resolved.driver_number === 1` and `matchedOn` includes `bare_verstappen_2024_default`.
   - **Case B — bare-Verstappen pre-2024 returns explicit ambiguity:** same rows, same message, `sessionYear=2003` → result has `.ambiguous.length === 2`, both Verstappens present, and `.resolved` is `undefined` (asserts no silent pick).
   - **Case C — explicit "max verstappen" resolves Max regardless of year:** message "max verstappen pace", `sessionYear=2003` → `.resolved.driver_number === 1` and `matchedOn` includes `canonical_full_name_match`.
   - **Case D — Q26-phrasing regression:** message replicating Q26's exact phrasing from the rerun artifact, `sessionYear=2024` → `.resolved.driver_number === 1` (Max wins, no ambiguity).
   No DB / fetch / LLM. The test file glob (`scripts/tests/*.test.mjs` per `web/package.json:10`) auto-discovers the new file; no `package.json` change is required.
5. Run the gates listed below and confirm green. Confirm the new test is actually executed by inspecting the isolated `node --test` invocation's TAP output for at least one `ok` line per Case A–D.

## Changed files expected
- `web/src/lib/chatRuntime/resolution.ts` — add `disambiguateDrivers` resolver entrypoint and supporting logic.
- `web/src/lib/chatRuntime.ts` — refactor the `driverRows`→`driverCandidates` block (~lines 1291-1320) to call `disambiguateDrivers`.
- `web/scripts/tests/resolver-disambiguation.test.mjs` — new deterministic test file at the resolver entrypoint.
- `web/package.json` — unchanged. The existing `"test:grading": "node --test scripts/tests/*.test.mjs"` glob auto-discovers the new file.

## Artifact paths
None (deterministic unit tests; no captured run artifact required).

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
# Discovery gate: prove the new test file is loaded and all four cases run.
# This complements the baseline-aware wrapper, which can exit 0 even if a
# new .test.mjs file is silently skipped (the grading harness's glob would
# simply miss a typo'd filename).
cd web && node --test scripts/tests/resolver-disambiguation.test.mjs 2>&1 | tee /tmp/resolver-disamb-tap.txt
grep -c '^ok ' /tmp/resolver-disamb-tap.txt | awk '{ if ($1 < 4) { print "FAIL: expected ≥4 ok lines, got " $1; exit 1 } else { print "OK: " $1 " ok lines" } }'
# Baseline-aware grading-suite gate.
bash scripts/loop/test_grading_gate.sh
```

## Optional live regrade (not a gate)
Reproducible procedure for operators wanting to confirm Q26 still grades A end-to-end. Not part of the loop's auto-gate because it requires external services.

```bash
# 1. Start dev server in another terminal:
#    cd web && npm run dev
# 2. Build a one-question filter file containing only Q26:
python3 -c "import json; qs=json.load(open('web/scripts/chat-health-check.questions.json')); json.dump([q for q in qs if q['id']==26], open('/tmp/q26.json','w'))"
# 3. Run health-check restricted to Q26 (writes a fresh artifact under web/logs/):
cd web && OPENF1_CHAT_BASE_URL=http://127.0.0.1:3000 node scripts/chat-health-check.mjs --questions /tmp/q26.json
# 4. Assert Q26 baseline grade is A or B (rerun JSON is the latest under web/logs/).
#    The current healthcheck schema uses camelCase `baselineGrade`; we also
#    fall back to the legacy snake_case `baseline_grade` so this command works
#    against historical artifacts.
python3 -c "import json,glob,os; f=max(glob.glob('web/logs/chat-health-check-*.json'), key=os.path.getmtime); rows=json.load(open(f)); r=next(x for x in rows if x['id']==26); g=r.get('baselineGrade') or r.get('baseline_grade'); print('Q26 grade:', g); assert g in ('A','B'), g"
```

## Acceptance criteria
- [ ] `web/scripts/tests/resolver-disambiguation.test.mjs` exists and asserts at the **resolver entrypoint** (`disambiguateDrivers`), not just the score function. All four cases (bare-Verstappen 2024+ resolves Max, bare-Verstappen pre-2024 returns explicit `{ ambiguous: [...] }` with no silent pick, explicit "max verstappen" resolves Max, Q26-phrasing regression resolves Max) pass.
- [ ] **Discovery gate** confirms the new test file is loaded: `cd web && node --test scripts/tests/resolver-disambiguation.test.mjs` exits 0 AND its TAP output contains at least 4 `^ok ` lines (one per Case A–D). This proves the file is not silently skipped by a typo'd filename or import error.
- [ ] `bash scripts/loop/test_grading_gate.sh` reports no NEW failures vs the baseline at `scripts/loop/state/test_grading_baseline.txt`. Pre-existing baseline failures (e.g. `driver-fallback.test.mjs` Cases A/B/E) are not regressions. Because `web/package.json:10` defines `test:grading` as `node --test scripts/tests/*.test.mjs`, the new file is auto-discovered by the same glob the wrapper uses.
- [ ] `cd web && npm run typecheck` and `cd web && npm run build` exit 0.

## Out of scope
- Re-grading any benchmark question other than Q26 (the only historical `resolver_failure`).
- Changes to LLM prompts or grading rubric.
- Database / SQL changes.
- The optional live regrade procedure — documented for operators, not a gate.

## Risk / rollback
Rollback: `git revert <commit>`. The disambiguation tightening is a localized score adjustment in one function plus one new test file; reverting restores prior behavior cleanly with no schema or artifact dependencies.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Add an explicit command path that identifies the target failing question IDs from `diagnostic/artifacts/healthcheck/11-rerun_2026-04-26.json`, re-runs just those questions after the resolver change, and asserts they now grade A or B, because the current gate block at `diagnostic/slices/11-resolver-disambiguation-tightening.md:37` never executes the core verification required by steps 1 and 4 (`diagnostic/slices/11-resolver-disambiguation-tightening.md:25`).
- [x] Replace `cd web && npm run test:grading` at `diagnostic/slices/11-resolver-disambiguation-tightening.md:41` with `bash scripts/loop/test_grading_gate.sh`, because `_state.md` requires the baseline-aware wrapper for slice grading gates.

### Medium
- [x] Specify the required services and env for the targeted re-grade workflow at `diagnostic/slices/11-resolver-disambiguation-tightening.md:22`, or replace the workflow with a fully local command path, because `None at author time` is not compatible with the planned post-fix grading step.
- [x] Make the second acceptance criterion at `diagnostic/slices/11-resolver-disambiguation-tightening.md:46` testable by naming the exact comparison set and gate command for "previously-passing questions in the same category", or narrow the criterion to the questions the plan actually re-grades.

### Low
- [x] Replace `(determined by diagnosis)` at `diagnostic/slices/11-resolver-disambiguation-tightening.md:32` with the expected resolver/test file scope once the intended rerun path is defined, so implementers are not left with an unbounded edit surface.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T15:42:52Z`).

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Replace the load-bearing "call the scoring function directly" test plan with at least one deterministic test at the resolver entrypoint that proves a bare `Verstappen` query in a pre-2024 session returns an explicit ambiguity result rather than silently selecting a driver, because score-only assertions do not verify the resolver-level behavior promised in Step 2 and the Goal.

### Medium
- [x] Add an explicit gate assertion that the new resolver-disambiguation test is actually discovered and executed by the `bash scripts/loop/test_grading_gate.sh` path, because the baseline-aware wrapper can still exit 0 if the new `.test.mjs` file is never wired into the grading harness.
- [x] Fix the optional live-regrade grade assertion to use the current healthcheck row schema (`baselineGrade`, or a schema-agnostic fallback) instead of only `baseline_grade`, because the documented operator procedure should not fail on the repo's current artifact shape.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T15:42:52Z`).
