# Phase 19 — Broadcast-Style Analytics Capability Plan — 2026-05-02 (rev8. 2026-05-02 post-audit-8)

## Revision 8 (2026-05-02 post-audit-8)

A eighth audit caught one low:

1. **Low — Phase 23 had no concrete slice ids.** rev7's seed contract
   requires all 40 ids to be enumerable, but Phase 23 was still
   described only as "six dashboard surfaces" without naming them.
   Since the unknown-id check is exact, a question with
   `floor_active_after_slice: "23-track-dominance-map"` would have
   tripped fail-fast even after rev7. rev8 enumerates the six
   `23-*` slice ids in Phase 23's section AND extends the rev7
   seed step to list them explicitly:
   - `23-track-dominance-map`
   - `23-corner-analysis-page`
   - `23-stint-degradation-chart`
   - `23-driver-performance-card`
   - `23-battle-replay`
   - `23-strategy-simulator`

   Each carries a `depends_on` row so the seed registry can be
   generated mechanically from the plan tables.

No open questions remain at rev8.

# Phase 19 — Broadcast-Style Analytics Capability Plan — 2026-05-02 (rev7. 2026-05-02 post-audit-7)

## Revision 7 (2026-05-02 post-audit-7)

A seventh audit caught one medium and one low:

1. **Medium — `column_match_waiver` / `author_note` missing from
   the emit/allow-list contract.** rev6 added the fields to the
   question schema but didn't extend the emit-path projection
   (`chat-health-check.mjs:165`) or the grader allow-list
   (`chat-health-check-baseline.mjs:1116`) to forward them. Since
   `kind: "skipped"` decisions depend on the waiver being visible
   to the gate AND the gate's exit summary, the fields must
   survive into graded JSON. rev7 adds both to the projection
   and allow-list, and extends the "survives into graded JSON"
   unit fixture to assert each one appears.
2. **Low — `slices_status.json` seeding scope inconsistent.**
   rev6 said "seed Phase 21/22/23 IDs" but the slice-budget table
   actually totals 40 across all phases (Phase 19 + 20 + 21 + 22 +
   23). Phase 21/22/23 alone is 33. Because the unknown-id check
   fails fast, the seed list must be exact. rev7 widens the seed
   scope to **all 40 slice ids** (Phase 19-A through 23-*) so any
   `floor_active_after_slice` reference — including a question
   that defers to a Phase 19 or 20 slice — passes the rev5
   validation. The seed list is generated mechanically from the
   plan's slice tables and committed as part of Slice 19-D.

No open questions remain at rev7.

# Phase 19 — Broadcast-Style Analytics Capability Plan — 2026-05-02 (rev6. 2026-05-02 post-audit-6)

## Revision 6 (2026-05-02 post-audit-6)

A sixth audit caught one medium and two low:

1. **Medium — `expected_columns` fails open where it should be a
   gate.** rev5 said the matcher returns `ok: false` on parse
   failure and "caller fails open"; CTE/subquery alias refs were
   logged but didn't fail the gate. For a benchmark *acceptance*
   contract, fail-open silently allows generated CTE / unparseable
   SQL to bypass the intended-column assertion. rev6 introduces
   tri-state outcome semantics for the matcher:
   ```ts
   export type ExpectedColumnsOutcome =
     | { kind: "pass"; matched: string[] }
     | { kind: "fail"; missing: string[]; observed: string[] }
     | { kind: "skipped";
         reason: "parse_failed" | "cte_unresolved" | "no_expected_columns";
         details: string };
   ```
   PR-gate rules:
   - `kind: "pass"` → A on the column-match axis.
   - `kind: "fail"` → fails the gate; lists missing + observed
     columns in the report.
   - `kind: "skipped"` → fails the gate UNLESS the question
     declares `column_match_waiver: true` with an `author_note`
     explaining why (e.g. CTE-projected SQL is the intended
     answer shape). Without an explicit waiver, `skipped` is a
     gate fail. The waiver is reviewed at PR time and recorded
     in the question file alongside `floor_active_after_slice`.
   - The category-level summary breaks down skipped vs fail vs
     pass per question so the audit log is unambiguous.
   `expected-columns-alias-resolution.test.mjs` adds three new
   table rows: pass, fail, skipped-with-waiver, skipped-without-
   waiver (last must fail the gate).
2. **Low — `slices_status.json` needs seeding.** rev5's
   fail-fast on unknown slice ids works as intended, but the FIRST
   Slice 19-B PR (which writes baseline-zero questions referencing
   future Phase 21/22/23 lift slices) would fail before any of
   those slices exists. rev6 makes Slice 19-D's deliverable
   explicit: when Slice 19-D lands, it ships
   `diagnostic/slices_status.json` pre-seeded with every planned
   Phase 21/22/23 slice id at `status: "pending"`. The seed list
   is generated mechanically from this plan's slice tables (40
   total) and committed alongside the gate. Subsequent PRs flip
   `pending → in_flight → merged` as slices ship.
3. **Low — JSONC example shape vs author-facing JSON.** rev4's
   schema example used `jsonc` with `//` comments, but actual
   question files must be valid JSON (no comments). rev6 mandates
   the schema doc at
   `web/scripts/chat-health-check.questions.SCHEMA.md` include
   BOTH:
   - A commented JSONC block explaining each field (for human
     readability).
   - A "copy-paste-ready" valid JSON block of the same record so
     authors don't accidentally add `//` comments to a real
     question file (which would break `JSON.parse`).
   Slice 19-A acceptance now lists both blocks as required.

No open questions remain at rev6.

# Phase 19 — Broadcast-Style Analytics Capability Plan — 2026-05-02 (rev5. 2026-05-02 post-audit-5)

## Revision 5 (2026-05-02 post-audit-5)

A fifth audit caught one high-severity gating gap, two medium, and
two low:

1. **High — unknown `floor_active_after_slice` silently suppresses
   forever.** rev4's gate skipped when the named slice's status was
   anything other than `"merged"`. A typo (`"21-corner-analyses"`)
   or a slice id that never lands resolves to "not in the JSON" →
   "treated as pending" → "skipped forever". rev5 mandates a hard
   validation step: at gate startup, every non-null
   `floor_active_after_slice` value across all question files MUST
   resolve to a row in `diagnostic/slices_status.json`. Unknown
   slice ids fail the gate immediately with a list of the offending
   `(question_id, slice_id)` pairs. The unit test
   `category-regression-gate.test.mjs` adds a fixture asserting an
   unknown id fails-fast rather than suppressing the floor.
2. **Medium — `expected_columns` plan overclaimed Phase 17-C
   reuse.** `columnExistenceCheck.ts` only exports
   `validateColumnExistence()`; its `AliasMap` and the traversal
   helpers are private. rev4 implied the existing validator API was
   reusable as-is. rev5 spells out the actual change: extract the
   alias-map construction + ref-resolution into an exported helper:
   ```ts
   // web/src/lib/sqlValidation/columnExistenceCheck.ts
   export type QualifiedColumnRef = {
     schema: string;        // resolved through alias map
     table: string;
     column: string;
     sourceRef: string;     // original alias-qualified form
     resolvedFromAlias: boolean;
   };
   export async function extractQualifiedColumnRefs(
     sql: string
   ): Promise<{
     ok: boolean;          // false on parse failure (caller fails open)
     refs: QualifiedColumnRef[];
     unresolvedAliases: string[];
   }>;
   ```
   `validateColumnExistence` is refactored to call
   `extractQualifiedColumnRefs` internally so the two share one
   alias-resolution implementation. The Phase 19 gate matcher
   consumes only the new helper.
3. **Medium — CTE-derived alias coverage was overpromised.** The
   existing validator marks CTE/subquery aliases as `derived` and
   intentionally skips them (they don't resolve to a real
   `information_schema` row). rev4's "covers CTE-derived alias
   cases" was incorrect — the validator can't resolve a column
   `WITH foo AS (SELECT ...) SELECT foo.x FROM foo` back to its
   originating table. rev5 narrows acceptance: the
   `expected_columns` matcher resolves only **base-table aliases**
   (explicit `AS` form, implicit form where alias = table name).
   Columns referenced through a CTE/subquery alias are reported as
   `unresolvedAliases` and the matcher logs them but does NOT
   false-fail (caller fails open). Slice authors who want to assert
   on CTE-projected columns either rewrite the question to use
   direct-table SQL OR rely on `expected_tables` (table-level
   matching, which already works through CTE refs that name the
   underlying table in the CTE body). The unit fixture's
   "CTE-derived alias" case becomes a *negative* test: assert that
   the matcher does NOT crash on CTE refs, NOT that it resolves
   them.
4. **Low — stale "Phase 17-D honest-fail" wording.** The "What this
   does NOT solve" bullet for team-proprietary telemetry still
   said "Phase 17-D honest-fail". rev5 updates to point at
   `no_data_refusal` and notes 17-D's `sql_generation_failed` caps
   at B for this question class.
5. **Low — slice count out of date.** rev0 said "~36 slices"; rev1
   added `22-A-runtime-model-tool-plumbing`; rev1 also added
   slices 19-A through 19-D (4) + Phase 20 (3) + Phase 21 (20) +
   Phase 22 (6 models + 1 plumbing) + Phase 23 (6) = **40
   slices**. rev5 updates the heading number and the slice-budget
   table.

No open questions remain at rev5.

# Phase 19 — Broadcast-Style Analytics Capability Plan — 2026-05-02 (rev4. 2026-05-02 post-audit-4)

## Revision 4 (2026-05-02 post-audit-4)

A fourth audit caught one high-severity gap, three medium, and one
low:

1. **High — `floor_active_after_slice` not in the emit/allow-list
   contract.** rev3 added the field as the core gate-activation
   mechanism but the emit-path and allow-list patches still listed
   only the rev1/rev2 fields. The new field would be silently
   dropped, defeating the entire activation lifecycle. rev4 adds
   `floor_active_after_slice` to BOTH the
   `chat-health-check.mjs:165` projection AND the
   `chat-health-check-baseline.mjs:1116` allow-list, and asserts
   the field appears in a sample graded JSON in the unit fixture.
2. **Medium — schema example still uses unqualified columns.** The
   normative rev2/rev3 contract requires `<schema>.<table>.<column>`,
   but the example block left in `["compound_name", "lap_start",
   "lap_end"]` from rev0/rev1 — copy-paste authors would adopt the
   bad shape. rev4 fixes the example to qualified form
   (`["analytics.minisector_dominance.dominant_count",
   "analytics.minisector_dominance.minisector_index"]`) AND adds an
   inline `// (qualified — required when expected_tables.length > 0)`
   comment so reviewers spot the intent.
3. **Medium — `_state.md` merge detection under-specified.** rev3
   said the gate "checks whether a slice has been recorded as merged
   in `_state.md`", but the current `_state.md:40` only exposes a
   human-prose "Recent slice merges (last 10)" list — fragile to
   parse and time-windowed. rev4 picks a concrete contract: the
   gate reads from a new
   `diagnostic/slices_status.json` (machine-readable, one row
   per slice with `slice_id`, `status: "pending|in_flight|merged"`,
   `merged_at`). The autonomous loop's existing slice-completion
   hook updates this file in the same commit that closes a slice.
   AS A BACKSTOP: each Phase 21 slice's PR MUST include the
   `floor_active_after_slice: null` cleanup commit on every
   question it lifts, AND the gate fails if a slice listed as
   merged still has questions deferred to it (catches the case
   where the cleanup commit was forgotten).
