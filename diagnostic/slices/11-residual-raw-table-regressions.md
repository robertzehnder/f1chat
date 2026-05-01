---
slice_id: 11-residual-raw-table-regressions
phase: 11
status: blocked
owner: user
user_approval_required: no
created: 2026-04-26
updated: 2026-05-01T08:46:30-04:00
---

## Goal
Investigate the 3 residual non-A questions in the 2026-04-30 healthcheck rerun (Q2, Q10, Q30 — all baseline B in `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json`) to determine whether the chat path still hits raw `f1.*` tables instead of the Phase-3 `core.*` materialized contracts. If a raw-table hit is confirmed for any targeted ID, route that query through `core.*`. If diagnosis shows the cause is elsewhere (synthesis-quality, semantic-contract gap, or rubric noise — which is what the rerun's `root_cause_labels` already suggest), record the finding in the slice-completion note and exit without source changes.

## Inputs
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` — failing rows are **Q2**, **Q10**, **Q30** (all `baselineGrade: B`). Q30 carries `root_cause_labels: ["sector_summary_matches_metrics", "synthesis_contradiction"]`; Q2/Q10 carry `answer_grade_reason: "Answer quality gaps: non_generic_answer."` with no `raw_table_regression` label. The rerun's overall `Root causes (rerun)` line in the sibling `.md` already shows `raw_table_regression=0` (only `sector_summary_matches_metrics=1, synthesis_contradiction=1`), so a literal raw-table fix may turn out to be a no-op.
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md` — per-question delta vs the 2026-04-26 baseline; confirms Q2 and Q10 stayed at B and Q30 improved C→B but did not reach A.
- `web/scripts/chat-health-check.questions.json` — canonical id→category mapping. Q2 and Q10 are in **`Session discovery and metadata`**; Q30 is in **`Head-to-head driver comparison`**.

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/11-rerun-benchmark-baseline.md`

## Required services / env
- `DATABASE_URL` — pooled Phase-6 production env (same one used by `slice/11-rerun-benchmark-baseline`); required by the chat route's SQL execution path.
- `ANTHROPIC_API_KEY` — required by the LLM-graded healthcheck rubric (`web/scripts/chat-health-check.mjs` → `gradeHealthCheckResults`).
- A running web dev server reachable at `OPENF1_CHAT_BASE_URL` (default `http://127.0.0.1:3000`). Start `PORT=<port> npm run dev` in `web/` before the targeted re-grade gate; if port 3000 is held by another process, set `OPENF1_CHAT_BASE_URL=http://127.0.0.1:<port>` to match (precedent from `slice/11-rerun-benchmark-baseline`'s gate-4 note).

## Steps
1. Lock the targeted IDs from the input artifact: **Q2, Q10, Q30** (every row in `11-rerun_2026-04-30.json` whose `baselineGrade != "A"`). The deterministic command that re-derives them is:
   ```bash
   node -e '
     const rows = require("./diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json");
     console.log(rows.filter(r => r.baselineGrade !== "A").map(r => r.id).sort((a,b)=>a-b).join(","));
   '
   ```
   Sanity-check the IDs and their categories against `web/scripts/chat-health-check.questions.json` (Q2/Q10 → `Session discovery and metadata`; Q30 → `Head-to-head driver comparison`).
2. Diagnose root cause for each ID: read the row's `sql`, `baselineReason`, `answer_grade_reason`, and `root_cause_labels` in `11-rerun_2026-04-30.json`. Specifically check whether the executed SQL touches raw `f1.*` tables (regex `\bf1\.[a-z_]+\b`) or only `core.*` matviews. Branch on the result:
   - **If `f1.*` is hit** for a targeted ID → the slice's scope kicks in; proceed to Step 3.
   - **If only `core.*` is hit** for every targeted ID (the expected outcome given the rerun root-cause labels) → record the finding in the slice-completion note (one paragraph per ID citing the SQL excerpt and root-cause label) and skip Step 3. Step 4's targeted re-grade still runs; it is the gate that proves nothing regressed.
3. Apply the minimal fix routing the offending query through the Phase-3 `core.*` contract. The fix lives in one of these bounded locations (depending on which layer emitted the raw-table SQL):
   - SQL-prompt / generator: `web/src/lib/sqlGenerator/**` (or the equivalent module that owns the chat route's SQL emission).
   - Answer-synthesis layer: `web/src/lib/answerSynthesis/**`.
   - Question metadata: `web/scripts/chat-health-check.questions.json` (only if the question's `sessionKey` / hint forces a raw-table path — unlikely).
   No other source files should change. If diagnosis surfaces a fix outside this bounded set, stop and escalate by setting `status: blocked, owner: user`.
4. Re-grade just the targeted IDs **plus** every other ID in the same two categories (so the same-category regression check has a non-trivial denominator). The targeted re-grade is implemented as a subset questions JSON passed to `npm run healthcheck:chat -- --questions <path>`; see Gate commands.

## Changed files expected
At most one of these source paths is touched, and only if Step 2 confirms a raw-table hit:
- `web/src/lib/sqlGenerator/**` (SQL prompt or generator path), OR
- `web/src/lib/answerSynthesis/**` (answer-synthesis path), OR
- `web/scripts/chat-health-check.questions.json` (question metadata only — not expected; included for completeness because the question file is part of the chat path's input).

Plus, in every case (including the no-source-change finding outcome):
- `diagnostic/slices/11-residual-raw-table-regressions.md` — slice-completion note, frontmatter, and Decisions.

If diagnosis surfaces a needed change outside this set, the slice is blocked (see Step 3).

## Artifact paths
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` (existing input — **not** regenerated by this slice; the full benchmark rerun is the responsibility of `slice/11-rerun-benchmark-baseline`).

## Gate commands
```bash
# 1. Build / typecheck sanity (trivial pass when no source changes;
#    must still exit 0 even on the no-source-change branch).
cd web && npm run build
cd web && npm run typecheck

# 2. Test-grading gate via the loop wrapper. Raw `cd web && npm run
#    test:grading` is forbidden by the loop audit protocol per the
#    auditor note in diagnostic/_state.md.
bash scripts/loop/test_grading_gate.sh

# 3. Targeted re-grade gate. Builds a subset questions JSON containing
#    the targeted IDs (Q2, Q10, Q30) plus every other id in the same
#    two categories (`Session discovery and metadata` and
#    `Head-to-head driver comparison`), runs the healthcheck against
#    that subset, then asserts:
#      (a) Targeted IDs grade A or B.
#      (b) Same-category regression check: no id that was baselineGrade
#          A in 11-rerun_2026-04-30.json drops below A in this re-run.
#    Requires `PORT=<p> npm run dev` already running in web/ and
#    OPENF1_CHAT_BASE_URL / ANTHROPIC_API_KEY / DATABASE_URL exported.
SUBSET=/tmp/11-residual-subset.questions.json
node -e '
  const fs = require("fs");
  const all = JSON.parse(fs.readFileSync("web/scripts/chat-health-check.questions.json", "utf8"));
  const TARGET_IDS = new Set([2, 10, 30]);
  const TARGET_CATS = new Set([
    "Session discovery and metadata",
    "Head-to-head driver comparison"
  ]);
  const subset = all.filter(q => TARGET_IDS.has(q.id) || TARGET_CATS.has(q.category));
  const have = new Set(subset.map(q => q.id));
  for (const id of TARGET_IDS) {
    if (!have.has(id)) { console.error("subset missing targeted id " + id); process.exit(1); }
  }
  fs.writeFileSync(process.env.SUBSET, JSON.stringify(subset, null, 2));
  console.log("subset rows: " + subset.length);
' SUBSET="$SUBSET"
( cd web && npm run healthcheck:chat -- --questions "$SUBSET" )
LATEST_JSON=$(ls -t web/logs/chat_health_check_*.json 2>/dev/null \
  | grep -v '\.summary\.json$' | head -1)
test -n "$LATEST_JSON" || { echo "no raw chat_health_check_<stamp>.json produced"; exit 1; }
node -e '
  const rows = require("./" + process.env.LATEST_JSON);
  const prior = require("./diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json");
  const priorById = Object.fromEntries(prior.map(r => [Number(r.id), r]));
  const TARGET_IDS = new Set([2, 10, 30]);

  // Acceptance (a): targeted IDs grade A or B.
  const targetedFail = rows.filter(r => TARGET_IDS.has(Number(r.id))
    && !(r.baselineGrade === "A" || r.baselineGrade === "B"));
  if (targetedFail.length) {
    console.error("targeted ids failed A/B: "
      + targetedFail.map(r => r.id + "=" + r.baselineGrade).join(", "));
    process.exit(1);
  }

  // Acceptance (b): same-category regression check.
  // An id regresses if it was baselineGrade A in 11-rerun_2026-04-30.json
  // but is non-A in this re-run.
  const regressed = rows.filter(r => {
    const p = priorById[Number(r.id)];
    return p && p.baselineGrade === "A" && r.baselineGrade !== "A";
  });
  if (regressed.length) {
    console.error("same-category A->non-A regressions: "
      + regressed.map(r => r.id + " A->" + r.baselineGrade).join(", "));
    process.exit(1);
  }

  console.log("OK: targeted ids "
    + [...TARGET_IDS].sort((a,b)=>a-b).map(id => {
        const r = rows.find(x => Number(x.id) === id);
        return id + "=" + (r ? r.baselineGrade : "missing");
      }).join(", ")
    + "; no same-category A->non-A regression among "
    + rows.filter(r => priorById[Number(r.id)] && priorById[Number(r.id)].baselineGrade === "A").length
    + " previously-A ids.");
' LATEST_JSON="$LATEST_JSON"
```

## Acceptance criteria
- [ ] Targeted IDs **Q2, Q10, Q30** each grade **A or B** in the gate-3 targeted re-grade output.
- [ ] No question that was `baselineGrade: "A"` in `11-rerun_2026-04-30.json` and is in the same category as a targeted ID (`Session discovery and metadata` or `Head-to-head driver comparison`) drops below A in the gate-3 targeted re-grade.
- [ ] `bash scripts/loop/test_grading_gate.sh` (gate 2) exits 0.
- [ ] `cd web && npm run build` and `cd web && npm run typecheck` (gate 1) exit 0.

## Decisions
- The slice scope intentionally covers the **diagnose + minimal-fix-or-document** flow. The rerun's `root_cause_labels` already point at synthesis-quality (`sector_summary_matches_metrics`, `synthesis_contradiction`) and not raw-table hits, so the most likely outcome is "no source change, finding documented." The targeted re-grade gate is still the load-bearing acceptance signal in either branch.
- Per the auditor note in `diagnostic/_state.md` (slice 08-fact-contract-shape / 08-synthesis-payload-cutover), the test-grading gate must be invoked via `bash scripts/loop/test_grading_gate.sh`, not raw `npm run test:grading`. This slice complies.
- The targeted re-grade is LLM-graded and non-deterministic, so a single occurrence of A→B noise on a same-category previously-A id can fail gate 3 by chance. If that happens, re-run gate 3 once before treating the failure as a real regression; if it persists across two consecutive runs, treat it as a real regression and revise the fix or escalate.

## Out of scope
- Phase-3 contract redesign or new `core.*` matview creation.
- Raw-table → contract routing for IDs not in {Q2, Q10, Q30}.
- Re-running the full 50-question benchmark or producing a new `11-rerun_<date>.json` artifact (covered by `slice/11-rerun-benchmark-baseline`).
- Changes to the rubric (`web/scripts/chat-health-check.rubric.json`) or the grader (`web/scripts/chat-health-check-baseline.mjs`).

## Risk / rollback
Rollback: `git revert <commit>`. The targeted re-grade gate is LLM-graded; per Decisions, transient grading noise is handled by re-running the gate once, not by lowering the bar.

## Slice-completion note

Branch: `slice/11-residual-raw-table-regressions` (off `integration/perf-roadmap`, base `b02b150` plan-pass-with-deferred commit).

**Status: BLOCKED** — escalating to `owner: user` per slice Decisions. Acceptance criterion (a) passes in both gate-3 runs; acceptance criterion (b) fails persistently on Q7 (a same-category previously-A id). This slice is on the **no-source-change branch** of Step 2, so there is no "fix to revise" per the rerun-rule in Decisions; the only paths forward are out of slice scope.

### Step 1 — IDs locked
Re-derived from `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` exactly as the slice prescribes: targeted IDs are **Q2, Q10, Q30**. Categories cross-checked against `web/scripts/chat-health-check.questions.json`: Q2 and Q10 are `Session discovery and metadata`; Q30 is `Head-to-head driver comparison`. Subset of all questions in those two categories has 19 rows (Q1–Q10 plus Q29–Q37).

### Step 2 — Diagnosis (raw-table regex on each targeted row's `sql`)

For every targeted ID, the executed SQL touches **only `core.*` matviews**; the `\bf1\.[a-z_]+\b` regex matches **0** times in each row. Diagnostic command (run from worktree root):

```bash
node -e '
  const rows = require("./diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json");
  const TARGET_IDS = new Set([2, 10, 30]);
  const RAW = /\bf1\.[a-z_]+\b/g;
  for (const r of rows.filter(x => TARGET_IDS.has(Number(x.id)))) {
    const sql = r.sql || "";
    const matches = sql.match(RAW) || [];
    console.log("Q" + r.id, "raw_f1_hits=" + matches.length);
  }
'
# Output: Q2 raw_f1_hits=0 / Q10 raw_f1_hits=0 / Q30 raw_f1_hits=0
```

Per-ID findings:

- **Q2 — `Which sessions in the warehouse are Race vs Qualifying vs Practice?`** (category: `Session discovery and metadata`). SQL is a single `SELECT … FROM core.sessions ORDER BY session_type, year, date_start LIMIT 200` with a `CASE WHEN LOWER(session_name) LIKE '%race%' …` classifier and `COUNT(*) OVER (PARTITION BY …)` window. No `f1.*` tables. Prior `answer_grade_reason: "Answer quality gaps: non_generic_answer."` and empty `root_cause_labels`. The B grade is therefore an answer-synthesis quality / rubric-genericity issue, not a raw-table regression. **No source change required by this slice.**
- **Q10 — `Which sessions appear to be partially loaded or placeholder sessions?`** (category: `Session discovery and metadata`). SQL is `SELECT … FROM core.sessions s WHERE s.meeting_name IS NULL OR s.meeting_name = '' OR …`, computing `missing_fields` and `missing_field_count`. Only `core.sessions`. No `f1.*` tables. Prior `answer_grade_reason: "Answer quality gaps: non_generic_answer."` and empty `root_cause_labels`. Same conclusion as Q2: synthesis-quality / rubric-genericity, not raw-table. **No source change required by this slice.**
- **Q30 — `Compare Max Verstappen and Charles Leclerc on sector times in the Abu Dhabi 2025 race session.`** (category: `Head-to-head driver comparison`). SQL is a `WITH lap_data AS (SELECT … FROM core.laps_enriched l LEFT JOIN core.session_drivers d …) SELECT driver_number, full_name, COUNT(*), MIN/AVG/MEDIAN/STDDEV…`. Only `core.laps_enriched` + `core.session_drivers`. No `f1.*` tables. Prior `answer_grade_reason: "Answer quality gaps: sector_summary_matches_metrics."` and `root_cause_labels: ["sector_summary_matches_metrics","synthesis_contradiction"]`. The B grade is a synthesis-quality issue (sector summary text disagreeing with the per-sector metrics rendered alongside it), not a raw-table regression. **No source change required by this slice.**

Step 2's branch (only-`core.*` for every targeted ID) was therefore taken: no source files modified.

### Step 3 — Skipped per Step 2's branch
No SQL-prompt / answer-synthesis / question-metadata change.

### Step 4 — Targeted re-grade (gate 3) — both consecutive runs

Subset built deterministically: 19 rows (every question in `Session discovery and metadata` ∪ `Head-to-head driver comparison`, which already includes the three targeted IDs). The shell variable `SUBSET` was passed via env-prefix `SUBSET=… node -e …` rather than the trailing `node -e '…' SUBSET="$SUBSET"` form that the slice's gate command literally writes — bash treats the trailing `VAR=val` after a command as positional argv, not as an env assignment, so without the prefix `process.env.SUBSET` is undefined and `fs.writeFileSync` throws. Same intent, same `SUBSET` value (`/tmp/11-residual-subset.questions.json`); only the shell-level invocation is corrected. Flagging here so the auditor can decide whether the plan literal needs a typo-fix in a follow-up.

Run 1 raw output: `web/logs/chat_health_check_2026-05-01T12-40-11-978Z.json`. Run 2 raw output: `web/logs/chat_health_check_2026-05-01T12-41-40-786Z.json`.

| ID | Category | Prior (`11-rerun_2026-04-30.json`) | Run 1 | Run 2 |
|---:|---|---|---|---|
| Q2  | Session discovery and metadata    | B (targeted) | **A** | **A** |
| Q10 | Session discovery and metadata    | B (targeted) | **B** | **B** |
| Q30 | Head-to-head driver comparison    | B (targeted) | **B** | **B** |
| Q5  | Session discovery and metadata    | A            | B (regressed) | A (recovered) |
| Q7  | Session discovery and metadata    | A            | B (regressed) | B (still regressed) |

Acceptance (a): targeted IDs grade A or B in **both** runs (Q2 actually improved A; Q10/Q30 stayed B). PASS.

Acceptance (b): same-category previously-A regression check.
- Run 1: 2 A→B regressions (Q5, Q7), both with `Answer quality gaps: non_generic_answer.`.
- Run 2: 1 A→B regression (Q7), same `non_generic_answer` reason.

Per slice Decisions: "if it persists across two consecutive runs, treat it as a real regression and revise the fix or escalate." Q5 did not persist (it recovered to A in run 2 — classic LLM-grading variance). Q7 **persisted across both consecutive runs**, so per the rule it must be treated as a real regression.

### Why this slice cannot fix Q7 in scope

1. Step 2's diagnosis branch is the no-source-change branch (no `f1.*` tables for any targeted ID, so no routing fix to apply).
2. Q7 is **not a targeted ID** of this slice — it is a same-category previously-A control row. The slice's `## Out of scope` explicitly excludes "Raw-table → contract routing for IDs not in {Q2, Q10, Q30}".
3. Q7's failure mode (`non_generic_answer` rubric quality gap) is the same one that produced Q2/Q10's B grades in the prior rerun. The prior slice (`slice/11-rerun-benchmark-baseline`, commit `ff9262a`) already documented Q7 as the single per-question regression vs the 2026-04-26 baseline ("Q7 A→B; baseline-grade dimension"), confirming Q7 sits structurally on the rubric's A/B boundary independent of raw-table routing.
4. Tightening the rubric or the answer-synthesis genericity check is also explicitly out of scope ("Changes to the rubric (`web/scripts/chat-health-check.rubric.json`) or the grader (`web/scripts/chat-health-check-baseline.mjs`)"), and the chat path itself produced no `f1.*` SQL for Q7's category in either run, so an in-scope rerouting change has nothing to land on.

### Escalation recommendation (for the user)

The user has three reasonable paths; this slice cannot pick one without violating its declared scope:

a. **Accept noise + override.** Issue an impl-audit PASS-WITH-DEFERRED noting Q7 is a known fragile A/B-boundary answer (already documented in `slice/11-rerun-benchmark-baseline`'s completion note) and that the no-source-change diagnosis is itself the correct outcome of this slice. The chat path is already on `core.*` for all targeted IDs and for Q7.
b. **Open a follow-up rubric-tightening slice** that is explicitly scoped to either (i) tighten the `non_generic_answer` quality gap so it does not flap on Q7-shaped marginal answers, or (ii) tighten Q7's expected-answer pattern. Both paths touch `web/scripts/chat-health-check.rubric.json`, which this slice's Out-of-scope list excludes.
c. **Open a follow-up answer-synthesis slice** that strengthens the `Session discovery and metadata` synthesis prompt to consistently produce non-generic answers — addresses Q2, Q10, and Q7 simultaneously. Touches `web/src/lib/answerSynthesis/**` (in *that* hypothetical slice's scope, not this slice's).

### Gate command exit codes

| Gate | Command | Exit code |
|---|---|---:|
| 1a | `cd web && npm run build` | 0 |
| 1b | `cd web && npm run typecheck` | 0 |
| 2  | `bash scripts/loop/test_grading_gate.sh` | 0 (`slice_fails=39 baseline_fails=39 baseline_failures_fixed=0`) |
| 3-prep-r1 | subset JSON build (`SUBSET=/tmp/11-residual-subset.questions.json node -e '…'`) | 0 (`subset rows: 19`) |
| 3-hc-r1   | `( cd web && OPENF1_CHAT_BASE_URL=http://127.0.0.1:3001 npm run healthcheck:chat -- --questions "$SUBSET" )` (run 1; `PORT=3001 npm run dev` running in `web/` because port 3000 was held by an unrelated Vite process — same precedent as `slice/11-rerun-benchmark-baseline`) | 0 (raw `web/logs/chat_health_check_2026-05-01T12-40-11-978Z.json`) |
| 3-assert-r1 | targeted+regression node assertion (run 1) | **1** (`same-category A->non-A regressions: 5 A->B, 7 A->B`) |
| 3-hc-r2   | rerun per Decisions | 0 (raw `web/logs/chat_health_check_2026-05-01T12-41-40-786Z.json`) |
| 3-assert-r2 | targeted+regression node assertion (run 2) | **1** (`same-category A->non-A regressions: 7 A->B`) |

### Self-check vs acceptance criteria

- [x] Targeted IDs Q2, Q10, Q30 each grade A or B in the gate-3 targeted re-grade — PASS in **both** runs (Q2=A/A, Q10=B/B, Q30=B/B).
- [ ] No question that was `baselineGrade: "A"` in `11-rerun_2026-04-30.json` and is in the same category as a targeted ID drops below A in the gate-3 targeted re-grade — **FAIL**: Q7 (`Session discovery and metadata`) regressed A→B in both consecutive runs. Per slice Decisions, this is treated as a real regression. The slice's no-source-change branch leaves no in-scope fix to apply, so the slice escalates rather than declares pass.
- [x] `bash scripts/loop/test_grading_gate.sh` (gate 2) exits 0.
- [x] `cd web && npm run build` and `cd web && npm run typecheck` (gate 1) exit 0.

### Files changed
- `diagnostic/slices/11-residual-raw-table-regressions.md` — frontmatter (`status: blocked`, `owner: user`, `updated: 2026-05-01T08:46:30-04:00`) and this Slice-completion note. No source files touched.

Commit hash:
- (to be filled by the commit step below)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh`, or declare an isolated grading gate that exits 0 for only the targeted questions plus the same-category regression set, because raw `npm run test:grading` violates the loop audit protocol and does not prove the slice-local acceptance criteria.
- [x] Add an explicit gate command that re-grades the targeted failing question IDs and a second explicit gate that checks previously-passing questions in the same category still pass, because the current gate block contains only repo-wide build/typecheck/grading commands and never tests either acceptance criterion directly.

### Medium
- [x] Replace `Specific failing question IDs from that artifact` with the concrete question IDs or a deterministic command/path that derives them, so the slice scope is auditable and step 1 is reproducible.
- [x] Update `## Required services / env` to list every prerequisite needed to diagnose and re-grade chat questions, including the DB/web/API env and any required running service, because `None at author time.` conflicts with the planned grading workflow.
- [x] Replace `Changed files expected: (determined by diagnosis)` with the minimum expected file set or an explicit bounded pattern, because the current scope declaration is too open-ended for a plan that intends to route queries off raw `f1.*` tables.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T03:00:31Z`).

## Plan-audit verdict (round 2, manual PASS-WITH-DEFERRED)

**Status: PASS-WITH-DEFERRED**
**Auditor: user (manual override after codex API instability blocked round-2 audit)**

### High
_None._

### Medium
_None._ Round-1 codex audit's High/Medium items (test-grading wrapper, targeted + same-category regression gates, concrete failing IDs Q2/Q10/Q30, full env prerequisites, bounded changed-files pattern) were all addressed by `c8bec1b plan-revise: address round-1 audit items` and re-verifiable by reading the current slice body.

### Low
_None._

### Notes (informational only — no action)
- Round-2 codex plan-audit was attempted 5 times between 00:10:10 and 01:24:43 EDT 2026-05-01: 4 watchdog kills (etime 596–1074s, well over 180s baseline) and 2 codex non-zero exits (rc=1) at ~18 min runtime. Round-1 succeeded immediately after the cooldown lifted (23:54:07), so the slice content itself is not the trigger; codex API appears intermittently unstable for round-2 audits on this slice. Manual override unblocks the loop without rolling back the (sound) round-1 revisions.
- Implementation may proceed under owner=claude. If codex impl-audit also exhibits instability, fall back to PASS-WITH-DEFERRED on impl as well or surface to user.
