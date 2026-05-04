# Phase 25 — Remaining 77 non-A questions roadmap — 2026-05-04 (rev9: Phase 25.1 implemented + demonym fix + 6/6 lift)

(Title says "77" not "75" per codex audit pass 5 — the Phase-24
merged_skipped questions are also still non-A and must be in scope
to close the 167-total arithmetic. Codex audit pass 6 then
promoted q1941 from merged_skipped → Phase 25.1, leaving **only
q2182** in the merged_skipped bucket. Filename keeps
`remaining_75` to preserve the existing repo path; document title
is the source of truth for scope.)

## rev9 changes (Phase 25.1 implementation — 2026-05-04)

Phase 25.1 shipped on `phase25.1/escalated-six` (commit `1d5c39c` =
base race-shaped markers + intermediate-tyre routing + FIA-pit-log
classification, then a follow-up commit with the demonym table +
in-string-semicolon prompt tweak). Live re-validation against all 6
escalated questions: **6/6 → A**, exceeding the plan's projection of
4 A + 2 B.

- **HIGH (live re-validation surfaced demonym alias-derivation bug)**
  — first live pass after the rev8 code merge showed all 5
  Hungary/Singapore/Imola/Australia 2025 questions resolved to
  Abu Dhabi (session 9839) because `core.session_search_lookup`
  indexes country names (`hungary`, `australia`, `italy`) and
  circuit short names (`imola`, `monza`, `hungaroring`), but
  `extractVenueHints` only emitted demonym tokens (`hungarian`,
  `australian`, `italian`). The chat alias list passed to the
  search_lookup query never matched the actual venue rows, so the
  lookup fell through to generic-token matches (`gp`, `grand prix`)
  that hit every 2025 race session — and the scorer tie-broke to
  the latest-date 2025 race (Abu Dhabi). Two probe scripts under
  `web/scripts/phase25_probe_*.mjs` confirmed the data was healthy
  (all 24 2025 race sessions had ≥7 aliases each) and the bug was
  purely in the chat alias-derivation. **Fix**: added a
  `VENUE_DEMONYM_ALIASES` table to `chatRuntime.ts:extractVenueHints`
  mapping each demonym to its matching country + circuit_short_name
  aliases (`hungarian` → `["hungary","hungaroring","budapest"]`,
  `australian` → `["australia","melbourne"]`, etc). 24 demonym
  triggers cover all 2025 venues. Unit fixture in
  `chatRuntime-resolution-race-shaped.test.mjs` pins the table
  contract.
- **MEDIUM (q2184 multi-statement-rejection bug)** — even after
  the data_health_question classification fix, q2184's LLM was
  embedding the FIA-pit-log caveat **inside a SQL string literal**
  with a semicolon (`'FIA pit log not ingested; only raw.pit
  available'`). `assertReadOnlySql` does a naive `includes(";")`
  check that doesn't respect string literals, so the SQL was
  rejected as multi-statement. **Fix**: tightened the system-prompt
  guidance: "do not embed semicolons or multi-clause notes inside
  SQL string literals (the FIA-pit-log caveat belongs in the
  synthesis text, not the SQL output)". Post-fix, q2184 grades A
  in 21s (was C → 30s timeout).
- **DOWNGRADED (q1945 / q2184 manifest entries no longer needed?)**
  — both questions reached A on live re-validation despite plan
  projecting them at B. The manifest entries remain in
  `phase25_target_grades.json` as belt-and-suspenders for the gate;
  the gate's `phase25_target_grade=B` is the floor (an A grade
  satisfies a B-or-better gate), so an actual A is not a failure.
  Whether these stay A reliably across runs depends on LLM
  variance — q1945's first attempt graded C, second graded A; same
  for q1940/q2121 (each had one C flake before settling at A).
  Per-question retry buffer ≥3 in benchmarks recommended.
- **OUTCOME MATH UPDATE** — projection unchanged at 157/167 since
  the manifest target for q1945/q2184 remains B (we just over-
  achieve it). If we eventually demote them out of the manifest
  (after stable-A confirmation across 5+ runs), aggregate would
  rise to 159/167 (95.2%).

## rev8 changes (codex audit pass 8 — 2026-05-04)

- **LOW (per-question validation manifest count stale at 6)** —
  the implementation-guidance section at line ~534 said the
  manifest covers "the 6 questions" where Phase 25 acceptance
  differs from the source `expected_grade_floor`, but rev6 added
  q2182 and the manifest now has 7 qids (q1715, q1945, q2008,
  q2182, q2184, q2206, q2207). **Fix**: count updated to 7 with
  the full qid list inline so a future implementer doesn't have
  to cross-reference the manifest to know what's covered.
- **LOW (q1941 risk note omits q1941 from the shared-rule set)** —
  rev7 cleaned up the q1940 prose to list `q1940 / q1941 / q1945
  / q2120`, but q1941's own Risk note still said "same composite
  fix as q1940 / q1945 / q2120". **Fix**: parenthetical note
  added clarifying q1941 joins the shared resolver set.

## rev7 changes (codex audit pass 7 — 2026-05-04)

- **MEDIUM (stale "2 Phase-24 merged_skipped" prose)** — rev6's
  bucket table and outcome math correctly show 1 merged_skipped
  (q2182 only) and 6 escalated, but the title note (line 3) and
  Section 6 preamble (line 747) still said "2 Phase-24
  merged_skipped questions q1941 / q2182". A future implementer
  reading just the prose could be misled back into the rev5 model.
  **Fix**: title note and Section 6 preamble both updated to say
  q1941 was promoted to Phase 25.1 in rev6 and **only q2182**
  remains merged_skipped. The Section 1 lead-in at line 197 is
  also rewritten to match.
- **LOW (q1940 shared-rule list omitted q1941)** — rev6 added
  q1941's `start on` / `started on` markers to the same composite
  resolver, but the q1940 prose at line 258 still says
  "q1940 / q1945 / q2120 all fire this rule." **Fix**: list
  updated to `q1940 / q1941 / q1945 / q2120` so the audit trail
  around the new `start on` marker is intact.

## rev6 changes (codex audit pass 6 — 2026-05-04)

- **HIGH (Phase-24 merged_skipped bucket not wired into the gate)** —
  rev5 held q1941 at C and q2182 at B in the plan, but neither
  appeared in `phase25_target_grades.json`. The PR-time gate reads
  manifest first, then source JSON `expected_grade_floor`. Both
  source records have `expected_grade_floor: "A"`, so the gate
  would have failed on both. **Fix**: q2182 added to the manifest
  with `phase25_target_grade: "B"` + rationale + escape_to_authored_floor.
  q1941 moved into Phase 25.1 (see MEDIUM below) so it lifts to A
  and no manifest entry is needed.