4. **Medium — `no_data_refusal` lacks a typed runtime contract.**
   rev3 said "guard runs in chatRuntime classification" but
   `ChatRuntimeResult` (chatRuntime.ts:93) has no terminal/refusal
   discriminant. Smuggling the refusal through `resolution.status`
   or `completeness.available` would muddle unrelated fields. rev4
   adds an explicit terminal-result shape:
   ```ts
   export type ChatRuntimeResult =
     | { kind: "proceed"; /* existing fields */ }
     | { kind: "no_data_refusal";
         refusalReason: string;     // human-readable
         matchedKeyword: string;    // which PROPRIETARY phrase fired
         questionType: QuestionType };
   ```
   The orchestration layer switch-cases on `kind` and short-circuits
   before any Anthropic call when `kind === "no_data_refusal"`. The
   shape is exhaustively typed so adding a new terminal kind in the
   future is a compile-time error in every consumer.
5. **Low — qualified `expected_columns` brittle against aliased
   SQL.** Generated SQL will use aliases (`ca.entry_speed_kph` for
   `analytics.corner_analysis ca`). Raw substring matching the
   qualified form would false-fail. rev4 requires the slice-21
   acceptance to use **AST + alias-aware matching** via the
   existing Phase 17-C
   `web/src/lib/sqlValidation/columnExistenceCheck.ts` parser:
   the parser already builds an alias map (`{alias → schema.table}`),
   so the matcher resolves `ca.entry_speed_kph` →
   `analytics.corner_analysis.entry_speed_kph` and matches against
   `expected_columns` accordingly. New unit fixture
   `web/scripts/tests/expected-columns-alias-resolution.test.mjs`
   covers explicit alias, implicit alias, and CTE-derived alias
   cases.

No open questions remain at rev4.

# Phase 19 — Broadcast-Style Analytics Capability Plan — 2026-05-02 (rev3. 2026-05-02 post-audit-3)

## Revision 3 (2026-05-02 post-audit-3)

A third audit caught two high-severity issues, three medium, and one
low:

1. **High — per-question floor gate would fail immediately after
   Phase 19.** Slice 19-B writes "0 A-grade at baseline" questions
   for the new categories on purpose; rev2's gate defaults `A` for
   low/medium and `B` for high, so the moment those baseline
   questions land they fail the gate before any compute slice
   ships. rev3 introduces an **activation lifecycle** for floors:
   - Each question carries `floor_active_after_slice: "<slice-id>"`
     (default `null` = active immediately).
   - Slice 19-B-authored questions for NEW categories set
     `floor_active_after_slice: "21-<their-lift-slice>"` so the
     gate ignores them until the lift slice has shipped.
   - The per-slice acceptance template (Phase 21) explicitly lists
     "after this slice merges, set `floor_active_after_slice` to
     null on every question that targets this category" as a
     cleanup step.
   - The gate skips a question's per-question floor check when its
     `floor_active_after_slice` is set AND the named slice has not
     yet been recorded as merged in `_state.md`.
2. **High — gate compares the wrong grade field.** rev2 said
   "achieved adequacyGrade", but `adequacyGrade` is the chat
   route's coarse runtime quality field (one-pass, no rubric).
   The credible benchmark grade is `baselineGrade` produced AFTER
   the rubric pass (`chat-health-check-baseline.mjs:1090`). rev3
   gates on `baselineGrade` AND, optionally, axis floors
   (`factual_correctness`, `completeness`, `clarity`):
   ```json
   {
     "expected_grade_floor": {
       "baselineGrade": "A",
       "axes": { "factual_correctness": "A" }   // optional
     }
   }
   ```
   Authors who only care about the headline letter set the string
   form; authors gating on a specific axis (common for analytics
   slices that need correctness ≥ A but tolerate B clarity) use
   the object form.
3. **Medium — `no_data_refusal` adjacency negative tests.** The
   proprietary keyword set overlaps with legitimately-supported
   analytics: `brake temp` vs braking-performance, `fuel mass` vs
   `fuel_corrected_pace`, `slip angle` vs traction / slipstream.
   rev3 requires the no-data-refusal unit test
   (`no-data-refusal.test.mjs`) to include negative fixtures
   covering each adjacency:
   - "How late does Norris brake at Turn 1?" → must NOT trip
     guard (corner/braking analytics path).
   - "Compare fuel-corrected pace for X and Y" → must NOT trip
     guard (Phase 21 `fuel_corrected_pace`).
   - "Who had the best traction on corner exit?" → must NOT trip
     guard (Phase 21 `traction_analysis`).
   - "Did Hamilton get a slipstream on the main straight?" → must
     NOT trip guard (Phase 21 `straight_line_dominance` /
     `drs_effectiveness`).
   - "What was the brake temperature at Turn 8?" → MUST trip guard.
   - "How much fuel did Verstappen burn in stint 2?" → MUST trip
     guard (mass on board, not pace correction).
   - "What was the slip angle through Eau Rouge?" → MUST trip
     guard (model-only, no public channel).
   The `PROPRIETARY_NO_DATA_TOPICS` keyword set must use phrase-
   level matches (`"brake temperature"`, `"slip angle"`,
   `"fuel mass"`, `"fuel burn"`, `"battery state"`, `"ers
   deployment"`, `"damage state"`) — NOT bare-token (`"brake"`,
   `"fuel"`, `"slip"`) which would false-trigger.
4. **Medium — `no_data_refusal` contract was internally
   inconsistent.** rev2 header said "the LLM's planner says
   unsupported data is needed", but Slice 19-A required the route
   never invoke `generateSqlWithAnthropic`. Those two are
   incompatible — the LLM planner runs as part of SQL-gen. rev3
   pins the route as a **deterministic pre-SQL keyword guard**:
   it runs in the chatRuntime classification stage, BEFORE any
   Anthropic call, using the phrase-level keyword set above. The
   rev2 wording "LLM's planner" is removed. `no_data_refusal` is
   added to the `expected_path` enum so authors can declare it.
5. **Medium — modifier-only signals pass the rev2 guard.** rev2's
   `templateAllowsTopic` allowed `active_primaries.size <= 1`,
   including the "just modifiers" case. A vague "track dominance"
   phrasing with no primary topic would silently match a modifier-
   only template. rev3 adds the rule: **a topic signal MUST
   contain at least one primary flag for any non-dataHealth
   template to match**, unless the template is explicitly listed
   in `MODIFIER_ONLY_TEMPLATE_EXEMPT` (empty by default — adding
   to it is a deliberate policy decision the coverage test flags).
6. **Low — stale rev1/rev0 wording.** Two paragraphs still said
   proprietary no-data is "scored against the 17-D fail-honestly
   path" and that 17-D is the "right landing spot". rev2 made
   `no_data_refusal` the right landing spot and demoted 17-D's
   `sql_generation_failed` to a B-cap. rev3 rewrites those two
   paragraphs.

No open questions remain at rev3.

# Phase 19 — Broadcast-Style Analytics Capability Plan — 2026-05-02 (rev2. 2026-05-02 post-audit-2)

## Revision 2 (2026-05-02 post-audit-2)

A second audit caught one high-severity gating defect, three medium,
and one low:

