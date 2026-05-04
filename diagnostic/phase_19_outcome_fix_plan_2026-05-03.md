# Phase 19 outcome-fix plan — 2026-05-03

Goal: lift the Phase 19 baseline from **40.7% A-rate (68/167)** toward
the realistic ceiling, **without depending on any Phase 21 matview
shipping**, by addressing root causes that are structurally fixable in
the chat layer today.

This plan is written for codex audit. Every section names: (1) the
concrete root cause, (2) the file/lines that change, (3) the expected
A-rate lift in question count, (4) the regression risk, (5) how we
verify the fix worked.

---

## Realistic ceiling estimate (codex audit pass 2 — recounted)

Of the 167 questions:
- **128 declare `floor_active_after_slice` pointing at an unshipped
  Phase 21 lift slice** — floor-suppressed by the regression gate
  today; grade A only when the lift slice ships. NOT in scope for
  this plan.
- **39 have `floor_active_after_slice: null`** — gate enforces the
  floor immediately. These are this plan's primary target.

**Current grades on the active-floor 39 (from baseline 2026-05-03)**:
20 A / 3 B / 16 C → **51.3% A-rate**.

Composition of the active-floor 39 (verified by counting source JSONs):

| Category | active count | category total | notes |
|---|---:|---:|---|
| proprietary_no_data | 9 | 9 | all active; route is Phase 19-A no_data_refusal |
| data_health | 8 | 8 | all active; rides on `core.session_completeness` |
| metadata | 6 | 7 | most active; one defers to `21-race-control-incident-index` |
| stint | 6 | 10 | partial — 4 defer to `21-stint-degradation-curve` / `21-tyre-warmup-curves` |
| pace | 5 | 10 | partial — 5 defer to `21-fuel-corrected-pace` / `21-traffic-adjusted-pace` |
| pit | 3 | 8 | partial — 5 defer to `21-pit-loss-per-circuit` / `21-undercut-overcut-history` |
| weather | 2 | 7 | partial — 5 defer to `21-weather-impact` |
| **TOTAL** | **39** | — | — |

