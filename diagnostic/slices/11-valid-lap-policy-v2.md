---
slice_id: 11-valid-lap-policy-v2
phase: 11
status: pending
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-05-01T13:53:28Z
---

## Goal
Refine the lap-validity policy that governs clean-lap analytics: improve handling of out-laps, in-laps, and SC laps (track-status flags). The policy lives in `core.valid_lap_policy` (default-row driven) and is materialized as the `is_valid` column on `core.laps_enriched`, both defined in `sql/006_semantic_lap_layer.sql`. Downstream summary contracts that depend on `is_valid` filtering are also in scope where the diagnosis shows their output is contaminated by an inadequate validity rule.

**Deleted-lap scope (per round-3 audit):** `raw.laps` exposes no `deleted` / `lap_deleted` column (`sql/002_create_tables.sql:57-77`) and `core.lap_context_summary` carries only per-lap-number aggregates (`sql/007_semantic_summary_contracts.sql:763-790`), so there is no source signal in this repo for "deleted laps." Deleted-lap handling is therefore **out of scope** for this slice. SC laps remain in scope: the `track_flag` column already projected onto `core.laps_enriched` from `raw.race_control` (`sql/006_semantic_lap_layer.sql:117-131,244` etc.) is the SC/SC-ending signal this slice may consult.

**Q30 scope clarification (per round-2 audit):** the 2026-04-30 rerun records Q30 as routed to deterministic template `max_leclerc_lap_pace_summary` (lap-pace), not to a sector-times template. That is a routing/template defect, not a lap-validity contamination, so this slice does **not** commit to lifting Q30. Q30 is held to a regression-only bar (must not drop below its current B grade) and the routing/template fix is handed off to a future slice.

## Inputs
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` (latest healthcheck baseline; supersedes the never-produced 2026-04-26 file).
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md` (per-question baseline-grade matrix and root-cause counts).
- `web/scripts/chat-health-check.questions.json` (canonical id → category mapping).

### Target question IDs (from `11-rerun_2026-04-30.json`)
- **No primary lift target.** The slice's measurable bar is "no regression on lap-policy-sensitive questions" (see regression-protection set below). Round-2 audit evidence — `generationNotes=template=max_leclerc_lap_pace_summary` for Q30 — shows Q30's B grade is caused by deterministic-template routing to a lap-pace template instead of a sector-times template, which is independent from the validity policy. Q30 is therefore demoted to regression-protection only; lifting Q30 requires a separate routing/template slice.
- **Regression-protection set (A in latest baseline, lap-policy-sensitive scope):**
  - Lap-pace and fastest-lap category — Q19–Q28 (10 questions, all currently A).
  - Head-to-head driver comparison category — Q29, Q31–Q37 (8 questions, all currently A).
- **Regression-protection (current B, must not drop further):** Q30 — held at its current B grade (i.e., gate 5 must not let Q30 drop to C/D). Lifting Q30 to A is **out of scope** because the proximate cause is template routing, not the validity policy.
- **Explicitly out of scope (B in latest baseline but unrelated to lap-validity policy — handled by a future Phase-11 slice):** Q2, Q10 from the "Session discovery and metadata" category. Their failure modes (Q2: row-cap truncation in a Race-vs-Quali-vs-Practice count; Q10: 50-row limit on partial-session listing) do not flow through `is_valid`/`core.valid_lap_policy`. Q30's routing/template defect is also out of scope and handed off to a future slice.

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/11-rerun-benchmark-baseline.md`
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json`
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md`
- `sql/006_semantic_lap_layer.sql` (current `core.valid_lap_policy` table + `core.laps_enriched.is_valid` derivation; lap-validity logic at roughly lines 50–110 for the policy table and lines 280–350 for the materialization).
- `sql/008_core_build_schema.sql` (`core` schema build; applies analogous out-lap/in-lap exclusions for the `core.laps_clean_*` view family — note: this is the actual filtered set, not the placeholder name `core.lap_clean` originally written into this slice).
- `web/src/lib/deterministicSql.ts`, `web/src/lib/deterministicSql/pace.ts` (client-side SQL templates that re-apply `is_pit_out_lap` filtering; need to remain consistent with any policy change).

## Required services / env
- `DATABASE_URL` (pooled, Phase 6 production env) — required for the SQL `psql` apply/parity steps and for the chat backend that the re-grade gate exercises.
- `ANTHROPIC_API_KEY` — required by `npm run healthcheck:chat` to grade answers.
- `OPENF1_CHAT_BASE_URL` pointed at a running web instance (default `http://127.0.0.1:3000`); start `npm run dev` (or equivalent) in `web/` before running the re-grade gate.

