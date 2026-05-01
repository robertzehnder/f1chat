# Alias Resolver Plan — 2026-05-01 (rev4. 2026-05-01 post-audit-4)

Goal: support casual-fan phrasing in chat by mapping any reasonable
human reference to drivers, teams, and venues onto the canonical
warehouse entity. "Max", "Verstappen", "VER", "1", "max verstappen"
all → driver_number 1; "Spa", "Belgium", "Belgian GP",
"Spa-Francorchamps" all → the right `core.sessions` row for the
Belgian Grand Prix in the requested year.

This plan addresses the resolver-failure tail surfaced by the
2026-05-01 variant benchmark (27/50 variant questions returned
`generationSource: unknown`, 32/50 graded C — most plausibly
entity-resolution failures masquerading as data gaps).

## Revision (2026-05-01 post-audit)

The first draft of this plan proposed three brand-new alias contract
tables and a venue model keyed on `meeting_name`. An audit found
three substantive errors:

1. **The proposed PK had an expression** (`COALESCE(season_year, 0)`),
   which Postgres rejects.
2. **The team model assumed a `team_id` column** that does not exist;
   `core.session_drivers` exposes only `team_name`, and the existing
   resolver canonicalizes by `canonical_team_name` plus active-year
   windows.
3. **The repo already has a fully-seeded alias infrastructure** —
   `core.driver_alias_lookup`, `core.team_alias_lookup`,
   `core.session_venue_alias_lookup`, `core.session_type_alias_lookup`,
   plus derived views `core.driver_identity_lookup`,
   `core.team_identity_lookup`, `core.session_search_lookup` —
   already wired into `web/src/lib/queries/resolver.ts`. Adding new
   parallel tables would create two sources of truth.
4. **The repo explicitly warns against `meeting_name`-only venue
   matching** (`web/src/lib/anthropic.ts:77-79`); the existing
   `session_search_lookup` already joins on `country_name`,
   `location`, and `circuit_short_name`, which is correct.

This revision reframes the plan as an **extension of existing
infrastructure**, not a replacement.

## Revision 2 (2026-05-01 post-audit-2)

A second audit caught three more issues in the rev1 draft:

1. The plan claimed the chat response would gain a new
   `clarification` block "with no breaking changes." That IS a
   contract change — the runtime contract today exposes
   clarification through `resolution.needsClarification` +
   `resolution.clarificationPrompt`, and the orchestration route's
   `runtime_clarification` branch returns a plain `answer` payload
   sourced from `clarificationPrompt` (`web/src/lib/chatRuntime.ts:96-100`,
   `web/src/app/api/chat/orchestration.ts:411-471`).

2. The diacritic claim ("`Pérez` ↔ `perez` resolves") was
   underspecified. The actual lookup-side normalization is
   lowercase + trim only (`web/src/lib/queries/resolver.ts:28-38`)
   and the chat-runtime normalizer is lowercase + non-word-strip +
   whitespace-collapse (`web/src/lib/chatRuntime.ts:210-212`) —
   neither strips diacritics. Without changes at those points,
   diacritic coverage requires duplicating every variant in seed,
   which doesn't scale.

3. The pg_trgm index claim was overstated. The plan added GIN
   indexes only on the three seed tables, but
   `getSessionsFromSearchLookup` queries `core.session_search_lookup`,
   which UNION-ALLs the seed-venue rows with intrinsic aliases
   computed inline from `core.sessions.{country_name, location,
   circuit_short_name, session_name}` (`sql/005_helper_tables.sql:170-277`).
   Misspellings hitting the intrinsic-aliases branch get no index
   benefit unless the underlying `core.sessions` columns are also
   indexed — or the resolver bypasses the view for the fuzzy path.

This revision specifies fixes for all three.

## Revision 3 (2026-05-01 post-audit-3)

A third audit caught three more concrete repo-shape issues:

1. **`core.sessions` is a view, not a table.** It is defined as
   `CREATE OR REPLACE VIEW core.sessions AS SELECT s.*, m.meeting_name, ... FROM raw.sessions s LEFT JOIN raw.meetings m USING (meeting_key)` (`sql/004_constraints.sql:56-63`).
   Postgres does not allow indexes on regular views, so the rev2
   "GIN expression indexes on `core.sessions.{country_name, ...}`"
   would fail at migration time. The intrinsic columns the resolver
   actually fuzzy-matches against (`country_name`, `location`,
   `circuit_short_name`, `session_name`) come from `s.*` — i.e.
   `raw.sessions`. Indexes must target `raw.sessions`.