1. **High — `insufficient_data` can be gamed via column
   hallucination.** rev1 said `sql_generation_failed` with
   `missingColumns` populated counts as A for proprietary-data
   questions. But the route emits that exact shape when generated SQL
   references nonexistent columns
   (`orchestration.ts:1125, 1197`) — i.e. exactly the
   "ask for brake_temp → LLM hallucinates `brake_temp` column → 17-C
   validator catches it → 17-D structured failure" path. That path
   should NOT score A. rev2 tightens the grader contract: an A-grade
   on `insufficient_data` requires a **proactive no-data refusal**
   that never attempted a SQL query referencing nonexistent
   columns. `sql_generation_failed` with `missingColumns` populated
   caps at B (it's an honest failure, not the right honest failure).
   A new `generationSource: "no_data_refusal"` is added to the route
   for the proactive case (a small synthesis-time guard that, when
   the LLM's planner says "this requires data we don't ingest",
   short-circuits to a templated `INSUFFICIENT_DATA` response without
   issuing SQL).
2. **Medium — primary-vs-modifier matrix regresses real hybrids.**
   rev1 declared primaries "mutually-exclusive" and had `pace` reject
   `stint`. But the existing topic-guard map already permits
   `pace+stint` hybrids on real templates: `max_leclerc_lap_degradation_by_stint`
   (`topicGuards.ts:104`), `max_leclerc_pre_post_pit_pace`,
   `max_leclerc_post_pit_pace`, `max_leclerc_stint_pace_vs_tire_age`,
   `max_leclerc_fresh_vs_used_tires`. rev2 introduces an allowed
   primary-pair set. `pace+stint`, `strategy+stint`,
   `telemetry+pace`, `corner+telemetry`, etc. are explicitly allowed
   pairs. The disjointness rule applies only to pairs NOT in this
   set. Regression fixtures added in
   `template-router-topic-guards.test.mjs` for each allowed pair.
3. **Medium — `expected_grade_floor` not enforced by the PR-time
   gate.** rev1 added the field but Slice 19-D only checked
   category-level A-rate. rev2 extends
   `category_regression_gate.mjs` with per-question floor
   enforcement: every question whose `expected_grade_floor` is set
   must meet it. Default floor is `A` for `complexity: low` and
   `medium`, `B` for `high`. The gate exits non-zero if ANY question
   regresses below its declared floor, even when the category-level
   A-rate stays above the category floor.
4. **Medium — `expected_columns` too loose for multi-table
   analytics.** rev1 used unqualified names that any SQL touching
   `session_key` or `driver_number` would satisfy. rev2 mandates
   QUALIFIED references when `expected_tables.length > 0`:
   `expected_columns: ["analytics.corner_analysis.entry_speed_kph",
   "analytics.corner_analysis.apex_min_speed_kph"]`. Common
   keys (`session_key`, `driver_number`, `lap_number`) are NOT
   listed as expected columns since they false-pass. The schema
   doc and a unit test enforce the `<schema>.<table>.<column>`
   format.
5. **Low — "Categories with ≥ 0% A-rate" is tautological.** rev1's
   acceptance table had `Categories with ≥ 0% A-rate` going from
   "~6 of 18" to "18 of 18", but every category trivially has ≥0%
   by definition. rev2 changes both rows to "**Categories with at
   least one A-graded question**" so the metric is non-trivial.

No open questions remain at rev2.

# Phase 19 — Broadcast-Style Analytics Capability Plan — 2026-05-02 (rev1. 2026-05-02 post-audit-1)

## Revision 1 (2026-05-02 post-audit-1)

A first audit caught one high-severity gap, five medium, and two low:

1. **High — `proprietary_no_data` cannot be graded correctly.** rev0
   expected `INSUFFICIENT_DATA` to score success but the existing
   grader treats no-rows as `C`
   (`chat-health-check-baseline.mjs:932`) and `should_be_answerable:
   false` maps to expected-clarification, not honest refusal
   (`chat-health-check-baseline.mjs:816, 907`). rev1 adds an
   `expected_outcome: "answer" | "clarification" | "insufficient_data"`
   field to the question schema, plus a grader branch + fixtures for
   the `insufficient_data` case (Slice 19-A.5).
2. **Medium — `expected_columns` was mis-named/under-specified.** The
   rev0 example value (`["analytics.minisector_dominance"]`) is a
   table, not a column. rev1 splits into `expected_tables` and
   `expected_columns`, both optional but at least one required for
   slice 21-* acceptance to assert "the LLM picked the right
   contract". Adds `expected_grade_floor` per question so slice
   acceptance can gate on per-question minimums in addition to
   category-level A-rate.
3. **Medium — healthcheck emit + grader allow-list need explicit
   patches.** Today `askQuestion()` emits only `id/category/question`
   from the source (`chat-health-check.mjs:165`) and the grader
   allow-list drops non-listed fields
   (`chat-health-check-baseline.mjs:1116`), so the new
   `complexity` / `expected_*` fields would be silently dropped along
   the existing `cacheHit` and `sqlElapsedMs` (which Phase 19
   baselines need too). rev1 spells out both patches as Slice 19-A
   sub-steps with the literal field names.
4. **Medium — topic flags need a compatibility matrix.** rev0 just
   added flags. rev1 declares which flags are **primary topics**
   (mutually exclusive: pace, stint, strategy, dominance, corner,
   braking, traction, weather, incident, restart, overtake_battle,
   driver_score, dataHealth) vs **modifiers** (telemetry, traffic)
   that compose with primaries. `dominance` becomes a modifier over
   pace/corner/straight_line/sector. `braking/traction/corner/
   straight_line` are telemetry subtopics that COMPOSE with telemetry,
   not reject it. Phase 18-A `templateAllowsTopic` extends to honor
   modifier-vs-primary rules (Slice 21 cross-cutting note).
5. **Medium — Phase 21 slice ordering misstated independence.**
   `driver_performance_7axis` aggregates other slices and must ship
   AFTER its components. `drs_effectiveness` depends on
   battle/overtake. `track_dominance_gps` depends on
   minisector/sector/corner. rev1 adds a per-slice dependency table
   and a strict topological order; the per-slice author has a "depends
   on" gate in acceptance.
6. **Medium — Phase 22 needs hard tool-plumbing prerequisite.** rev0
   conditionally fell back to one-off plumbing if 17-H hadn't shipped.
   rev1 promotes runtime-tool plumbing to a hard prerequisite via
   new slice `22-A-runtime-model-tool-plumbing` so each modeling
   slice ships against a stable interface.
7. **Low — refresh manifest at 20 matviews.** rev1 adds
   `sql/refresh_manifest.json` (or equivalent) listing matviews in
   topological refresh order, consumed by the `ingest.mjs` post-run
   hook and the standalone refresh script.
8. **Low — `CORE_CONTRACTS` points at facade views, not storage
   matviews.** Phase 17-F's introspection lists contracts the LLM
   should query; `analytics.<name>_data` is implementation, the
   facade `analytics.<name>` is the stable contract. Slice 21-*
   acceptance updates `CORE_CONTRACTS` with the facade name only.
9. **Low — 150 questions under-budgeted if fully hand-authored.**
   rev1 explicitly permits LLM-assisted drafting with REQUIRED human
   rubric review, duplicate checking, and authored
   `expected_outcome` / `expected_tables` per question (Slice 19-B
   "authorship policy" sub-step).

No open questions remain at rev1.

# Phase 19 — Broadcast-Style Analytics Capability Plan — 2026-05-02 (rev0, retained below for reference)

Updates and re-scopes
[`diagnostic/analysis_taxonomy_plan_2026-04-27.md`](analysis_taxonomy_plan_2026-04-27.md)
against the post-Phase-18 codebase. The taxonomy plan was drafted before
the Phase 17 LLM-SQL incident; many of its assumptions (regex template
matching only, no schema introspection, no SQL pre-validation, no
materialized completeness, hand-typed column docs) are now obsolete.
This plan keeps the same 35-slice substantive scope but renumbers the
phases (Phase 13/14/15/16 in the original → **Phase 19/20/21/22** here)
and folds in the patterns Phase 17/18 made standard.

It also adds the **per-category before/after benchmark suite** the user
asked for — low/medium/high complexity questions for every analysis
category, scored before AND after each compute slice ships, so we can
quantify the capability lift instead of asserting it.

---

## Why this matters

After Phase 17/18, the chat returns **correct** answers fast on the
existing core.* contract surface. The remaining capability gap is
**breadth**: questions like "Who was strongest in mini-sector 4 of
Silverstone?" or "Compare Verstappen and Leclerc's braking at Monza
turn 1" route through LLM-gen, hit a missing column (no
`analytics.minisector_dominance` exists), and either fail honestly via
17-D or return a generic lap-time answer that misses the point of the
question.

The 50-question curated benchmark covers 18 of the 18 categories from
the taxonomy at *one* level of complexity each — usually the simplest.
We have no signal on harder questions in any category. Phase 19 closes
that visibility gap first (benchmark suite expansion), then ships the
compute layer with measured lift.

## Repo grounding (verified 2026-05-02)

What landed in Phase 17/18 that this plan **inherits** as a baseline:

- `web/src/lib/schemaCatalog.ts` (Phase 17-F) — live `information_schema`
  introspection, cached for the process lifetime. Adding new tables to
  the LLM's known-column surface means listing them in the
  `CORE_CONTRACTS` array; no hand-typed docs.
- `web/src/lib/sqlValidation/columnExistenceCheck.ts` (Phase 17-C) —
  pgsql-ast-parser–based column-existence validator with full
  alias-map resolution. New analytics.* tables get pre-execute
  validation for free once their columns are in the catalog.
- `web/src/lib/deterministicSql/topicGuards.ts` (Phase 18-A) —
  topic-flag taxonomy + `templateAllowsTopic` predicate. New analytics
  templates need entries in `TEMPLATE_TOPICS` plus matching topic flags
  (probably new flags for `dominance`, `corner`, `braking`, `traction`,
  `weather`, `incident`).
- `core.session_completeness` matview + facade pattern (Phase 18-C) —
  storage matview underneath a regular-view facade so dependents stay
  stable. Phase 19/20 analytics matviews follow the same pattern.
- `scripts/refresh_completeness_matview.py` and the
  `scripts/ingest.mjs` post-run hook (Phase 18-C) — refresh wiring.
  New analytics matviews piggyback on the same hook.
- `web/scripts/chat-health-check.questions.json` (50 questions, ~A 88%
  post-Phase-18) — the regression bar this plan must not break, and
  the foundation the new benchmark suite extends from.
- `scripts/phase17_chat_smoke.py` (3-tier randomized smoke) — the
  cold/warm comparator. Phase 19 extends this into a per-category
  variant.

What does **not** exist yet:
- `analytics.*` schema (zero matviews today)
- `f1.track_segments` static table
- per-category benchmark coverage at low/med/high complexity
- topic flags for the analytics-specific topics listed above
- chat-health-check question grouping by complexity (every question is
  flat-graded today)

## Slice breakdown — Phase 19 (5 phases, **40 slices** (rev5: was "~36"; +1 for 22-A plumbing, exact count is 4+3+20+7+6), ~12-20 days)

| Phase | What lands | Slice count |
|---|---|---|
| **19** | Benchmark suite expansion + complexity tiering | 4 |
| **20** | Data layer — track segments + intervals parser | 3 |
| **21** | Compute layer — `analytics.*` matviews | 20 |
| **22** | Modeling layer — 22-A plumbing prereq + 6 model slices | 7 |
| **23** | Product surfaces (track-dominance map, corner page, …) | 6 |

Phase 19 ships **first** so we have a measurable baseline. The next
four phases ship slices in dependency order; each compute slice in
Phase 21 includes its own before/after benchmark numbers in the
acceptance gate (proves the slice actually lifts the category, not
just compiles).

---

### Phase 19 — Benchmark suite expansion

**Goal**: ~150-200 new tests across 18 analysis categories at three
complexity tiers, gradeable, attributable to a category, runnable
through the existing healthcheck pipeline. Establishes the
"before" measurement; every Phase 20-23 slice then publishes its
"after" lift.

#### Slice 19-A: question-set schema + complexity tiers