## Steps
1. Inspect the current `is_valid` rule (`core.valid_lap_policy` defaults + `is_valid` derivation in `sql/006_semantic_lap_layer.sql`) and enumerate the three in-scope target signals available in this repo: out-laps (`is_pit_out_lap`), in-laps (`is_pit_lap` / pit-stop on this lap), and SC laps (the `track_flag` column already projected from `raw.race_control` onto `core.laps_enriched` via the `race_control_at_lap` CTE in `sql/006_semantic_lap_layer.sql`). Deleted-lap handling is out of scope (no source column exists in `raw.laps`).
2. **Routing/template check first (Q30):** before treating Q30 as lap-validity contamination, confirm what the 2026-04-30 rerun already shows — Q30's `generationNotes` records `template=max_leclerc_lap_pace_summary` (a lap-pace template), not a sector-times template. Read the Q30 row in `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` and the routing logic in `web/src/lib/deterministicSql.ts` / `web/src/lib/deterministicSql/pace.ts` to verify the routing mismatch. If Q30 is failing because of routing/template selection (the documented case), do **not** modify the validity policy on Q30's behalf; record the finding in the slice-completion note and hand Q30 off to a future routing/template slice. Q30's grade is a regression-only check in gate 5 (must not drop below B).
3. **Lap-validity contamination check (independent of Q30):** for the lap-policy-sensitive contracts that drive Q19–Q29 and Q31–Q37, audit whether SC laps (via `track_flag`), in-laps, or out-laps slip past the current `is_valid` rule and contaminate aggregates. If contamination is found that risks regression (or that demonstrably degrades any of these answers in the rerun), update `sql/006_semantic_lap_layer.sql` (`core.valid_lap_policy` defaults and/or the `is_valid` boolean expression) accordingly. Mirror in `sql/008_core_build_schema.sql` only if the `core_build.laps_enriched` view's `is_valid` derivation (`sql/008_core_build_schema.sql:7-67`) carries the same defect. If no contamination is found that warrants a change, the slice may complete with **no SQL change** and only the slice-file/diagnosis updates committed (still subject to gate 5).
4. Always run gate 4 (the schema apply + re-materialization sequence in `## Gate commands`), regardless of whether step 3 produced SQL edits. The migrations are idempotent TRUNCATE+INSERT scripts (per `sql/010_laps_enriched_mat.sql:71-83`), so re-applying them when nothing changed is a safe no-op that still exits 0; this preserves a single, executable gate-4 behavior that matches the acceptance criterion. Apply `sql/006_semantic_lap_layer.sql` (and `sql/008_core_build_schema.sql` only if step 3 touched it), then re-materialize the dependent storage tables in dependency order. The actual refresh path is **TRUNCATE + INSERT** by re-applying the mat migration files, NOT `REFRESH MATERIALIZED VIEW` — `core.laps_enriched` is a CREATE-OR-REPLACE-VIEW facade over the heap table `core.laps_enriched_mat`, not a Postgres materialized view. The order is:
   1. `sql/010_laps_enriched_mat.sql` — repopulates `core.laps_enriched_mat` from the (now-updated) `core_build.laps_enriched` view.
   2. Downstream summary mats that filter by `is_valid` and feed Q19–Q37's deterministic templates: `sql/009_driver_session_summary_mat.sql`, `sql/011_stint_summary_mat.sql`, `sql/013_race_progression_summary_mat.sql`, `sql/017_lap_phase_summary_mat.sql`, `sql/018_lap_context_summary_mat.sql`.