2. **Seed-table branch of the session fuzzy fallback was
   under-specified.** The rev2 SQL sketch returned only
   `(matched_on, session_key=NULL, sim)` from
   `core.session_venue_alias_lookup`, but the planned
   "join back to sessions via country_name/location/circuit_short_name"
   needs those columns in the result. Fixed by performing the
   join-back inside the same branch so it emits a real
   `session_key`.

3. **Loader behavior already handles re-normalization via
   truncate-and-reload.** `scripts/load_codex_helpers.sh:66-102`
   does `TRUNCATE ... \copy ... UPDATE normalized_alias = LOWER(BTRIM(...))`.
   Slice E does not need a separate one-time backfill — the next
   loader run reseeds everything. The loader change is one
   expression swap (`LOWER(BTRIM(alias_text))` →
   `unaccent(LOWER(BTRIM(alias_text)))`) on each
   `UPDATE … SET normalized_alias = …` block; idempotency comes
   from the existing truncate-and-reload pattern.

## Revision 4 (2026-05-01 post-audit-4)

A fourth audit caught one substantive omission and one wording
inconsistency:

1. **The view-side `normalized_alias` expressions still use
   `LOWER(BTRIM(...))`, not `unaccent(LOWER(BTRIM(...)))`.** Slice
   E in rev3 updated three boundaries (JS resolver normalizer, JS
   chat-runtime normalizer, seed loader) but missed a fourth: the
   inline `normalized_alias` computations inside derived views.
   The repo's seven inline-normalization sites in
   `sql/005_helper_tables.sql` are:
   - `core.session_search_lookup` intrinsic-alias branches
     (lines 189, 200, 211, 222 — country_name, location,
     circuit_short_name, session_name)
   - `core.session_search_lookup` venue_aliases JOIN predicates
     (lines 237-239) and session_type_aliases JOIN predicates
     (lines 250-251)
   - `core.driver_identity_lookup` (line 339)
   - `core.team_identity_lookup` (lines 400, 412, 424)
   - The seed-table partial-unique indexes at lines 131-140 use
     `COALESCE(normalized_alias, LOWER(BTRIM(alias_text)))` as
     a fallback expression

   Without these updates, exact-match lookups via the views still
   miss diacritic variants (e.g. user types `Sao Paulo`, view-side
   intrinsic alias is `LOWER(BTRIM('São Paulo')) = 'são paulo'`,
   no match). Fuzzy fallback would catch them at higher cost,
   but the goal of Slice E is to make exact-match work
   end-to-end. Slice E now explicitly covers the view definitions.

2. **Stale wording in the integration section.** The integration
   text referred to "the new `core.sessions` expression GIN
   indexes" after rev3 had moved them to `raw.sessions`. Editorial,
   but corrected for internal consistency.

---

## Why the resolver still fails (corrected)

Today the resolver path is:

1. The chat runtime extracts entity mentions from the question
2. `resolver.ts` calls `getDriversFromIdentityLookup` /
   `getSessionsFromSearchLookup`, which run **exact match on
   `normalized_alias`** against the seeded lookup tables/views
3. If no exact match, the runtime drops to LLM-assisted resolution
   or returns `low_confidence` / `unknown`

The seeded tables are real and useful — but their **coverage** of
casual phrasing is thin. From the variant benchmark and casual fan
chat patterns:

- **Drivers**: 3-letter codes (VER, HAM, NOR), nicknames (Checo,
  Mad Max, Magic Alonso), driver-number-as-text ("1", "44"),
  diacritic variants (Pérez ↔ Perez), and casual misspellings
  (Verstapen) are inconsistently covered
- **Teams**: short forms (RBR), nicknames (Maranello → Ferrari,
  Black Bull → Red Bull), and historic names that map forward
  (AlphaTauri → Racing Bulls) are partially covered at best
- **Venues**: short circuit names (Spa, Monza), country names
  (Belgium, Italy), nicknames (the Ardennes, the Tilkedrome),
  and casual GP forms (Belgian GP, Italian Grand Prix) are
  unevenly seeded; the lookup tolerates but does not enforce
  this coverage

**There is no fuzzy fallback.** If the seed is missing or misspelled,
the lookup returns nothing and the runtime cascades to the slow LLM
path. That's the dominant variant-benchmark failure mode.

---

## Architecture (corrected) — extend, don't replace