- **MEDIUM (q1941 mis-bucketed as no-iteration-path)** — q1941 is
  low-complexity (`expected_columns: core.stint_summary.compound_name`)
  and failed via `runtime_clarification`, the same class as q1940 /
  q1945 / q2120 that Phase 25.1 already fixes via the composite
  venue+year+race-shaped resolver. **Fix**: q1941 promoted from
  Phase-24 merged_skipped → Phase 25.1. Added `started on` and
  `start on` to `RACE_SHAPED_MARKERS` so q1941 ("Verstappen start
  on at the 2025 Singapore GP") fires the same composite path as
  q1940. New section in Section 1 specifies the validation SQL
  (single-table `core.stint_summary` lookup for stint 1's compound).
  Phase 25.1 bucket grows from 5 → 6; merged_skipped bucket
  shrinks from 2 → 1 (q2182 only); 77 total non-A is preserved.
- **OUTCOME MATH UPDATE** — Phase 25.1 now produces 4 newly-A
  (q1940, q2120, q2121, q1941) + 2 B (q1945, q2184). Aggregate
  shifts from 156/167 (93.4%) → **157/167 (94.0%)**. B count
  unchanged (q1945 + q2184 + 4 source-B from 25.2 + q2182 = 7).
  C count drops from 4 → 3 (q1941 leaves the C bucket).

## rev5 changes (codex audit pass 5 — 2026-05-04)

- **HIGH (scope vs arithmetic mismatch)** — rev4 said "75 non-A
  remain" but Section 6's outcome math reached 167 only by adding
  q1941 + q2182 outside the declared scope. **Fix**: scope expanded
  to **77 non-A** with a third explicit bucket "Phase-24
  merged_skipped (held at baseline grade)". The new Section 1
  bucket table sums to 77; the Section 6 outcome math now
  explicitly partitions all 77 into Phase 25.1 (5) + Phase 25.2 (70)
  + Phase-24 skipped (2) so each addend is traceable.
- **MEDIUM (q2184 target ambiguity)** — manifest said B, plan said
  "A if caveat present". Since the PR-time gate reads a single
  `phase25_target_grade` value, conditional targets are
  unenforceable. **Fix**: q2184 committed to **B** unconditionally
  in both the plan section and the manifest. Acceptance is stable
  B with manifest-vs-observed counts + a one-line FIA-data-not-
  ingested caveat. The "path to A" is documented in the manifest's
  `escape_to_authored_floor` (rewrite the question OR add a rubric
  exception) but is out of Phase 25 scope.
- **LOW (q1945/q2184 mislabeled as C-caps)** — wording bug; both
  are B-targets. **Fix**: rev4 outcome-math rewrite already
  corrected the labels to "manifest B-caps" (q1945 / q2184) vs
  "manifest C-caps" (q2008 / q2206 / q2207). Verified no remaining
  mislabel via grep sweep.

## rev4 changes (codex audit pass 4 — 2026-05-04)

- **HIGH (outcome math double-counted q2184; C-bucket miscount)** —
  rev3's Phase 25.1 said "4 of 5 → A" but q2184 is manifest-capped
  at B; the same q2184 was also counted in the "newly B" bucket.
  Section 6 also said "2 of 70 → C" while the manifest lists 3
  C-cap qids (q2008, q2206, q2207). **Fix**: rebuilt the outcome
  math from first principles. New tally: **156 A / 7 B / 4 C =
  167** (Phase 25.1: 3 A + 2 B; Phase 25.2: 63 A + 4 B + 3 C; plus
  Phase-24 merged_skipped q2182 → B and q1941 → C). Top-level
  aggregate updated from 155/167 (92.8%) to **156/167 (93.4%)**.
- **MEDIUM (q1715 audit-ask says target B but manifest says A)** —
  rev3's per-slice audit-ask block for `21-corner-analysis` still
  said "Authored target grade: B" for q1715, contradicting the
  manifest which has `phase25_target_grade: A`. **Fix**: rewrote
  q1715's audit-ask to match the manifest (single-table lookup,
  target A) so the lift PR validates against the right target.
- **MEDIUM (q2184 SQL prose vs validation SQL inconsistency)** —
  rev3's prose said `COUNT(DISTINCT (driver_number, lap_number))`
  for the observed pit-row metric, but the validation SQL used
  `COUNT(*)`. The two would produce different "manifest-vs-observed
  gap" rows. **Fix**: aligned both to `COUNT(*)` (matches what
  `core.session_completeness.pit_rows` actually counts — raw row
  insertions, not unique pit events).
- **LOW (stint-degradation audit ask references q2027)** — rev1
  replaced already-A q2027 with q2026 in the lift table, but the
  audit-ask block at the bottom of the slice still referenced
  q2027. **Fix**: updated to q2026 with a note explaining the
  rev1 swap.

## rev3 changes (codex audit pass 3 — 2026-05-04)

- **HIGH (target-grade gate not grounded in question metadata)** —
  rev2's gate text said targets come from `expected_grade_floor`,
  but several questions the plan classifies at B / C have source
  JSONs with `expected_grade_floor: "A"` (q1715, q1945, q2184).
  **Fix**: shipped
  [diagnostic/phase25_target_grades.json](phase25_target_grades.json),
  a manifest of explicit per-qid `phase25_target_grade` overrides
  with rationale + `escape_to_authored_floor` notes. The PR-time
  gate reads the manifest first, falling back to source JSON's
  `expected_grade_floor` if the qid is not listed. Manifest covers
  6 questions (q1715 promoted A, q1945 / q2008 / q2184 / q2206 /
  q2207 capped). Section 6 outcome math updated:
  **155 A / 9 B / 3 C** (was 154 A / 9 B / 4 C).