5. Re-grade the lap-policy-sensitive question set (Q19–Q37) per gate 5 to verify regression-protection holds: Q19–Q29 and Q31–Q37 remain at A, and Q30 does not regress below B.
6. Record the diagnosis in the slice-completion note: which contamination class (if any) was fixed, and the explicit Q30 hand-off to a routing/template slice with its evidence (`generationNotes=template=max_leclerc_lap_pace_summary`).

## Changed files expected
- `sql/006_semantic_lap_layer.sql` — `core.valid_lap_policy` default row and/or the `is_valid` boolean expression on `core.laps_enriched`. Optional: omitted entirely if step 3 finds no contamination class warranting a policy change.
- `sql/008_core_build_schema.sql` — only if step 3's diagnosis shows the `core.laps_clean_*` view family carries the same defect.
- `web/src/lib/deterministicSql.ts` and/or `web/src/lib/deterministicSql/pace.ts` — only if the policy change requires the client-side SQL templates to drop or replace ad-hoc `is_pit_out_lap` filters. **NOT** to be edited for Q30 routing/template selection — that defect is out of scope and handed to a future slice.
- `diagnostic/slices/11-valid-lap-policy-v2.md` — this slice file (plan + slice-completion note); always touched.
- `diagnostic/artifacts/healthcheck/11-valid-lap-policy-v2_<date>.json` — re-grade artifact written by gate 5 (Q19–Q37 regression-protection re-grade output); always produced.

## Artifact paths
- `diagnostic/artifacts/healthcheck/11-valid-lap-policy-v2_<date>.json` — re-grade output from gate 5 (19-row subset: Q19–Q37, regression-protection only). No primary lift target; Q30 is held to a "must not regress below B" check, and Q19–Q29 + Q31–Q37 are held at A.