```
                   ┌──────────────────────────┐
   user mention ─► │  normalize(text)         │ existing path:
                   │                          │ lowercase, strip
                   │                          │ diacritics (NEW),
                   │                          │ collapse whitespace
                   └────────────┬─────────────┘
                                ▼
                   ┌──────────────────────────┐
                   │ exact match against      │ existing:
                   │ normalized_alias in      │ getDriversFromIdentityLookup
                   │ existing lookup tables   │ getSessionsFromSearchLookup
                   └────────────┬─────────────┘
                                │ no match
                                ▼
                   ┌──────────────────────────┐
                   │ pg_trgm fuzzy match  NEW │ similarity > 0.7
                   │ on normalized_alias      │ via gin_trgm_ops
                   └────────────┬─────────────┘
                                │ no match / multiple matches
                                ▼
                   ┌──────────────────────────┐
                   │ disambiguation by    NEW │ for ambiguous tokens
                   │ season / context         │ (e.g. Verstappen with
                   │                          │ no year → ask)
                   └────────────┬─────────────┘
                                │ still ambiguous
                                ▼
                   ┌──────────────────────────┐
                   │ structured           NEW │ "Did you mean Max V
                   │ clarification (no LLM)   │ (driver 1, 2024+) or
                   │                          │ Jos V (1994-2003)?"
                   └──────────────────────────┘
```

---

## What the existing schema actually gives us

These are the real tables/views already in the repo (per
`sql/005_helper_tables.sql`):

### `core.driver_alias_lookup` (existing)
```
driver_number INTEGER NOT NULL
canonical_full_name TEXT
first_name, last_name, name_acronym, broadcast_name TEXT
alias_text TEXT NOT NULL
normalized_alias TEXT
alias_type TEXT NOT NULL              -- 'broadcast'|'short_name'|'nickname'|...
season INTEGER                        -- nullable: NULL = all seasons
created_at, updated_at TIMESTAMPTZ
```

(Seeded from `f1_codex_helpers/driver_alias_lookup.csv` via
`scripts/load_codex_helpers.sh`.)

### `core.team_alias_lookup` (existing)
```
alias_text, normalized_alias TEXT
alias_type TEXT
canonical_team_name TEXT NOT NULL    -- the canonical reference; NO team_id
active_from_year, active_to_year INTEGER  -- season scoping
notes TEXT
```

Teams are referenced by `canonical_team_name`. The resolver joins
through `core.team_identity_lookup` and uses `active_from_year` /
`active_to_year` for the season-rename pattern (AlphaTauri → RB →
Racing Bulls).

### `core.session_venue_alias_lookup` (existing)
```
alias_text, normalized_alias TEXT
alias_type TEXT
country_name, location, circuit_short_name TEXT  -- joined per-column
notes TEXT
```

### `core.session_type_alias_lookup` (existing)
For race/qualifying/sprint phrasing variants. Already covers most
cases.

### Derived views (existing)
- `core.driver_identity_lookup` — unifies aliases + intrinsic columns
- `core.team_identity_lookup` — same for teams
- `core.session_search_lookup` — unions intrinsic columns
  (country_name, location, circuit_short_name, session_name) with
  the seed venue aliases; joins on **country_name + location +
  circuit_short_name** (already correct re: the
  no-meeting_name-alone warning)

**Conclusion:** the schema is sound. What's missing is (a) seed-data
coverage breadth and (b) a fuzzy fallback when seed misses.

---

## Slice breakdown (corrected) — Phase 13 proposal (8 slices)

Slices in dependency order. Slices A-D are pure data/infra (low
risk, no behavior change). Slices E-H change resolver behavior.

| # | Slice | Touches | Risk |
|---|---|---|---|
| A | `13-pgtrgm-and-unaccent-extensions` | Postgres extensions + GIN expression indexes on seed tables and `raw.sessions` (the underlying base of `core.sessions`, which is a view) | Low (additive) |
| B | `13-alias-seed-expand-drivers` | `f1_codex_helpers/driver_alias_lookup.csv` + reload | Low (additive seed data) |
| C | `13-alias-seed-expand-teams` | `f1_codex_helpers/team_alias_lookup.csv` + reload | Low |
| D | `13-alias-seed-expand-venues` | `f1_codex_helpers/session_venue_alias_lookup.csv` + reload | Low |
| E | `13-resolver-normalize-diacritics` | `resolver.ts:28-38`, `chatRuntime.ts:210-212`, `scripts/load_codex_helpers.sh` | Medium (lookup-side change; backfills `normalized_alias`) |
| F | `13-resolver-trgm-fallback` | `resolver.ts` queries (driver + session fallbacks) | Medium (new query paths; needs EXPLAIN gates) |
| G | `13-resolver-clarification` | `chatRuntime.ts` clarification producer; reuses existing surface | Low (no contract change; updates fixture tests) |
| H | `13-alias-benchmark-update` | New casual-phrasing question set + variant rerun | Low (test asset) |