**Steps**:
1. Extend the question file schema (rev1: split `expected_columns`,
   add `expected_outcome`, add `expected_grade_floor`):
   ```jsonc
   {
     "id": 1701,
     "category": "Track dominance",
     "complexity": "medium",
     "expected_outcome": "answer",
     "expected_path": "anthropic",
     "expected_tables": ["analytics.minisector_dominance"],
     // Fully-qualified <schema>.<table>.<column> form is required when
     // expected_tables.length > 0. Unqualified names like "compound_name"
     // are NOT accepted (false-positives on common keys). The matcher
     // resolves SQL aliases (e.g. "md.dominant_count") against the
     // expected_tables alias map before comparing.
     "expected_columns": [
       "analytics.minisector_dominance.dominant_count",
       "analytics.minisector_dominance.minisector_index"
     ],
     "expected_grade_floor": "A",
     "floor_active_after_slice": "21-minisector-dominance",
     "question": "Who dominated the most mini-sectors at Silverstone 2025 between Verstappen and Norris?"
   }
   ```
   - `complexity ∈ {low, medium, high}`.
   - `expected_outcome ∈ {answer, clarification, insufficient_data}` —
     **rev1**: required field. `answer` = the chat returns a real
     synthesis. `clarification` = `runtime_clarification` is the right
     reply. `insufficient_data` = the chat must return
     `INSUFFICIENT_DATA` (proprietary-data class).
   - `expected_path ∈ {anthropic, anthropic_repaired, deterministic_template,
     runtime_clarification, sql_generation_failed, no_data_refusal}` —
     soft expectation; used in the per-question report, not a fail
     gate. (rev3: added `no_data_refusal` for the proactive-refusal
     path.)
   - `expected_tables` (optional) — list of contract relations
     (`schema.table_or_view`) the SQL-gen path should reference.
   - `expected_columns` (optional, rev2 — qualified form, rev4 —
     alias-aware match) — **fully-qualified** column refs in
     `<schema>.<table>.<column>` form, e.g.
     `["analytics.corner_analysis.entry_speed_kph",
       "analytics.corner_analysis.apex_min_speed_kph"]`.
     Unqualified column names are NOT accepted (a unit test enforces
     the format) because common keys like `session_key`,
     `driver_number`, `lap_number` would false-pass.
     **Matching (rev5 — exported helper, narrowed CTE policy)**:
     the gate uses a new exported helper
     `extractQualifiedColumnRefs(sql)` added to
     `web/src/lib/sqlValidation/columnExistenceCheck.ts`. The
     helper returns `{ ok, refs, unresolvedAliases }` where each
     `ref` is `{schema, table, column, sourceRef,
     resolvedFromAlias}`. `validateColumnExistence` is refactored
     to call this helper internally so the two share one
     alias-resolution implementation (rev4 wrongly implied the
     existing public API was reusable as-is).

     **Scope**: the matcher resolves only **base-table aliases**
     — explicit `AS` form (`FROM analytics.corner_analysis AS ca`)
     and implicit form where alias = table name. CTE / subquery
     aliases are intentionally NOT resolved (the existing parser
     marks them as `derived` because their columns are projected,
     not from `information_schema`).

     **Outcome semantics (rev6 — tri-state)**: the matcher returns
     `ExpectedColumnsOutcome = "pass" | "fail" | "skipped"`:
     - `pass`: every entry in `expected_columns` was resolved
       through a base-table alias and matched a column in the
       generated SQL.
     - `fail`: at least one expected column was unmatched even
       though all aliases resolved cleanly (the LLM picked a
       different contract or column).
     - `skipped`: parse failure OR the SQL only projects through
       CTE/subquery aliases that the matcher can't resolve.
       `skipped` requires a per-question waiver
       (`column_match_waiver: true` + `author_note: "..."`) to
       count as "not a regression"; otherwise the PR gate fails
       so an unevaluable contract can't silently bypass the
       acceptance gate. Slice authors needing CTE-projected
       coverage either set the waiver with a justification,
       rewrite the question to use direct-table SQL, OR rely on
       `expected_tables` matching (which still works through CTE
       bodies that name the underlying analytics table).

     Raw substring matching is forbidden because legitimate
     aliased SQL would false-fail.

     Unit fixture `expected-columns-alias-resolution.test.mjs`
     covers seven cases (rev6 — tri-state outcome assertions):
     - **pass**: explicit alias (`FROM analytics.corner_analysis AS ca`,
       all expected columns resolved → `kind: "pass"`).
     - **pass**: implicit alias (`FROM analytics.corner_analysis ca`).
     - **pass**: unaliased direct table (`FROM analytics.corner_analysis`,
       column ref `corner_analysis.entry_speed_kph`).
     - **fail**: SQL references the wrong contract (LLM picked
       `analytics.sector_dominance` when the question expected
       `analytics.corner_analysis`) → `kind: "fail"`, gate fails.
     - **skipped + waiver**: CTE-projected SQL with
       `column_match_waiver: true` on the question →
       `kind: "skipped"`, gate passes.
     - **skipped + no waiver**: CTE-projected SQL without waiver →
       `kind: "skipped"`, gate FAILS.
     - **skipped: parse_failed**: malformed SQL the parser rejects →
       `kind: "skipped"` with `reason: "parse_failed"`; without a
       waiver the gate fails.
   - `expected_grade_floor` (rev3) — either a string (`"A" | "B"`)
     or an object form for axis-specific floors:
     ```json
     "expected_grade_floor": "A"
     // or
     "expected_grade_floor": {
       "baselineGrade": "A",
       "axes": { "factual_correctness": "A" }
     }
     ```
     The gate (Slice 19-D) compares the question's `baselineGrade`
     (NOT the runtime `adequacyGrade`) against the floor.
     Optionally, the `axes` map gates specific multi-axis grades.
     Default if absent: `"A"` for `complexity ∈ {low, medium}`,
     `"B"` for `complexity: high`.
   - `floor_active_after_slice` (rev3, optional) — slice id
     (e.g. `"21-corner-analysis"`) after which this question's
     per-question floor begins to be enforced. Default `null`
     (active immediately). Slice 19-B authors set this on
     baseline-zero questions for new categories so the gate
     doesn't fail until the lift slice ships. The named slice's
     own acceptance includes a cleanup step that nulls this
     field on every question it lifts.
   - `column_match_waiver` (rev6, optional) — boolean. When
     `true`, the per-question gate accepts a `kind: "skipped"`
     outcome from the `expected_columns` matcher (CTE-projected
     SQL, parse failure with author-acknowledged reason). Without
     a waiver, `skipped` fails the gate.
   - `author_note` (rev6, required when `column_match_waiver:
     true`) — short string explaining why the waiver is granted
     (e.g. "intended answer is a CTE-projected aggregation that
     the alias matcher can't resolve; relying on
     `expected_tables` instead"). Reviewed at PR time.
2. Per-category complexity rubric:
   - **low**: one contract, no JOIN, no driver pair, no
     time-conditional filter. Example: "List the stints for driver X
     in race Y."
   - **medium**: one contract + one filter or one JOIN. Driver pair
     allowed. Example: "Compare clean-lap pace for X and Y at Z."
   - **high**: multi-contract JOIN, conditional aggregation, or
     time-window comparison. Example: "How did X's pace change
     before and after their second pit stop, accounting for tyre
     compound and traffic?"
3. **Emit-path patch** (rev4 + rev7):
   `web/scripts/chat-health-check.mjs:165` (`askQuestion()`)
   currently emits only `id`/`category`/`question` from the source
   row. The projection forwards verbatim:
   `complexity`, `expected_outcome`, `expected_path`,
   `expected_tables`, `expected_columns`, `expected_grade_floor`,
   `floor_active_after_slice` (rev4),
   **`column_match_waiver`** and **`author_note`** (rev7 — the
   waiver pair from rev6; previously omitted from the projection).
4. **Grader-allow-list patch** (rev4 + rev7):
   `web/scripts/chat-health-check-baseline.mjs:1116` currently
   strips fields not on its allow-list. The allow-list extends to:
   `complexity`, `expected_outcome`, `expected_path`,
   `expected_tables`, `expected_columns`, `expected_grade_floor`,
   `floor_active_after_slice` (rev4),
   **`column_match_waiver`** and **`author_note`** (rev7),
   `cacheHit`, `sqlElapsedMs`. Tests assert EACH field —
   including `column_match_waiver` and `author_note` — appears in
   a sample graded JSON. The "skipped expected-columns +
   waiver-respected" gate behavior depends on these fields being
   present in graded JSON, so the survival assertion is
   load-bearing.
5. **Grader branch for `insufficient_data`** (rev2 tightened): amend
   `chat-health-check-baseline.mjs:816,907,932` so when
   `expected_outcome === "insufficient_data"`:
   - `generationSource === "no_data_refusal"` (new — see step 6) →
     **A**. The chat proactively recognized the question requires
     data we don't ingest and returned `INSUFFICIENT_DATA` without
     attempting SQL.
   - `generationSource === "sql_generation_failed"` with
     `missingColumns` populated → **B max**. Honest failure, but
     not the right kind: the LLM tried to query
     hallucinated columns and got caught by 17-C, which is a
     graceful crash, not a proactive refusal. This rule is what
     prevents the "ask for `brake_temp` → hallucinate column → fail
     → free A" gameable path codex flagged.
   - `generationSource === "runtime_clarification"` → **C**. Wrong
     refusal class — the chat asked for clarification instead of
     refusing. Distinguishable failure mode worth its own grade so
     audits can spot it.
   - A normal-shaped answer (`generationSource: anthropic` /
     `anthropic_repaired` / `deterministic_template` with rows) →
     **C**. The chat hallucinated where it should have refused.
   New unit fixture
   `web/scripts/tests/grader-insufficient-data.test.mjs` covers all
   four branches with table-driven cases.
6. **New `no_data_refusal` route** (rev4 — typed runtime contract):
   amend `web/src/lib/chatRuntime.ts` so the public
   `ChatRuntimeResult` becomes a discriminated union with an
   explicit terminal-refusal arm:
   ```ts
   export type ChatRuntimeResult =
     | ChatRuntimeProceed       // existing fields, kind: "proceed"
     | ChatRuntimeNoDataRefusal;

   export type ChatRuntimeNoDataRefusal = {
     kind: "no_data_refusal";
     refusalReason: string;       // "no public data for brake temperature"
     matchedKeyword: string;      // exact PROPRIETARY phrase that fired
     questionType: QuestionType;  // preserved for telemetry parity
   };
   ```
   `buildChatRuntime()` checks `PROPRIETARY_NO_DATA_TOPICS` against
   the normalized message DURING the classification stage — BEFORE
   any Anthropic call. On match, returns the
   `ChatRuntimeNoDataRefusal` shape immediately. The orchestration
   layer switch-cases on `result.kind`:
   ```ts
   if (runtime.kind === "no_data_refusal") {
     // emit templated INSUFFICIENT_DATA answer, never call
     // generateSqlWithAnthropic / executeSqlWithTrace
     return makeNoDataRefusalResponse(runtime);
   }
   ```
   The discriminated union forces every consumer to handle the new
   case (TypeScript compile error otherwise), which prevents the
   refusal from silently leaking through `resolution.status` or
   `completeness.available`.

   The route returns a templated `INSUFFICIENT_DATA` answer with
   `generationSource: "no_data_refusal"`, never invokes
   `generateSqlWithAnthropic` or `executeSqlWithTrace`, and emits
   a `chat_no_data_refusal` perfTrace event for monitoring.

   `PROPRIETARY_NO_DATA_TOPICS` (rev3 — phrase-level, NOT
   bare-token, to avoid adjacency false-positives):
   ```ts
   const PROPRIETARY_NO_DATA_TOPICS = [
     "brake temperature", "brake temp ",   // not "brake" — collides with braking analysis
     "tyre temperature", "tire temperature",
     "battery state", "battery soc", "battery charge",
     "ers deployment", "ers harvest",
     "fuel mass", "fuel burn", "fuel load",  // not "fuel" — collides with fuel_corrected_pace
     "steering angle",
     "slip angle", "slip ratio",            // not "slip" — collides with slipstream
     "damage state", "front-wing damage",
     "engine rpm", "shift map",
     "differential setting", "diff setting"
   ];
   ```
   Phrase-level matching is case-insensitive, whole-phrase, with
   adjacent-word tolerance (e.g. "brake temp" with arbitrary
   whitespace).

   New unit test `web/scripts/tests/no-data-refusal.test.mjs`
   asserts BOTH directions:

   **MUST trip (proprietary)**:
   - "What was the brake temperature at Turn 8?"
   - "How much fuel did Verstappen burn in stint 2?"
   - "What was the slip angle through Eau Rouge?"
   - "What was the battery state at the start of lap 30?"
   - "What ERS deployment did Hamilton use in Q3?"

   **MUST NOT trip (legitimate analytics — adjacency negatives)**:
   - "How late does Norris brake at Turn 1?"  → corner/braking
   - "Compare fuel-corrected pace for X and Y" → `fuel_corrected_pace`
   - "Who had the best traction on corner exit?" → traction analysis
   - "Did Hamilton get a slipstream on the main straight?" →
     `straight_line_dominance` / `drs_effectiveness`
   - "Who set the fastest lap at Monza?" → existing pace path

**Acceptance**:
- Schema doc lands at
  `web/scripts/chat-health-check.questions.SCHEMA.md` and includes
  TWO example blocks (rev6):
  - A commented JSONC block (with `//` annotations explaining each
    field) for human readability.
  - A copy-paste-valid JSON block (no comments) of the same record
    so authors don't accidentally paste `//` into a real question
    file (which would break `JSON.parse`).
- Existing 50-question file gains `complexity` and `expected_outcome`
  fields on every entry (retroactively tagged from question content).
- The healthcheck emit + grader allow-list patches land; the grader
  unit fixture passes.
- Typecheck clean; the curated 50-question benchmark still passes
  ≥88% A.

#### Slice 19-B: per-category benchmark question files

**Steps**:
1. Author one question file per analysis category from the taxonomy.
   Each file has 3-15 questions across the three tiers. Categories
   that the system already covers (existing 50q benchmark) get
   coverage at all three tiers; categories the system does NOT cover
   yet (most of the 20-matview list) get questions written *now* so
   the baseline reads "0 A-grade" before slice 21-* ships and lifts
   them.
2. Files (one per category, dropped into
   `web/scripts/chat-health-check.questions.<category>.json`):
   - `metadata` (existing 50q expanded to all three tiers — ~15 q)
   - `pace` (~12 q) — lap pace, sector pace, clean-lap pace, fuel-corrected
   - `stint` (~12 q) — stint lengths, compounds, undercut/overcut,
     opening-closing stints
   - `dominance` (~12 q) — sector / mini-sector / track-dominance
     between drivers (NEW category — Phase 21 lift)
   - `corner` (~9 q) — entry/turn-in/mid/exit (NEW)
   - `braking` (~9 q) — brake-zone speed delta (NEW)
   - `traction` (~9 q) — throttle / exit speed (NEW)
   - `straight_line` (~6 q) — i1/i2/st-speed dominance (NEW)
   - `tyre` (~9 q) — degradation curve, warm-up, fresh-vs-used (NEW for
     deg curve; existing for compound)
   - `traffic` (~6 q) — clean-air vs traffic pace (NEW)
   - `pit` (~9 q) — pit-loss, undercut/overcut history (existing
     plus NEW lift)
   - `overtake` (~9 q) — overtake events, battle segments, DRS
     effectiveness (NEW)
   - `restart` (~6 q) — SC/VSC restart launch, lap-1 (NEW)
   - `weather` (~6 q) — rain impact, compound choices around weather
     (NEW)
   - `incident` (~6 q) — race-control incident timeline, penalties (NEW)
   - `driver_score` (~6 q) — 7-axis driver performance (NEW; depends
     on Phase 21 + 22)
   - `data_health` (existing dataHealth slice — ~6 q, all tiers)
   - `proprietary_no_data` (~9 q) — battery, ERS, brake temp, fuel
     mass, steering angle, slip angle, damage. Expected behavior:
     proactive `INSUFFICIENT_DATA` refusal via the rev2/rev3
     **`no_data_refusal` route** (deterministic pre-SQL keyword
     guard). Phase 17-D's `sql_generation_failed` is NOT the
     intended landing spot here — that path caps at B in the rev2
     grader because it indicates the LLM tried to query
     hallucinated columns instead of refusing proactively. Each
     question has `expected_path: "no_data_refusal"`.
   - `cross_category` (~9 q, all tier=high) — questions that span
     multiple matviews, e.g. "Did Verstappen's tyre choice affect his
     pace through the high-speed corners at Silverstone?"
3. Each file conforms to slice 19-A's schema. Total ≈ **150 questions**
   across 18 categories. Every entry has authored
   `expected_outcome` + (when `expected_outcome === "answer"`)
   `expected_tables` and/or `expected_columns`.
4. **Authorship policy (rev1)**: LLM-assisted drafting is permitted to
   reach the 150-question floor on schedule, BUT every drafted question
   passes through:
   - Human rubric review (does it match the complexity tier? does
     `expected_outcome` match the data we have?).
   - Duplicate check vs the existing 50q + sibling category files
     (a SHA-256 of the normalized question text plus a soft fuzzy
     check on overlapping wording).
   - Author-supplied (not LLM-supplied) `expected_outcome`,
     `expected_tables`, `expected_columns` — the authors decide what
     "correct" looks like; the LLM only proposes phrasings.
   The slice author commits both the source set and a one-line
   review-status note per question (so audit can spot LLM-only
   entries that slipped through).
5. Build a runner script
   `web/scripts/run_category_benchmarks.mjs` that takes a comma-list
   of categories (or `all`) and writes per-category result JSONs.
   Reuses the existing healthcheck transport so the
   `cacheHit`/`sqlElapsedMs`/spans capture is uniform.

**Acceptance**:
- All 18 category files land and are valid JSON conforming to
  19-A schema.
- `npm run healthcheck:chat:categories -- --category dominance` runs
  to completion against the dev server.
- Total question count ≥ 150.

#### Slice 19-C: baseline run + before-table

**Steps**:
1. Run `run_category_benchmarks.mjs all` against the
   post-Phase-18 codebase, capture per-category `(A-rate,
   median elapsedMs, generationSource distribution, cacheHit
   distribution)`. Write to
   `diagnostic/phase_19_baseline_2026-05-02.json` and a Markdown
   sibling `phase_19_baseline_2026-05-02.md` with the table.
2. The baseline IS the "before" snapshot; every Phase 20-23 slice
   that ships compute or modeling MUST publish a delta vs this
   table in its own acceptance.
3. Categories with 0% A-rate at baseline (the new ones — dominance,
   corner, braking, etc.) are the explicit lift targets.

**Acceptance**:
- Baseline JSON + MD land in `diagnostic/`.
- `_state.md` for the in-flight phase index references the baseline
  artifact path so future audit rounds can diff against it.

#### Slice 19-D: PR-time gate

**Steps**:
1. Add `web/scripts/category_regression_gate.mjs` with **two layers
   of gating** (rev3 corrections in bold):
   - **Category-level**: A-rate per category vs floors in
     `web/scripts/category_a_rate_floors.json`. Exits non-zero if
     any category's measured A-rate is below its floor.
   - **Per-question**: each question's `expected_grade_floor` is
     compared against the question's **`baselineGrade`** (rev3 —
     was `adequacyGrade`; `baselineGrade` is the rubric-graded
     output from `chat-health-check-baseline.mjs:1090`, NOT the
     route's coarse runtime quality field).
     - String-form floor: `baselineGrade >= floor`.
     - Object-form floor: `baselineGrade >= floor.baselineGrade`
       AND, if `floor.axes` is set, every named axis grade meets
       its declared floor (`factual_correctness`, `completeness`,
       `clarity`).
     - **Slice-id validation (rev5 — fail-fast)**: at gate
       startup, every non-null `floor_active_after_slice` value
       across all loaded question files MUST resolve to a row in
       `diagnostic/slices_status.json`. If any question references
       a slice id that doesn't exist (typo, never-landed slice),
       the gate FAILS immediately with an "unknown slice ids"
       error listing every offending `(question_id, slice_id)`
       pair. Without this, a typo would silently suppress the
       floor forever.
     - **Activation lifecycle (rev4, validated by rev5)**: the
       gate reads slice merge status from a new machine-readable
       file `diagnostic/slices_status.json`:
       ```json
       {
         "slices": [
           {"slice_id": "21-minisector-dominance",
            "status": "merged", "merged_at": "2026-05-15T12:00:00Z"},
           {"slice_id": "21-corner-analysis",
            "status": "pending", "merged_at": null}
         ]
       }
       ```
       The autonomous loop's slice-completion hook is amended to
       also write this file whenever it records a merge in
       `_state.md`'s prose log. The gate skips a question's
       per-question floor check when its `floor_active_after_slice`
       is set AND the named slice's status is anything other than
       `"merged"`.
     - **Cleanup-or-fail rule (rev4)**: when a slice transitions to
       `"merged"`, every question whose
       `floor_active_after_slice === <slice_id>` MUST have that
       field set to null in the same PR (the lift slice's cleanup
       step). The gate fails the PR if a slice is `"merged"` AND
       any question still references it via
       `floor_active_after_slice`. Catches the case where the
       cleanup commit was forgotten — a shipped slice cannot leave
       its questions in the deferred-floor state.
   - Defaults when `expected_grade_floor` is absent: `A` for
     `complexity ∈ {low, medium}`, `B` for `complexity: high`.
2. The gate's exit summary lists, in order:
   - Category-level fails (with category, measured rate, floor)
   - Per-question fails (with id, category, question preview,
     measured `baselineGrade`, declared floor, slice activation
     status)
   - Skipped per-question checks (so an audit can confirm the
     activation lifecycle isn't suppressing too many)
3. **Seed `diagnostic/slices_status.json`** (rev6 + rev7): when
   Slice 19-D lands, it ships the registry pre-populated with
   every planned slice id across Phase 19-23 at `status:
   "pending"`. rev7 corrects the rev6 scope (which incorrectly
   said "Phase 21/22/23 only", 33 ids — but a Phase 19 or 20
   `floor_active_after_slice` reference would then trip the
   unknown-id check). The seed list is generated mechanically
   from this plan's slice tables — **all 40 slice ids**:
   - Phase 19 (4): `19-A`, `19-B`, `19-C`, `19-D` (these mark
     themselves `merged` when they land — fine, the registry
     just records that fact).
   - Phase 20 (3): `20-track-segments-auto`,
     `20-track-segments-corners`, `20-intervals-parser`.
   - Phase 21 (20): every slice in the topological table.
   - Phase 22 (7): `22-A-runtime-model-tool-plumbing` plus the
     six model slices.
   - Phase 23 (6): `23-track-dominance-map`,
     `23-corner-analysis-page`, `23-stint-degradation-chart`,
     `23-driver-performance-card`, `23-battle-replay`,
     `23-strategy-simulator`.
   So the FIRST Slice 19-B PR (writing baseline-zero questions
   referencing future lift slices via
   `floor_active_after_slice`) doesn't fail the rev5 unknown-
   slice-id check regardless of which phase the deferred slice
   sits in. Subsequent PRs flip
   `pending → in_flight → merged` as slices ship. The seed file
   is checked into the repo and reviewed alongside Slice 19-D.
4. Wire the gate into the autonomous loop's `test_grading_gate.sh`
   so future PRs can't accidentally regress either bar.
5. New unit test
   `web/scripts/tests/category-regression-gate.test.mjs` — table-
   driven cases: category-fail-only, per-question-fail-only,
   axis-fail-only, activation-suppressed, both, neither, plus
   **rev5**: unknown slice id in `floor_active_after_slice` →
   fail-fast (asserts the gate exits non-zero with an
   "unknown slice ids" error and lists every offending
   `(question_id, slice_id)` pair).

**Acceptance**:
- Gate runs and respects both layers of floors; lowering a category
  floor or downgrading a question's measured grade triggers a fail
  on the appropriate layer.
- Per-question fail cannot be hidden behind a passing category
  rate.
- Documented in `loop_hardening_plan_*.md` follow-up note.

---

### Phase 20 — Data layer

Same as the original taxonomy plan's Phase 13. Single materialized table
(`f1.track_segments`) plus an intervals parser. Three slices.

| Slice | Output | Notes |
|---|---|---|
| `20-track-segments-auto` | `f1.track_segments` schema + auto-derived 25-50 mini-sectors per circuit from `raw.location` | First contract Phase 17-F's catalog will pick up after migration |
| `20-track-segments-corners` | Hand-curated FIA corner zones bolted into `f1.track_segments` | One-row update per corner; tied to circuit_short_name |
| `20-intervals-parser` | A pure-SQL helper or pg function `core.parse_interval(text) → (seconds_or_null, laps_down_or_null)` | Used by every battle-related Phase 21 matview |

Each gets a sqitch deploy/revert/verify triplet, integrated with
Phase 18-C's `phase17_neon_setup.py` acceptance.

### Phase 21 — Compute layer

Twenty `analytics.*` matviews. Each follows the **Phase 18-C
storage-matview + facade-view** pattern: a `analytics.<name>_data`
matview underneath an `analytics.<name>` regular view. Concurrent
refresh via `scripts/refresh_*` plus the `ingest.mjs` post-run hook.

**Per-slice acceptance template**:
1. New matview lands with `IF NOT EXISTS` + column-shape verify
   (Phase 18-C rev4 pattern with the CTE-based FULL OUTER JOIN).
2. Migration includes `pg_depend` parity check.
3. Phase 17-F `CORE_CONTRACTS` array gains the new contract so the
   LLM's introspected schema docs include it.
4. Phase 18-A `TEMPLATE_TOPICS` gains topic flags for the slice's
   category (e.g. dominance, corner, braking, traction). New flags
   added to `TopicSignal`:
   ```ts
   export type TopicSignal = {
     pace, stint, strategy, telemetry, dataHealth,    // existing
     dominance, corner, braking, traction, traffic,   // Phase 21 new
     weather, incident, driver_score, restart, overtake_battle
   };
   ```
5. New deterministic templates (where the question shape is reliably
   templatable) gain `TEMPLATE_TOPICS` entries with explicit
   `rejectIfPresent` to avoid the Phase 18-A false-match class.
6. **Before/after benchmark numbers** for the slice's category,
   sourced from Phase 19. PR ships only if the category's A-rate
   improved AND the curated 50-question benchmark didn't regress.

**Slice list with topological order + dependencies (rev1)**:

The "Order" column is the strict ship sequence — each slice ships
only after its `depends_on` peers have landed. Slices with no
upstream Phase 21 deps (just Phase 20 data layer) sit in tiers 1-2.
`driver_performance_7axis` is an aggregator and ships LAST.

| Order | Slice | Output | Topic flag(s) | depends_on |
|---|---|---|---|---|
| 1 | `21-sector-dominance` | `analytics.sector_dominance` | pace, dominance | (Phase 20 only) |
| 1 | `21-minisector-dominance` | `analytics.minisector_dominance` | pace, dominance | (Phase 20 only) |
| 1 | `21-stint-degradation-curve` | `analytics.stint_degradation_curve` | stint, pace | (Phase 20 only) |
| 1 | `21-tyre-warmup-curves` | `analytics.tyre_warmup` | stint, pace | (Phase 20 only) |
| 1 | `21-fuel-corrected-pace` | `analytics.fuel_corrected_pace` | pace | (Phase 20 only) |
| 1 | `21-pit-loss-per-circuit` | `analytics.pit_loss_per_circuit` | strategy | (Phase 20 only) |
| 1 | `21-weather-impact` | `analytics.weather_impact` | weather | (Phase 20 only) |
| 1 | `21-race-control-incident-index` | `analytics.race_control_incidents` | incident | (Phase 20 only) |
| 1 | `21-overtake-events` | `analytics.overtake_events` | overtake_battle | (Phase 20 only) |
| 1 | `21-traffic-adjusted-pace` | `analytics.traffic_adjusted_pace` | pace, traffic | `20-intervals-parser` |
| 2 | `21-straight-line-dominance` | `analytics.straight_line_dominance` | telemetry, dominance | `20-track-segments-auto` |
| 2 | `21-corner-analysis` | `analytics.corner_analysis` | telemetry, corner | `20-track-segments-corners` |
| 2 | `21-braking-performance` | `analytics.braking_performance` | telemetry, braking | `21-corner-analysis`, `20-track-segments-corners` |
| 2 | `21-traction-analysis` | `analytics.traction_analysis` | telemetry, traction | `21-corner-analysis`, `20-track-segments-corners` |
| 3 | `21-track-dominance-gps` | `analytics.track_dominance_gps` | telemetry, dominance | `21-minisector-dominance`, `21-sector-dominance`, `21-corner-analysis` |
| 3 | `21-battle-segments` | `analytics.battle_segments` | overtake_battle, traffic | `21-overtake-events`, `20-intervals-parser` |
| 3 | `21-drs-effectiveness` | `analytics.drs_effectiveness` | overtake_battle, telemetry | `21-battle-segments` |
| 3 | `21-undercut-overcut-history` | `analytics.undercut_overcut_history` | strategy, stint | `21-pit-loss-per-circuit` |
| 3 | `21-restart-performance` | `analytics.restart_performance` | restart, overtake_battle | `21-overtake-events`, `21-race-control-incident-index` |
| 4 | `21-driver-performance-7axis` | `analytics.driver_performance_score` | driver_score | **all of**: `21-stint-degradation-curve`, `21-pit-loss-per-circuit`, `21-overtake-events`, `21-traffic-adjusted-pace`, `21-restart-performance` |

**Per-slice rev1 acceptance additions**:
- `CORE_CONTRACTS` (`web/src/lib/schemaCatalog.ts`) gets the
  **facade view name** (`analytics.<name>`) appended, NOT the
  storage matview (`analytics.<name>_data`). The matview is
  implementation; the LLM should only see the contract.
- `sql/refresh_manifest.json` (new file from rev1 cross-cutting)
  gets a row for the slice in topological order. The
  `ingest.mjs` post-run hook reads this manifest and refreshes in
  declared order.
- `depends_on` peers MUST already be deployed on the target DB
  before this slice's migration runs (verify-script asserts
  preconditions).

### Phase 22 — Modeling

Same six modeling slices as the taxonomy plan's Phase 15 PLUS one
hard-prerequisite plumbing slice (rev1). Each model is implemented
as a Postgres function or a Node helper that's called from a
synthesis-time tool — NOT pre-materialized — so it can take
runtime parameters (target lap, alternate strategy, etc.).

**Slice 22-A — `runtime-model-tool-plumbing` (HARD PREREQUISITE)**:
defines the tool-call interface every Phase 22 model uses. Two
acceptable implementations, in priority order:
1. If Phase 17-H (tools-use refactor) has shipped: register each
   model as an Anthropic tool; the LLM invokes by name with
   parameters.
2. If 17-H has NOT shipped: a one-off shim in
   `web/src/lib/anthropic.ts` that intercepts question patterns
   matching a model's keywords (`"alternative strategy"`,
   `"battle forecast probability"`, etc.) and routes to the
   model helper directly. Same Node/SQL function signature as the
   17-H form so the future migration is mechanical.