## Gate commands
```bash
# Gate 1 — build
cd web && npm run build

# Gate 2 — typecheck
cd web && npm run typecheck

# Gate 3 — test-grading wrapper (per loop audit protocol in diagnostic/_state.md)
bash scripts/loop/test_grading_gate.sh

# Gate 4 — apply the schema change(s) the slice touched, in dependency order, and
# re-materialize dependent storage tables. Skip migration files this slice did not
# modify; ALWAYS re-apply the mat files below when 006 or 008 changed, because the
# storage tables are repopulated by TRUNCATE + INSERT inside those migrations
# (see sql/010_laps_enriched_mat.sql:71-83). core.laps_enriched is a
# CREATE-OR-REPLACE-VIEW facade over core.laps_enriched_mat, not a Postgres
# materialized view, so REFRESH MATERIALIZED VIEW does NOT apply here.
psql "$DATABASE_URL" -f sql/006_semantic_lap_layer.sql
# Only if step 3 also touched the core build schema:
# psql "$DATABASE_URL" -f sql/008_core_build_schema.sql

# Re-materialize storage tables in dependency order (idempotent TRUNCATE+INSERT).
psql "$DATABASE_URL" -f sql/010_laps_enriched_mat.sql
psql "$DATABASE_URL" -f sql/009_driver_session_summary_mat.sql
psql "$DATABASE_URL" -f sql/011_stint_summary_mat.sql
psql "$DATABASE_URL" -f sql/013_race_progression_summary_mat.sql
psql "$DATABASE_URL" -f sql/017_lap_phase_summary_mat.sql
psql "$DATABASE_URL" -f sql/018_lap_context_summary_mat.sql

# Gate 5 — re-grade the lap-policy-sensitive question set (Q19–Q37) using a filtered
# questions file built from the canonical mapping. Acceptance: Q19–Q29 and Q31–Q37
# each remain A (no regression vs the 2026-04-30 baseline); Q30 must not regress
# below B (its current baseline grade — Q30's routing/template defect is OUT OF SCOPE
# and handed to a future slice).
SLICE_DATE=$(date -u +%Y-%m-%d)
TARGET_IDS="19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37"
node -e '
  const fs = require("fs");
  const path = require("path");
  const all = JSON.parse(fs.readFileSync("web/scripts/chat-health-check.questions.json", "utf8"));
  const ids = new Set(process.argv.slice(1).map(Number));
  const subset = all.filter(q => ids.has(Number(q.id)));
  if (subset.length !== ids.size) {
    console.error("missing ids in canonical questions file");
    process.exit(1);
  }
  fs.writeFileSync(
    "web/scripts/chat-health-check.questions.11-valid-lap-policy-v2.json",
    JSON.stringify(subset, null, 2) + "\n"
  );
' $TARGET_IDS
( cd web && npm run healthcheck:chat -- --questions scripts/chat-health-check.questions.11-valid-lap-policy-v2.json )
LATEST_JSON=$(ls -t web/logs/chat_health_check_*.json 2>/dev/null | grep -v '\.summary\.json$' | head -1)
test -n "$LATEST_JSON" || { echo "no raw chat_health_check_<stamp>.json produced"; exit 1; }
ARTIFACT="diagnostic/artifacts/healthcheck/11-valid-lap-policy-v2_${SLICE_DATE}.json"
cp "$LATEST_JSON" "$ARTIFACT"
node -e '
  const rows = require("./'"$ARTIFACT"'");
  if (!Array.isArray(rows)) { console.error("artifact is not an array"); process.exit(1); }
  const expected = new Set([19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37]);
  if (rows.length !== expected.size) { console.error("expected " + expected.size + " rows, got " + rows.length); process.exit(1); }
  // Grade ordering for "no regression" comparisons (higher index = better grade).
  const order = { F: 0, D: 1, C: 2, B: 3, A: 4 };
  const fails = [];
  for (const r of rows) {
    const id = Number(r.id);
    const grade = r.baselineGrade;
    if (!(grade in order)) { fails.push("Q" + id + " has unrecognized grade " + grade); continue; }
    if (id === 30) {
      // Q30: routing/template defect, out of scope. Must not drop below B (its 2026-04-30 baseline).
      if (order[grade] < order["B"]) fails.push("Q30 regressed below B (routing-defect baseline): got " + grade);
    } else {
      // Q19-Q29, Q31-Q37: regression-protection at A.
      if (grade !== "A") fails.push("Q" + id + " regressed: expected A, got " + grade);
    }
  }
  if (fails.length) { console.error(fails.join("\n")); process.exit(1); }
  console.log("OK: regression-protection set Q19-Q29 + Q31-Q37 remain at A, Q30 not regressed below B");
'
```