### 13-pgtrgm-and-unaccent-extensions

Adds two Postgres extensions and the GIN indexes that support the
fuzzy-fallback path on **both** the seed tables and the intrinsic
session columns the resolver-view UNIONs over.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Seed tables (the side already used by the existing exact-match path)
CREATE INDEX IF NOT EXISTS idx_driver_alias_lookup_alias_trgm
  ON core.driver_alias_lookup USING gin (normalized_alias gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_team_alias_lookup_alias_trgm
  ON core.team_alias_lookup USING gin (normalized_alias gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_session_venue_alias_lookup_alias_trgm
  ON core.session_venue_alias_lookup USING gin (normalized_alias gin_trgm_ops);

-- Intrinsic session columns. core.sessions is a VIEW
-- (sql/004_constraints.sql:56-63), so indexes go on the underlying
-- base table raw.sessions. These match the expression
-- `unaccent(lower(btrim(<col>)))` that 13-resolver-trgm-fallback uses
-- for fuzzy session lookup; without these, the fuzzy path sequential-
-- scans raw.sessions.
CREATE INDEX IF NOT EXISTS idx_raw_sessions_country_name_norm_trgm
  ON raw.sessions USING gin (unaccent(lower(btrim(country_name))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_raw_sessions_location_norm_trgm
  ON raw.sessions USING gin (unaccent(lower(btrim(location))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_raw_sessions_circuit_short_norm_trgm
  ON raw.sessions USING gin (unaccent(lower(btrim(circuit_short_name))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_raw_sessions_session_name_norm_trgm
  ON raw.sessions USING gin (unaccent(lower(btrim(session_name))) gin_trgm_ops);
```

Acceptance: both extensions present (`pg_extension` rows), all
seven indexes exist with `indisvalid = true`. EXPLAIN of the
fuzzy-fallback query patterns from `13-resolver-trgm-fallback`
shows `Bitmap Index Scan` on the relevant trgm index, never a
sequential scan. Smoke tests:
`similarity(unaccent(lower('verstapen')), unaccent(lower('verstappen'))) > 0.7`,
`similarity(unaccent(lower('Pérez')), unaccent(lower('Perez'))) = 1.0`.

### 13-alias-seed-expand-drivers

Extend `f1_codex_helpers/driver_alias_lookup.csv` with the missing
casual-phrasing rows. For every `driver_number` currently in
`core.session_drivers`, ensure the seed has at least:

- canonical_full_name (e.g. "Max Verstappen") — alias_type
  `canonical`, confidence implied by alias_type ordering
- 3-letter code (VER) — alias_type `name_acronym`
- driver number as text ("1") — alias_type `driver_number_text`,
  season-scoped (numbers get reassigned)
- first_name only (Max) — alias_type `first_name`
- last_name only (Verstappen) — alias_type `last_name`
- nicknames where they exist (Checo, Mad Max, Magic Alonso)
- diacritic-stripped forms (Perez ↔ Pérez) where the canonical has
  a diacritic

Coverage gate: every `driver_number` that appears in
`core.session_drivers` must have ≥3 alias rows in the seed; ≥80% of
seasoned drivers (5+ sessions) must additionally have a nickname
or 3-letter code row. No new schema; just CSV growth + reload via
`scripts/load_codex_helpers.sh`.

### 13-alias-seed-expand-teams

Extend `f1_codex_helpers/team_alias_lookup.csv`. For every distinct
`team_name` currently in `core.session_drivers` (the canonical
reference, since there is no `team_id`):

- canonical_team_name itself ("Oracle Red Bull Racing")
- short form ("Red Bull", "RBR")
- nicknames where they exist ("Maranello" → "Ferrari", "the
  prancing horse" → "Ferrari")
- historic names that map forward to the current canonical, scoped
  by `active_from_year`/`active_to_year`

Coverage gate: every distinct `team_name` in `core.session_drivers`
has ≥2 alias rows; the loader populates
`core.team_identity_lookup` (the resolver-facing view) without
duplicate-canonical rows for any single year.

### 13-alias-seed-expand-venues

Extend `f1_codex_helpers/session_venue_alias_lookup.csv`. For every
distinct `(country_name, location, circuit_short_name)` triple in
`core.sessions`, ensure the seed has:

- circuit short form (Spa, Monza, Silverstone)
- country name (Belgium, Italy, United Kingdom)
- common GP form (Belgian GP, Italian GP, British GP)
- nicknames where they exist (the Ardennes, the Tilkedrome)
- common spelling variants (Sao Paulo ↔ São Paulo)

The resolver already joins by country_name + location +
circuit_short_name (NOT meeting_name), so a single seed row can
match all sessions at that venue across years without per-year
maintenance. Coverage gate: every distinct triple in
`core.sessions` has ≥3 alias rows hitting it via the existing
`core.session_search_lookup` view.

### 13-resolver-normalize-diacritics

Updates the **lookup-side** normalization at every boundary so
diacritic stripping is consistent on both sides of the join.
Without this, the fuzzy fallback still requires duplicating every
ASCII/diacritic variant in seed data.

Four coordinated changes:

1. `web/src/lib/queries/resolver.ts:28-38` — extend `normalizeAliasList`
   to strip diacritics:
   ```ts
   .map((value) => String(value ?? "")
     .normalize("NFKD")
     .replace(/\p{Diacritic}/gu, "")
     .toLowerCase()
     .trim())
   ```
2. `web/src/lib/chatRuntime.ts:210-212` — extend `normalize()` with
   the same NFKD + diacritic-strip step before the existing
   non-word-strip pass.
3. `scripts/load_codex_helpers.sh` (the seed loader) — replace the
   four `UPDATE … SET normalized_alias = LOWER(BTRIM(alias_text))`
   blocks (`scripts/load_codex_helpers.sh:88-102`) with
   `unaccent(LOWER(BTRIM(alias_text)))` so seed-side and query-side
   normalization match exactly. The loader's existing
   truncate-and-reload pattern (`TRUNCATE TABLE … \copy …`) means
   re-running the loader fully reseeds and re-normalizes; no
   separate backfill is required.
4. `sql/005_helper_tables.sql` — every inline `LOWER(BTRIM(<col>))`
   that participates in a `normalized_alias` computation or in a
   join predicate against an alias-normalized column must be
   wrapped with `unaccent(...)`. Concretely, in a forward-only SQL
   migration `sql/00X_alias_diacritic_alignment.sql`:
   - `CREATE EXTENSION IF NOT EXISTS unaccent;` (idempotent)
   - `CREATE OR REPLACE VIEW core.session_search_lookup AS ...`
     replacing the four intrinsic-alias `normalized_alias`
     computations (lines 189, 200, 211, 222) and the
     venue_aliases / session_type_aliases JOIN predicates (lines
     237-239, 250-251) to use `unaccent(LOWER(BTRIM(...)))` on
     both sides
   - `CREATE OR REPLACE VIEW core.driver_identity_lookup AS ...`
     replacing the inline normalization at line 339
   - `CREATE OR REPLACE VIEW core.team_identity_lookup AS ...`
     replacing the three sites at lines 400, 412, 424 (and the
     matching `GROUP BY` at 424)
   - `DROP INDEX … ; CREATE INDEX …` for the four seed-table
     partial-unique indexes at lines 131-140 to update the fallback
     expression `COALESCE(normalized_alias, LOWER(BTRIM(alias_text)))`
     to `COALESCE(normalized_alias, unaccent(LOWER(BTRIM(alias_text))))`

   No data backfill needed: the views re-evaluate on next query
   automatically, and the seed-table `normalized_alias` columns are
   refreshed by the next loader run from change (3).

The reason all four boundaries must change together: the lookup
predicate is `normalized_alias = ANY($N::text[])`. If the runtime
strips diacritics before sending the array but the seed
`normalized_alias` still contains "pérez", the join misses; if the
seed strips but the runtime doesn't, the user typing "perez" still
misses; if the views' inline normalization disagrees with the
seed loader's, intrinsic-alias exact-match misses on diacritic
inputs (the `Sao Paulo` vs `São Paulo` case). They must all agree.

Acceptance:
- A fixture asserting `Pérez`, `pérez`, `Perez`, `perez` all produce
  identical `normalized_alias` output via both the JS normalizer
  and the SQL `unaccent(lower(btrim(...)))` expression.
- A SQL fixture asserting `Sao Paulo` and `São Paulo` resolve to
  the same `core.session_search_lookup` rows via the intrinsic
  branch (i.e. exact match against the view's `normalized_alias`
  column, no fuzzy fallback needed).
- The seeded `core.driver_alias_lookup.normalized_alias` for every
  diacritic-bearing canonical name has at least one ASCII-only
  row after the loader runs.

### 13-resolver-trgm-fallback

Modify `web/src/lib/queries/resolver.ts`:
- `getDriversFromIdentityLookup` continues to filter
  `normalized_alias = ANY($N::text[])` for the exact-match fast
  path. When that returns zero rows, run a fuzzy-fallback query
  against `core.driver_alias_lookup` directly:
  ```sql
  SELECT DISTINCT ON (driver_number)
    driver_number,
    alias_text,
    normalized_alias,
    similarity(normalized_alias, $1) AS sim
  FROM core.driver_alias_lookup
  WHERE normalized_alias % $1            -- pg_trgm % operator uses GIN
  ORDER BY driver_number, sim DESC
  LIMIT 5
  ```
- `getSessionsFromSearchLookup`: the view's intrinsic-aliases UNION
  branch is **not directly indexable** (the view's `normalized_alias`
  is computed inline) and `core.sessions` is a view with no
  underlying storage. The fuzzy fallback therefore queries
  `raw.sessions` directly for the four intrinsic-column branches —
  each hitting its own GIN expression index from Slice A — and
  performs the seed-table → session join inside its own UNION-ALL
  branch so it emits a real `session_key`:
  ```sql
  SELECT 'country_name' AS matched_on, session_key,
         similarity(unaccent(lower(btrim(country_name))), $1) AS sim
  FROM raw.sessions
  WHERE unaccent(lower(btrim(country_name))) % $1
  UNION ALL
  SELECT 'location' AS matched_on, session_key,
         similarity(unaccent(lower(btrim(location))), $1)
  FROM raw.sessions
  WHERE unaccent(lower(btrim(location))) % $1
  UNION ALL
  SELECT 'circuit' AS matched_on, session_key,
         similarity(unaccent(lower(btrim(circuit_short_name))), $1)
  FROM raw.sessions
  WHERE unaccent(lower(btrim(circuit_short_name))) % $1
  UNION ALL
  SELECT 'session_name' AS matched_on, session_key,
         similarity(unaccent(lower(btrim(session_name))), $1)
  FROM raw.sessions
  WHERE unaccent(lower(btrim(session_name))) % $1
  UNION ALL
  -- seed-table branch: fuzzy-match against the alias seed first,
  -- then JOIN raw.sessions on the same multi-column key the
  -- existing core.session_search_lookup view uses, so the branch
  -- emits a real session_key. The fuzzy filter uses the seed
  -- table's GIN index from Slice A; the join columns are then
  -- equality-matched (small fan-out per alias row).
  SELECT 'venue_alias' AS matched_on, s.session_key,
         similarity(svl.normalized_alias, $1) AS sim
  FROM core.session_venue_alias_lookup svl
  JOIN raw.sessions s
    ON (svl.country_name IS NULL
        OR unaccent(lower(btrim(svl.country_name))) =
           unaccent(lower(btrim(coalesce(s.country_name, '')))))
   AND (svl.location IS NULL
        OR unaccent(lower(btrim(svl.location))) =
           unaccent(lower(btrim(coalesce(s.location, '')))))
   AND (svl.circuit_short_name IS NULL
        OR unaccent(lower(btrim(svl.circuit_short_name))) =
           unaccent(lower(btrim(coalesce(s.circuit_short_name, '')))))
  WHERE svl.normalized_alias % $1
  ```
  Result rows are then optionally aggregated by `session_key` (max
  sim, list of `matched_on` reasons) and ordered by sim DESC,
  limited to top 5 candidates.

- Both fallbacks return candidates with a `match_kind` column
  (`'exact'` vs `'fuzzy'`); the runtime treats fuzzy matches with
  ≥0.85 similarity as confident, and 0.7-0.85 as needs-clarification
- Telemetry: log `{mention, normalized, match_kind, similarity,
  candidates}` to `perfTrace`

Acceptance:
- A unit-test fixture of 50 casual phrasings (Max, Checo, Mad Max,
  Spa, Belgium, Belgian GP, Maranello, the Tilkedrome, Verstapen
  with typo, Pérez with diacritic, etc.) all resolve through either
  exact or fuzzy match.
- `EXPLAIN ANALYZE` of each fuzzy-fallback query shows `Bitmap
  Index Scan` on the appropriate GIN trgm index — no
  sequential scans on `raw.sessions` or any seed table.
- Resolver p50 latency stays ≤30ms.

### 13-resolver-clarification

When the resolver returns multiple candidates with comparable
confidence (similarity differences <0.05, or multiple seed rows
match the same normalized alias across different
`driver_number`s/`canonical_team_name`s/venues), the runtime should
not silently pick one. Build a structured clarification message
deterministically:

> "Did you mean **Max Verstappen** (driver 1, Red Bull, 2015-now) or
> **Jos Verstappen** (driver 6, 1994-2003)?"

**This reuses the existing clarification surface — no contract
change.** Concretely:

- The runtime already exposes
  `ChatRuntimeResult.resolution.needsClarification: boolean` and
  `resolution.clarificationPrompt?: string`
  (`web/src/lib/chatRuntime.ts:96-100`).
- The orchestration route's `runtime_clarification` branch
  (`web/src/app/api/chat/orchestration.ts:411-471`) already returns
  a plain `answer` payload sourced from `clarificationPrompt` (or a
  fallback string).

This slice changes the **producer** of `clarificationPrompt`: when
ambiguity is detected, populate it with the deterministically-built
"Did you mean A or B?" text instead of an LLM-suggested or generic
fallback. Consumer-side (orchestration.ts, chat clients) stays
identical: they read `answer` from the existing payload field.

Tests/consumers explicitly updated by this slice:
- `web/scripts/tests/chat-runtime-clarification.test.mjs` (or its
  current path post Phase 9 split) — assert the deterministic
  clarification shape for the new ambiguous-mention fixtures.
- Any orchestration-route harness test that snapshots the
  `clarification_required` payload — refresh fixture text.
- `chat_query_trace.jsonl` schema is unchanged
  (`generationSource: 'runtime_clarification'` is the existing
  trace path).

Acceptance: a fixture with truly ambiguous mentions ("Verstappen"
no year, "Sainz" no year, "USA" with multiple 2024 venues) sets
`resolution.needsClarification = true` and populates
`resolution.clarificationPrompt` with the structured candidate
list; the orchestration route returns the existing
`runtime_clarification` payload shape unchanged. No new response
fields, no API version bump, no breaking client-side change.

### 13-alias-benchmark-update

Add a new benchmark suite
`web/scripts/chat-health-check.questions.casual_2026-05-01.json`
explicitly designed to exercise alias resolution: 50 questions
using nicknames, 3-letter codes, country names, casual venue
references, and known-ambiguous mentions.

Re-run the variant benchmark from 2026-05-01; assert:
- `generationSource: 'unknown'` rate drops below 10% (from 54%)
- under the new multi-axis grader, factual_correctness A-rate ≥80%
  (from a conflated 30%)
- resolver p50 latency stays ≤30ms

Acceptance: both gates exit 0; updated `_state.md` benchmark
headline includes a "Casual phrasing A/B/C" line.

---

## Edge cases worth specifying upfront

**Ambiguity by year**
- "Verstappen" with year=1994 → Jos (driver 6 in seed, season=1994)
- "Verstappen" with year=2024+ → Max (driver 1, season >= 2015)
- "Verstappen" with no year → ambiguous → clarify (rather than
  defaulting to "most recent")

**Multiple drivers with same surname**
- Sainz Sr. and Jr. did not overlap; safe to disambiguate on year
- Hamilton, Leclerc, Norris — only one of each; safe
- Schumacher (Michael, Ralf, Mick) — overlapping eras, must be
  season-scoped via the seed's `season` column

**Diacritics**
- Today the seed populates both `Pérez` (canonical) and `perez`
  (normalized_alias). Confirm coverage; fill gaps in
  `13-alias-seed-expand-drivers`. The normalize() step in the
  runtime should strip diacritics before lookup so either
  user-side spelling hits.

**Country-name collisions**
- "Bahrain" → one venue; safe
- "USA" → Miami + Austin + Las Vegas (3 venues post-2023); must
  return ambiguous → clarify by city or year
- "Mexico" → Mexico City only; safe
- "Italy" → Monza + Imola in 2025 — must clarify

**Casual misspellings**
- "Verstapen" (single 'p'), "Hamiltn", "Leclerk" — pg_trgm threshold
  0.7 catches most; tune empirically
- Common 3-letter typos (HAM ↔ NAM) — trigram should handle

**Team renames mid-career**
- AlphaTauri (2020-2023) → RB (2024) → Racing Bulls (2025+); each
  becomes a row in `team_alias_lookup` with appropriate
  `active_from_year`/`active_to_year` and a single
  `canonical_team_name` per year

**Sprint vs main race for venues that have both**
- "Spa 2025" alone — which session? race / qualifying / sprint /
  sprint qualifying / practice 1/2/3?
- Already handled by the existing
  `core.session_search_lookup` + `getSessionsFromSearchLookup`
  pipeline, which respects session_name / session_type filters.
  Alias work doesn't need to touch this.

---

## Integration with existing system

**Where it plugs in**
- `web/src/lib/queries/resolver.ts`: (a) extend `normalizeAliasList`
  to strip diacritics; (b) add the trgm fuzzy-fallback query paths
  (driver path against the seed-table GIN index, session path via
  base-table UNION-ALL against the new `raw.sessions` expression
  GIN indexes). No public-API change.
- `web/src/lib/chatRuntime.ts`: (a) extend `normalize()` with the
  same NFKD + diacritic-strip step as the resolver; (b) populate
  the existing `resolution.clarificationPrompt` field
  deterministically when fuzzy-match returns multiple comparable
  candidates. No new fields on `ChatRuntimeResult`.
- `web/src/app/api/chat/orchestration.ts`: unchanged. The
  `runtime_clarification` branch already reads `answer` from
  `clarificationPrompt`.
- `scripts/load_codex_helpers.sh:88-102`: replace the four
  `UPDATE … SET normalized_alias = LOWER(BTRIM(alias_text))` blocks
  with `unaccent(LOWER(BTRIM(alias_text)))`. The existing
  truncate-and-reload pattern at the top of the loader
  (`scripts/load_codex_helpers.sh:66-83`) re-seeds and
  re-normalizes every row on the next run — no separate backfill
  needed.
- The Phase 8 FactContract validators don't change — they still
  operate on `driver_number` / `canonical_team_name` / `session_key`.

**Caching**
- The Phase 5 `resolver-lru` cache still works. With more user
  phrasings now mapping to the same canonical IDs, hit rate goes
  up.

**Performance**
- pg_trgm fuzzy queries with GIN: typically sub-10ms
- Exact alias lookup via existing btree index: sub-1ms
- Total resolver overhead: should stay ≤30ms p50 (down from the
  current ~50-200ms when the LLM-clarification fallback kicks in)
- Slow-path latency win on the variant set: the 15s p50 includes
  resolver retries on ambiguous mentions; deterministic resolution
  removes those

**Backwards compat**
- No schema changes to existing tables; only seed-data growth +
  index additions
- Every existing canonical reference continues to work — the
  expanded seed just makes more user phrasings resolve to the same
  canonical IDs
- The deterministic-template path is unchanged

---

## Out of scope (separate efforts)

- **Live driver/team data sync.** Aliases are seeded from
  hand-curated CSV; a follow-up can automate season-rollover
- **LLM-assisted ambiguity resolution.** Once the seed + trgm
  fallback covers common cases, the LLM-clarification fallback
  should be REMOVED, not enhanced. The clarification prompt above
  is structured (built from the candidate list); no LLM call
  needed
- **Voice-input phonetic matching.** Trigram handles typos but
  not "verr-stop-en". Not Phase 13
- **Multi-language aliases.** "Großer Preis von Belgien" → Belgian
  GP. Possible but not Phase 13

---

## Acceptance — what success looks like

After Phase 13 lands:

1. The 50-question variant benchmark from 2026-05-01 reruns with
   ≤10% unknown generationSource (down from 54%) and the multi-axis
   grader shows factual_correctness A-rate ≥80% (up from a
   conflated 30%)
2. A new "casual phrasing" benchmark suite (50 nickname-and-3-letter
   questions) hits ≥85% factual_correctness A
3. Resolver p50 latency stays ≤30ms across all paths
4. Production traffic — when a user types "did Max win Spa?" — the
   chat path resolves both entities deterministically without an
   LLM round-trip, lands the correct SQL, and returns a streamed
   answer in ~1-2s TTFB / ~5s total instead of ~12s today

---

## What this does NOT solve

- **Data coverage**: if Spa 2025 lap data isn't loaded, no resolver
  improvement helps. Aliases route the question to the right
  canonical entity; whether the answer is *complete* depends on
  what the warehouse contains. That's the data-engineering
  follow-up
- **Template generalization**: deterministic-template matching is
  still entity-tuple-based. With aliases resolving more mentions to
  canonical IDs, more questions will match existing templates — but
  if a question genuinely doesn't fit any template shape, the
  LLM-gen path remains
- **Synthesis quality**: the multi-axis clarity grade depends on the
  synthesis prompt. Aliases don't change what synthesis sees, only
  what entities it operates on

The alias-coverage + trgm-fallback work is the highest-leverage
single fix because it unblocks the next set of slices on data and
synthesis: once resolution is deterministic, the variant benchmark
becomes a true measurement of those downstream layers.