22-A acceptance: a stub model (returns a fixed payload) lands AND is
invokable end-to-end from the chat route via the chosen path; a
unit test asserts the question routes to the model and the
response carries the model's payload. **22-B onward MUST NOT
ship until 22-A's harness is green.**

Each Phase 22 model slice must pass a held-out validation gate:

| Slice | Gate metric |
|---|---|
| `22-tyre-deg-bayesian` | calibration: 90% credible interval coverage on held-out laps |
| `22-battle-forecast` | AUC ≥ 0.65 on held-out overtake-or-not labels |
| `22-overtake-difficulty-index` | rank correlation ≥ 0.6 with actual overtake counts per (circuit, year) |
| `22-safety-car-probability` | log-loss ≤ 0.45 on held-out race lap-windows |
| `22-alternative-strategy-sim` | Monte Carlo sim's actual-lap winners ≥ 90% within ±1 position of real result |
| `22-points-as-they-run` | trivial — exact match with FIA points formula |

### Phase 23 — Product surfaces

**Slice ids (rev8 — enumerated for the seed registry)**: the
taxonomy plan's six `16-*` surface slices renumbered to `23-*`:

| Slice id | Surface | Depends on |
|---|---|---|
| `23-track-dominance-map` | Per-session, per-pair-of-drivers track map colored by dominance | `21-minisector-dominance`, `21-track-dominance-gps` |
| `23-corner-analysis-page` | Picker: session + corner + drivers → entry/turn-in/mid/exit comparison | `21-corner-analysis`, `21-braking-performance`, `21-traction-analysis` |
| `23-stint-degradation-chart` | Per-session, per-driver, lap-by-lap degradation curve overlay | `21-stint-degradation-curve`, `22-tyre-deg-bayesian` |
| `23-driver-performance-card` | 7-axis radar chart per driver per season | `21-driver-performance-7axis` |
| `23-battle-replay` | Time-series scrubber over a battle stretch with both drivers' telemetry | `21-battle-segments`, `21-overtake-events` |
| `23-strategy-simulator` | Interactive "what if X had pitted on lap N?" hitting `22-alternative-strategy-sim` | `22-alternative-strategy-sim`, `22-A-runtime-model-tool-plumbing` |