## Acceptance criteria
- [ ] Build (gate 1) and typecheck (gate 2) exit 0.
- [ ] `bash scripts/loop/test_grading_gate.sh` (gate 3) exits 0 (no new failures vs the loop baseline).
- [ ] Schema apply / materialized-view refresh (gate 4) exits 0 against the pooled `DATABASE_URL`. (If step 3 produced no SQL edits, gate 4 is a no-op `psql` re-apply of the unchanged file — still must exit 0.)
- [ ] Re-grade gate (gate 5) exits 0: regression-protection set Q19–Q29 and Q31–Q37 each remain at grade **A** in `diagnostic/artifacts/healthcheck/11-valid-lap-policy-v2_<date>.json` (no regression vs the 2026-04-30 baseline).
- [ ] Re-grade gate (gate 5) exits 0: Q30 does **not** regress below grade **B** in the same artifact. (Q30's lift to A is out of scope — handed off to a future routing/template slice.)
- [ ] Slice-completion note records the diagnosis: which contamination class (if any) was fixed by the policy change, and the explicit Q30 hand-off to a routing/template slice with the `generationNotes=template=max_leclerc_lap_pace_summary` evidence from the 2026-04-30 rerun.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace the missing input path `diagnostic/artifacts/healthcheck/11-rerun_2026-04-26.json` with an existing rerun artifact and name the exact failing question IDs/categories this slice will re-grade, because step 1 is blocked on a non-existent benchmark input.
- [x] Replace `core.lap_clean` with the actual existing contract or relation names this slice will change, because repo context already records `core.lap_clean` as a placeholder that does not exist.
- [x] Add an explicit gate command that re-grades the targeted question IDs and the same-category previously-passing IDs, and tie both acceptance checkboxes to that command, because the current gate block only runs build/typecheck/full grading tests and never exercises either acceptance criterion.

### Medium
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` per the loop audit protocol in `diagnostic/_state.md`.
- [x] Replace `Changed files expected: (determined by diagnosis)` with the concrete file families the implementer is expected to touch, including the contract/test artifacts implied by the plan, so scope can be audited before implementation starts.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T13:24:14Z`).

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Resolve the contradiction between step 6 and gate 5 / the acceptance criteria: if step 2 shows Q30 is unrelated to lap-validity and must be handed off unchanged, gate 5 cannot still require Q30 to grade `A` for this slice to pass.
- [x] Re-scope the slice or its success criterion for Q30 to match the actual prior-context evidence: `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` shows Q30 was answered by deterministic template `max_leclerc_lap_pace_summary` instead of the sector-times template, so a lap-validity-only slice cannot assume Q30 will lift to `A` without also planning the routing/template fix.

### Medium
- [x] Update step 2 so the diagnostic explicitly checks whether Q30 is failing because the wrong deterministic SQL template/routing path was selected before treating sector aggregates as contaminated by `is_valid`.
- [x] Expand `Changed files expected` if the slice is intended to fix the demonstrated Q30 routing/template defect, or otherwise remove deterministic-template-driven Q30 uplift from this slice’s acceptance target.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T13:24:14Z`).
- Prior-context evidence for the routing mismatch is in `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` (Q30 `generationNotes=template=max_leclerc_lap_pace_summary`; SQL aggregates lap pace, not sector summaries).

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Replace gate 4's `REFRESH MATERIALIZED VIEW CONCURRENTLY core.laps_enriched;` with the repo's actual refresh path for this contract graph: `core.laps_enriched` is a view facade over `core.laps_enriched_mat` (`sql/010_laps_enriched_mat.sql:12-13,71-83`), so the plan must name the executable re-materialization step(s) that repopulate `core.laps_enriched_mat` and any downstream summary mats the slice relies on before gate 5 re-grades.
- [x] Resolve the deleted-lap scope against real repository sources: `raw.laps` has no `deleted`/`lap_deleted` field (`sql/002_create_tables.sql:57-77`) and `core.lap_context_summary` exposes only per-lap-number aggregates (`sql/007_semantic_summary_contracts.sql:763-790`), so the slice must either remove deleted-lap handling from scope or name the actual source relation/column that can drive it.

### Medium
- [x] Fix the gate-5 artifact contract so its row-count and targeting language match the declared question set: the slice re-grades Q19-Q37 inclusive (19 IDs) with no primary lift target, but `## Artifact paths` still says `15-row subset` and calls Q30 the primary target.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T13:24:14Z`).
- Current validity-policy columns in `core.valid_lap_policy` / `core_build.laps_enriched.is_valid` cover pit-out, pit-in, sector-data, compound-known, and slick-compound checks, but no SC/deleted-lap toggles yet (`sql/006_semantic_lap_layer.sql:50-67,273-330`; `sql/008_core_build_schema.sql:7-63`).

## Plan-audit verdict (round 4)

**Status: REVISE**

### High

### Medium
- [x] Resolve the no-SQL-change path contradiction: step 4 says to skip DB apply/re-materialization entirely when step 3 makes no SQL edits, but the acceptance criteria still require gate 4 to run and describe it as a mandatory no-op re-apply; make the step, gate block, and acceptance text agree on one executable behavior.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T13:24:14Z`).

## Plan-audit verdict (round 5)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T13:24:14Z`).
