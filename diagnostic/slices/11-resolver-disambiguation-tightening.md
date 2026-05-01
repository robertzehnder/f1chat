---
slice_id: 11-resolver-disambiguation-tightening
phase: 11
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-05-01T13:49:17-04:00
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
1. Identify the resolver-disambiguation surface area in `web/src/lib/chatRuntime/resolution.ts` (the `containsWholePhrase(... "max verstappen") && row.driver_number === 1` branch and surrounding scoring at the file's `scoreDriverRow`/equivalent function). Confirm that "Verstappen" alone (without "max") falls through to surname-only matching.
2. Tighten the disambiguation rules so that:
   - A bare-"verstappen" mention with no first name and a session whose `year >= 2024` resolves to Max Verstappen (driver_number 1) when Max is in the session roster.
   - A bare-"verstappen" mention in a session whose `year < 2024` does not auto-prefer Max; it returns the candidate set with explicit ambiguity rather than silently picking one.
   - Explicit "max verstappen" continues to score uniquely highest (existing behavior preserved).
3. Add a deterministic Node test file `web/scripts/tests/resolver-disambiguation.test.mjs` covering the three cases above plus a regression case for the historical Q26 phrasing (which already names "Max Verstappen" explicitly — the regression assertion is that Max still wins by a wide score margin and `matchedOn` includes `canonical_full_name_match`). Tests construct the candidate rows in-memory and call the scoring function directly; no DB / fetch / LLM.
4. Wire the new test into `web/package.json`'s `test:grading` script (or the umbrella runner that `test:grading` invokes — discover during implementation; do not duplicate harness).
5. Run the gates listed below and confirm green.

## Changed files expected
- `web/src/lib/chatRuntime/resolution.ts` — disambiguation logic edits.
- `web/scripts/tests/resolver-disambiguation.test.mjs` — new deterministic test file.
- `web/package.json` — only if `test:grading` does not auto-discover `web/scripts/tests/*.test.mjs`; otherwise unchanged.

## Artifact paths
None (deterministic unit tests; no captured run artifact required).

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
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
# 4. Assert Q26 baseline grade is A or B (rerun JSON is the latest under web/logs/):
python3 -c "import json,glob,os; f=max(glob.glob('web/logs/chat-health-check-*.json'), key=os.path.getmtime); rows=json.load(open(f)); r=next(x for x in rows if x['id']==26); g=r.get('baseline_grade'); print('Q26 grade:', g); assert g in ('A','B'), g"
```

## Acceptance criteria
- [ ] `web/scripts/tests/resolver-disambiguation.test.mjs` exists and is invoked by `bash scripts/loop/test_grading_gate.sh`; all four cases (bare-Verstappen 2024+, bare-Verstappen pre-2024, explicit "max verstappen", Q26-phrasing regression) pass.
- [ ] `bash scripts/loop/test_grading_gate.sh` reports no NEW failures vs the baseline at `scripts/loop/state/test_grading_baseline.txt`. Pre-existing baseline failures (e.g. `driver-fallback.test.mjs` Cases A/B/E) are not regressions.
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
- [ ] Replace the load-bearing "call the scoring function directly" test plan with at least one deterministic test at the resolver entrypoint that proves a bare `Verstappen` query in a pre-2024 session returns an explicit ambiguity result rather than silently selecting a driver, because score-only assertions do not verify the resolver-level behavior promised in Step 2 and the Goal.

### Medium
- [ ] Add an explicit gate assertion that the new resolver-disambiguation test is actually discovered and executed by the `bash scripts/loop/test_grading_gate.sh` path, because the baseline-aware wrapper can still exit 0 if the new `.test.mjs` file is never wired into the grading harness.
- [ ] Fix the optional live-regrade grade assertion to use the current healthcheck row schema (`baselineGrade`, or a schema-agnostic fallback) instead of only `baseline_grade`, because the documented operator procedure should not fail on the repo's current artifact shape.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T15:42:52Z`).