Each surface is roughly the complexity of a Phase-10 slice (~½ day
through the autonomous loop). Same six dashboard surfaces as the
taxonomy plan's Phase 16. UI behind
a `analyticsv2` feature flag.

---

## Cross-cutting concerns

### Topic-flag growth (Phase 18-A `TopicSignal`)

Phase 21 multiplies the topic taxonomy from 5 flags to ~15. The
`TEMPLATE_TOPICS` map grows accordingly. The Phase 18-A coverage test
(`template-router-topic-coverage.test.mjs`) will fail any new slice
that adds a templateKey without an annotation.

**Compatibility matrix (rev2)**: rev0 implied disjoint flags; rev1
declared primary "mutually exclusive" which broke real `pace+stint`
hybrids already in production (`max_leclerc_lap_degradation_by_stint`,
`max_leclerc_pre_post_pit_pace`, `max_leclerc_stint_pace_vs_tire_age`,
`max_leclerc_fresh_vs_used_tires`). rev2 introduces a flat
**ALLOWED_PRIMARY_PAIRS** set: any pair NOT in this set is rejected
unless one flag is a declared modifier.

```ts
// web/src/lib/deterministicSql/topicGuards.ts (rev2)
export const PRIMARY_TOPICS: ReadonlySet<keyof TopicSignal> = new Set([
  "pace", "stint", "strategy", "corner", "braking", "traction",
  "straight_line", "weather", "incident", "restart",
  "overtake_battle", "driver_score", "dataHealth"
]);

export const MODIFIER_TOPICS: ReadonlySet<keyof TopicSignal> = new Set([
  "dominance", "traffic", "telemetry"
]);

// Pair ⇔ Set<flag>. Any UNORDERED primary pair appearing here is
// allowed; pairs NOT here trigger a `templateAllowsTopic` reject
// when both primaries are present in the signal.
export const ALLOWED_PRIMARY_PAIRS: ReadonlyArray<ReadonlyArray<keyof TopicSignal>> = [
  ["pace", "stint"],            // degradation-by-stint, pre/post-pit pace
  ["stint", "strategy"],        // stint-lengths-as-strategy
  ["pace", "weather"],          // wet-vs-dry pace
  ["stint", "weather"],         // compound choices around weather
  ["pace", "corner"],           // corner-section pace
  ["pace", "straight_line"],    // straight-line pace gap
  ["corner", "braking"],        // brake-into-turn analysis
  ["corner", "traction"],       // exit-traction analysis
  ["pace", "overtake_battle"],  // pace-delta during a battle
  ["overtake_battle", "restart"], // battles after restart
  ["incident", "restart"],      // SC/VSC incident → restart
  ["overtake_battle", "strategy"] // strategic overtakes
];
```

Modifier flags (`dominance`, `traffic`, `telemetry`) compose with
ANY primary they're listed against — no pair-set check, just an
explicit `composesWith` declaration per modifier.

Per-flag rules (rev2 — same as rev1's table for primary `composesWith`,
but now interpreted through the pair set, not "rejects"):

