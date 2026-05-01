---
slice_id: 11-resolver-disambiguation-tightening
phase: 11
status: done
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-05-01T14:25:00-04:00
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
- **Disambiguation contract preserves multi-driver scoring (round-3 High-1).** Q26 is a `comparison_analysis` query naming both Max Verstappen and Charles Leclerc (verified: `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` Q26 → `questionType: "comparison_analysis"`, two `previewRows` for #1 and #16). A single-winner `{ resolved } | { ambiguous }` shape would collapse this to one driver and break `selectComparisonDriverNumbers` at `web/src/lib/chatRuntime.ts:343`. `disambiguateDrivers` therefore returns the **full scored list** (`scoredCandidates`) plus a separate `ambiguousSurnames` metadata array; the year-aware logic is implemented as score boosts and ambiguity flagging, not as a winner-pick.
- **Q26 actual session year = 2025 (round-3 Medium-1).** Verified: the artifact's Q26 question text is "Within the Abu Dhabi 2025 weekend ...". Case D below uses `sessionYear=2025`.

## Required services / env
- **Gate path (fully local, used in CI/loop):** none. Node 20 + repo dev deps (already installed in the worktree) are sufficient. No DB, no dev server, no env vars.
- **Optional live regrade (not a gate):** requires `OPENF1_DATABASE_URL` (Neon / local Postgres URL), `ANTHROPIC_API_KEY` (LLM grading), and a running `npm run dev` on `OPENF1_CHAT_BASE_URL` (default `http://127.0.0.1:3000`). Operator-only; not invoked by the loop.

## Steps
1. Identify the resolver-disambiguation surface area in `web/src/lib/chatRuntime/resolution.ts` (the `containsWholePhrase(... "max verstappen") && row.driver_number === 1` branch in `scoreDriverCandidate`) and its lone caller in `web/src/lib/chatRuntime.ts` around line 1290 (`scoredDrivers = driverRows.map(... scoreDriverCandidate ...)` → `driverCandidates`). Confirm that "Verstappen" alone (without "max") currently falls through to surname-only matching with no year-aware tiebreak.
2. Add a new exported pure function in `web/src/lib/chatRuntime/resolution.ts`:
   ```ts
   export function disambiguateDrivers(
     rows: DriverResolutionRow[],
     normalizedMessage: string,
     sessionYear: number | null
   ): {
     scoredCandidates: { row: DriverResolutionRow; matchedOn: string[]; score: number }[];
     ambiguousSurnames: { surname: string; rows: DriverResolutionRow[] }[];
   }
   ```
   This is the **resolver entrypoint under test**. It does NOT pick a single winner — it returns the full scored list so downstream comparison queries (e.g. Q26's "Max Verstappen and Charles Leclerc") still receive both candidates. Implementation:
   - Score every row via the existing `scoreDriverCandidate` helper. The returned `scoredCandidates` is sorted by `score` desc, then `driver_number` asc, and includes every row with `score > 0` (caller still applies its own `.slice(0, 6)` cap; this function does not truncate).
   - **Year-aware boost rule:** when `normalizedMessage` mentions the surname "verstappen" but does NOT also include "max" (case-insensitive whole-word check), and `sessionYear !== null && sessionYear >= 2024`, add a `+5` score boost to the row whose `driver_number === 1` (Max) and append `bare_verstappen_2024_default` to its `matchedOn`. The boost is large enough to outrank a same-surname tiebreak but does not displace explicit-driver-number boosts applied later in `chatRuntime.ts`.
   - **Ambiguity-flagging rule:** when the same bare-"verstappen" condition holds but `sessionYear === null || sessionYear < 2024` AND ≥2 rows match the surname "verstappen" (case-insensitive on `last_name`), populate `ambiguousSurnames` with `{ surname: "verstappen", rows: [...allMatches] }`. No score boost is applied; all matching rows remain in `scoredCandidates` with their natural scores so the caller can decide whether to clarify.
   - **Explicit "max verstappen":** falls through to the existing `canonical_full_name_match` boost in `scoreDriverCandidate`; no special-case logic is needed in `disambiguateDrivers`.
   - The function is **pure**: no DB, no fetch, no module-level state.
3. Refactor `web/src/lib/chatRuntime.ts:1291-1320` to call `disambiguateDrivers(driverRows, normalizedMessage, selectedSession?.year ?? null)`. Wiring requirements (each is grep-checked by the discovery gate below):
   - The call site at the former `scoredDrivers = driverRows.map(...)` block uses `disambiguateDrivers` with `selectedSession?.year ?? null` as the third argument. Pattern that must match: `disambiguateDrivers(\s*driverRows\s*,[^)]*selectedSession\?\.year\s*\?\?\s*null`.
   - The returned `scoredCandidates` is then mapped to add the existing `explicitDriverNumbers` boost (`+30` per `chatRuntime.ts:1294`), filtered to `score > 0`, sorted, and `.slice(0, 6)` — preserving the existing `driverCandidates` shape so `selectComparisonDriverNumbers` at `chatRuntime.ts:343` still receives a multi-driver list for Q26-style queries.
   - The `explicitDriverNumbers.length > 0` short-circuit at `chatRuntime.ts:1316` is preserved verbatim (explicit numbers still win unconditionally).
   - `ambiguousSurnames` is forwarded to the existing clarification path: when it is non-empty AND `explicitDriverNumbers.length === 0` AND no other tiebreaker resolves the surname group, set `forceDriverClarification = true` (extending the current condition at `chatRuntime.ts:1280`) so the caller emits a clarification request rather than silently picking a driver.
4. Add a deterministic Node test file `web/scripts/tests/resolver-disambiguation.test.mjs` that imports `disambiguateDrivers` directly from a TS-stripped entrypoint (use the existing pattern from `web/scripts/tests/grading-regression.test.mjs` or `resolver-lru.test.mjs` for how peer tests load `@/lib/chatRuntime/...` modules under `node --test`). The test asserts at the resolver entrypoint, not the score function. Test fixtures use the round-3 contract (`scoredCandidates` + `ambiguousSurnames`):
   - **Case A — bare-Verstappen 2024+ boosts Max:** input rows = [Max(#1), Jos(#33-historic)], message "verstappen lap times", `sessionYear=2024` → `scoredCandidates[0].row.driver_number === 1`, `scoredCandidates[0].matchedOn` includes `bare_verstappen_2024_default`, `ambiguousSurnames.length === 0`.
   - **Case B — bare-Verstappen pre-2024 flags ambiguity without dropping candidates:** same rows, same message, `sessionYear=2003` → `ambiguousSurnames.length === 1`, `ambiguousSurnames[0].surname === "verstappen"`, both Verstappens present in `ambiguousSurnames[0].rows`. `scoredCandidates` still contains both rows (caller decides whether to clarify); neither row carries `bare_verstappen_2024_default`.
   - **Case C — explicit "max verstappen" surfaces Max regardless of year:** message "max verstappen pace", `sessionYear=2003` → `scoredCandidates[0].row.driver_number === 1`, `scoredCandidates[0].matchedOn` includes `canonical_full_name_match`, `ambiguousSurnames.length === 0`.
   - **Case D — Q26 comparison regression (preserves both drivers):** message = the verbatim Q26 question text from `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` ("Within the Abu Dhabi 2025 weekend ..."), input rows = [Max(#1), Jos(#33-historic), Charles Leclerc(#16), Carlos Sainz(#55)], `sessionYear=2025` → `scoredCandidates` contains BOTH `driver_number === 1` (Max) AND `driver_number === 16` (Charles) with positive scores in the top 4 (proves comparison_analysis is not collapsed). `ambiguousSurnames.length === 0` (Max is unambiguously selected via the 2025 boost; Leclerc has no ambiguous twin in fixtures).
   No DB / fetch / LLM. The test file glob (`scripts/tests/*.test.mjs` per `web/package.json:10`) auto-discovers the new file.
5. Run the gates listed below and confirm green. Confirm the new test is actually executed by inspecting the isolated `node --test` invocation's TAP output for at least one `ok` line per Case A–D.

## Changed files expected
- `web/src/lib/chatRuntime/resolution.ts` — add `disambiguateDrivers` resolver entrypoint and supporting logic.
- `web/src/lib/chatRuntime.ts` — refactor the `driverRows`→`driverCandidates` block (~lines 1291-1320) to call `disambiguateDrivers`; extend the `forceDriverClarification` condition at ~line 1280 to OR-in non-empty `ambiguousSurnames` when no explicit driver number is present.
- `web/scripts/tests/resolver-disambiguation.test.mjs` — new deterministic test file at the resolver entrypoint.

(`web/package.json` is intentionally not in this list — it is unchanged. The existing `"test:grading": "node --test scripts/tests/*.test.mjs"` glob auto-discovers any new file under `web/scripts/tests/`.)

## Artifact paths
None (deterministic unit tests; no captured run artifact required).

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
# Wiring gate (round-3 High-2): prove chatRuntime.ts actually routes through
# disambiguateDrivers with the year arg, AND that the explicit-driver-number
# short-circuit is preserved. Pure grep — independent of the test file's
# behavior, so a green entrypoint test cannot mask an un-wired runtime.
grep -E 'disambiguateDrivers\(\s*driverRows\s*,[^)]*selectedSession\?\.year\s*\?\?\s*null' web/src/lib/chatRuntime.ts \
  || { echo "FAIL: chatRuntime.ts does not call disambiguateDrivers(driverRows, ..., selectedSession?.year ?? null)"; exit 1; }
grep -E 'explicitDriverNumbers\.length\s*>\s*0' web/src/lib/chatRuntime.ts \
  || { echo "FAIL: explicit-driver-number short-circuit removed or renamed"; exit 1; }
# Clarification-wiring gate (round-4 Medium-1): prove the runtime actually
# consumes `ambiguousSurnames` in the forceDriverClarification decision, not
# just the call signature of `disambiguateDrivers`. Without this, a green
# entrypoint test could still mask a silent pre-2024 bare-`Verstappen`
# misresolution if the ambiguity metadata is dropped on the way back into
# the runtime.
grep -E 'ambiguousSurnames' web/src/lib/chatRuntime.ts \
  || { echo "FAIL: chatRuntime.ts does not reference ambiguousSurnames"; exit 1; }
grep -E 'forceDriverClarification[^=;]*=[^;]*ambiguousSurnames|ambiguousSurnames[^;]*forceDriverClarification' web/src/lib/chatRuntime.ts \
  || { echo "FAIL: forceDriverClarification declaration does not consume ambiguousSurnames"; exit 1; }
# Discovery gate: prove the new test file is loaded and all four cases run.
# Complements the baseline-aware wrapper, which can exit 0 even if a new
# .test.mjs file is silently skipped (the grading harness's glob would
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
- [ ] `web/scripts/tests/resolver-disambiguation.test.mjs` exists and asserts at the **resolver entrypoint** (`disambiguateDrivers`), not just the score function. All four cases pass: Case A (bare-Verstappen + 2024+ → Max boosted to top of `scoredCandidates` with `bare_verstappen_2024_default`); Case B (bare-Verstappen + pre-2024 → `ambiguousSurnames` populated, both Verstappens still in `scoredCandidates`, no silent pick); Case C (explicit "max verstappen" → Max via `canonical_full_name_match`, no ambiguity); Case D (Q26 verbatim text + 2025 + 4-row fixture → BOTH #1 and #16 in `scoredCandidates`, proving comparison_analysis is preserved).
- [ ] **Wiring gate** (round-3 High-2): the two `grep` checks listed under Gate commands both succeed — proving `web/src/lib/chatRuntime.ts` actually calls `disambiguateDrivers(driverRows, ..., selectedSession?.year ?? null)` AND retains the `explicitDriverNumbers.length > 0` short-circuit. This signal is independent of the entrypoint test, so a green test cannot mask an un-wired runtime.
- [ ] **Clarification-wiring gate** (round-4 Medium-1): the two grep checks listed under Gate commands both succeed — proving `web/src/lib/chatRuntime.ts` references `ambiguousSurnames` AND that the `forceDriverClarification` declaration consumes it (e.g. `forceDriverClarification = (asksSpecificDriverClarification || ambiguousSurnames.length > 0) && explicitDriverNumbers.length === 0`). Without this, the entrypoint test (Case B) can pass while the runtime silently drops the metadata and still picks a single Verstappen for pre-2024 sessions.
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

- **Branch:** `slice/11-resolver-disambiguation-tightening`
- **Implementation commit:** filled in commit message body (single commit on top of plan-approved `7b3d396`).

### Changes

- `web/src/lib/chatRuntime/resolution.ts` — added exported `disambiguateDrivers(rows, normalizedMessage, sessionYear)` plus `DisambiguationResult` type. Implements the year-aware boost rule (`+5` on `driver_number === 1` with `bare_verstappen_2024_default` in `matchedOn` when bare "verstappen" appears with `sessionYear !== null && sessionYear >= 2024`) and the ambiguity-flagging rule (populate `ambiguousSurnames` when bare-verstappen + `sessionYear === null || sessionYear < 2024` and ≥2 rows match surname). Pure function — no DB / fetch / module-level state. `scoreDriverCandidate` retained and reused internally.
- `web/src/lib/chatRuntime.ts` — refactored the `driverRows`→`driverCandidates` block (~lines 1289-1320) to call `disambiguateDrivers(driverRows, normalizedMessage, selectedSession?.year ?? null)`. Caller still applies the existing `+30` `explicitDriverNumbers` boost, the `score > 0` filter, the `score`/`driver_number` sort, and the `.slice(0, 6)` cap, so `selectComparisonDriverNumbers` (`chatRuntime.ts:343`) still receives a multi-driver list. `forceDriverClarification` was relocated to immediately after the `disambiguateDrivers` call and rewritten as `(asksSpecificDriverClarification || ambiguousSurnames.length > 0) && explicitDriverNumbers.length === 0`, wiring ambiguity metadata into the existing clarification path. The `explicitDriverNumbers.length > 0` short-circuit at the original line is preserved verbatim. `SessionCandidate` gained `year: number | null` (sourced from `SessionResolutionRow.year`) so the resolver can pass it to `disambiguateDrivers`; `getSessionByKey` and the scored-session candidate constructor were both updated to populate it. The unused `scoreDriverCandidate` named import was removed; `disambiguateDrivers` was added in its place.
- `web/scripts/tests/resolver-disambiguation.test.mjs` — new deterministic Node test file using the existing `ts.transpileModule`/temp-dir pattern from `resolver-lru.test.mjs`. No DB / fetch / LLM. Asserts at the resolver entrypoint (`disambiguateDrivers`) for all four cases (A: bare-Verstappen + 2024 → Max top with `bare_verstappen_2024_default`; B: bare-Verstappen + 2003 → ambiguousSurnames populated, both Verstappens still in `scoredCandidates`, no boost stamped; C: explicit `max verstappen` + 2003 → Max via `canonical_full_name_match`, no ambiguity; D: Q26 verbatim text + 2025 + 4-row fixture → Max #1 and Charles #16 both in `scoredCandidates` top 4 with positive scores, no ambiguity).

### Decisions made during implementation

- **`SessionCandidate.year` propagation.** `selectedSession` is a `SessionCandidate`, not a raw `SessionResolutionRow`, so I added a `year: number | null` field to `SessionCandidate` and populated it from `row.year ?? null` in both construction sites (the explicit-session-key path and the scored-session loop). This is the minimal way to fulfil the planned `selectedSession?.year ?? null` argument and stays within the slice's "Changed files expected" list (`web/src/lib/chatRuntime.ts`).
- **Single-line call sites for grep gates.** The wiring grep (`disambiguateDrivers\(\s*driverRows\s*,[^)]*selectedSession\?\.year\s*\?\?\s*null`) and the clarification grep (`forceDriverClarification[^=;]*=[^;]*ambiguousSurnames`) are line-based, so I kept both expressions on a single line each rather than wrapping for readability.
- **`scoredCandidates` filter.** Per the slice spec ("includes every row with `score > 0`"), `disambiguateDrivers` filters to score > 0 internally. The caller still re-applies its own `score > 0` filter after the explicit-driver-number boost — preserving the existing `driverCandidates` shape exactly.

### Gate exit codes

| Gate | Command | Exit |
|---|---|---|
| build | `cd web && npm run build` | 0 |
| typecheck | `cd web && npm run typecheck` | 0 |
| wiring grep 1 | `grep -E 'disambiguateDrivers\(\s*driverRows\s*,[^)]*selectedSession\?\.year\s*\?\?\s*null' web/src/lib/chatRuntime.ts` | 0 |
| wiring grep 2 | `grep -E 'explicitDriverNumbers\.length\s*>\s*0' web/src/lib/chatRuntime.ts` | 0 |
| clarification grep 1 | `grep -E 'ambiguousSurnames' web/src/lib/chatRuntime.ts` | 0 |
| clarification grep 2 | `grep -E 'forceDriverClarification[^=;]*=[^;]*ambiguousSurnames|ambiguousSurnames[^;]*forceDriverClarification' web/src/lib/chatRuntime.ts` | 0 |
| isolated test run | `cd web && node --test scripts/tests/resolver-disambiguation.test.mjs` | 0 (4 pass / 0 fail) |
| ok-line count gate | `grep -c '^ok ' /tmp/resolver-disamb-tap.txt` ≥ 4 | 4 |
| baseline-aware grading suite | `bash scripts/loop/test_grading_gate.sh` | 0 (`slice_fails=39 baseline_fails=39 baseline_failures_fixed=0` — no new regressions vs `scripts/loop/state/test_grading_baseline.txt`) |

### Self-checks

- **Acceptance criterion 1 (entrypoint test, all four cases pass):** TAP shows `ok 1` Case A, `ok 2` Case B, `ok 3` Case C, `ok 4` Case D in `/tmp/resolver-disamb-tap.txt`; `1..4`, `# pass 4`, `# fail 0`.
- **Acceptance criterion 2 (wiring gate):** both wiring greps emit a match on stdout and exit 0.
- **Acceptance criterion 3 (clarification-wiring gate):** both clarification greps emit a match on stdout and exit 0; the `forceDriverClarification` declaration literally reads `(asksSpecificDriverClarification || ambiguousSurnames.length > 0) && explicitDriverNumbers.length === 0`.
- **Acceptance criterion 4 (discovery gate):** isolated `node --test scripts/tests/resolver-disambiguation.test.mjs` exits 0 with 4 ok-lines, proving the new file is loadable and not silently skipped.
- **Acceptance criterion 5 (grading suite no new failures):** `test_grading_gate.sh` reports `slice_fails=39 baseline_fails=39 baseline_failures_fixed=0` — pre-existing baseline failures preserved, no new regressions.
- **Acceptance criterion 6 (typecheck + build):** both exit 0.
- **Out-of-scope check:** diff touches only the three files listed under "Changed files expected" plus the slice file's frontmatter and completion note. `web/package.json` is unchanged; the new test is auto-discovered by the existing `scripts/tests/*.test.mjs` glob (verified by `npm run test:grading` running through `test_grading_gate.sh`).

### Re-verification (round 1, 2026-05-01T14:20:35-04:00)

The round-1 audit returned REVISE solely on `npm run typecheck` exit 2 (TS6053 missing `.next/types/...`). The implementation code at commit `6f2729b` was unchanged; only the slice markdown was modified by the audit commit `a8d91ca`. The auditor's typecheck failure was an environmental artifact: TS6053 fires when `.next/types/**/*.ts` (matched by `web/tsconfig.json:23`) is absent, and that directory is generated by `npm run build`. The slice's gate command block runs `npm run build` before `npm run typecheck`, so when executed in declared order in this worktree all gates pass:

| Gate | Command | Exit |
|---|---|---|
| build | `cd web && npm run build` | 0 |
| typecheck | `cd web && npm run typecheck` | 0 |
| wiring grep 1 | `grep -E 'disambiguateDrivers\(\s*driverRows\s*,[^)]*selectedSession\?\.year\s*\?\?\s*null' web/src/lib/chatRuntime.ts` | 0 |
| wiring grep 2 | `grep -E 'explicitDriverNumbers\.length\s*>\s*0' web/src/lib/chatRuntime.ts` | 0 |
| clarification grep 1 | `grep -E 'ambiguousSurnames' web/src/lib/chatRuntime.ts` | 0 |
| clarification grep 2 | `grep -E 'forceDriverClarification[^=;]*=[^;]*ambiguousSurnames\|ambiguousSurnames[^;]*forceDriverClarification' web/src/lib/chatRuntime.ts` | 0 |
| isolated test run | `cd web && node --test scripts/tests/resolver-disambiguation.test.mjs` | 0 (4 pass / 0 fail) |
| ok-line count gate | `grep -c '^ok ' /tmp/resolver-disamb-tap.txt` ≥ 4 | 4 |
| baseline-aware grading suite | `bash scripts/loop/test_grading_gate.sh` | 0 (`slice_fails=39 baseline_fails=39 baseline_failures_fixed=0` — no new regressions vs baseline) |

No code changes were required for this revision; the implementation at `6f2729b` is correct. The auditor must run gates in the declared order (`build` then `typecheck`) for the typecheck gate to find `.next/types/`. After `cd web && npm run build` completes, `web/.next/types/` contains `app/`, `cache-life.d.ts`, `package.json`, `routes.d.ts`, `validator.ts` — verified locally before re-submission.

## Audit verdict

**Status: PASS**

- Gate 1 `cd web && npm run build` -> exit `0`
- Gate 2 `cd web && npm run typecheck` -> exit `0`
- Gate 3 wiring grep `disambiguateDrivers(... selectedSession?.year ?? null)` -> exit `0`
- Gate 4 wiring grep `explicitDriverNumbers.length > 0` -> exit `0`
- Gate 5 clarification grep `ambiguousSurnames` -> exit `0`
- Gate 6 clarification grep `forceDriverClarification ... ambiguousSurnames` -> exit `0`
- Gate 7 `cd web && node --test scripts/tests/resolver-disambiguation.test.mjs` -> exit `0`
- Gate 8 `grep -c '^ok ' /tmp/resolver-disamb-tap.txt` -> exit `0` (`4`)
- Gate 9 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
- Scope diff: PASS — `git diff --name-only integration/perf-roadmap...HEAD` is limited to `diagnostic/slices/11-resolver-disambiguation-tightening.md`, `web/scripts/tests/resolver-disambiguation.test.mjs`, `web/src/lib/chatRuntime.ts`, and `web/src/lib/chatRuntime/resolution.ts`
- Criterion resolver-entrypoint test exists and all four cases pass: PASS (`web/scripts/tests/resolver-disambiguation.test.mjs:78`, `web/scripts/tests/resolver-disambiguation.test.mjs:102`, `web/scripts/tests/resolver-disambiguation.test.mjs:138`, `web/scripts/tests/resolver-disambiguation.test.mjs:162`)
- Criterion wiring gate proves `chatRuntime.ts` calls `disambiguateDrivers(driverRows, ..., selectedSession?.year ?? null)` and preserves the explicit-driver-number short-circuit: PASS (`web/src/lib/chatRuntime.ts:1292`, `web/src/lib/chatRuntime.ts:1318`)
- Criterion clarification wiring consumes `ambiguousSurnames` in `forceDriverClarification`: PASS (`web/src/lib/chatRuntime.ts:1293`)
- Criterion discovery gate confirms the new test file loads and emits at least four TAP `ok` lines: PASS
- Criterion `bash scripts/loop/test_grading_gate.sh` reports no new failures vs baseline: PASS
- Criterion `cd web && npm run build` exits `0`: PASS
- Criterion `cd web && npm run typecheck` exits `0`: PASS
- Decision: PASS

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

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Redefine the `disambiguateDrivers` contract and step-3 wiring so comparison prompts keep enough scored driver candidates to select both drivers, because the proposed `{ resolved } | { ambiguous }` single-winner shape would collapse Q26-style "Max Verstappen and Charles Leclerc" queries to one driver and break `comparison_analysis`.
- [x] Add a deterministic acceptance signal that `web/src/lib/chatRuntime.ts` actually routes driver resolution through `disambiguateDrivers(..., selectedSession?.year ?? null)` while preserving the explicit-driver-number short-circuit, because the planned entrypoint-only test can pass even if the runtime never wires in the new year-aware helper.

### Medium
- [x] Align Case D with the cited artifact by using Q26's actual 2025 session year, not `sessionYear=2024`, so the regression test exercises the same year context as the rerun question it claims to replicate.

### Low
- [x] Remove `web/package.json` from `## Changed files expected` or move the auto-discovery note elsewhere, because the file is explicitly unchanged and should not appear in the expected diff scope.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T15:42:52Z`).

## Plan-audit verdict (round 4)

**Status: REVISE**

### High

### Medium
- [x] Add a gate/acceptance assertion that `ambiguousSurnames` is actually wired into the runtime clarification path in `web/src/lib/chatRuntime.ts`, because the current plan only proves `disambiguateDrivers(..., selectedSession?.year ?? null)` is called and that explicit-driver-number handling remains, so a green entrypoint test could still mask a silent pre-2024 bare-`Verstappen` misresolution if `forceDriverClarification` never consumes the ambiguity metadata.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T15:42:52Z`).

## Plan-audit verdict (round 5)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T15:42:52Z`).