Realistic post-fix target on the active-floor 39 (codex audit pass 3
— aligned with the lift table below): **26–30 of 39 A (67–77%)**.
The earlier draft claimed 34–37 / 87–95% but the per-fix lift table
in §"Combined expected outcome" only generates +6 to +10 A on the
active-floor 39 (so 20 → 26-30 A). The earlier 34–37 figure was
unscoped against the actual fixes; it's what would be reachable
with additional active-floor-specific fixes (3–7 more A's) that
this plan does NOT include.

Why the math caps at ~30/39:
- The 16 active-floor C-grades skew toward data_health (5–8 of the
  16) where cross-table audits between `core.session_completeness`
  and analytics.* matviews are required, and those matviews don't
  exist yet.
- Fix 2 (resolver) lifts 3–5 active-floor questions because most
  clarification-trapped questions are actually deferred-floor
  (cross_category 8/9, driver_score 5/8).
- Fix 3 (timestamp-proximity validator) hits mostly deferred-floor
  questions (corner / braking / tyre).
- Fix 4 (raw.* reminder) primarily fixes deferred-floor questions
  too (q1702 is deferred, q2085 is deferred).

Lifting the active-floor target above ≥30/39 requires an additional
fix not in scope here. Two candidates for a follow-up plan:
- **Active-floor data_health uplift**: ship a small core-side helper
  that surfaces session-vs-session completeness diffs without
  needing analytics.race_control_incidents — would unlock 3–5
  active-floor C's.
- **Active-floor metadata cross-weekend audit**: ship a
  `core.session_audit_summary` view aggregating completeness,
  red-flag counts, conditions deltas — would unlock 1–2.

Both are out of scope for this plan and tracked as open questions.

For the 128 deferred-floor questions, this plan opportunistically
lifts the ones whose root cause is independent of their lift slice
(resolver clarification, system-prompt anti-patterns, column
hallucinations). Today's deferred-floor grades are 48 A / 29 B / 51 C
(37.5% A-rate). Best-case after this plan: **62–68 A-grades on
deferred (48–53% A-rate)** — matches the lift-table range in
§"Combined expected outcome" (codex audit pass 4 aligned this from
the earlier "55–65" prose claim, which was a draft estimate that
predated the per-fix layered split). This becomes the new "before"
snapshot Phase 21 PRs publish deltas against.

**Aggregate target (recomputed against actual active/deferred split,
NOT the earlier 50/117 estimate)**: 40.7% → see §"Combined expected
outcome" for the layered math; ≥51% acceptance bar (NOT ≥56%).

The acceptance gate (§"Acceptance criteria") uses **≥51% aggregate
A-rate** as the bar — recomputed against the 39/128 split. The
active-floor target is **≥77% A-rate (≥30/39, up from 51.3%)** —
codex audit pass 3 lowered this from ≥85%/≥33 because the per-fix
lift table caps at +6 to +10 A on active-floor (reaching ≥33 needs
out-of-scope follow-up fixes).

---

## Findings → fixes (ordered by ROI)

### 1. HIGH ROI — `differential settings` plural-form leak (10-min fix)

**Root cause**: `web/src/lib/chatRuntime/proprietaryNoData.ts`'s phrase
list contains `"differential setting"` and `"diff setting"` (singular).
The proximity-window regex matches plural forms via word-boundary
fuzz, but only when the singular root token (`setting`) appears in the
message. The benchmark question is "Compare the differential **settings**
between Verstappen and Norris" — the plural `settings` does not match
because `\b setting \b` excludes the trailing `s`.

**Fix**: extend the keyword set with plural variants OR change the
proximity-window matcher to use a stem-tolerant comparison
(`setting` → `setting(s)?`). Plural-extension is simpler and traces
back to a single-line edit per affected phrase.

**Files**: [web/src/lib/chatRuntime/proprietaryNoData.ts:11-32](web/src/lib/chatRuntime/proprietaryNoData.ts#L11-L32)
(extend the phrase list).

**Expected lift**: +1 A (id=1758 → A). proprietary_no_data → 9/9.

**Regression risk**: low. New plural phrases are still phrase-level
matches; they cannot trigger on bare "settings" alone.

**Verification**: extend [no-data-refusal.test.mjs](web/scripts/tests/no-data-refusal.test.mjs)'s
`MUST_TRIP` table with the plural form; test must pass before merge.

---

### 2. HIGHEST ROI — resolver over-clarifies on questions that name venue+year

**Root cause**: 45 of 167 questions (27%) routed to
`runtime_clarification` when the question text already names a venue
and a year. Hot spots (data from baseline JSON):

- Cross-category: 8/9 (89%)
- Driver score: 5/8 (62%)
- Stint: 5/10 (50%)
- Pit / Pace / Weather / Overtake / Incident: 3 each
- Tyre / Restart / Straight-line / Data health / Metadata: 2 each
- Track dominance / Traction: 1 each

Pattern: questions like *"At Suzuka 2025, did Red Bull's narrow setup
window..."* should resolve to `selectedSession=Suzuka 2025 race` with
high confidence. Today the resolver returns
`needsClarification: true` because the venue-hint matching in
`web/src/lib/chatRuntime.ts:buildChatRuntime()` is lossy when the
venue name appears mid-sentence rather than as the leading subject,
or when the question has no explicit "race" / "qualifying" qualifier
(the resolver requires session_type to disambiguate).

**Fix** (codex audit revision — was naively "default to race"):
amend `buildChatRuntime` to relax clarification ONLY for **explicitly
race-shaped intents**. Race-shaped means the question text contains
race-typing markers (`"race"`, `"the race"`, `"during the race"`,
`"closing laps"`, `"opening laps"`, `"finished"`, `"finishing"`,
`"won"`, `"first stint"`, `"final stint"`, `"pit stop"`, etc.) AND a
venue + year. In that case, default to the race session for that
weekend at high confidence and skip clarification.

For all other phrasings — explicitly **session-type-sensitive**
(`"qualifying"`, `"qualifier"`, `"pole"`, `"Q1"` / `"Q2"` / `"Q3"`,
`"sprint"`, `"FP1"` / `"FP2"` / `"FP3"`, `"practice"`, `"telemetry"`,
`"long run"` (because long runs are practice-session-specific)) —
keep the existing clarification path. The resolver MUST NOT pick a
session-type implicitly when the question implies a non-race session
type.

When the question text contains BOTH race-shaped and session-type-
sensitive markers (e.g. "qualifying lap times in the race"), the
session-type-sensitive marker wins and clarification fires. Coverage
test asserts this ordering.

**Existing 50q rubric clarification ids 8, 9, 15, 17** are NOT
race-shaped + venue+year questions; they are deliberately
underspecified. The new heuristic does not affect them. The
verification step asserts this.

**Files**:
- [web/src/lib/chatRuntime.ts](web/src/lib/chatRuntime.ts) — extend the
  intake-stage extractors with `extractRaceShapedIntent(text)` and
  `extractSessionTypeSensitiveIntent(text)`. Race-shaped wins ONLY when
  no session-type-sensitive marker is present.
- [web/src/lib/chatRuntime/resolution.ts](web/src/lib/chatRuntime/resolution.ts)
  — `deriveResolutionStatus` accepts a new "default-race-allowed" flag
  from the caller; otherwise unchanged.

**Expected lift**: re-estimate (more conservative after the
guardrails). Of the 45 `runtime_clarification` questions in baseline:
- ~25 are race-shaped + venue+year (cross_category 8/9, several
  pit/pace/restart/incident questions). These resolve under the new
  rule.
- ~12 are session-type-sensitive (driver_score quali questions,
  some stint long-run questions). These still clarify (correctly).
- ~8 are genuinely underspecified. These still clarify (correctly).

Of the 25 that resolve, conservatively half (12) succeed at A on
first attempt (the rest still need Phase 21 contracts). **Net: +10
to +15 A** (down from the unguarded estimate of +15–20).

**Regression risk**: medium-low (down from medium). The race-shaped
allow-list is enumerable; we can add to it conservatively. The
session-type-sensitive deny-list explicitly protects the 50q rubric
clarification ids and the analyst questions that legitimately need
qualifying / sprint / practice context.

**Verification** (extended for codex's negative-fixture requirement):
1. **Positive fixtures** — questions that MUST resolve to race
   session without clarification (add to a new
   `chatRuntime-resolution-race-shaped.test.mjs` fixture). All
   entries below MUST resolve cleanly; no clarifications in this
   list:
   - "At Suzuka 2025, did Red Bull's narrow setup window ..." → race
   - "Across the closing laps of the Abu Dhabi 2025 race, ..." → race
   - "How did Hamilton's race pace compare to Russell across the
     first stint at Monza 2025?" → race
   - "Compare Verstappen's first-stint pace to Norris at Bahrain
     2025." → race
   - "Did Mercedes need more warmup laps on the hard at Silverstone
     2025 vs McLaren in stint 1?" → race
     (`stint 1` is a race-shaped marker — relocated from the
     negative-fixture list per codex audit pass 2)
2. **Negative fixtures** — questions that MUST still trigger
   clarification (same test file). All entries below MUST clarify
   under the new rule; **no positive resolutions** in this list:
   - "What was Verstappen's pole lap time at Suzuka 2025?" → quali
     clarification (`pole` marker fires)
   - "Compare Q3 sector dominance at Silverstone 2025 between
     Verstappen and Norris" → quali clarification
   - "Show me Verstappen's FP2 long-run pace at Spa 2025" → practice
     clarification (`FP2`, `long-run` markers fire)
   - "How many sprint races has Norris won in 2025?" → sprint
     clarification (`sprint` marker fires)
   - The existing 50q rubric clarification ids **8, 9, 15, 17** —
     re-run all four and assert clarification still fires (test
     fixture cites them by id).

   *(NOTE — codex audit pass 2: the earlier draft included
   "Did Mercedes need more warmup laps on the hard at Silverstone
   2025 vs McLaren in stint 1?" in this list with the comment "still
   resolves" — that was contradictory. Moved that question to the
   positive-fixture list above (it IS race-shaped via `stint 1` and
   should resolve to the race session under the new rule).)*

3. Re-run the curated 50q benchmark; confirm A-rate stays ≥88%
   (no regression on the existing baseline).
4. Re-run the 45 affected Phase 19 questions; confirm
   `runtime_clarification` count drops from 45 → ≤25 (matches the
   acceptance-criteria ≤25 bar; the earlier ≤20 figure was stale
   from the unguarded estimate).

---

### 3. MEDIUM ROI — `raw.car_data` × `raw.location` timestamp-proximity anti-pattern (10 timeouts)

**Root cause**: every `heuristic_after_sql_timeout` question has the
LLM building SQL of the form:
```sql
JOIN raw.location loc ON ABS(EXTRACT(EPOCH FROM (cd.date - loc.date))) < 0.15
```
This is effectively a cross-join scaled by sample rate. On Neon it
times out at the 15s budget. The auto-repair path strips the join
and uses time-in-lap windows, which produces 0 rows because Turn
detection then fails.

**Fix** (codex audit revision — system prompt + rubric is NOT a hard
runtime guarantee; the acceptance bar is "zero
`heuristic_after_sql_timeout`" which only a parse-time validator can
enforce). Three layers, all required:

- **Layer 1 (HARD GATE) — parse-time SQL validator reject**.
  Add a sibling validator
  `web/src/lib/sqlValidation/joinPatternsCheck.ts`. Codex audit pass
  4 noted that `extractQualifiedColumnRefs` (the existing helper)
  returns *resolved column refs*, NOT the FROM/JOIN alias map or
  ON-predicate AST that JOIN-pattern validation needs. Two valid
  ways to get there:
  - **(a)** Walk the AST inside `joinPatternsCheck.ts` directly,
    duplicating the FROM/alias resolution logic (small but
    introduces drift between the two validators when the alias
    rules evolve).
  - **(b) PREFERRED** — extract a new shared exported helper
    `extractFromAliasMap(sql)` from
    [columnExistenceCheck.ts](web/src/lib/sqlValidation/columnExistenceCheck.ts)
    (it already builds an `AliasMap` internally inside
    `walkStatementForRefs`; codex audit pass 5 corrected the earlier
    pointer that called this `validateStatement` — that function
    name doesn't exist in the current source). Both
    `validateColumnExistence` and the new `validateJoinPatterns`
    call the same helper. Drift-free.

  **Decision**: ship option (b). The alias-map builder hoist is a
  ~30-line refactor and the new validator becomes pattern-walking
  on top of a shared primitive.

  Validator logic — rejects SQL containing a JOIN whose ON predicate
  satisfies ALL of:
  - The two FROM aliases (per the new `extractFromAliasMap` helper)
    resolve to `raw.car_data` and `raw.location` (in either order),
    AND
  - The ON predicate AST contains a non-equi comparison whose terms
    include a `date`-typed column from each side wrapped in
    `EXTRACT(EPOCH FROM ...)` / `ABS(...)` / a similar timestamp-
    proximity shape (parser tagged as `binary` op type
    `<` / `<=` / `>` / `>=` over a `call` or `extract` node, with
    `date` column refs reaching both aliased tables).

  Returns the same `ValidationResult` shape as
  `validateColumnExistence`: `{ ok: true }` when no anti-pattern OR
  `{ ok: false, missing: [...] }` with a synthetic
  `joinPatternViolation` entry. The orchestration layer (Phase 17-D
  branch) treats this exactly like a column-validator miss: invokes
  `repairSqlWithAnthropic` with a hint pointing at the offending
  predicate. Critically: the validator runs **BEFORE** SQL execution,
  so the 15s timeout path is never reached.

- **Layer 2 (SOFT) — system prompt forbidden-pattern note**.
  [web/src/lib/anthropic.ts](web/src/lib/anthropic.ts) — add to the
  hand-curated raw-table reminder block: "DO NOT join `raw.car_data`
  and `raw.location` by timestamp proximity (e.g.
  `ABS(EXTRACT(EPOCH FROM (cd.date - loc.date))) < 0.15`). Use
  `core.telemetry_lap_bridge` or aggregate spatial samples and
  telemetry samples within their respective `(session_key,
  driver_number, lap_number)` bins separately." This reduces the
  rate at which the LLM emits the anti-pattern in the first place,
  cutting wasted Anthropic calls on the repair path.

- **Layer 3 (RUBRIC) — graded forbidden-pattern check**.
  Extend `forbidden_sql_patterns` in
  [web/scripts/chat-health-check.rubric.json](web/scripts/chat-health-check.rubric.json)
  with the regex form of the anti-pattern. The rubric pass is the
  audit-trail capture: any question whose final SQL still contains
  the pattern grades C on completeness regardless of whether the
  rows came back. This catches the failure mode where the validator
  has a bug and the LLM slips an anti-pattern past it.

**Why all three**: codex's audit point is correct that prompt+rubric
alone don't enforce a hard runtime guarantee. Layer 1 is the gate;
Layers 2 and 3 are belt-and-suspenders that cut LLM call count and
add an audit-log signal.

**Files**:
- Modified: [web/src/lib/sqlValidation/columnExistenceCheck.ts](web/src/lib/sqlValidation/columnExistenceCheck.ts) — hoist the FROM/JOIN alias-walking logic out of `walkStatementForRefs` (codex audit pass 5 — the function is `walkStatementForRefs`, NOT `validateStatement`; the latter doesn't exist in the current source) into a new exported `extractFromAliasMap(sql)` helper.

  **Return shape (codex audit pass 5 — scope-aware)**: returning a
  single global `aliases: AliasMap` is not safe for nested SQL with
  CTEs, subqueries, or alias shadowing — the outer scope's `cd`
  alias may shadow an inner scope's `cd`. The helper instead
  resolves each predicate's alias references at extraction time,
  inside the scope that owns it:

  ```ts
  export type ResolvedTableRef =
    | { kind: "base"; schema: string; table: string }
    | { kind: "cte" | "subquery" | "unknown"; aliasName: string };

  export type ResolvedJoinOnPredicate = {
    // Resolved canonical sides at extraction time, scoped to the
    // SELECT statement that owns the JOIN. CTE / subquery refs are
    // tagged so consumers don't try to match them against base-table
    // names.
    leftRef:  ResolvedTableRef;
    rightRef: ResolvedTableRef;
    on: AstNode; // the parsed ON-predicate root for the consumer to walk
  };

  export type ExtractFromAliasMapResult = {
    ok: boolean; // false on parse failure
    // ALL JOIN-on predicates from every SELECT scope (top-level +
    // CTEs + inline subqueries), each pre-resolved against its
    // own scope's alias map. No global alias-map lookup needed.
    joinOnPredicates: ResolvedJoinOnPredicate[];
    // Optional: the per-scope alias maps, exposed only for tests
    // and rare consumers that need them. Not required for Fix 3.
    perScopeAliases?: Array<{ scopeKind: "top" | "cte" | "subquery"; aliases: AliasMap }>;
  };

  export async function extractFromAliasMap(sql: string): Promise<ExtractFromAliasMapResult>;
  ```

  `validateColumnExistence` is refactored to call this helper
  internally so both validators share one implementation. (Codex
  audit pass 4 finding: this is the actual reuse vehicle, NOT
  `extractQualifiedColumnRefs` which only returns column refs.
  Codex audit pass 5 finding: the return shape needed scope-aware
  pre-resolution to be safe under CTE/subquery shadowing.)

- New: [web/src/lib/sqlValidation/joinPatternsCheck.ts](web/src/lib/sqlValidation/joinPatternsCheck.ts) — consumes `extractFromAliasMap` and walks the `joinOnPredicates`. Each entry already carries `leftRef` / `rightRef` resolved to canonical (schema, table) pairs (or tagged as cte/subquery), so JOIN-pattern detection is "two base-table refs whose canonical names are `raw.car_data` and `raw.location` in either order, plus a timestamp-proximity ON predicate" — no global alias-map lookup, no scope-confusion risk.
- New unit test: `web/scripts/tests/join-patterns-validator.test.mjs` — includes a CTE-shadowing fixture (outer `cd` alias resolves to `raw.car_data`; inner CTE rebinds `cd` to a different relation; the validator MUST NOT cross-resolve).
- New unit test addendum: extend
  `web/scripts/tests/expected-columns-alias-resolution.test.mjs` with
  cases that verify `extractFromAliasMap` is shape-stable (per-scope
  resolution + JOIN-on predicate list) so future refactors of either
  validator can't drift the contract.
- [web/src/app/api/chat/orchestration.ts](web/src/app/api/chat/orchestration.ts) — wire `validateJoinPatterns` into the same Phase 17-D branch as `validateColumnExistence`.
- [web/src/lib/anthropic.ts](web/src/lib/anthropic.ts) — system prompt addition.
- [web/scripts/chat-health-check.rubric.json](web/scripts/chat-health-check.rubric.json) — `forbidden_sql_patterns` extension.

**Expected lift**: +5 to +8 A (unchanged from before). Some questions
genuinely need `raw.car_data × raw.location` joins; those will
either route to repair successfully (if the LLM can find an
alternative shape) or remain blocked on `21-corner-analysis` /
similar Phase 21 slices that pre-join the data in the matview.

**Regression risk** (codex audit pass 2 — closed the parse-failure
fail-open hole): the validator's default behavior on a parser
failure is `ok: true` (matches Phase 17-C's behavior of letting the
DB catch malformed SQL). For THIS specific anti-pattern the
default-open is unsafe: if the LLM emits a timestamp-proximity
JOIN inside SQL the parser can't process (CTE shape oddities,
unsupported syntax), the validator silently passes and the join
hits Postgres at execution time, blowing through the 15s budget.

**Fix-the-fix**: layer a cheap regex pre-screen on top of the AST
walk:
1. Tokenize the input SQL (case-insensitive).
2. If the token stream contains `raw.car_data` AND `raw.location`
   AND a regex matching `(EXTRACT|epoch|abs)\s*\(.*date.*\)`,
   AND the AST parse FAILS, return
   `{ ok: false, missing: [{joinPatternViolation: "parse_failed_with_telemetry_proximity"}] }`
   so the orchestration repair path fires.
3. If the AST parse SUCCEEDS, run the existing AST walk (which
   correctly identifies the predicate shape).

The regex pre-screen is over-conservative — it could reject SQL
that happens to mention both tables and `EXTRACT`-with-`date` for
unrelated reasons. The catalog test asserts the pre-screen fires
on the exact incident SQL even when the parser is mocked to
fail. False-positive risk is low because the LLM rarely cites
both telemetry tables together unless it's attempting the join.

The validator is otherwise still conservative — only fires on the
exact shape via AST. Catalog test fixture (extended per codex
audit pass 2):
- Pure equi-join on `(session_key, driver_number, lap_number)` →
  ok.
- Window-based JOIN on `lap_number BETWEEN n-1 AND n+1` → ok.
- Single-table self-join via timestamp proximity → ok
  (anti-pattern is specifically cross-telemetry).
- The exact incident SQL form (parses cleanly) → fails via AST.
- The exact incident SQL form (parser mocked to fail) → fails via
  regex pre-screen (codex audit pass 2 addition).
- Question that legitimately mentions both telemetry tables in
  separate CTEs without a proximity join → ok (test asserts
  no false-positive).

**Verification**:
1. New unit test: 8+ table-driven cases for the validator.
2. Re-run the 10 timeout questions; confirm zero
   `heuristic_after_sql_timeout` and confirm each routes through
   `anthropic_repaired` or shifts to a different (succeeding) shape.
3. p95 latency target: drop from 71s → ≤45s on the same 10
   questions (validator catches before the 15s timeout).
4. The rubric `forbidden_sql_patterns` check fires on any
   slip-through.

---

### 4. MEDIUM ROI — repair rate is high on telemetry-adjacent categories (50% of all repairs are braking + tyre)

**Root cause**: braking 80%, tyre 50%, traction 40% of questions go
through `anthropic_repaired`. The repair path is firing because the
first-pass SQL has column-existence misses (`raw.location.n_gear` etc.)
or expensive-cross-join shapes. The 17-C validator catches the column
misses; the timeout protector catches the cross-joins. Both add ~25s
to elapsed time and produce inferior SQL after repair.

**Fix** (codex audit revision — earlier wording confused
"add to CORE_CONTRACTS" with "add column docs"; the system prompt
already PERMITS both raw.car_data and raw.location to be queried,
but does not DOCUMENT their columns).

The actual problem is two-layered:

- **Today** (verified at
  [web/src/lib/anthropic.ts:76](web/src/lib/anthropic.ts#L76) and
  [line 80](web/src/lib/anthropic.ts#L80)):
  the system prompt allows raw.car_data and raw.location, but the
  hand-curated reminder block only documents a few raw.* tables in
  detail. raw.car_data / raw.location columns reach the LLM only
  through the introspected `information_schema` schema docs from
  `web/src/lib/schemaCatalog.ts:getSchemaDocs()`. Today
  `CORE_CONTRACTS` lists 17 contracts (16 from Phase 18 + 1 added in
  Phase 21 = `analytics.sector_dominance`); raw.car_data and
  raw.location are NOT in `CORE_CONTRACTS`, so their columns are
  not introspected and not surfaced to the LLM in either path.
- **Mechanism** to fix is the codex-questioned choice between:
  - **(a) Introspect via `CORE_CONTRACTS`**: add
    `{schema:"raw", table:"car_data"}` and
    `{schema:"raw", table:"location"}` to the array. The
    introspector pulls every column at process start; the LLM
    sees full column docs in every prompt. Token cost scales with
    column count (raw.car_data has ~10 columns; raw.location has
    ~6).
  - **(b) Extend the hand-curated raw reminder block** at
    [anthropic.ts:80](web/src/lib/anthropic.ts#L80) — add 2 lines
    naming the column lists explicitly. Token cost is ~50 tokens
    total; the column lists become part of every prompt by
    definition.

**Decision**: ship **option (b)** as the primary fix, with the
table list extended (codex audit pass 2 — see "Coverage scope"
below) to also include `raw.overtakes` since two of the three
`sql_generation_failed` questions hallucinated columns on that
table.

**Coverage scope**: the column-list reminders extended at
[anthropic.ts:80](web/src/lib/anthropic.ts#L80) MUST cover every
raw.* table the baseline showed column-hallucinations on:
- `raw.car_data` — speed, brake, throttle, n_gear, rpm, drs, date,
  session_key, driver_number, meeting_key.
- `raw.location` — x, y, z, date, session_key, driver_number,
  meeting_key (NO telemetry; spatial only).
- `raw.overtakes` — actual columns per `information_schema`. The
  LLM's hallucinated `driver_number` / `overtake_type` are NOT in
  this table; the real fields involve overtaking + overtaken
  driver numbers and lap. Add real column list to the reminder.

**Why (b) over (a)**:
- (a) adds raw.* tables to the LLM-stable contract surface, which
  is the OPPOSITE of the design intent (`CORE_CONTRACTS` is for
  curated contracts the LLM should prefer; raw.* tables are
  implementation, only allowed when no contract covers the
  question).
- (b) puts the column docs where they belong — in the same
  hand-curated block that already names raw.* tables — without
  promoting them to "preferred contract" status.
- (b) is also smaller (~75 tokens for three raw.* column lists vs
  ~225 for full introspected docs).

**Prompt-size impact**: measured before/after.
- Today: introspected schema docs run ~3.5 KB on production
  prompts (16 contracts × ~10 columns × ~25 tokens/column).
- After (b): + ~75 tokens for three raw.* column-list lines (was
  +50 in the codex-audit-pass-1 wording when only car_data +
  location were covered). No CORE_CONTRACTS change. Margin
  remains comfortable against the Anthropic context-window
  budget.

**Files**:
- [web/src/lib/anthropic.ts](web/src/lib/anthropic.ts) — extend the
  hand-curated raw-table reminder block at line 80 with the
  raw.car_data, raw.location, AND raw.overtakes column lists.
- (NOT changed): `web/src/lib/schemaCatalog.ts` `CORE_CONTRACTS` —
  stays scoped to curated contracts only.
- A test fixture asserts a sample prompt contains all three column
  lists (so a future refactor can't silently drop them).

**Expected lift**: +5 A (unchanged), plus elapsed-time reductions
across 35 repair-path questions (target: drop median elapsed from
30s → ≤18s). All 3 `sql_generation_failed` questions should be
the fastest wins now that the reminder covers all three offending
tables.

**Regression risk**: low. ~75 added prompt tokens is negligible
against the budget; no contract surface change.

**Verification**:
1. Re-run the 3 `sql_generation_failed` questions; confirm column
   hallucinations stop. Specific assertions:
   - q1702 (Track dominance): `raw.location.n_gear` no longer
     appears in generated SQL (the reminder makes clear that
     n_gear is on raw.car_data).
   - q2085 (Overtake): `raw.overtakes.driver_number` /
     `.overtake_type` no longer appear (the reminder lists the
     real raw.overtakes column shape).
   - q1982 (Traction): the third hallucination case — root-cause
     identified separately.
2. Repair-rate target: braking ≤40%, tyre ≤25%, traction ≤20%.
3. Prompt-size test fixture: the assembled system prompt is within
   ±100 tokens of pre-fix, AND contains all three raw.* column
   lists.

---

### 5. LOW ROI — handful of questions are inherently multi-matview (cross_category 8/9 will not lift before Phase 21)

**Root cause**: cross_category questions cite 2+ analytics matviews
that don't exist yet. Even with perfect resolver + schema docs, these
cannot grade A.

**Fix**: NONE. These are correctly deferred via `floor_active_after_slice`
to a Phase 21 tier-4 slice (`21-driver-performance-7axis`) and the
gate suppresses them today. They become A only when Phase 21 ships.

**Expected lift**: 0 from this plan. Phase 21 → expected +6 A on
cross_category alone.

---

### 6. LOW ROI — distinguish proven-data-unavailable from wrong-filter on 0-row results

**Root cause** (codex audit revision — the earlier wording confused
two distinct failure modes that should grade differently):
the chat returns 0 rows in TWO different scenarios that today both
grade C:
- **(a) Proven-data-unavailable**: the SQL is correct, but the
  underlying data legitimately doesn't exist (e.g. no DRS-aided
  overtakes happened in the queried window; no telemetry samples
  for a known-truncated session). This is honest no-data and
  deserves B (not full A — the chat could be more proactive about
  surfacing the upstream data gap, but it didn't lie).
- **(b) Wrong filter**: the SQL ran clean, but the filter
  predicate was wrong (e.g. `time_in_lap_sec BETWEEN 60 AND 110`
  for Turn 22 when Turn 22 occurs at ~85-95s of the lap, but the
  brake event there is `< 1` sample wide and got missed; or
  driver_number = 1 when the driver was actually #4). This is a
  bad answer dressed up in fluent prose. Should remain C.

**Fix** (codex audit pass 5 — propagated the snapshot decision from
the open-question resolution into the live implementation steps;
the grader stays DB-free):

Ship a grader-side classifier that distinguishes the two cases,
NOT a blanket C-to-B uplift. The classifier reads from a
**per-run snapshot** of `core.session_completeness` captured by
the runner BEFORE benchmark execution starts; the grader never
hits the DB.

Three-piece architecture:

1. **Runner-side snapshot capture** —
   [scripts/phase19_baseline_run.py](scripts/phase19_baseline_run.py)
   queries `core.session_completeness` ONCE at the start of the
   run, after the Neon probe but before the benchmark starts, and
   writes
   `web/logs/session_completeness_snapshot_<runId>.json` with the
   shape `{ "<session_key>": { "<table>": <row_count>, ... }, ...
   }`. The snapshot is captured at the same point-in-time as the
   benchmark SQL runs against, so wall-clock drift between SQL
   execution and grading can't drift the answer.

2. **Runner forwards the snapshot path to the grader** —
   `run_category_benchmarks.mjs` accepts a new
   `--completeness-snapshot <path>` arg (or reads
   `OPENF1_BENCHMARK_COMPLETENESS_SNAPSHOT` env var). The
   `phase19_baseline_run.py` orchestrator passes the snapshot path
   captured in step 1.

3. **Grader-side classifier (DB-free)** —
   [web/scripts/chat-health-check-baseline.mjs](web/scripts/chat-health-check-baseline.mjs)
   loads the snapshot once at process start. The classifier:
   - **Resolve `session_key`** (codex audit pass 6 — the snapshot is
     keyed by session_key but `extractQualifiedColumnRefs` only
     returns tables/columns, not literal values). Use this
     precedence order:
     1. **Parse the SQL's WHERE clause** for `session_key = <int>`
        or `session_key IN (<int>, ...)` predicates (regex on the
        normalized SQL is sufficient — the existing
        `extractSessionKeyLiterals` helper at
        [orchestration.ts:216](web/src/app/api/chat/orchestration.ts#L216)
        already does this; export it for grader reuse). If exactly
        one session_key is found, use it.
     2. **Fall back to `item.sessionKey`** (the resolved session key
        from the runtime, surfaced into the graded record by Phase
        19-A's emit projection).
     3. **If neither is available** (multi-session SQL with no
        literal filter, or a session_key set was wider than 1), the
        classifier returns `'unknown'` and the grader stays at C.
        Multi-session SQL is rare in Phase 19 (most questions name
        a specific weekend) but the fail-safe prevents an arbitrary
        "first session key" pick from masking a real wrong-filter
        case.
   - **Cross-reference with the snapshot**: extract the
     `(session_key, table)` pairs the SQL touched. The `table` side
     comes from `extractQualifiedColumnRefs` (already in scope from
     Phase 19-A); the `session_key` side comes from the precedence
     resolution above. If the snapshot reports zero rows for any
     touched pair, the 0-row outcome is proven-data-unavailable.
     Award B.
   - **Predicate-narrow detection**: if the SQL has a WHERE clause
     that includes a literal time-range / lap-range / driver-number
     filter, the 0-row outcome is more likely a wrong-filter case.
     Stay at C unless the proven-data-unavailable signal also fires.
   - **Default**: if neither signal fires (e.g. snapshot path
     missing, session_key unresolved), stay at C (existing
     behavior — fail-safe).

This is conservative on purpose: codex's point is that B should
only be awarded when there is positive evidence of upstream data
unavailability, not when 0 rows happens to be the result of a
filter the grader can't introspect. Snapshot-vs-live also
guarantees no time-of-check / time-of-use skew.

**Files**:
- [scripts/phase19_baseline_run.py](scripts/phase19_baseline_run.py) —
  add a `capture_completeness_snapshot(conn, runId, logsDir)` step
  between the Neon probe and the dev-server start; pass the
  resulting path to `run_category_benchmarks.mjs` via
  `--completeness-snapshot`.
- [web/scripts/run_category_benchmarks.mjs](web/scripts/run_category_benchmarks.mjs) —
  accept `--completeness-snapshot <path>` arg; forward it through
  to `gradeHealthCheckResults` via a new optional arg or env var.
- [web/src/app/api/chat/orchestration.ts](web/src/app/api/chat/orchestration.ts) —
  export `extractSessionKeyLiterals(sql)` (already defined at line
  216) so the grader can reuse it for the WHERE-clause precedence
  resolution step. Or move it to a shared location like
  `web/src/lib/sqlValidation/sessionKeyExtraction.ts` if importing
  from `app/api/` into a CLI script would create a circular
  dependency.
- [web/scripts/chat-health-check-baseline.mjs](web/scripts/chat-health-check-baseline.mjs) —
  add the classifier as a new helper function
  `classifyZeroRowOutcome(item, completenessSnapshot)` returning
  `'proven_data_unavailable' | 'wrong_filter' | 'unknown'`.
  Apply: only `proven_data_unavailable` → B; the other two → stay
  at C. Grader is DB-free; if the snapshot is missing or empty,
  fall back to `'unknown'` (C).

**Expected lift**: +1 to +2 from C → B (unchanged).

**Regression risk**: low. The classifier is conservative; default
is unchanged behavior.

**Acceptance test**: a unit fixture
`web/scripts/tests/grader-zero-row-classifier.test.mjs` covers:
- (a) clean SQL with `WHERE session_key = 9839` AND a snapshot
  reporting 0 rows for `(9839, raw.car_data)` → B
  (session_key from WHERE-clause path #1 of the precedence rule).
- (b) clean SQL with no `session_key` literal but
  `item.sessionKey = 9839` AND snapshot reports 0 rows → B
  (session_key from `item.sessionKey` fallback path #2).
- (c) clean SQL with `WHERE session_key IN (9839, 9840)` (multi-
  session set wider than 1) → `'unknown'` → C (precedence path #3
  fail-safe; classifier MUST NOT pick the first one arbitrarily).
- (d) clean SQL with no session_key literal AND no
  `item.sessionKey` → `'unknown'` → C.
- (e) clean SQL with a tight literal filter and 0 rows where
  the snapshot reports upstream data IS populated → C (unchanged).
- (f) malformed SQL → C (unchanged).
- (g) **snapshot path missing/empty** → classifier returns
  `'unknown'` and grader stays at C (fail-safe; never opens DB
  connection).
- (h) snapshot file present but malformed JSON → fall back to
  `'unknown'` with a warning log; grader stays at C.

The fixture asserts the grader never imports `pg` / `psycopg2` /
any DB driver — a textual "no DB import" check on the loaded
module surface.

---

## Combined expected outcome (codex audit pass 2 — recomputed)

Recomputed against the actual **39 active-floor / 128 deferred-floor**
split (codex audit pass 2 corrected the earlier 50/117 estimate).

Active-floor 39 today: **20 A / 3 B / 16 C (51.3% A-rate)**.
Deferred-floor 128 today: **48 A / 29 B / 51 C (37.5% A-rate)**.

Per-fix lift (split into active vs deferred where possible):

| Layer | Δ A on active-39 | Δ A on deferred-128 | Total Δ A | Notes |
|---|---:|---:|---:|---|
| 1. proprietary plural fix | +1 | 0 | +1 | id=1758 is active-floor; proprietary_no_data 8/9 → 9/9 |
| 2. resolver race-shaped guardrails | +3 to +5 | +7 to +10 | +10 to +15 | most clarification-trapped questions are deferred (cross_category 8/9, driver_score 5/8); active-floor lift smaller |
| 3. parse-time timestamp-proximity validator | +1 to +2 | +4 to +6 | +5 to +8 | timeouts skewed deferred (corner / braking / tyre); active wins are stint and pit |
| 4. raw.* column docs in reminder block | +1 to +2 | +3 to +4 | +5 | sql_generation_failed q1702 (deferred), q2085 (deferred), q1982 (deferred) — minimal active-floor wins |
| 5. cross_category | 0 | 0 | 0 | needs Phase 21 |
| 6. proven-data-unavailable B-classifier | 0 to A | 0 to A | ~+1 to +2 to B | conservative; very few questions hit the proven-unavailable signal cleanly |
| **TOTAL** | **+6 to +10 A** | **+14 to +20 A** | **+20 to +30 A** | **active 51.3% → 67-77%; aggregate 40.7% → 53-58%** |

If every fix lands cleanly:
- **Active-floor 39**: 20 → 26-30 A (67–77%; acceptance bar is
  ≥77% / ≥30 per codex audit pass 3, aligned with the lift math).
- **Deferred-floor 128**: 48 → 62-68 A (~48-53%).
- **Aggregate 167**: 68 → 88-98 A (53–58%; acceptance bar is
  ≥51% per codex audit pass 2).

The earlier ≥56% acceptance bar is replaced with **≥51%** because
the recounted 39/128 split shifts where the lift comes from — most
A-grade upside lives in the deferred-floor 128 (which contributes
to aggregate but not to "active-floor passing the gate"). Most of
the active-floor 16 C-grades are deeper-cause: questions that
genuinely need Phase 21 even though their `floor_active_after_slice`
is null (e.g. data_health questions that ask for cross-table audits
between core.session_completeness and analytics.race_control_incidents).

**Acceptance bars (§"Acceptance criteria")**:
- Active-floor 39: **≥77% A-rate (≥30/39)**, up from 51.3%.
- Aggregate 167: **≥51% A-rate**, up from 40.7%.

---

## Order of execution

1. **Day 1** — Fix 1 (regex). Re-run proprietary_no_data category only.
   Verify 9/9.
2. **Day 1-2** — Fix 4 (raw-table prompt reminder extension at
   [anthropic.ts:80](web/src/lib/anthropic.ts#L80) — codex audit
   pass 3 renamed this step from "CORE_CONTRACTS extension" because
   Fix 4 explicitly does NOT change CORE_CONTRACTS; it extends the
   hand-curated raw.* reminder block with column lists for
   raw.car_data, raw.location, and raw.overtakes). Confirm prompt
   doesn't truncate. Re-run the 3 `sql_generation_failed` questions.
3. **Day 2-3** — Fix 3 (forbidden timestamp-proximity). Re-run the 10
   timeout questions.
4. **Day 3-5** — Fix 2 (resolver venue+year). Hardest engineering. Add
   unit tests. Re-run curated 50q baseline (must stay ≥88%) AND the
   45 affected Phase 19 questions.
5. **Day 6-7** — Fix 6 (grader proven-data-unavailable classifier).
   **Codex audit pass 6 reclassified this from "cosmetic, ship if
   easy" to a multi-component change** spanning three files:
   - Runner-side completeness snapshot capture in
     [scripts/phase19_baseline_run.py](scripts/phase19_baseline_run.py).
   - CLI plumbing in
     [web/scripts/run_category_benchmarks.mjs](web/scripts/run_category_benchmarks.mjs)
     to forward `--completeness-snapshot <path>`.
   - Grader-side classifier in
     [web/scripts/chat-health-check-baseline.mjs](web/scripts/chat-health-check-baseline.mjs)
     with the WHERE-clause / item.sessionKey precedence resolution
     and the `'unknown'` fail-safe.
   - `extractSessionKeyLiterals` export refactor (or shared module
     move) so the grader can reuse the WHERE-clause parser.
   Effort: ~1.5 days (was scoped at ½ day pre-pass-5/6).
   Risk: low-medium (snapshot-capture step adds DB I/O at run start;
   grader path stays DB-free; precedence rule has fail-safe).
6. **Day 8** — Re-run full Phase 19 baseline. Capture as
   `phase_19_baseline_2026-05-04.{json,md}` and supersede the
   2026-05-03 snapshot. This becomes the "before" snapshot every
   Phase 21 PR's acceptance compares against.

---

## Acceptance criteria (codex audit pass 2 — recounted)

- [ ] All existing test suites pass (`npx tsc --noEmit` clean; 50 new
      Phase 19 tests still green).
- [ ] Curated 50-question benchmark A-rate ≥88% (no regression).
- [ ] **Phase 19 active-floor 39 questions A-rate ≥77%** (≥30/39;
      currently 20/39 = 51.3%; codex audit pass 3 lowered the bar
      from ≥85%/≥33 because the per-fix lift table only generates
      +6 to +10 A on active-floor — see §"Realistic ceiling
      estimate" for why higher targets need additional out-of-scope
      fixes).
- [ ] **Phase 19 aggregate A-rate ≥51%** (currently 40.7%; revised
      down from ≥56% after recounting 39/128 active/deferred split).
- [ ] proprietary_no_data category 9/9 A (Fix 1).
- [ ] Median elapsedMs ≤18s (currently 30s).
- [ ] p95 elapsedMs ≤45s (currently 71s).
- [ ] No question regresses from A → B/C compared to 2026-05-03 baseline.
- [ ] Zero questions hit `heuristic_after_sql_timeout` after Fix 3
      lands (HARD GATE — enforced by parse-time validator with the
      regex pre-screen for parse-failure cases, not just prompt rule).
- [ ] `runtime_clarification` count drops from 45 to ≤25 after Fix 2
      lands (consistent across plan).
- [ ] All 4 existing 50q rubric clarification ids (8, 9, 15, 17)
      still trigger clarification — assert in Fix 2 unit test.
- [ ] Quali / pole / sprint / FP / practice / long-run questions in
      Phase 19 still trigger clarification (negative fixtures from
      Fix 2 verification).
- [ ] Fix 4 prompt-size impact is within ±100 tokens of pre-fix; the
      assembled system prompt contains all THREE raw.* column lists
      (raw.car_data, raw.location, raw.overtakes).
- [ ] Fix 6's grader-side B-grade fires ONLY when the per-run
      `session_completeness_snapshot_<runId>.json` reports zero
      rows on the (session_key, table) pair the SQL touched
      (proven-data-unavailable); wrong-filter cases stay C.
- [ ] Fix 6's grader stays DB-free — no `pg` / `psycopg2` import
      reachable from `chat-health-check-baseline.mjs`. The runner
      captures the snapshot ONCE and forwards the path; the grader
      reads the snapshot file only.
- [ ] When the snapshot path is missing / empty / malformed, the
      classifier falls back to `'unknown'` and grades C (fail-safe;
      no DB hit attempted).

---

## Out of scope (deferred to Phase 21)

- The 128 questions whose `floor_active_after_slice` points at a
  Phase 21 lift slice (codex audit pass 3 corrected the earlier 117
  count — see §"Realistic ceiling estimate" for the verified
  39/128 split).
- Latency floor below 18s — that requires the analytics matviews to
  exist.
- driver_score / cross_category beyond ~50% A-rate.

---

## Codex audit history + open questions

### Resolved by audit pass 6 (2026-05-03)

- **MEDIUM (Fix 6 session_key resolution under-specified)** — the
  snapshot is keyed by session_key but the classifier only had
  table/column information from `extractQualifiedColumnRefs`,
  with no path to derive the concrete session_key value.
  **RESOLVED**: added an explicit precedence rule in the Fix 6
  classifier:
  1. Parse `WHERE session_key = ...` / `IN (...)` from the SQL
     using the existing `extractSessionKeyLiterals` helper at
     [orchestration.ts:216](web/src/app/api/chat/orchestration.ts#L216).
     Use it only when exactly one session_key is found.
  2. Fall back to `item.sessionKey` from the runtime resolution.
  3. Otherwise return `'unknown'` and grade C (fail-safe).
  Files block extended to include exporting / sharing
  `extractSessionKeyLiterals`. Test fixture extended with cases
  for each precedence path including the multi-session-set
  fail-safe.
- **LOW (Fix 6 effort wording stale)** — the order-of-execution
  step still called Fix 6 "cosmetic, ship if easy" while pass 5
  had grown it into a three-component runner+CLI+grader change.
  **RESOLVED**: rewrote the Day 6 entry as Day 6-7, listing all
  four implementation pieces (snapshot capture, CLI plumbing,
  grader classifier, helper export) and revising effort estimate
  to ~1.5 days. Day 7 (re-run baseline) shifted to Day 8.

### Resolved by audit pass 5 (2026-05-03)

- **MEDIUM (Fix 6 snapshot decision not propagated to live
  implementation)** — open-question resolution said "capture a
  per-run snapshot of `core.session_completeness` at benchmark
  start, grade against the snapshot," but the live Fix 6
  implementation steps still cross-referenced the live DB and only
  modified `chat-health-check-baseline.mjs`. **RESOLVED**: split
  Fix 6 into three explicit pieces — runner-side snapshot capture
  (`phase19_baseline_run.py`), runner forwards path
  (`run_category_benchmarks.mjs --completeness-snapshot`), grader
  reads the snapshot only (`chat-health-check-baseline.mjs` stays
  DB-free). Acceptance criteria updated to assert the grader has
  no DB driver imports reachable, and the unit fixture covers
  missing/malformed snapshot paths.
- **MEDIUM (`extractFromAliasMap` return shape under-scoped for
  nested SQL)** — single global `aliases: AliasMap` would cross-
  resolve outer/inner aliases under CTE/subquery shadowing.
  **RESOLVED**: helper now returns
  `joinOnPredicates: ResolvedJoinOnPredicate[]` where each entry
  carries `leftRef` / `rightRef` ALREADY resolved at extraction
  time inside the scope that owns the JOIN. CTE/subquery refs are
  tagged so consumers don't try to match them as base tables. A
  CTE-shadowing fixture is added to the unit test.
- **LOW (`validateStatement` doesn't exist)** — corrected pointer
  to `walkStatementForRefs`. The hoist target is now named
  correctly in three places: Layer 1 description, Files block, and
  audit-history's pass-4 entry.

### Resolved by audit pass 4 (2026-05-03)

- **MEDIUM (Fix 3 reuse claim)** — earlier wording said
  `extractQualifiedColumnRefs` was the alias-resolution helper Fix
  3 reuses, but that helper returns *resolved column refs* only,
  NOT the FROM/JOIN alias map or ON-predicate AST that JOIN-
  pattern validation needs. **RESOLVED**: Fix 3 now hoists a new
  exported `extractFromAliasMap(sql)` helper out of
  `walkStatementForRefs` in `columnExistenceCheck.ts` (codex
  audit pass 5 corrected the function name). Both
  `validateColumnExistence` and `validateJoinPatterns` consume it,
  so the alias rules stay drift-free. Test addendum extended.
- **LOW (deferred-floor projection mismatch)** — ceiling section
  said deferred would rise to "55–65 A-grades"; lift table said
  "62–68 A". **RESOLVED**: aligned both to the lift-table range
  **62–68 A (48–53% A-rate)**.
- **LOW (open-questions overlap)** — earlier #2 and #6 both asked
  whether `core.session_completeness` is the right authority for
  Fix 6's grader classifier and whether the DB I/O is acceptable.
  **RESOLVED**: merged into a single open question with a decided
  approach — capture a per-run snapshot of
  `core.session_completeness` at benchmark start and grade against
  the snapshot (DB-free grader path preserved; authority captured
  at the same point-in-time as the SQL ran).

### Resolved by audit pass 3 (2026-05-03)

- **HIGH (active-floor target unsupported by lift table)** — the
  ≥85% / ≥33 active-floor target was unreachable from the per-fix
  +6 to +10 A active-floor lift in the table. **RESOLVED**: lowered
  the active-floor acceptance bar to **≥77% / ≥30** A-rate (matches
  the upper bound of the lift math). The previously-stated 34-37/39
  target was unscoped and required additional out-of-scope fixes
  (3-7 more A) — those moved to open question #5.
- **LOW (stale 117 in Out of Scope)** — corrected to **128**
  questions deferred to Phase 21, matching the verified count in
  §"Realistic ceiling estimate".
- **LOW (Fix 4 mislabeled "CORE_CONTRACTS extension")** — renamed
  the order-of-execution step to **"raw-table prompt reminder
  extension"**, matching the actual mechanism. Fix 4 explicitly
  does NOT touch `CORE_CONTRACTS`.
- **LOW (resolved question still in Open Questions)** — removed
  the "Active-floor 50 question composition" question from open
  list (it was resolved by audit pass 2's recount); replaced with
  the new active-floor uplift open question.

### Resolved by audit pass 2 (2026-05-03)

- **HIGH (active-floor math)** — earlier counts said 50 active /
  117 deferred; actual is **39 active / 128 deferred** (verified by
  counting `floor_active_after_slice: null` in source JSONs). Active
  grades are 20 A / 3 B / 16 C, NOT 32 A / 9 B / 9 C. **RESOLVED**:
  recomputed §"Realistic ceiling estimate" and §"Combined expected
  outcome" with actual numbers. Acceptance bar dropped from ≥56% to
  **≥51%** aggregate; active-floor target dropped from ≥90% to
  ≥85% (33/39) at audit pass 2, and was further lowered to
  **≥77% (≥30/39) at audit pass 3** to align with the per-fix lift
  table — see audit pass 3's HIGH finding above.
- **MEDIUM (aggregate target inconsistency)** — ceiling section
  said `40.7% → 56–60%` and `+26 to +34 A`; lift table said
  `+21 to +29 A` and `53–58%`. **RESOLVED**: single source of truth
  is now §"Combined expected outcome" with `+20 to +30 A` and
  `53–58%`; ceiling section converged.
- **MEDIUM (Fix 2 contradictions)** — negative-fixture list
  contained an entry marked "still resolves"; verification said
  `≤20` while acceptance said `≤25`. **RESOLVED**: moved
  "Mercedes warmup laps stint 1" question to positive-fixture list
  (it IS race-shaped); aligned both verification and acceptance to
  `≤25`.
- **MEDIUM (Fix 3 fail-open on parse failure)** — calling Fix 3 a
  hard gate while the validator returns `ok: true` on parse failure
  is contradictory for a HARD GATE. **RESOLVED**: layered a regex
  pre-screen on top of the AST walk. If both telemetry tables and
  a timestamp-extraction shape are present in the token stream AND
  the AST parse fails, the validator emits a synthetic violation
  and routes to repair.
- **LOW (Fix 4 coverage gap)** — adding raw.car_data and
  raw.location reminders won't fix the q2085 hallucinations on
  `raw.overtakes.driver_number` / `.overtake_type`. **RESOLVED**:
  extended Fix 4's table list to also cover `raw.overtakes`. Token
  budget grows from +50 to +75; still well within the prompt
  budget.

### Resolved by audit pass 1 (2026-05-03)

- **HIGH (Fix 2)** — naive race-default would pick wrong session for
  quali/sprint/practice questions. **RESOLVED**: race-shaped allow-
  list + session-type-sensitive deny-list, with positive AND
  negative fixtures including the 50q rubric clarification ids and
  Phase 19's quali/pole/sprint/FP questions.
- **HIGH (Fix 3)** — system prompt + rubric is not a hard runtime
  guarantee but acceptance demands zero
  `heuristic_after_sql_timeout`. **RESOLVED**: parse-time SQL
  validator (Layer 1 HARD GATE) added that rejects the
  `raw.car_data × raw.location` timestamp-proximity join pattern
  before SQL execution and routes to repair. Prompt + rubric kept
  as Layers 2 and 3 belt-and-suspenders.
- **MEDIUM (ceiling math)** — stale "~70%" claim contradicted the
  per-fix table. **RESOLVED**: cleaned up, settled on 53–58% range
  with ≥56% as the acceptance floor.
- **MEDIUM (Fix 4)** — confused "add to CORE_CONTRACTS" with "add
  column docs"; CORE_CONTRACTS is the curated-contract surface, not
  the schema-doc surface. **RESOLVED**: shipped option (b) — extend
  the hand-curated raw-table reminder block at
  [anthropic.ts:80](web/src/lib/anthropic.ts#L80) with raw.car_data
  and raw.location column lists. CORE_CONTRACTS unchanged.
  Prompt-size impact bounded to ~50 tokens, with a fixture
  asserting the column lists are present.
- **MEDIUM (Fix 6)** — blanket C → B uplift would reward wrong
  filters. **RESOLVED**: classifier distinguishes proven-data-
  unavailable (cross-referenced via `core.session_completeness`)
  from wrong-filter (stays C).

### Open questions (codex audit pass 4)

1. **Validator false-positive risk for Fix 3 Layer 1**: the
   timestamp-proximity detection is AST-pattern-based. Are there
   legitimate analytical SQL shapes (e.g. window-function
   approximation of brake events) that the validator would
   incorrectly reject? Catalog 3-5 known-legitimate shapes and add
   them to the test fixture.
2. **Fix 6 classifier — `core.session_completeness` as the authority**
   (codex audit pass 4 — merged from earlier #2 and #6, both of
   which asked the same underlying question):
   - **(a) Is the table itself the right authority?** Are there
     data-availability signals it misses (e.g. driver-specific gaps
     within an otherwise complete session, missing telemetry windows
     mid-session, weather-feed dropouts mid-FP1)?
   - **(b) Is querying it from the grader acceptable?** The grader
     path is currently DB-free; this fix adds DB I/O. Should the
     grader instead read from a frozen snapshot captured at the
     start of each benchmark run (avoid drift between when SQL ran
     and when grading reads completeness)?
   Decision: ship the snapshot approach (b) — capture
   `core.session_completeness` at benchmark start, freeze it as
   `logs/session_completeness_snapshot_<runId>.json`, and grade
   against the snapshot. Resolves both sub-questions together.
3. **Fix order interaction**: does Fix 4 reduce the repair rate so
   much that Fix 3's parse-time validator rarely fires? If so,
   Fix 3's lift estimate (+5 to +8 A) might overlap with Fix 4's
   (+5 A). If overlap is >50%, drop the combined estimate to
   account for the double-count.
4. **Are there fixes I missed?** From the baseline JSON:
   - 1 expected_path mismatch where `no_data_refusal` was expected
     and `anthropic` returned. This IS id=1758, covered by Fix 1.
     Confirmed.
   - 1 `deterministic_template` route — verify it's the
     `sessions_most_complete_downstream_coverage` template firing
     correctly on a metadata question; if so, no fix needed.
5. **Active-floor uplift beyond +6 to +10 A**: codex audit pass 3
   established that this plan's lift table caps the active-floor
   gain at 26-30 A (out of 39). Reaching ≥85% A-rate / ≥33 would
   require an out-of-scope follow-up plan. Two candidates:
   - Active-floor data_health uplift (small core helper for
     session-vs-session completeness diffs without
     analytics.race_control_incidents) → +3-5 A.
   - Active-floor metadata cross-weekend audit (a
     `core.session_audit_summary` view) → +1-2 A.
   Decision deferred until after this plan ships and the
   2026-05-04 baseline locks in.

If APPROVED, next step is to start **Fix 1** (10-min regex change)
as the fastest verification that the plan's measurement loop works.
Fix 4 ships in parallel since it's another low-risk single-file
change. Fix 3 (parse-time validator) is the most engineering-heavy
fix; ship it after Fixes 1 + 4 verify the loop is working.