| Flag | Class | Notes |
|---|---|---|
| pace | primary | pairs with stint, weather, corner, straight_line, overtake_battle (per pair set) |
| stint | primary | pairs with pace, strategy, weather |
| strategy | primary | pairs with stint, overtake_battle |
| dominance | **modifier** | composes with pace, corner, sector/minisector, straight_line |
| corner | primary | pairs with braking, traction, pace |
| braking | primary | pairs with corner |
| traction | primary | pairs with corner |
| straight_line | primary | pairs with pace |
| traffic | **modifier** | composes with pace, stint, strategy, overtake_battle |
| weather | primary | pairs with pace, stint |
| incident | primary | pairs with restart |
| restart | primary | pairs with overtake_battle, incident |
| overtake_battle | primary | pairs with strategy, restart, pace |
| driver_score | primary | aggregator — bypasses pair check (composes with all) |
| telemetry | **modifier** | composes with all primaries except dataHealth |
| dataHealth | primary | does not pair (rejected with everything else) |

Implementation: `TopicSignal` keeps its boolean shape. New
`PRIMARY_TOPICS` / `MODIFIER_TOPICS` / `ALLOWED_PRIMARY_PAIRS`
exports. `templateAllowsTopic` rev3 logic:
1. Compute the set of primary flags in the signal (`active_primaries`).
2. **rev3**: if `active_primaries.size === 0`, the signal is
   modifier-only. Reject UNLESS the template's id is in the new
   `MODIFIER_ONLY_TEMPLATE_EXEMPT` set (empty by default —
   adding to it is a deliberate policy decision the coverage test
   flags). Modifier-only signals are typically vague ("track
   dominance", "in traffic") that lack actual analytical intent;
   forcing them to LLM-gen is the safer default.
3. If `active_primaries.size === 1`: allowed.
4. Else (`size >= 2`) for each unordered pair, require the pair to
   be in `ALLOWED_PRIMARY_PAIRS`. Any disallowed pair → reject.
5. Templates declaring an `owns` list containing only modifier
   flags (e.g. `dominance` only) MUST also list at least one
   primary they apply to — the coverage test enforces this.

`MODIFIER_ONLY_TEMPLATE_EXEMPT` is empty in rev3. If a future
template legitimately answers a "just modifiers" intent (e.g. a
"track dominance overview" page that doesn't need a specific
primary), the slice author adds the templateKey to the exempt set
with a one-line justification.

**Regression fixtures (rev2 — added to
`template-router-topic-guards.test.mjs`)**: one test per allowed
pair confirms it routes to the right template. Plus two tests for
disallowed pairs (e.g. `pace+strategy` alone — not in the pair set
unless both are subordinate to `stint` — must reject).

The benchmark scoring uses the same matrix: a question whose
`expected_outcome === "answer"` and topic-signals `pace+dominance`
correctly accepts a `pace`-primary answer with `dominance`-modifier
qualifying language.

### Schema introspection (Phase 17-F `CORE_CONTRACTS`)

Adding `analytics.*` to the introspected catalog means the LLM gets
column docs without hand-typing. Phase 21 slices each append one row
to `CORE_CONTRACTS` and rely on `getSchemaDocs` to do the rest. No
prompt rebuild required.

### Refresh wiring (Phase 18-C ingest hook)

The `scripts/ingest.mjs` post-run refresh today targets
`core.session_completeness_data`. Phase 21 amends it to refresh every
new `analytics.*_data` matview in topological order. Failure of any
single refresh is non-fatal (matview is a perf optimization).

**Refresh manifest (rev1)**: at 20+ matviews, hard-coding the order
in `ingest.mjs` is unwieldy. Phase 19 introduces
`sql/refresh_manifest.json`:
```json
{
  "matviews": [
    {"name": "core.session_completeness_data", "tier": 0, "depends_on": []},
    {"name": "analytics.sector_dominance_data", "tier": 1, "depends_on": []},
    {"name": "analytics.minisector_dominance_data", "tier": 1, "depends_on": []},
    {"name": "analytics.corner_analysis_data", "tier": 2, "depends_on": []},
    {"name": "analytics.track_dominance_gps_data", "tier": 3,
     "depends_on": ["analytics.sector_dominance_data",
                    "analytics.minisector_dominance_data",
                    "analytics.corner_analysis_data"]},
    ...
  ]
}
```
Each Phase 21 slice appends its matview to the manifest in its
own tier. `ingest.mjs` reads the manifest at the post-run hook and
refreshes by tier (parallel within tier, sequential across tiers).
`scripts/refresh_completeness_matview.py` becomes
`scripts/refresh_matviews.py` taking an optional
`--names <comma-list>` so an operator can refresh a subset.

### Honest-failure compliance (rev2/rev3 — `no_data_refusal` is the
right landing spot, not Phase 17-D)

Every `proprietary_no_data` benchmark question (battery, fuel mass,
brake temp, etc.) MUST return a **proactive** `INSUFFICIENT_DATA`
refusal via the new `no_data_refusal` route. The route is a
**deterministic pre-SQL keyword guard** in chatRuntime — phrase-level
matches on `PROPRIETARY_NO_DATA_TOPICS` short-circuit the request
before any Anthropic call.

Phase 17-D's `sql_generation_failed` is **NOT** the right landing
spot here — that path indicates the LLM hallucinated a column,
which 17-C caught. Reaching it on a proprietary-data question
means the proactive guard didn't fire (benchmark grade caps at B).
A normal-shaped synthesized answer caps at C (the chat hallucinated
where it should have refused).

Phase 17-C's column validator still catches the "LLM hallucinated a
column on a SUPPORTED analytics path" class — that path is
unrelated to proprietary-data questions and stays as-is.

### Data-dependent vs schema-only gates (Phase 18-C `OPENF1_ASSUME_POPULATED`)

Phase 21's column-shape verifies and dependent-compile checks run
anywhere; row-count assertions stay gated on
`OPENF1_ASSUME_POPULATED=1`. Empty Neon branches keep working for CI.

---

## Acceptance — what success looks like end-to-end

| Metric | Pre-Phase-19 (post-Phase-18 baseline) | Target after Phase 23 |
|---|---|---|
| Curated 50-question benchmark A-rate | 88% (44/50) | ≥ 90% (no regression) |
| Total benchmarked questions | 50 | ≥ 150 (Phase 19) and ≥ 200 once cross-category lands |
| Categories with at least one A-graded question | ~6 of 18 | 18 of 18 |
| Categories with ≥ 80% A-rate | ~3-4 of 18 | ≥ 12 of 18 |
| `INSUFFICIENT_DATA` honest-fail rate on `proprietary_no_data` | n/a | ≥ 90% |
| New `analytics.*` matviews | 0 | 20 |
| New deterministic templates | 0 | ~20-30 |
| Topic flags in `TopicSignal` | 5 | ~15 |

The before/after snapshot per category becomes the audit-trail of
which slice raised what bar, so future regressions are diffable.

## What this does NOT solve

- **Live-broadcast graphics**: out of scope (post-session only).
- **Team-proprietary telemetry** (battery, ERS, brake temp, fuel
  mass, steering angle, slip angle, damage state): no source data.
  rev2/rev3 routes these via the proactive `no_data_refusal` route
  (deterministic pre-SQL keyword guard); Phase 17-D's
  `sql_generation_failed` caps at B for this question class —
  reaching it means the proactive guard didn't fire.
- **Live data streams**: ingest stays batch / per-session.

## Audit-trail / decisions log

- **Renumbering 13→19, 14→20, 15→21, 16→22, +23**: Phase 13 was
  taken by the Neon backfill runbook; 14-18 were used by Phases 14
  alias resolver / 16 production observability / 17 LLM-SQL / 18
  follow-ups. Phase 19+ is the next free integer.
- **Storage-matview + facade pattern**: chosen for analytics matviews
  too (parallel to Phase 18-C) so dependents stay relkind-stable and
  the refresh path is uniform.
- **Per-category benchmark BEFORE compute slices**: the alternative
  was to write benchmarks per-slice (one author writes both the
  matview and the questions). Rejected — gives biased questions and
  no shared baseline to diff against. Phase 19's separate authorship
  step keeps the grading honest.
- **Topic-flag explosion**: 5 → ~15. The coverage test
  (Phase 18-A) catches missing annotations, so adding a flag is
  cheap (one entry in `TopicSignal` + however many template entries
  reference it).
- **Modeling slices NOT pre-materialized**: each runs as a function
  / helper at synthesis time so it can take runtime parameters.
  Means Phase 22 needs a different "tool-call" plumbing than Phase 21
  (which is matview-only). rev0 punted to "Phase 17-H if shipped,
  else one-off"; rev1 promotes the plumbing to a hard-prereq slice
  `22-A-runtime-model-tool-plumbing` so each subsequent model
  slice ships against a stable interface either way.

- **rev1 schema additions**: `expected_outcome` (3-valued), split
  `expected_tables` / `expected_columns`, `expected_grade_floor`. The
  high-severity finding on `proprietary_no_data` grading depended on
  the grader having a way to tell "honest refusal expected" from
  "forgot to populate the matview"; only an explicit
  `expected_outcome` resolves that.

- **rev1 topic-flag matrix**: declared primary vs modifier at the
  topic level so `dominance` (modifier) composes with
  `pace`/`corner`/`straight_line` (primaries) instead of rejecting
  them. `templateAllowsTopic` extended; coverage test enforces every
  modifier-only template lists at least one primary it composes
  with.

- **rev1 Phase 21 ordering**: explicit topological tiers (1-4) plus
  a `depends_on` per slice. `driver_performance_7axis` is tier 4 —
  ships LAST since it aggregates across tiers 1-3. `track_dominance_gps`
  is tier 3 (depends on minisector + sector + corner). The original
  list-order in rev0 was misleading.

- **rev1 refresh manifest**: 20+ matviews exceed what hand-coded
  refresh order can sanely support. `sql/refresh_manifest.json` is
  the single source of truth for tier-respecting parallel refresh.

- **rev1 `CORE_CONTRACTS` points at facade, not storage**: the
  introspected schema-docs surface should expose stable contract
  names, not implementation details. Storage matviews stay
  invisible to the LLM.

- **rev1 authorship policy**: LLM-assisted question drafting is
  permitted to hit the 150-question floor on schedule, but human
  review + duplicate-check + author-supplied `expected_outcome` /
  `expected_tables` are required; LLM proposes phrasings, humans
  decide what "correct" looks like.

