---
slice_id: 11-valid-lap-policy-v2
phase: 11
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-05-01T14:30:00-04:00
---

## Goal
Refine the lap-validity policy that governs clean-lap analytics: improve handling of out-laps, in-laps, SC laps, and deleted laps. The policy lives in `core.valid_lap_policy` (default-row driven) and is materialized as the `is_valid` column on `core.laps_enriched`, both defined in `sql/006_semantic_lap_layer.sql`. Downstream summary contracts that depend on `is_valid` filtering are also in scope where the diagnosis shows their output is contaminated by an inadequate validity rule.

## Inputs
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.json` (latest healthcheck baseline; supersedes the never-produced 2026-04-26 file).
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-30.md` (per-question baseline-grade matrix and root-cause counts).
- `web/scripts/chat-health-check.questions.json` (canonical id → category mapping).

### Target question IDs (from `11-rerun_2026-04-30.json`)
- **Primary lap-policy target (B in latest baseline):** Q30 — "Compare Max Verstappen and Charles Leclerc on sector times in the Abu Dhabi 2025 race session." Root cause logged in the rerun .md: `sector_summary_matches_metrics` — the sector-summary contract that drives this answer is filtered by `core.laps_enriched.is_valid`, so an inadequate validity rule (e.g. failing to exclude SC/deleted laps from sector aggregates) is a plausible source.
- **Regression-protection set (A in latest baseline, same lap-policy-sensitive scope):**
  - Lap-pace and fastest-lap category — Q19–Q28 (10 questions, all currently A).
  - Head-to-head driver comparison category — Q29, Q31–Q37 (8 questions, all currently A; Q30 itself is the primary target above).
- **Explicitly out of scope (B in latest baseline but unrelated to lap-validity policy — handled by a future Phase-11 slice):** Q2, Q10 from the "Session discovery and metadata" category. Their failure modes (Q2: row-cap truncation in a Race-vs-Quali-vs-Practice count; Q10: 50-row limit on partial-session listing) do not flow through `is_valid`/`core.valid_lap_policy`.

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
1. Inspect the current `is_valid` rule (`core.valid_lap_policy` defaults + `is_valid` derivation in `sql/006_semantic_lap_layer.sql`) and enumerate the four target signals: out-laps (`is_pit_out_lap`), in-laps (`is_pit_lap` / pit-stop on this lap), SC laps (track-status / safety-car flag), deleted laps (any `deleted` / `lap_deleted` / sanity-band flag carried in `raw.laps` or available via the lap-context summary).
2. Diagnose Q30 against the rerun answer: confirm whether the sector-summary contract feeding the answer is filtered by `is_valid` and whether its sector aggregates are being polluted by SC/deleted/out-of-band laps. Pull the per-driver rerun answer text from `11-rerun_2026-04-30.json` and compare against the raw sector data to identify the contamination class.
3. Update `sql/006_semantic_lap_layer.sql` (`core.valid_lap_policy` defaults and/or the `is_valid` boolean expression) so the policy correctly excludes the diagnosed contamination class. Mirror the change in `sql/008_core_build_schema.sql` if and only if the diagnosis shows the `core` schema's lap-clean view family carries the same defect.
4. Apply the schema change to the dev DB (`psql "$DATABASE_URL" -f sql/006_semantic_lap_layer.sql` and, if touched, `sql/008_core_build_schema.sql`), then refresh the dependent materializations.
5. Re-grade the slice's targeted questions and the same-category regression-protection set (see Gate commands gate 5) to verify Q30 lifts to A and Q19–Q28 / Q29 / Q31–Q37 remain A.
6. If diagnosis in step 2 shows Q30 is unrelated to lap-validity (e.g. it is a pure synthesis-formatter bug), record that finding in the slice-completion note, leave the policy unchanged, and explicitly hand Q30 off to a future slice — but still execute gate 5 to prove no regression.

## Changed files expected
- `sql/006_semantic_lap_layer.sql` — `core.valid_lap_policy` default row and/or the `is_valid` boolean expression on `core.laps_enriched`.
- `sql/008_core_build_schema.sql` — only if step 3's diagnosis shows the `core.laps_clean_*` view family carries the same defect.
- `web/src/lib/deterministicSql.ts` and/or `web/src/lib/deterministicSql/pace.ts` — only if the policy change requires the client-side SQL templates to drop or replace ad-hoc `is_pit_out_lap` filters.
- `diagnostic/slices/11-valid-lap-policy-v2.md` — this slice file (plan + slice-completion note).
- `diagnostic/artifacts/healthcheck/11-valid-lap-policy-v2_<date>.json` — re-grade artifact written by gate 5 (target-set + regression-protection-set re-grade output).

## Artifact paths
- `diagnostic/artifacts/healthcheck/11-valid-lap-policy-v2_<date>.json` — re-grade output from gate 5 (15-row subset: Q19–Q37; Q30 is the primary target, the rest are regression protection).

## Gate commands
```bash
# Gate 1 — build
cd web && npm run build

# Gate 2 — typecheck
cd web && npm run typecheck

# Gate 3 — test-grading wrapper (per loop audit protocol in diagnostic/_state.md)
bash scripts/loop/test_grading_gate.sh

# Gate 4 — apply the schema change(s) the slice touched, in dependency order, and
# refresh dependent materializations. Skip files this slice did not modify.
psql "$DATABASE_URL" -f sql/006_semantic_lap_layer.sql
# Only if step 3 also touched the core build schema:
# psql "$DATABASE_URL" -f sql/008_core_build_schema.sql
psql "$DATABASE_URL" -c "REFRESH MATERIALIZED VIEW CONCURRENTLY core.laps_enriched;"

# Gate 5 — re-grade the target question (Q30) and the same-category regression-protection
# set (Q19–Q29, Q31–Q37) using a filtered questions file built from the canonical mapping.
# Acceptance: Q30 grades A; Q19–Q29 and Q31–Q37 each grade A (no regression).
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
  const fails = [];
  for (const r of rows) {
    const id = Number(r.id);
    const grade = r.baselineGrade;
    if (id === 30) {
      if (grade !== "A") fails.push("Q30 expected A (target lift), got " + grade);
    } else {
      if (grade !== "A") fails.push("Q" + id + " regressed: expected A, got " + grade);
    }
  }
  if (fails.length) { console.error(fails.join("\n")); process.exit(1); }
  console.log("OK: Q30 lifted to A and regression-protection set unchanged at A");
'
```

## Acceptance criteria
- [ ] Build (gate 1) and typecheck (gate 2) exit 0.
- [ ] `bash scripts/loop/test_grading_gate.sh` (gate 3) exits 0 (no new failures vs the loop baseline).
- [ ] Schema apply / materialized-view refresh (gate 4) exits 0 against the pooled `DATABASE_URL`.
- [ ] Re-grade gate (gate 5) exits 0: target ID **Q30 grades A** in `diagnostic/artifacts/healthcheck/11-valid-lap-policy-v2_<date>.json`.
- [ ] Re-grade gate (gate 5) exits 0: regression-protection set Q19–Q29 and Q31–Q37 each remain at grade **A** in the same artifact (no regression vs the 2026-04-30 baseline).

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