- **MEDIUM (q2184 SQL doesn't satisfy expected_tables contract)** —
  source JSON requires both `core.session_completeness` AND
  `raw.pit`; rev2's SQL only used the former. **Fix**: rewrote q2184
  validation SQL as a manifest-vs-observed JOIN of
  `core.session_completeness.pit_rows` and a `COUNT(*)` aggregate
  from `raw.pit`. Synthesizer also instructed to surface the "FIA
  pit log not directly available" limitation. Target grade tied to
  whether the limitation note ships (B without it; A with).
- **LOW (q1940 risk note)** — rev2's risk note still said
  "composite marker requires Grand Prix reference"; the rule is
  actually `hasStrongVenueYearAnchor + race-shaped token`. **Fix**:
  rewrote the risk note to match the rev2 generalization.

## rev2 changes (codex audit pass 2 — 2026-05-04)

- **HIGH (q1945 not covered by composite Grand Prix rule)** — the
  rev1 rule required `"Grand Prix" + year + race-shaped token`, but
  q1945 says "at Imola 2025" (no `Grand Prix`). **Fix**: generalized
  to `venue+year anchor + race-shaped token` (codex's recommended
  shape). Now q1940 ("2025 Hungarian Grand Prix" + "first stint"),
  q1945 ("Imola 2025" + "first stint"), and q2120 ("2025 Hungarian
  Grand Prix" + "run wet or dry") all fire the same rule. Deny-list
  (`pole`/`qualifying`/`sprint`/`FP*`/`practice`/`long run`) stays
  dominant. Section "q1940 — Concrete fix" rewritten to use the
  generalized formulation.
- **HIGH (per-slice gate vs B/C-ceiling math)** — rev1's per-slice
  ship template required every lifted question to grade A, which
  conflicts with Section 6's expectation that 8 of 70 land at B and
  2 of 70 at C. **Fix**: per-question validation gate now checks
  against the **authored target grade per qid** (`expected_grade_floor`
  in the question JSON), not universal A. The Phase 24 autonomous
  loop's success criterion changes from "reaches A" to "meets target
  grade".
- **MEDIUM (top-level aggregate stale)** — corrected the §"Realistic
  ceiling estimate" / Section 0 line from `155/167 (93%)` to
  `154/167 (92.2%)` to match Section 6's recomputed math.
- **MEDIUM (q1715 audit notes contradiction)** — rev1 fixed the
  table row but the codex-audit-ask block still claimed q1715 had
  `expected_outcome=clarification`. Removed; replaced with the actual
  entry/exit-speed acceptance criteria.
- **LOW (q2167 in driver-performance audit ask)** — q2167 was
  removed from the lift list in rev1 (already-A) but the audit ask
  still listed it. Dropped from the audit ask.

## rev1 changes (codex audit pass 1 — 2026-05-04)

- **HIGH (Section 3 sync)** — Per-slice question lists were
  regenerated directly from
  `diagnostic/phase_19_baseline_2026-05-04.json` so they match the
  actual non-A deferred set. Specific corrections:
  - `21-race-control-incident-index` (8 q): now correctly lists
    `2067, 2100, 2140, 2142, 2143, 2144, 2145, 2146` (was missing
    2067 / 2100, was duplicating 2143, was incorrectly including
    already-A 1905).
  - `21-driver-performance-7axis` (7 q): now correctly lists
    `2160, 2161, 2162, 2163, 2164, 2165, 2166` (was including
    already-A 2167; 2167 is removed).
  - `21-stint-degradation-curve` (8 q): now correctly lists
    `1947, 1949, 2020, 2024, 2026, 2028, 2203, 2207` (was including
    already-A 2027; replaced with 2026 from baseline).
  - All 17 slice tables verified against baseline.
- **HIGH (q1715)** — fixed misdescription. q1715 is "Compare Piastri
  and Russell entry vs exit speed through Tarzan at Zandvoort 2025"
  with expected_tables `analytics.corner_analysis`. Treated as a
  real corner-analysis lift, not a clarification case.
- **MEDIUM (aggregate math)** — rewrote the §6 outcome table as
  proper outcome math: `90 already A + 4 escalated → A + 60 deferred → A
  + 13 stays not-A = 167`. No more double-counting.
- **MEDIUM (q1945 graining)** — reclassified. q1945 asks whether
  graining "cut short" the stint. Public data can prove early-stop
  (stint_length_laps) but cannot prove the *cause* was graining.
  The fix lifts it to an honest **B ceiling** (answer cites stint
  length + invites the human to interpret), NOT A. Acceptance for
  q1945 is "B grade is the floor; A would require a proprietary
  tyre-thermal-condition signal we don't ingest."
- **LOW (`Grand Prix` marker)** — relaxed from standalone marker to
  **composite venue+year+race-shaped term** (codex audit pass 2
  generalized this further: q1945 says "at Imola 2025" without
  "Grand Prix", so a `Grand Prix`-only rule would miss it). The
  fix requires:
  - A venue+year anchor (existing `hasStrongVenueYearAnchor`
    detection — works for both "2025 Hungarian Grand Prix" and
    "Imola 2025"), AND
  - At least one race-shaped token from `RACE_SHAPED_MARKERS`
    (`first stint`, `pit stop`, `run wet`, `run dry`,
    `closing laps`, `stint length`, etc.).
  
  Quali / pole / sprint / FP markers stay dominant via the deny-list.

After Phase 24's autonomous loop finished (11 merged + 2 skipped + 5
escalated), **77 questions remain non-A** (codex audit pass 5
correction — was incorrectly stated as 75; the Phase-24
merged_skipped questions are also still non-A and must be in scope
to close the outcome-math arithmetic. Codex audit pass 6 then
promoted q1941 from merged_skipped → Phase 25.1 once it was
re-classified as the same `runtime_clarification` family as q1940
/ q1945 / q2120 — leaving only q2182 in the merged_skipped
bucket):

| Bucket | Count | Lift mechanism |
|---|---:|---|
| Escalated active-floor (Phase 24 couldn't form a hypothesis) | 6 | Per-question manual hypothesis with concrete SQL plan + autonomous re-run (codex audit pass 6 promoted q1941 from merged_skipped → escalated, +1) |
| Deferred-floor (waiting for Phase 21 lift slices) | 70 | Ship the matview + cleanup `floor_active_after_slice` in same PR |
| Phase-24 merged_skipped (q2182 baseline B, manifest-capped) | 1 | Out of Phase 25 active scope; held at baseline B via manifest entry. Counted in the outcome math under "stays at baseline" |
| **TOTAL** | **77** | |

This plan specifies the lift approach **per question** so codex can
audit the concrete SQL / prompt / matview shape rather than the
high-level fix vector.

Aggregate target: **A-rate 90/167 (54%) → 157/167 (94.0%)** (codex
audit pass 6 lifted from rev5's 156 — q1941 promoted from
Phase-24 merged_skipped C → Phase 25.1 A via the same composite
race-shaped resolver fix as q1940/q1945/q2120). The remaining 10
questions split into 7 final B (4 source-B from 25.2 + q1945 +
q2184 + q2182 Phase-24-skip) and 3 final C (q2008/q2206/q2207
manifest C-caps).

---

## Section 1 — Escalated 6 (active-floor manual triage)

These hit the Phase 24 loop's iteration cap or REVISE-streak escalator
because codex couldn't form a workable hypothesis from the failure-mode
classifier alone (q1941 was promoted from Phase-24 merged_skipped to
this section in codex audit pass 6 once the failure mode was
re-classified as the same `runtime_clarification` family as
q1940/q1945/q2120). Each has a known concrete fix; the autonomous
loop just needed more context. Approach: ship a **per-question
hypothesis fixture file** that pre-loads the loop with the right
hypothesis, re-launch the loop on these 6 only.

### q1940 — "How long was Norris's first stint at the 2025 Hungarian Grand Prix?"
- **Failure mode**: `runtime_clarification` (resolver picked qualifying instead of race).
- **Concrete fix** (codex audit passes 1 + 2 — composite
  venue+year+race-shaped, NOT bare "Grand Prix"; bare-"Grand Prix"
  would miss q1945's "Imola 2025" phrasing):
  extend [chatRuntime.ts](../web/src/lib/chatRuntime.ts) so race-
  shaped intent fires when **ALL** of:
  1. `hasStrongVenueYearAnchor === true` (existing detection — works
     for both "2025 Hungarian Grand Prix" and "Imola 2025"), AND
  2. The text contains at least one race-shaped token from the
     existing `RACE_SHAPED_MARKERS` (e.g. `first stint`, `pit stop`,
     `closing laps`, `stint length`, `run wet`, `run dry`, etc.), AND
  3. NO `SESSION_TYPE_SENSITIVE_MARKERS` token is present (`pole`,
     `qualifying`, `Q1/Q2/Q3`, `sprint`, `FP1/FP2/FP3`, `practice`,
     `long run`) — deny-list dominates.
  
  So:
  - "pole at the Hungarian Grand Prix" → still clarifies (deny-list).
  - "first stint at the Hungarian Grand Prix 2025" → resolves to race.
  - "first stint at Imola 2025" → resolves to race (no `Grand Prix`
    needed; the venue-year anchor + race-shaped token suffices).

  q1940 / q1941 / q1945 / q2120 all fire this rule (each has
  venue+year + a race-shaped token + no deny-list trigger). q1941
  was added to this list in codex audit pass 6 once the
  `start on` / `started on` markers were appended to
  `RACE_SHAPED_MARKERS`.
- **Validation SQL** (what the LLM should produce after the fix):
  ```sql
  SELECT stint_length_laps FROM core.stint_summary
  WHERE session_key = <hungary_2025_race> AND driver_number = 4
        AND stint_number = 1
  ```
- **Expected A-grade evidence**: rowCount ≥ 1, answer cites a specific lap count.
- **Risk**: low — composite marker requires `hasStrongVenueYearAnchor`
  AND a race-shaped token AND no deny-list match, so
  quali/sprint/practice questions don't false-trigger. (Codex audit
  pass 3 corrected the prior "requires Grand Prix reference" wording
  — the rev2 generalization works on any venue+year anchor, not
  just `Grand Prix`.)

### q1941 — "What compound did Verstappen start on at the 2025 Singapore GP?"
- **Failure mode**: `runtime_clarification` (resolver returned 3
  candidate session keys despite the question naming "the 2025
  Singapore GP" — same root cause as q1940 / q1945 / q2120; the
  composite race-shaped intent did not fire because `start on` was
  not in `RACE_SHAPED_MARKERS`).
- **Concrete fix** (codex audit pass 6 — promoted from Phase-24
  merged_skipped to Phase 25.1):
  add the substrings `start on` and `started on` to
  `RACE_SHAPED_MARKERS` in
  [chatRuntime.ts](../web/src/lib/chatRuntime.ts). Combined with
  `hasStrongVenueYearAnchor("2025 Singapore GP") === true` and no
  deny-list match, q1941 then fires the composite race-shaped
  resolver and pins the Singapore 2025 race session.
  
  Risk note on `start on` token width: the substring match could
  in principle false-trigger on phrases like "What did Norris start
  on the medium for?" but the deny-list (`pole`/`qualifying`/
  `sprint`/`FP*`/`practice`/`long run`) is dominant, and the
  composite rule still requires `hasStrongVenueYearAnchor`. Add a
  unit fixture in
  [chatRuntime-resolution-race-shaped.test.mjs](../web/scripts/tests/chatRuntime-resolution-race-shaped.test.mjs)
  asserting q1941's exact phrasing fires race-shaped intent AND
  asserting "Verstappen's pole at Singapore 2025" still resolves
  to clarification (deny-list dominance).
- **Validation SQL**:
  ```sql
  SELECT s.compound_name
  FROM core.stint_summary s
  WHERE s.session_key = <singapore_2025_race>
        AND s.driver_number = 1 AND s.stint_number = 1
  ```
- **Expected A-grade evidence**: rowCount = 1, answer names a
  compound (e.g. "soft", "medium", "hard"). Grade target **A**
  (source `expected_grade_floor: "A"`; manifest entry not needed
  since target = source).
- **Risk**: low — same composite fix as q1940 / q1945 / q2120
  (q1941 joins this shared resolver set), with the additional
  `start on` / `started on` markers covered by the new unit
  fixture.

### q1945 — "Was Piastri's first stint at Imola 2025 cut short by graining on the front-right?"
- **Failure mode**: `runtime_clarification` (similar — venue+year + first-stint phrasing).
- **Concrete fix** (codex audit pass 1 — reclassified to B-ceiling):
  question fires the new composite race-shaped path (`Imola 2025` +
  `first stint`). Resolver pins the Imola 2025 race session, SQL
  generation produces stint metadata.
  
  HOWEVER, the question asks about *causation* — "cut short BY
  graining". Public data shows the stint length and compound; it
  CANNOT prove the cause was graining. The realistic ceiling is **B**:
  the answer cites the stint length + compound + invites the human
  to interpret whether early-stop pattern is consistent with graining.
  
  An A-grade would require either (1) a proprietary tyre-thermal-
  condition signal we don't ingest, or (2) a rubric exception that
  awards A for honest "cause-unknown but stint-length-known"
  answers. Without (2), B is the cap.

  **Decision**: ship Phase 25 fix that reaches B reliably; flag q1945
  as a candidate for a Phase-19-B *question rewrite* (drop the
  "by graining on the front-right" causation clause and replace
  with "what was the stint length and compound").
- **Validation SQL**:
  ```sql
  SELECT s.stint_length_laps, s.compound_name, s.tyre_age_at_start
  FROM core.stint_summary s
  WHERE s.session_key = <imola_2025_race>
        AND s.driver_number = 81 AND s.stint_number = 1
  ```
- **Expected outcome**: **B-grade ceiling** without a question
  rewrite OR rubric exception. The acceptance bar for q1945 in Phase
  25 is "stable B" (was C in baseline) — counted toward the +1 B
  improvement, not toward the +A target.
- **Risk**: medium — "graining" is observational F1-analyst
  vocabulary, not proprietary telemetry; the no_data_refusal route
  does not match the phrase per the existing
  `PROPRIETARY_NO_DATA_TOPICS` list. Verify with a unit fixture in
  [no-data-refusal.test.mjs](../web/scripts/tests/no-data-refusal.test.mjs)
  that "graining on the front-right" does NOT trip
  `detectProprietaryNoDataMatch`.

### q2120 — "Was the 2025 Hungarian Grand Prix run wet or dry?"
- **Failure mode**: `runtime_clarification` (similar to 1940;
  contains `Grand Prix` + `run wet/dry`).
- **Concrete fix**: same composite marker as q1940. The phrase
  `"run wet or dry"` is added to `RACE_SHAPED_MARKERS` so it
  contributes to the composite check.
- **Validation SQL**:
  ```sql
  SELECT MAX(rainfall) AS max_rainfall, AVG(rainfall) AS avg_rainfall
  FROM raw.weather WHERE session_key = <hungary_2025_race>
  ```
- **Expected A-grade evidence**: rowCount = 1 with a numeric answer; chat synthesis says "dry" or "wet" based on the value.
- **Risk**: low — same composite fix as q1940.

### q2121 — "Who pitted first for intermediates at the 2025 Australian GP late-race rain shower?"
- **Failure mode**: `repaired_to_zero_rows` (LLM generated complex multi-stint analysis SQL, repair simplified to 0 rows).
- **Concrete fix**: route this to the existing pit-stop / stint contract rather than letting the LLM compose telemetry. Extend the system prompt's "for intermediate-tyre crossover questions, use core.stint_summary filtered by compound_name LIKE 'INTER%'" guidance.
- **Validation SQL**:
  ```sql
  SELECT s.driver_number, d.full_name, s.lap_start, s.compound_name
  FROM core.stint_summary s
  JOIN core.session_drivers d ON d.session_key = s.session_key AND d.driver_number = s.driver_number
  WHERE s.session_key = <australia_2025_race>
        AND s.compound_name ILIKE '%INTER%'
  ORDER BY s.lap_start ASC LIMIT 1
  ```
- **Expected A-grade evidence**: rowCount = 1, answer names the driver + the lap they pitted.
- **Risk**: medium — depends on `compound_name` having `INTERMEDIATE` / `INTER` text. Verify with a real query first.

### q2184 — "Show 2025 weekends where pit-stop timing data is incomplete vs the official FIA pit log."
- **Failure mode**: `runtime_clarification` (resolver wants a specific session, but this is season-wide data-health).
- **Concrete fix** (codex audit pass 3 — the SQL must touch BOTH
  `core.session_completeness` AND `raw.pit` per the source JSON's
  expected_tables, AND the answer must honestly bound the "vs FIA
  pit log" claim):
  - Extend the season-wide fast-path in `chatRuntime.ts` (already
    added by the Phase 24 q1906 commit) to also recognize
    `"pit-stop timing data"` / `"FIA pit log"` phrasings as
    data-health questions that don't need session resolution.
  - Extend the system prompt to route this question to a JOIN of
    `core.session_completeness.pit_rows` AND `raw.pit` driver-count
    per session, to detect mismatches between the manifest and the
    actual pit-event rows.
  - Frame the synthesis prompt to acknowledge "official FIA pit log"
    is not a data source we ingest — the answer compares
    `core.session_completeness.pit_rows` (manifest) vs actual
    `COUNT(*) FROM raw.pit` per session (observed pit rows ingested)
    and surfaces deltas as candidate gaps, not as an authoritative
    FIA-comparison. (Codex audit pass 4: prose and SQL now both
    use `COUNT(*)` for the observed metric. Earlier draft had
    `COUNT(DISTINCT (driver_number, lap_number))` in prose and
    `COUNT(*)` in SQL, which would report false manifest-vs-observed
    deltas when raw.pit contains multiple rows per (driver, lap)
    that the manifest counts as one.)
- **Validation SQL**:
  ```sql
  WITH manifest AS (
    SELECT sc.session_key, sc.session_name, sc.year, sc.pit_rows AS manifest_pit_rows
    FROM core.session_completeness sc
    WHERE sc.year = 2025
  ),
  observed AS (
    SELECT p.session_key, COUNT(*) AS observed_pit_rows
    FROM raw.pit p
    JOIN core.sessions s ON s.session_key = p.session_key
    WHERE s.year = 2025
    GROUP BY p.session_key
  )
  SELECT m.session_key, m.session_name, m.year,
         m.manifest_pit_rows, COALESCE(o.observed_pit_rows, 0) AS observed_pit_rows,
         m.manifest_pit_rows - COALESCE(o.observed_pit_rows, 0) AS pit_row_gap
  FROM manifest m
  LEFT JOIN observed o ON o.session_key = m.session_key
  WHERE m.manifest_pit_rows = 0
     OR COALESCE(o.observed_pit_rows, 0) = 0
     OR m.manifest_pit_rows <> COALESCE(o.observed_pit_rows, 0)
  ORDER BY m.session_key
  ```
- **Phase 25 target grade: B** (codex audit pass 5 — fixed
  ambiguity by committing to B unconditionally, matching the
  manifest's `phase25_target_grade: B`. The PR-time gate reads a
  single value; conditional A targets are not enforceable.).
  Acceptance: stable B with the answer surfacing both
  manifest and observed pit-row counts plus a one-line
  acknowledgment that "official FIA pit log is not a data source
  we ingest."
- **Path to A** (out of Phase 25 scope): rewrite the source
  question to drop the "vs the official FIA pit log" comparison
  clause OR add a rubric exception that awards A on
  factual_correctness when the answer explicitly bounds an
  unsupported claim with a limitation note. Documented in
  [phase25_target_grades.json](phase25_target_grades.json) →
  q2184 → `escape_to_authored_floor`.
- **Risk**: low. The target grade B is a hold (current baseline is
  C), so the gate's single read of `phase25_target_grade=B` matches
  acceptance.

---

## Section 2 — Deferred-floor 70 (Phase 21 batches)

Each Phase 21 slice ships a matview AND lifts its tagged questions in
the same PR. The "lift" step is mechanical: add `expected_columns`
references to the new matview, ship test data, run the validator.

Question-count lift per Phase 21 slice (when its matview ships):

| Phase 21 slice | Questions lifted | What the matview gives them |
|---|---:|---|
| `21-stint-degradation-curve` | 8 | `degradation_per_lap_s` per (session, driver, stint) |
| `21-race-control-incident-index` | 8 | `incident_kind`, `penalty_points`, `driver_number` per session |
| `21-driver-performance-7axis` | 7 | 7 axis scores per (driver, season) — Tier 4 aggregator |
| `21-corner-analysis` | 6 | `entry_speed_kph`, `apex_min_speed_kph`, `exit_speed_kph` per (session, driver, corner) |
| `21-traffic-adjusted-pace` | 5 | `clean_air_pace_s`, `traffic_pace_s` |
| `21-restart-performance` | 4 | `position_delta` on restart-laps |
| `21-drs-effectiveness` | 4 | `drs_active`, `drs_overtake_count` |
| `21-straight-line-dominance` | 4 | `i1_speed_kph`, `i2_speed_kph`, `st_speed_kph` |
| `21-traction-analysis` | 4 | `exit_throttle_application_pct`, `exit_speed_kph` |
| `21-minisector-dominance` | 3 | `dominant_count` per minisector |
| `21-overtake-events` | 3 | `overtake_count`, `overtaking_driver_number` |
| `21-pit-loss-per-circuit` | 3 | `pit_loss_s` per circuit |
| `21-tyre-warmup-curves` | 3 | `warmup_laps_to_target` |
| `21-weather-impact` | 3 | `wet_pace_delta_s`, `crossover_lap` |
| `21-braking-performance` | 2 | `brake_zone_speed_drop_kph` |
| `21-fuel-corrected-pace` | 2 | `fuel_corrected_lap_s` |
| `21-undercut-overcut-history` | 1 | `undercut_success_count` |
| **TOTAL** | **70** | |

**Per-slice ship template** (every Phase 21 slice's PR runs this):

1. **SQL migration** — `sql/migrations/deploy/0XX_<slice>.sql` per the
   Phase 18-C storage-matview + facade-view pattern. Storage matview
   is `analytics.<name>_data`; facade view is `analytics.<name>`.
2. **Verify script** — column-shape verify (`pg_depend` parity check)
   following the [032_analytics_sector_dominance.sql](../sql/migrations/verify/032_analytics_sector_dominance.sql)
   exemplar shipped in Phase 21.
3. **CORE_CONTRACTS append** — add the facade view name (NOT the storage
   matview) to [schemaCatalog.ts](../web/src/lib/schemaCatalog.ts).
4. **TopicSignal entry** — add the relevant flag(s) to
   [topicGuards.ts](../web/src/lib/deterministicSql/topicGuards.ts)
   if the slice's category isn't already covered.
5. **floor_active_after_slice cleanup** — find every question whose
   `floor_active_after_slice === <this-slice-id>` and set it to `null`
   in the question JSON file. The Phase 19-D rev4 cleanup-or-fail rule
   enforces this.
6. **Per-question validation** — for each lifted question, run
   `node web/scripts/run_category_benchmarks.mjs --question <id> --retries 2`
   and assert the resulting `baselineGrade` meets the **target
   grade for that qid**, NOT universal A. Codex audit pass 3
   grounded the targets in two sources:
   - **`diagnostic/phase25_target_grades.json`** (codex audit pass 3
     deliverable, expanded by codex audit pass 6): explicit per-qid
     `phase25_target_grade` for the 7 questions where the Phase 25
     acceptance reality differs from the source JSON's
     `expected_grade_floor` — q1715 (promote B → A), q1945
     (graining-causation B-cap), q2008 (proven-data-unavailable
     C-cap), q2182 (telemetry-coverage-per-driver B-cap; added in
     codex audit pass 6), q2184 (FIA-pit-log B-cap), q2206 / q2207
     (proven-data-unavailable C-caps). Each override carries
     a rationale and an `escape_to_authored_floor` note explaining
     what change would unlock the higher grade.
   - **Source JSON `expected_grade_floor`** for every other qid
     (the long-term contract). Most questions target A; high-
     complexity ones target B per their authored floor.
   - The PR-time gate fails IF any question's measured grade is below
     its `phase25_target_grade` (manifest first) OR
     `expected_grade_floor` (source fallback). A question whose
     target is B passes the gate at B or A; a question whose target
     is A fails at B/C.
7. **Run the autonomous loop on the lifted set** — if any of the
   slice's questions don't meet their target grade on first try after
   the cleanup, feed them through the Phase 24 loop (with the matview's
   column docs as additional hypothesis context) for up to 10
   iterations. The loop's success criterion is "meet target grade",
   not "grade A".

---

## Section 3 — Per-question fix specifics (deferred-floor 70)

For each Phase 21 slice, codex audits whether the question's expected
SQL shape is reachable from the matview's columns. Below: top 4 slices
detailed; remaining 13 follow the same template.

### Slice `21-stint-degradation-curve` (8 questions)

**Matview shape**: `analytics.stint_degradation_curve_data` keyed by
(session_key, driver_number, stint_number) with columns:
`degradation_per_lap_s`, `compound_name`, `stint_length_laps`,
`first_3_laps_avg_s`, `last_3_laps_avg_s`, `cliff_lap`.

| qid | Baseline grade | Question | Expected SQL after lift |
|---|---|---|---|
| 1947 | C | Did Verstappen's longest stint outlast McLaren's at Suzuka? | `SELECT MAX(stint_length_laps) FROM analytics.stint_degradation_curve WHERE session_key = <suzuka_2025_race> GROUP BY driver_number` |
| 1949 | B | Did Red Bull's soft-tyre opener at Singapore force longer stint? | `SELECT stint_length_laps, compound_name FROM analytics.stint_degradation_curve WHERE session_key = <singapore_2025_race> AND driver_number = 1 AND stint_number = 1` |
| 2020 | C | Norris's deg across FP1 long run at Jeddah | `SELECT degradation_per_lap_s FROM analytics.stint_degradation_curve WHERE session_key = <saudi_2025_fp1> AND driver_number = 4` |
| 2024 | B | McLaren vs Red Bull deg curves at Jeddah stint 2 | `SELECT team, AVG(degradation_per_lap_s) FROM analytics.stint_degradation_curve JOIN core.session_drivers ... WHERE session_key = ... AND stint_number = 2 GROUP BY team` |
| 2026 | B | Medium-vs-hard crossover lap Verstappen vs Piastri at Qatar 2025 | `SELECT cliff_lap, compound_name FROM analytics.stint_degradation_curve WHERE session_key = <qatar_2025_race> AND driver_number IN (1, 81)` |
| 2028 | B | Monza C4 graining: McLaren vs Ferrari first-3 vs last-3 | `SELECT first_3_laps_avg_s, last_3_laps_avg_s, ...` |
| 2203 | C | Suzuka Red Bull narrow setup vs low track deg | cross-check: `degradation_per_lap_s` per driver |
| 2207 | C | Mercedes Spa split: who hit C3 cliff first | `cliff_lap` per driver |

**Codex audit ask for this slice**:
- Are the proposed `analytics.stint_degradation_curve_data` columns
  sufficient for all 8 questions? Specifically, does `cliff_lap`
  capture what 2026 / 2207 actually need (a single lap number where
  pace dropped >X seconds, e.g. q2026's medium-vs-hard crossover at
  Qatar), or do they need a whole-curve structured output? (Codex
  audit pass 4 corrected the prior "2027 / 2207" reference — q2027
  is already-A and was replaced with q2026 in the lift table at
  rev1.)
- Question 2024 needs team aggregation. Should the matview include a
  `team_name` denormalized column, or should the lift SQL JOIN to
  `core.session_drivers` at query time?

### Slice `21-race-control-incident-index` (8 questions)

**Matview shape**: `analytics.race_control_incidents_data` keyed by
(session_key, lap_number, message_id) with columns:
`incident_kind` (enum: `safety_car`, `vsc`, `red_flag`, `track_limits`,
`penalty`, `investigation`, `restart`), `driver_number` (nullable),
`penalty_points`, `penalty_seconds` (nullable), `category_text`.

| qid | Baseline grade | Question | Expected SQL |
|---|---|---|---|
| 2067 | B | For Monaco 2025, identify drivers whose two mandatory stops were both 'free' (under VSC/SC) | JOIN with `analytics.pit_loss_per_circuit`: rows where `pit_event_during_yellow = TRUE` |
| 2100 | C | Who led the field on the lap-3 SC restart at Saudi Arabian GP 2025? | `SELECT leading_driver_number FROM analytics.race_control_incidents WHERE session_key = <saudi_2025_race> AND incident_kind = 'restart' AND lap_number = 3` |
| 2140 | C | How many penalty points were issued at São Paulo 2025? | `SELECT SUM(penalty_points) FROM analytics.race_control_incidents WHERE session_key IN (<sp_sprint>, <sp_race>)` |
| 2142 | B | Did the T1 contact at São Paulo swing more points away from Piastri or Leclerc? | per-driver: `SELECT driver_number, penalty_seconds, penalty_points FROM analytics.race_control_incidents WHERE session_key = <sp_race> AND lap_number = 6 AND incident_kind = 'penalty'` |
| 2143 | C | Verstappen license points entering Austria 2025 | rolling sum: `SELECT SUM(penalty_points) FROM analytics.race_control_incidents WHERE driver_number = 1 AND session_key < <austria_2025_race> AND penalty_points > 0` |
| 2144 | C | Mexico T1-T4 sequence — Hamilton vs Verstappen consistency | `SELECT driver_number, incident_kind, penalty_seconds FROM analytics.race_control_incidents WHERE session_key = <mexico_2025_race> AND lap_number BETWEEN 5 AND 7` |
| 2145 | B | SP weekend net points delta on top-3 contenders | aggregate per driver across sprint+race penalties |
| 2146 | B | "Leaving track and gaining lasting advantage" calls in 2025 first 10 laps | `WHERE category_text ILIKE '%leaving the track%' AND lap_number <= 10` |

**Codex audit ask**:
- Is `incident_kind` as a fixed enum sufficient, or do we need free-
  text `category_text` for q2146's "leaving the track" filter? (Plan
  has both — confirm both ship.)
- 2143 needs a "rolling-sum-up-to-date-X" calculation. Should the
  matview ship a `running_penalty_points` column per (driver, race),
  or should it stay as a query-time SUM?

### Slice `21-driver-performance-7axis` (7 questions, Tier 4)

**Matview shape**: `analytics.driver_performance_score_data` keyed by
(driver_number, season) with 7 axis columns:
`qualifying_axis`, `race_pace_axis`, `tyre_management_axis`,
`overtake_difficulty_axis`, `restart_axis`, `traffic_handling_axis`,
`error_rate_axis`, plus a `composite_score`.

This is Tier 4 so it depends on:
- `21-stint-degradation-curve` (tyre management)
- `21-pit-loss-per-circuit` (none, but pit data feeds traffic)
- `21-overtake-events` (overtake-difficulty)
- `21-traffic-adjusted-pace` (traffic-handling)
- `21-restart-performance` (restart)

7 questions, all explicit single-axis or compare-axis queries:

| qid | Baseline grade | Question | Expected SQL |
|---|---|---|---|
| 2160 | C | Norris qualifying-axis 2025 | `SELECT qualifying_axis FROM analytics.driver_performance_score WHERE driver_number = 4 AND season = 2025` |
| 2161 | C | Verstappen tyre-management axis | single column |
| 2162 | C | Verstappen vs Norris: qual or race-pace dominant | 2-row comparison |
| 2163 | C | Piastri vs Norris strongest axis | full 7-axis row, find argmax |
| 2164 | C | Hamilton vs Leclerc traffic-handling at Monaco | per-event variant — needs `analytics.driver_performance_score_per_event` (sub-matview) |
| 2165 | C | Error-rate axis through European triple-header | per-event aggregation: 3 races |
| 2166 | C | Cross-event: overtake-difficulty Spa vs tyre-mgmt Monza | per-event |

**Codex audit ask for this slice**:
- Per-event axis scoring (questions 2164/2165/2166; codex audit
  pass 2 dropped q2167 since it is already A) needs a
  finer-grained sub-matview than the season-level
  `driver_performance_score`. Do we ship two matviews
  (`_per_event_data` + `_season_data`) or one keyed by
  (driver_number, season, session_key)?
- The 7-axis composition needs careful per-axis weighting. Should
  weights be ML-derived (Phase 22) or hand-tuned (Phase 21)? If
  Phase 21 ships hand-tuned, codex audits the weight formulas in
  the migration.

### Slice `21-corner-analysis` (6 questions)

**Matview shape**: `analytics.corner_analysis_data` keyed by
(session_key, driver_number, corner_id) referring back to
`f1.track_segments` (Phase 20-B). Columns: `entry_speed_kph`,
`turn_in_speed_kph`, `apex_min_speed_kph`, `exit_speed_kph`.

| qid | Baseline grade | Question | Expected SQL |
|---|---|---|---|
| 1714 | B | Norris's apex speed at Copse vs Verstappen at Silverstone 2025 quali | `SELECT driver_number, apex_min_speed_kph FROM analytics.corner_analysis JOIN f1.track_segments ON corner_id = id WHERE segment_label LIKE 'Turn 9 (Copse)%' AND session_key = <silverstone_2025_quali> AND driver_number IN (4, 1)` |
| 1715 | B | Compare Piastri and Russell entry vs exit speed through Turn 1 (Tarzan) at Zandvoort 2025 | `SELECT driver_number, entry_speed_kph, exit_speed_kph FROM analytics.corner_analysis JOIN f1.track_segments ON corner_id = id WHERE segment_label = 'Turn 1 (Tarzan)' AND session_key = <zandvoort_2025_race> AND driver_number IN (81, 63)` (codex audit pass 1: was misdescribed as clarification — q1715 has expected_tables=[analytics.corner_analysis] and expected_columns=[entry_speed_kph, exit_speed_kph], so it lifts via the corner-analysis matview like the others) |
| 1717 | B | Suzuka esses T7/T8/T9 Verstappen vs Norris | multi-corner JOIN: WHERE segment_index IN (7, 8, 9) |
| 1718 | B | Spa Eau Rouge / Pouhon / Stavelot Hamilton vs Leclerc race trim | 3-corner range, race session |
| 1719 | B | Monaco SteDevote / Casino / Hairpin Leclerc vs Verstappen Q-segment evolution | 3-corner range, Q-segment grouping |
| 2206 | C | Cross-category: Leclerc Monza compound choice + corner pace | JOIN `analytics.corner_analysis` × `core.stint_summary` |

**Codex audit ask for this slice**:
- Q1715 lifts via `analytics.corner_analysis.entry_speed_kph` and
  `exit_speed_kph`. Source JSON has `expected_outcome=answer` and
  `expected_grade_floor=A`; manifest
  ([phase25_target_grades.json](phase25_target_grades.json))
  confirms `phase25_target_grade=A` (codex audit pass 4 corrected
  the prior "target B" wording — q1715 is a clean single-table
  lookup, not a cross-JOIN, so A is reachable). Confirm the lift
  PR ships test fixtures asserting `analytics.corner_analysis`
  returns rows for the Zandvoort Tarzan corner with both Piastri
  (81) and Russell (63).
- For Q1717's "consistent loss across 3 esses" question, should the
  matview pre-compute "loss per corner-pair-driver" so the SQL is
  simpler, or should the question synthesize from raw corner rows?
- Q2206 needs a JOIN to `core.stint_summary`. Confirm the lift slice's
  PR adds `expected_columns` references that span both tables.

### Slice `21-traffic-adjusted-pace` (5 questions)

**Matview shape**: `analytics.traffic_adjusted_pace_data` keyed by
(session_key, driver_number, lap_number). Columns:
`is_in_traffic` (boolean), `traffic_laps` (running count),
`clean_air_laps`, `clean_air_pace_s`, `traffic_pace_s` (rolling
windowed).

| qid | Question | Expected SQL |
|---|---|---|
| 1927 | Verstappen Singapore traffic-corrected stint 2 pace | `SELECT AVG(traffic_pace_s) - AVG(clean_air_pace_s) FROM analytics.traffic_adjusted_pace WHERE session_key=<singapore> AND driver_number=1 AND stint_number=2` |
| 2202 | Norris one-stop Hungary clean-air pace recoup | 2-stage: traffic during stint 1, clean-air after Piastri pit |
| 2204 | Verstappen Singapore soft-stint cascade | sequential lap-by-lap |
| 2205 | Russell Australia long-run vs Hamilton 0.6s/lap | `clean_air_pace_s` comparison |
| 2208 | Saudi McLaren stint-sim advantage clean-air vs traffic | aggregate split |

**Codex audit ask**:
- `traffic_pace_s` requires a "rolling" windowed average over
  consecutive in-traffic laps. What's the right window? 5 laps?
  Whole stint? The matview should bake in one choice.
- `is_in_traffic` definition: gap to car ahead < 1.5s for ≥2
  consecutive laps? Codex audits the threshold per Phase 19's
  baseline F1-analyst-content.

### Remaining 12 Phase 21 slices (less detail; same template)

For each, the per-question expected SQL is straightforward (single-
or two-column lookup against the lift matview). Codex should audit:

- **`21-restart-performance`** (4q: 2103, 2105, 2106, 2101): position-delta on SC restarts. Matview keyed by (session_key, driver_number, restart_lap). Q2103 needs both Verstappen's pre-spin position AND post-spin → matview should split into two rows or include both.
- **`21-drs-effectiveness`** (4q: 2007, 2083, 2085, 2086): DRS-active flag on overtake events. Confirm `analytics.drs_effectiveness` has both per-zone and per-overtake granularity.
- **`21-straight-line-dominance`** (4q: 2002, 2006, 2008, 2009): i1/i2/st speed per session. Q2008 needs qualifying-trim vs race-trim split — matview should include `session_type` on the row.
- **`21-traction-analysis`** (4q: 1980, 1983, 1986, 1987): exit-throttle and exit-speed. Q1987 needs cross-event slipping; consider whether the matview key includes `corner_id`.
- **`21-minisector-dominance`** (3q: 1707, 1708, 1711): dominant_count per minisector. Q1711 needs cross-session compare (Spa quali + race opening). Matview with session-level granularity sufficient.
- **`21-overtake-events`** (3q: 2080, 2081, 2084): overtake_count + location. Q2084 needs T1 specifically — matview should include `corner_id` (resolved against `f1.track_segments`).
- **`21-pit-loss-per-circuit`** (3q: 2063, 2065, 2066): pit_loss_s per (circuit, year). Q2066 (cross-team Qatar SC complex) needs JOIN with `analytics.race_control_incidents` (Phase 21 Tier-3 dep).
- **`21-tyre-warmup-curves`** (3q: 1946, 2023, 2025): warmup_laps_to_target. Standard matview; Q2025 also needs Hamilton-vs-Leclerc cross-stint comparison.
- **`21-weather-impact`** (3q: 2124, 2125, 2126): wet_pace_delta_s. Standard.
- **`21-braking-performance`** (2q: 1960, 1967): brake_zone_speed_drop. 1967 needs Imola-T5/T9/T11 cross-corner; pairs with `21-corner-analysis`.
- **`21-fuel-corrected-pace`** (2q: 1925, 1926): fuel_corrected_lap_s.
- **`21-undercut-overcut-history`** (1q: 2201): undercut_success_count.

---

## Section 4 — Autonomous loop driver re-run on the deferred 70

Once Phase 21 ships its slices, the autonomous loop re-runs on the
70 questions whose `floor_active_after_slice` was just nulled out.
The loop's per-slice template:

1. After each Phase 21 slice merges, run a script that nulls the
   `floor_active_after_slice` for every question targeting it (the
   cleanup-or-fail step from Phase 19-D rev4).
2. Re-seed `iter-19-q*` slices in `slices_status.json` for the now-
   active questions (existing
   [phase24_autonomous_loop.py](../scripts/phase24_autonomous_loop.py)
   driver picks them up).
3. Run `phase24_autonomous_loop.py --resume` — it picks up only the
   newly-active non-A questions and iterates.
4. With the matview's column docs surfaced via `CORE_CONTRACTS`, the
   LLM can produce correct SQL on the FIRST attempt for most
   questions; iterations will be 1-2 not 5-10.

**Per-Phase-21-slice batch budget**: 1-2 hours of runner-wallclock.

**Total Phase 21 budget**: 17 slices × 1.5h = ~26h, mostly autonomous.

---

## Section 5 — Phase 22 (ML) and Phase 23 (UI) impact on remaining

Looking at the deferred 70: **none currently defer to a Phase 22 slice
or Phase 23 surface**. So Phases 22/23 don't unblock any of the 70
directly. They will produce *new* questions if the benchmark gets
expanded post-Phase-21, but for the existing 167-question pool, Phase
21 ships the full lift surface.

---

## Section 6 — Aggregate target after this plan

Of the **77 remaining non-A** in this plan's scope (codex audit
pass 5 expanded from 75 → 77 to include the Phase-24
merged_skipped questions, closing the scope-vs-arithmetic gap;
codex audit pass 6 then promoted q1941 from merged_skipped to
Phase 25.1 escalated, so the merged_skipped bucket is now **q2182
only**):

**Outcome math** (sums to 167 exactly; codex audit pass 5 closed
the scope-vs-arithmetic gap by treating the Phase-24
merged_skipped questions as a third bucket; codex audit pass 6
promoted q1941 from that bucket to Phase 25.1, so the bucket sizes
are now 6 escalated + 70 deferred + 1 merged_skipped = 77):

```
SCOPE: 167 total = 90 already-A + 77 non-A
                              non-A = 6 (Phase 25.1 escalated, codex audit pass 6 added q1941)
                                    + 70 (Phase 25.2 deferred)
                                    + 1 (Phase-24 merged_skipped, manifest-capped)

PHASE 25.1 (6 escalated):
  4 → A (q1940, q2120, q2121, q1941)
+ 2 → B (q1945, q2184 — manifest B-caps from baseline C → B)
————————
  6 ✓

PHASE 25.2 (70 deferred-floor):
  63 → A (62 clean matview lifts + q1715 manifest promote B → A)
+  4 → B (source-B authored, baseline B, target B: q1717, q1718, q1719, q1949)
+  3 → C (manifest C-caps: q2008, q2206, q2207 — proven-data-unavailable causation)
————————
  70 ✓

PHASE-24 MERGED_SKIPPED (1, manifest-capped at baseline):
  1 → B (q2182 — baseline B, manifest entry, target B)
————————
  1 ✓

AGGREGATE:
   90 already A
+  4 newly A from Phase 25.1
+ 63 newly A from Phase 25.2
————————
 157 total A      (final A-rate: 157/167 = 94.0%)

   2 newly B from Phase 25.1 (q1945, q2184)
+  4 stays-B from Phase 25.2
+  1 stays-B from Phase-24 merged_skipped (q2182)
————————
   7 final B

   3 stays-C from Phase 25.2 (manifest C-caps)
————————
   3 final C

157 A + 7 B + 3 C = 167  ✓
```

The 3 final C-grades break down as:
- **q2008, q2206, q2207** (Phase 25.2 manifest C-cap): proven-
  data-unavailable causal claims. Each is documented in
  [diagnostic/phase25_target_grades.json](phase25_target_grades.json)
  with an `escape_to_authored_floor` note explaining what change
  (setup-trim matview, Tier-4 attribution model, Phase 22 Bayesian
  deg model) would lift each one.

---

## Codex audit ask (rev0 → rev1)

Per-question audit angles (codex should walk through each Phase 21
slice's question list and call out gaps):

1. **Per-question expected_columns coverage**: for each of the 70
   deferred-floor questions, does the proposed matview shape include
   the columns the question's `expected_columns` cite? Mismatch
   means the lift won't actually grade A.
2. **Cross-matview JOINs**: questions like 2206 (corner_analysis ×
   stint_summary), 2066 (pit_loss × race_control), 2207 (tyre_warmup ×
   weather_impact) need 2-matview JOINs. Are the foreign key
   relationships explicit in each matview's storage layer?
3. **Tier ordering**: 21-driver-performance-7axis is Tier 4. If we
   ship it in question-batch mode (do all matviews, THEN all lifts),
   does the loop's `floor_active_after_slice` cleanup rule force a
   strict topological order, or can we ship 21-corner-analysis lift
   commits in parallel with 21-overtake-events lift commits?
4. **Per-question proven-data-unavailable scrub**: of the 12-15
   questions I expect to stay non-A, which ones are *really*
   proven-data-unavailable vs. lazy-skip? Codex should pick out the
   ones that COULD be A with a trivial extra column (e.g. team name
   denormalization) and propose adding that column.
5. **Escalated 6 risk audit**: q1945's "graining" might still trip
   the no_data_refusal route as a side-effect of "tyre temperature"
   adjacency. Verify the proprietary phrase list does NOT match
   "graining" / "graining cliff" / "front-right graining."
6. **Loop re-run behavior post-cleanup**: when
   `floor_active_after_slice` flips null, does the autonomous loop
   re-add the slice automatically, or do we need a script that
   regenerates the iter-19-q* registry on each Phase 21 merge?
7. **Test coverage**: should each Phase 21 lift PR include a unit
   test that asserts the question grades A against a synthetic
   matview-shaped fixture? (This decouples test correctness from
   live-DB state.)

If APPROVED at rev-N, ship order:

1. **Phase 25.1 first** — 6 escalated questions via the targeted
   hypothesis fixture (cheap, ~1 hour total).
2. **Phase 21 Tier 1 slices** in parallel with the autonomous loop
   re-run after each merge.
3. **Phase 21 Tier 2/3** sequenced per dependency graph in
   [slices_status.json](slices_status.json).
4. **Phase 21 Tier 4** (`21-driver-performance-7axis`) ships LAST.
5. Final acceptance: re-run `phase19_baseline_run.py` →
   `phase_19_baseline_2026-05-05.{json,md}` → assert A-rate ≥94.0%
   (≥157/167) AND every question meets its target grade per
   `diagnostic/phase25_target_grades.json` (manifest first) or
   source JSON `expected_grade_floor` (fallback).