- **rev2 `no_data_refusal` route + tightened grading**: the
  gameable path codex flagged ("ask for `brake_temp` → LLM
  hallucinates the column → 17-C catches it → grader awards A
  because `missingColumns` is populated") is closed by adding a
  proactive `no_data_refusal` route AND making `sql_generation_failed`
  cap at B for `insufficient_data` questions.
  `runtime_clarification` caps at C (wrong refusal class), and a
  normal-shaped answer caps at C (hallucination where refusal was
  expected). Forces the slice author to wire the
  proactive-refusal path BEFORE proprietary-data questions can
  benchmark green.

- **rev2 ALLOWED_PRIMARY_PAIRS**: rev1's "primaries are mutually
  exclusive" was incompatible with already-shipped templates
  (`max_leclerc_lap_degradation_by_stint`, etc.). rev2's pair set
  enumerates the legitimate hybrids and the `templateAllowsTopic`
  rule rejects only pairs that aren't in the set. Regression
  fixtures cover every allowed pair so a future template-router
  refactor can't silently regress them.

- **rev2 per-question floor gate**: rev1's gate was category-only,
  which let a category pass while a key high-complexity question
  silently regressed. rev2 adds per-question
  `expected_grade_floor` enforcement that exits non-zero
  independently of the category-level rate. Default floors per
  complexity tier so authors don't have to set the field on every
  question.

- **rev2 fully-qualified `expected_columns`**: rev1's unqualified
  `["compound_name"]` would false-pass on any analytics SQL since
  `session_key` / `driver_number` / `lap_number` are touched by
  every query. rev2 mandates `<schema>.<table>.<column>` form so
  the column assertion actually proves the LLM picked the intended
  contract.

- **rev2 metric naming**: "Categories with ≥ 0% A-rate" is true by
  definition; rev2 changes both rows to "categories with at least
  one A-graded question" so the before/after delta is meaningful.

- **rev3 floor activation lifecycle**: rev2's per-question floor
  gate would fire IMMEDIATELY at the Phase 19 baseline because
  Slice 19-B intentionally writes 0-A-grade questions for the new
  categories. rev3 adds `floor_active_after_slice` so authors can
  declare which lift slice activates the floor. Each Phase 21
  slice has a cleanup acceptance step that nulls the field on
  questions it lifts.

- **rev3 grade source**: rev2 said "achieved adequacyGrade", but
  `adequacyGrade` is the chat route's coarse runtime quality field
  (no rubric pass). rev3 gates on `baselineGrade` (rubric output
  from `chat-health-check-baseline.mjs`). Optional axis floors
  for slice authors who need `factual_correctness ≥ A` but
  tolerate `clarity = B`.

- **rev3 `no_data_refusal` is deterministic pre-SQL, not LLM-
  planner-driven**: rev2 wording was internally inconsistent.
  rev3 pins the route as a phrase-level keyword guard in
  chatRuntime, runs before any Anthropic call, never invokes
  `generateSqlWithAnthropic`. Adds `no_data_refusal` to the
  `expected_path` enum.

- **rev3 phrase-level keyword set**: rev2 used bare-token keywords
  (`"brake"`, `"fuel"`, `"slip"`) which would false-trigger on
  legitimate analytics questions ("how late does Norris brake at
  Turn 1", "fuel-corrected pace", "slipstream on the main
  straight"). rev3 mandates phrase-level matches
  (`"brake temperature"`, `"fuel mass"`, `"slip angle"`) plus
  adjacency negative fixtures in the no-data-refusal unit test.

- **rev3 modifier-only signal rejection**: rev2 allowed
  `active_primaries.size <= 1` which let modifier-only signals
  pass. rev3 requires at least one primary unless the template is
  in the explicit (initially empty) `MODIFIER_ONLY_TEMPLATE_EXEMPT`
  set.

- **rev3 stale wording cleanup**: two paragraphs still said 17-D
  is the right landing spot for proprietary-data questions. rev3
  rewrites both to point at `no_data_refusal` and explicitly
  notes that 17-D's `sql_generation_failed` caps at B for that
  question class.

- **rev4 emit/allow-list completeness**: rev3 added
  `floor_active_after_slice` as the activation lifecycle field
  but didn't update the emit-path projection or the grader
  allow-list. rev4 adds it to both, and the unit fixture asserts
  it survives into graded JSON — without that the entire
  activation lifecycle would silently no-op.

- **rev4 schema example fix**: the rev0/rev1 example block still
  showed unqualified `expected_columns`, contradicting rev2/rev3's
  normative requirement. rev4 fixes the example to qualified form
  with an inline comment so future authors don't copy the bad
  shape.

- **rev4 machine-readable slice status**: rev3 said the gate
  reads merge state from `_state.md`, but that file is human
  prose. rev4 introduces `diagnostic/slices_status.json` (machine-
  readable) as the gate's source of truth, with a backstop
  cleanup-or-fail rule: a slice marked `"merged"` MUST have its
  `floor_active_after_slice` cleanup applied in the same PR;
  otherwise the gate fails.

- **rev4 typed `no_data_refusal` runtime contract**:
  `ChatRuntimeResult` becomes a discriminated union with an
  explicit `kind: "no_data_refusal"` arm. Forces every consumer
  to handle the case at compile time and prevents the refusal
  from leaking through `resolution.status` or
  `completeness.available`.

- **rev4 alias-aware `expected_columns` matching**: rev2/rev3
  required qualified column refs but didn't say how to match
  them against aliased generated SQL. rev4 reuses the Phase 17-C
  pgsql-ast-parser alias map so `ca.entry_speed_kph` resolves to
  `analytics.corner_analysis.entry_speed_kph` before the
  expected-columns comparison. Unit fixture covers explicit /
  implicit / CTE alias cases.

- **rev5 unknown-slice-id fail-fast**: rev4's gate skipped per-
  question floor checks when the named slice wasn't `"merged"`,
  but a typo or never-landed slice id resolved to "not in JSON" →
  silently suppressed forever. rev5 adds startup validation: every
  non-null `floor_active_after_slice` MUST resolve to a row in
  `slices_status.json`; unknowns fail the gate with a list of
  offending question/slice pairs.

- **rev5 explicit `extractQualifiedColumnRefs` helper**: rev4
  overclaimed Phase 17-C reuse (the validator's alias map was
  private). rev5 spells out the actual change: refactor
  `columnExistenceCheck.ts` to extract alias-map construction +
  ref resolution into an exported `extractQualifiedColumnRefs`
  helper. `validateColumnExistence` now calls it internally so
  one alias-resolution implementation serves both Phase 17-C and
  Phase 19's matcher.

- **rev5 CTE policy narrowed**: rev4 said the matcher "covers
  CTE-derived alias cases" — but the existing validator
  intentionally marks CTE/subquery aliases as `derived` and skips
  them. rev5 narrows acceptance: the matcher resolves only base-
  table aliases (explicit AS, implicit alias = table name).
  CTE/subquery alias columns are reported via
  `unresolvedAliases` and the matcher fails open (logs, does NOT
  false-fail). Slice authors needing CTE-projected coverage
  rewrite the question or rely on `expected_tables` matching.

- **rev5 stale "Phase 17-D honest-fail" line**: one bullet in
  "What this does NOT solve" still pointed at 17-D for proprietary
  telemetry. rev5 rewrites to point at `no_data_refusal` and
  notes the 17-D B-cap.

- **rev5 slice count corrected**: rev0 said "~36"; the actual
  count after rev1's `22-A-runtime-model-tool-plumbing` addition
  is 4 + 3 + 20 + 7 + 6 = **40 slices**. Heading updated.

- **rev6 tri-state `expected_columns` outcome**: rev5's
  fail-open semantics let CTE-projected SQL or unparseable SQL
  silently bypass the contract assertion. rev6 splits the
  outcome into `pass | fail | skipped`. `skipped` requires an
  explicit per-question `column_match_waiver: true` +
  `author_note` to count as not-a-regression; without a waiver,
  `skipped` fails the gate. Forces author intent to be visible
  in the question file rather than a silent `ok: false` in
  matcher logs.

- **rev6 `slices_status.json` seeding**: rev5's fail-fast on
  unknown slice ids would have broken the FIRST Slice 19-B PR
  because that PR writes questions referencing future Phase
  21/22/23 lift slices. rev6 makes the seed file a mandatory
  Slice 19-D deliverable: the registry ships pre-populated with
  every planned Phase 21/22/23 slice id at `status: "pending"`,
  so the first 19-B PR doesn't trip the unknown-id check.

- **rev6 schema doc dual examples**: rev4 used a JSONC example
  with `//` comments. Question files must be valid JSON. rev6
  mandates the schema doc include BOTH a JSONC explanation block
  AND a copy-paste-valid JSON block of the same record so
  authors don't paste comments into real question files.

- **rev7 waiver-pair preservation**: rev6 added
  `column_match_waiver` + `author_note` to the question schema
  but didn't extend the emit-path or grader allow-list, so the
  fields would have been silently stripped. rev7 patches both
  lists and asserts each field appears in graded JSON — the
  gate's "skipped + waiver respected" branch depends on the
  waiver being visible in the graded record, so the survival
  assertion is load-bearing.

- **rev7 seed-scope correction**: rev6 said seed Phase 21/22/23
  ids only (33 total), but the slice-budget table actually sums
  to 40 across Phase 19-23. A `floor_active_after_slice`
  pointing at a Phase 19 or 20 slice would have tripped the
  rev5 unknown-id fail-fast. rev7 widens the seed to all 40
  ids and lists them by phase in the Slice 19-D step.

- **rev8 Phase 23 ids enumerated**: rev7 required all 40 ids to
  be seedable, but Phase 23 was still a generic "six dashboard
  surfaces" with no names. rev8 names the six concrete `23-*`
  ids (track-dominance-map, corner-analysis-page,
  stint-degradation-chart, driver-performance-card,
  battle-replay, strategy-simulator) with `depends_on` per
  surface, so the seed registry is fully mechanical from the
  plan tables.

## Codex audit ask

This plan extends the original taxonomy plan into the post-Phase-18
codebase and adds the per-category benchmark scaffolding the user
asked for. Audit for:

1. **Phase 19 schema correctness**: is the `complexity` /
   `expected_path` / `expected_columns` shape sufficient for
   per-slice acceptance to publish a credible "before/after" lift,
   or does it need `expected_grade_floor` per question too?
2. **Topic-flag explosion**: 5 → ~15. Are there any topic-pair
   `rejectIfPresent` rules that the current taxonomy obviously
   misses? Specifically: does `dominance` need to reject `pace`,
   or do they overlap legitimately (a "who was faster in sector
   2" question is both)?
3. **Phase 21 slice independence**: each compute slice should be
   independently shippable (slice author can run its own
   before/after benchmark). Are there cross-slice dependencies the
   plan misses? E.g. `corner_analysis` likely depends on
   `track_segments` plus a real-corner reference table I haven't
   listed.
4. **Modeling slice plumbing (Phase 22)**: the plan punts to
   Phase 17-H (tools-use) for runtime model invocation. If
   Phase 17-H is the right home, should Phase 22 be reordered to
   wait on it? Alternative: ship the one-off plumbing in Phase 22
   and refactor onto tools-use later.
5. **Benchmark question authorship**: 150+ questions is a lot to
   author manually. Is partial LLM-assisted question generation
   acceptable, with hand-grading the generated set? Or is the cost
   of manual authorship the right floor here?
6. **Cross-category question tier**: 9 questions that span multiple
   matviews. Are they redundant with the per-category high-tier
   questions, or do they exercise something distinct (i.e.,
   route-level reasoning across multiple SQL queries)?
7. **Phase 23 surface prioritization**: 6 dashboard pages. Should
   the plan defer all six until Phase 21 + 22 are done, or
   interleave (e.g. ship `track-dominance-map` immediately after
   slice 21-minisector-dominance lands)?

If APPROVED, next step is generating the Phase 19 benchmark question
files (one per category) and running the baseline against the
post-Phase-18 dev server so we have the "before" numbers committed
before slice 21-* shipping begins.
