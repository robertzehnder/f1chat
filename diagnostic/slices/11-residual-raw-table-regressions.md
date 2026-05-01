---
slice_id: 11-residual-raw-table-regressions
phase: 11
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T22:30:00-04:00
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
(filled by Claude)

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
