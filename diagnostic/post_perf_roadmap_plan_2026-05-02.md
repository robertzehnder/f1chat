# Post-Perf-Roadmap Plan — 2026-05-02 (rev2. 2026-05-02 post-audit-2)

After the 84-slice perf roadmap (Phases 0-12) closed and the 2026-05-01
data-coverage scan exposed the actual gaps in the warehouse, the next
high-leverage work is sequenced as four phases:

- **Phase 13 — Data Coverage Backfill** (~half a day to 2 days)
- **Phase 14 — Alias Resolver** (~1-2 weeks; full plan already
  specced in `diagnostic/alias_resolver_plan_2026-05-01.md` rev4)
- **Phase 15 — LLM-gen Latency Reduction** (~1 week)
- **Phase 16 — Production Observability** (~3-5 days; cross-cutting)

Total: roughly 3-4 weeks of focused work to move public-readiness from
~5/10 to ~7-8/10.

## Revision (2026-05-02 post-audit)

A first audit caught three repo-shape errors in the rev0 draft:

1. **`raw.session_result` columns mismatch the OpenF1 API shape.** The
   API returns `{position, driver_number, number_of_laps, points,
   dnf, dns, dsq, duration, gap_to_leader, meeting_key, session_key}`.
   The warehouse table is `(session_key, meeting_key, driver_number,
   position, points, status TEXT, classified BOOLEAN, source_file,
   ingested_at)` — see `sql/002_create_tables.sql:155`. So the slice
   is a TRANSFORM, not a direct copy: the API's `{dnf, dns, dsq}`
   booleans must collapse into a single `status` TEXT
   (`'Finished' | 'DNF' | 'DNS' | 'DSQ'`) and a `classified` BOOLEAN
   (`NOT (dnf OR dns OR dsq)`). The API's `{number_of_laps, duration,
   gap_to_leader}` have no column to land in today; either drop them
   or extend the schema (recommendation: extend, since they're
   answer-relevant for "how far behind did Y finish?" questions).
2. **`raw.starting_grid` is already a TABLE, not a view-shaped slot.**
   Schema: `(session_key, meeting_key, driver_number, grid_position,
   ...)` keyed on the RACE session_key, with indexes on `session_key`
   (`sql/003_indexes.sql:24`) and a downstream UNION in
   `core_build.grid_vs_finish` that expects
   `raw.starting_grid.session_key` to align with the session being
   summarized (`sql/008_core_build_schema.sql:186-195`). Replacing
   it with a view shaped on `(qualifying_session_key,
   race_session_key, ...)` would break those dependencies. The
   correct design is to POPULATE the existing table via an
   INSERT-from-qualifying-session_result pipeline that writes rows
   keyed on the RACE `session_key`.
3. **Meetings-backfill acceptance cited the wrong resolver mechanism.**
   The seed-aliases branch of `core.session_search_lookup` joins on
   `country_name + location + circuit_short_name`
   (`sql/005_helper_tables.sql:234`), NOT `meeting_name`. Meetings
   backfill is still useful — it populates
   `core.sessions.meeting_name` for display, narrative answers, and
   the intrinsic-aliases UNION's `session_name` branch — but it does
   not directly enable the seed-aliases JOIN. Acceptance restated.

This revision corrects all three.

## Revision 2 (2026-05-02 post-audit-2)

A second audit caught two repo-shape mismatches in the load-path
framing:

1. **The plan's load-path framing referenced infrastructure that no
   longer does the work.** The rev1 slices added `\copy` steps to
   `scripts/init_db.sh`, but after the just-merged Phase 12 sqitch
   adoption that script is now schema-only — it runs `sqitch deploy`
   plus the helper-lookup CSV load and nothing else
   (`scripts/init_db.sh:1-37`). The rev1 slices also framed
   `openf1-full-history-extract.py` as the place to extend, but
   `AGENTS.md:21` explicitly marks that file as legacy. Verified: no
   active script in `scripts/` or `web/scripts/` loads `raw.*` race
   tables today; `data/` directory's CSVs were last produced in
   March 2026 by the legacy extractor. The current canonical
   ingest path for race data is not defined in-repo.
2. **The meetings-backfill acceptance still over-stated direct
   coupling to Phase 14.** "Enables Phase 14's `meeting_name`-bearing
   alias seeds" sounded like it unblocks the whole venue resolver,
   but Phase 14's seeded-venue branch already keys off `country_name
   + location + circuit_short_name` and is not blocked by
   `meeting_name`. Restated more narrowly.

This revision restates Phase 13 in CONTRACT terms (the deliverable
is "rows in `raw.*` with the correct shape and key alignment") and
explicitly surfaces "choose the canonical ingest path" as a Phase 13
sub-decision rather than presuming the legacy extractor.

The phases are numbered so they can drop into the existing slice loop
(Phases 0-12 already done). Each phase is independently mergeable and
each phase's wins are MEASURABLE against benchmarks the prior phase
unblocks.

---

## Why this order

The 2026-05-01 data-coverage scan changed the prioritization. Before
the scan I'd recommended aliases first; after the scan, data backfill
is unambiguously highest-leverage:

| Order | Why |
|---|---|
| **13 first** | Without `session_result` / `starting_grid` / `meetings` populated, the chat cannot answer "who won?" / "who was on pole?" / "Belgian GP" by-name regardless of how good the resolver is. The Phase 8 grid-vs-finish validator is also a no-op until the underlying tables exist. Smallest, most user-visible fix. |
| **14 next** | Once the data is there, alias resolver converts that data into accessible answers for casual phrasing ("did Lando win at Spa?"). Without the data, alias work would invisibly succeed and visibly fail. |
| **15 third** | After data + resolution work, the remaining tail metric is the 15s p50 on the LLM-generation slow path. Prompt caching + smaller-model SQL gen attacks it directly. Builds on a known-good baseline. |
| **16 cross-cutting** | Production observability ties the loop together — measures whether real users are actually hitting the cache, what latency they see, what gets thumbed-down. Could ship in parallel with 13-15 but designed last because it instruments the others. |

Each phase produces benchmark deltas measurable in the variant-suite
+ casual-phrasing benchmarks. Don't move to the next phase until the
prior phase's variant numbers improve.

---

## Phase 13 — Data Coverage Backfill (3 slices, ~1-2 days)

### Why it matters

The 2026-05-01 coverage scan against the live Neon warehouse showed:

- **Strong**: 30 of 30 race+sprint sessions in 2025 have full lap /
  sector / pit / stint / position / interval / car_data / race_control
  / weather coverage. 20 drivers per session. Hundreds of thousands of
  rows of telemetry per race.
- **Empty**: `raw.session_result` and `raw.starting_grid` have **0
  rows across every 2025 session**. `raw.meetings` is also empty,
  causing `core.sessions.meeting_name` to be NULL on every row.

This narrowly breaks an entire class of fan-question coverage:
- "Who won at Mexico?" — needs `session_result`
- "Who was on pole at Monaco?" — needs `starting_grid` (or qual
  session_result)
- "What's the Belgian GP?" — needs `meetings.meeting_name`

### Sub-decision (applies to all three Phase 13 slices)

**No active ingest script in the repo loads `raw.*` race tables today.**
`scripts/init_db.sh` is now sqitch-deploy + helper-lookups only;
`openf1-full-history-extract.py` is marked legacy in `AGENTS.md:21`;
`data/`'s CSVs were last produced in March 2026 by the legacy
extractor. Phase 13's first decision is therefore: **what is the
canonical ingest path going forward?** Three viable choices:

(a) **Resurrect the legacy extractor.** Un-mark
    `openf1-full-history-extract.py` as legacy, fix any drift, run
    it for the new endpoints, and `psql \copy` the resulting CSVs as
    a one-shot. Lowest immediate effort; the path is entrenched as
    "legacy" in tribal knowledge.

(b) **Build a new ingest CLI.** A `scripts/ingest.{py,mjs}` that
    pulls from the OpenF1 API on demand, writes to `data/`, and
    runs `\copy` against the configured DB. This is the
    forward-shape — explicit, runnable, version-controlled.

(c) **Inline the load into a sqitch deploy step.** Sqitch deploys
    can run arbitrary SQL including `\copy`, so a migration like
    `sql/migrations/deploy/024_seed_meetings_2023_2026.sql` could
    `\copy raw.meetings FROM 'data/meetings_<year>.csv'`. Migration
    is reversible and tied to the schema-version contract.

Recommend (b) for operational durability — (a) re-entrenches a
file the team already deprecated; (c) couples data to schema
migrations in a way that's awkward at scale (refresh requires a
new migration each season). Whichever is picked, the slice's
deliverable contract below is unchanged.

### Slice 13-data-meetings-backfill

Populate `raw.meetings` for 2023-2026 from the OpenF1
`/v1/meetings?year=YYYY` endpoint. Endpoint verified live (returns
25 rows for 2025 with `meeting_key`, `meeting_name`,
`meeting_official_name`, `location`, `country_name`,
`circuit_short_name`, `date_start`, `is_cancelled`).

**Deliverable contract** (implementation path follows the Phase 13
sub-decision above):

- For every `meeting_key` referenced by `raw.sessions` in 2023-2026,
  there exists a `raw.meetings` row whose columns match the
  `raw.meetings` schema in `sql/002_create_tables.sql` (which the
  current `core.sessions` view's LEFT JOIN at
  `sql/004_constraints.sql:56-63` already expects).
- The load is idempotent (re-run produces the same row-set, no
  duplicate-key errors).

**Acceptance**:
- `SELECT COUNT(DISTINCT meeting_key) FROM raw.meetings WHERE year = 2025`
  returns ≥ 24 (24 GPs + pre-season testing rows are acceptable)
- `SELECT COUNT(*) FROM core.sessions WHERE year = 2025 AND meeting_name IS NULL`
  returns 0 (the LEFT JOIN through `meeting_key` in
  `sql/004_constraints.sql:56-63` now resolves)
- The intrinsic-aliases branch of `core.session_search_lookup`'s
  `session_name` UNION continues to fire (was already working off
  `raw.sessions.session_name`); the new value is that
  `meeting_name`-bearing answers and chat narrative ("the Belgian
  Grand Prix") now have non-NULL strings to render
- **Note**: the seed-aliases venue branch of
  `core.session_search_lookup` joins on `country_name + location +
  circuit_short_name` (`sql/005_helper_tables.sql:234`), NOT
  `meeting_name`, so meetings backfill is not a prerequisite for that
  branch — those columns come from `raw.sessions` and were already
  populated. Meetings backfill is a display + name-resolution
  improvement: rendered answers can use the GP's official name
  ("the Belgian Grand Prix") instead of falling back to country or
  circuit, and Phase 14 has the option to seed additional GP-name
  aliases on top of the now-populated `meeting_name`. It does NOT
  unblock the venue resolver itself.

### Slice 13-data-session-result-backfill

Populate `raw.session_result` for 2023-2026 from the OpenF1
`/v1/session_result?session_key=N` endpoint, **transforming the API
shape into the warehouse schema**. Endpoint verified live:
`session_key=9636` returns rows shaped `{position, driver_number,
number_of_laps, points, dnf, dns, dsq, duration, gap_to_leader,
meeting_key, session_key}`. Implementation path follows the Phase 13
sub-decision above (the legacy extractor is deprecated; the slice
author picks (a) / (b) / (c) and the deliverable contract below
applies regardless). The shapes do not align directly:

```
OpenF1 API row:                       raw.session_result table:
  position           INTEGER             session_key      BIGINT (FK)
  driver_number      INTEGER             meeting_key      BIGINT (FK)
  number_of_laps     INTEGER             driver_number    INTEGER
  points             DOUBLE              position         INTEGER
  dnf                BOOLEAN             points           DOUBLE
  dns                BOOLEAN             status           TEXT
  dsq                BOOLEAN             classified       BOOLEAN
  duration           DOUBLE              source_file      TEXT
  gap_to_leader      DOUBLE              ingested_at      TIMESTAMPTZ
  meeting_key        BIGINT
  session_key        BIGINT
```

Direct fits: `position`, `points`, `driver_number`, `meeting_key`,
`session_key`. Transform-required and column-orphaned fields are
the bulk of the slice work.

**Deliverable contract** (implementation path follows the Phase 13
sub-decision above; the steps below are the work items regardless of
which path is chosen):

1. **API pull** — for every `session_key` in `raw.sessions` for
   2023-2026 (race, qualifying, sprint, sprint_qualifying), call
   `/v1/session_result?session_key=N` and capture the raw response.
2. **Transform** — derive the warehouse columns from the API fields:
   - `status` ← `CASE WHEN dsq THEN 'DSQ' WHEN dns THEN 'DNS' WHEN dnf THEN 'DNF' ELSE 'Finished' END`
   - `classified` ← `NOT (COALESCE(dnf,false) OR COALESCE(dns,false) OR COALESCE(dsq,false))`
   - Direct copy: `position`, `points`, `driver_number`,
     `meeting_key`, `session_key`
3. **Schema extension** (recommended, separate sqitch migration via
   the Phase 12 runner): `ALTER TABLE raw.session_result ADD COLUMN
   IF NOT EXISTS number_of_laps INTEGER, ADD COLUMN IF NOT EXISTS
   duration DOUBLE PRECISION, ADD COLUMN IF NOT EXISTS
   gap_to_leader DOUBLE PRECISION;` and include those columns in
   the load. Without them, "how far behind did Y finish?" /
   "Y completed N of M laps" / "Y's race time was T" questions
   cannot be answered. Migration shape:
   `sql/migrations/deploy/022_session_result_extend_columns.sql`
   plus paired revert/verify per the sqitch runner contract.
4. **Load** — write the transformed rows into `raw.session_result`.
   Idempotent: re-running produces the same row-set without
   duplicate-key errors (use `INSERT ... ON CONFLICT DO NOTHING`
   keyed on `(session_key, driver_number)` if you add a
   uniqueness constraint, or rely on the BIGSERIAL `id` plus a
   pre-load DELETE for the affected `session_key`s).

**Acceptance**:
- Every 2025 race session has 19-20 rows in `raw.session_result`
- Every 2025 qualifying session has 19-20 rows
- `status` distribution looks reasonable on race sessions: most
  rows `'Finished'`, a few `'DNF'`, occasional `'DSQ'`
- `classified` is TRUE on the bulk of finishing rows
- If schema-extension sub-step shipped: `duration` is non-NULL on
  finishing rows; `gap_to_leader` is non-NULL on rows with
  `position > 1` and finished
- The Phase 8 `grid-vs-finish` validator's downstream view
  `core_build.grid_vs_finish` (`sql/008_core_build_schema.sql:186`)
  starts producing rows for 2025 races (it UNIONs
  `raw.session_result` and `raw.starting_grid` — see slice
  `13-data-starting-grid-population` below)
- A smoke chat query "who won the 2025 Monaco Grand Prix?" returns
  the correct driver

### Slice 13-data-starting-grid-population

OpenF1 does NOT expose `/v1/starting_grid` (verified — returns 404).
The grid IS the qualifying session's final positions (with
grid-penalty adjustment, which we defer). The data needed to
populate the grid lives in `raw.session_result` once
`13-data-session-result-backfill` lands and we ingest qualifying
sessions.

**Critical constraint**: `raw.starting_grid` is already a real table
in the warehouse (`sql/002_create_tables.sql:168`) keyed on the
RACE `session_key`, with btree indexes on `session_key`
(`sql/003_indexes.sql:24`) and a downstream UNION in
`core_build.grid_vs_finish` (`sql/008_core_build_schema.sql:186-195`)
that JOINs it to other contracts on `(session_key, driver_number)`
where `session_key` aligns with the race session, NOT the
qualifying session. The slice MUST populate the existing table
preserving that key shape. Replacing it with a view shaped on
`(qualifying_session_key, race_session_key, ...)` would break the
existing indexes and the `grid_vs_finish` UNION.

**Design**: post-ingest INSERT pipeline that, for every race
session in `raw.sessions`, finds the corresponding qualifying
session in the same `meeting_key` and writes one row per finishing
driver into `raw.starting_grid` with `session_key` set to the
**race session's** `session_key` (not the qualifying session's).

**Steps**:
1. Once `13-data-session-result-backfill` has populated
   `raw.session_result` for both Race and Qualifying sessions,
   run a one-time backfill SQL (idempotent, INSERT ... ON
   CONFLICT) that derives the grid:
   ```sql
   INSERT INTO raw.starting_grid (session_key, meeting_key,
                                  driver_number, grid_position,
                                  source_file)
   SELECT race.session_key,
          race.meeting_key,
          q_result.driver_number,
          q_result.position AS grid_position,
          'derived_from_qualifying_session_result' AS source_file
   FROM raw.sessions race
   JOIN raw.sessions q
     ON q.meeting_key = race.meeting_key
    AND q.session_type = 'Qualifying'
   JOIN raw.session_result q_result
     ON q_result.session_key = q.session_key
   WHERE race.session_type = 'Race'
     AND q_result.position IS NOT NULL
   ON CONFLICT DO NOTHING;
   ```
   For sprint weekends (post-2024 format where the Sprint has its
   own grid set by Sprint Qualifying), do the same derivation with
   `race.session_type = 'Sprint'` and `q.session_type IN
   ('Sprint Qualifying', 'Sprint Shootout')` (the latter is the
   2023 name).
2. Wire the SQL into a sqitch migration `sql/migrations/deploy/
   023_starting_grid_derivation.sql` (using the Phase 12 sqitch
   runner) plus matching revert/verify scripts. The deploy is
   idempotent (`ON CONFLICT DO NOTHING`) so re-deploys are safe.
3. **Grid-penalty adjustment is out of scope for v1** — the
   slice's completion note must explicitly acknowledge that
   penalty-adjusted grids (e.g. a driver qualifies P3 but starts
   P8 due to engine-change penalty) are not handled. A follow-up
   slice can compare lap-1 `position` from `raw.position_history`
   against this derived grid_position to detect and correct
   penalty-affected starts.

**Acceptance**:
- `SELECT COUNT(*) FROM raw.starting_grid WHERE session_key IN
  (SELECT session_key FROM core.sessions WHERE year = 2025 AND
  session_type = 'Race')` returns ≥ 24 × 19 ≈ 456 rows
- Every 2025 race session has 19-20 grid rows
- Every 2025 sprint session has 19-20 grid rows
- The existing `core_build.grid_vs_finish` view's UNION at
  `sql/008_core_build_schema.sql:186-195` produces non-empty
  driver_keys for 2025 races (it currently UNIONs the now-empty
  `raw.starting_grid` and `raw.session_result`; both populated
  means the view materializes real grid-vs-finish deltas)
- The Phase 8 `validators-grid-finish` slice's validator runs
  against non-empty data
- Smoke chat query "who started on pole at the 2025 Monaco Grand Prix?"
  returns the correct driver
- The slice-completion note documents grid-penalty adjustment as
  a known v1 gap with a follow-up slice reference

### Phase 13 acceptance (rolled up)

After all three slices land, re-run the variant benchmark from
2026-05-01. Expected delta:
- factual_correctness A-rate: ≥ 60% (from a conflated 30%)
- "unknown" generationSource: still ~50% (alias work hasn't landed —
  this is what Phase 14 attacks)
- New question types unblocked: "who won X", "who was on pole at Y",
  "where did Z finish", championship standings questions

---

## Phase 14 — Alias Resolver (8 slices, ~2 weeks)

**Full plan already specced** in
`diagnostic/alias_resolver_plan_2026-05-01.md` (rev4, audit-closed).

Renumbering: the plan currently labels the slices `13-*`. When
enqueued, rename them to `14-*` to match the actual phase numbering
(Phase 13 is now data backfill above). The plan content is unchanged.

### Slices in dependency order

| # | Slice | Risk |
|---|---|---|
| A | `14-pgtrgm-and-unaccent-extensions` | Low |
| B | `14-alias-seed-expand-drivers` | Low |
| C | `14-alias-seed-expand-teams` | Low |
| D | `14-alias-seed-expand-venues` | Low |
| E | `14-resolver-normalize-diacritics` | Medium |
| F | `14-resolver-trgm-fallback` | Medium |
| G | `14-resolver-clarification` | Low |
| H | `14-alias-benchmark-update` | Low |

### Phase 14 acceptance (rolled up)

- Variant-benchmark `unknown` generationSource rate drops below 10%
  (from 54%)
- factual_correctness A-rate climbs to ≥ 80%
- Resolver p50 latency stays ≤ 30ms
- New benchmark suite `chat-health-check.questions.casual_2026-05-01.json`
  hits ≥ 85% factual_correctness A on nicknames / 3-letter codes /
  casual venue references

---

## Phase 15 — LLM-gen Latency Reduction (5 slices, ~1 week)

### Why it matters

After Phase 14, the resolver path is fast (≤30ms). The remaining
slow-path tail is dominated by `sqlgen_llm` (~3-7s) + `synthesize_llm`
(~5-7s) per question on the LLM-generation path. Variant benchmark
showed 15s p50 on the slow path. None of the merged perf-roadmap
slices attack this.

### Slice 15-sqlgen-haiku-with-sonnet-fallback

Today the SQL-generation prompt uses Sonnet. Most SQL-gen tasks are
straightforward enough that Haiku 4.5 produces correct SQL in one
shot. Concrete change:

1. `web/src/lib/anthropic.ts` (or wherever `sqlgen_llm` is invoked):
   route the SQL-gen request to Haiku by default
2. Add a parse-and-validate check on the returned JSON. If parse
   fails OR the SQL fails validation (uses non-existent column,
   touches forbidden raw table, exceeds token budget, etc.), retry
   the same request on Sonnet
3. Telemetry: log `{request_id, model_first, model_final,
   retry_reason}` — measures Haiku hit rate

**Acceptance**:
- ≥ 85% of SQL-gen requests succeed on Haiku first-shot (measured
  over the full 50-question + variant suite combined)
- Sonnet retries account for ≤ 15% of requests
- `sqlgen_llm` p50 drops from ~3.8s to ~1.5s
- Total per-request cost drops by ~70% on the SQL-gen step

### Slice 15-synthesis-prompt-prefix-cache

Anthropic's prompt-cache feature lets the static portion of the
synthesis prompt (system prompt + format rules + few-shot examples)
be cached server-side with a 5-min / 1-hour TTL. Cache reads cost
~10% of cache writes and ~10% of normal input tokens.

The Phase 8 FactContract work made the prompt structure
`{ staticPrefix, dynamicSuffix }`-shaped, which already separates
the cacheable static portion from the per-question variable portion.
Just need to add `cache_control: { type: "ephemeral" }` to the
static-prefix message block.

**Acceptance**:
- Anthropic API response includes `usage.cache_read_input_tokens > 0`
  on warm requests
- Synthesis input-token cost drops by ~80% on cache-hit requests
- `synthesize_llm` p50 drops from ~4.7s to ~3.0s (cache reads are
  faster than fresh inferences)
- Cache hit rate ≥ 70% measured over a 1-hour rolling window of
  benchmark traffic

### Slice 15-parallel-sql-exec-and-synthesis-prep

Today the path is sequential: sqlgen → exec → synthesis. The
synthesis prompt prefix construction (FactContract building, prompt
template assembly) doesn't need the SQL result; it only needs the
question + runtime metadata. Run synthesis-prep in parallel with
SQL exec.

**Acceptance**:
- Total request time drops by ~execute_db p50 = ~1.7s on the slow
  path
- `perfTrace` shows overlapping spans for `execute_db` and a new
  `synthesize_prep` span
- No correctness regression on the curated suite

### Slice 15-synthesis-prompt-token-reduction

The current synthesis prompt is generous on instructions and
format rules. A concrete budget pass: review token usage of the
static prefix, remove redundant format rules already enforced by
JSON schema, tighten the few-shot examples. Target 30% reduction
in static-prefix tokens.

**Acceptance**:
- `staticPrefix` byte-count drops by ≥ 30%
- Output quality on the curated suite is unchanged (multi-axis
  grader: factual_correctness / completeness / clarity all stay at
  current levels or improve)
- Cache-write cost (the cold synthesis call's first token) drops
  proportionally

### Slice 15-deterministic-template-broadening

Phase 7's `zero-llm-path-tighten` was tuned against the curated
50-question suite. The 2026-05-01 variant benchmark showed only
6% of variant questions matched a template (vs 68% on the curated
suite). Broaden the template-match conditions to fire on
question-shape signals rather than literal-entity signals.
Concrete: parameterize templates on `(questionType, grain,
required_tables)` rather than on resolved entity tuples.

**Acceptance**:
- Variant-benchmark template-match rate climbs from 6% to ≥ 35%
  (won't reach the curated 68% — variant questions are intrinsically
  more novel)
- Variant-benchmark p50 drops from ~15s toward ~3-5s
- No regression on curated-suite template-match rate (must stay ≥ 65%)

### Phase 15 acceptance (rolled up)

After all five slices, re-run BOTH the curated and variant
benchmarks. Expected:
- Curated p50: ~50ms (unchanged — already cache-driven)
- Curated p95: ~5s (down from ~12s)
- Variant p50: ~3-5s (down from ~15s)
- Variant p95: ~10s (down from ~33s)
- Cost-per-question: drops ~50% on average (Haiku SQL-gen + cache
  reads)

---

## Phase 16 — Production Observability (3-4 slices, ~3-5 days)

### Why it matters

Every benchmark in this roadmap measures against a fixed test set.
Real users ask different questions. Without production-traffic
metrics, we cannot tell whether the wins generalize. Three things
to wire up:

### Slice 16-cache-hit-rate-metric

First-class metric in the existing `perfTrace` log: per-question
record `{cache_hit: true|false, cache_layer: 'answer'|'template'|'none'}`.
Aggregate to a daily roll-up the
`web/scripts/refresh_test_grading_baseline.sh` pipeline can read.

**Acceptance**:
- `cache_hit` field present on every `perfTrace` record after this
  slice ships
- A daily `diagnostic/artifacts/perf/cache-hit-rate-<date>.json`
  artifact is auto-generated by the loop merger
- The `_state.md` benchmark headline includes a "Cache hit rate" line

### Slice 16-prod-traffic-perftrace-sampling

Today `perfTrace` is opt-in via env var. Wire a 10% sample by
default in production (configurable). Land the sampled traces to a
durable store (the existing JSONL file is fine for now; can move
to a real metrics backend later).

**Acceptance**:
- Production traffic produces `perfTrace` records at the configured
  rate
- A weekly artifact `diagnostic/artifacts/perf/prod-traffic-
  weekly-<week>.json` summarizes p50/p95/cache-hit-rate by
  generationSource

### Slice 16-thumbs-up-down-feedback

Wire a thumbs-up / thumbs-down button to every chat answer. Land
feedback to a new table `core.user_feedback` keyed on
`request_id`. Aggregate weekly into the same artifact pipeline.

**Acceptance**:
- The chat UI shows thumbs after each completed answer
- Feedback rows accumulate in `core.user_feedback`
- Weekly artifact summarizes feedback rate, ratio, by question
  category, by generationSource

### Slice 16-multi-axis-grader-on-prod-sample

The Phase 11 multi-axis grader runs offline against the curated +
variant benchmarks. Run it on a sample of production traffic
weekly to detect quality drift. Same grader, different input set.

**Acceptance**:
- Weekly artifact
  `diagnostic/artifacts/healthcheck/prod-sample-grade-<week>.json`
  contains the multi-axis grade breakdown for the sample
- Drift alerts trigger when factual_correctness A-rate drops > 10%
  week-over-week

### Phase 16 acceptance (rolled up)

After all four slices:
- We can answer "what's our real production p50?" with data, not
  speculation
- We can answer "what % of users thumb-down our answers?" with data
- Quality drift is detected within 1 week of regression

---

## Cross-cutting concerns

### Cost discipline

After Phase 15's Haiku-fallback + prompt-cache work, expected
per-question cost on the LLM-gen path drops from ~$0.20 to ~$0.06.
Add a budget assertion to the merger gate: any slice that bumps
mean per-question cost > 10% must justify in its slice file.

### Test methodology

Every benchmark report from now on must include BOTH the curated
50-question suite AND the entity-fanout variant suite numbers.
Single-suite reports are forbidden because they can be gamed by
template-fitting (as the original perf-roadmap was).

### Documentation

Each phase's completion adds a section to `_state.md` benchmark
headline (multi-axis grader output PLUS the variant numbers PLUS
cache-hit-rate). The headline becomes a 5-line summary instead of
the current 1-line.

---

## Sequencing + dependency graph

```
Phase 13 ──┬──> Phase 14 ──> Phase 15
           │
           └──> Phase 16 (parallel, no hard dependency)
```

**Phase 13 must complete before Phase 14** because alias resolver
gains depend on resolved entities mapping to populated tables.

**Phase 14 must complete before Phase 15** because the
template-broadening slice (15-5) operates on the resolver's output
shape; resolver instability would mask template-match gains.

**Phase 16 has no hard dependency** — start once Phase 13's
backfill is loaded so the prod-traffic instrumentation has
something to measure. Could even run Phase 16 first on the
existing system to establish a baseline, then re-measure after
each subsequent phase.

---

## Acceptance — what success looks like end-to-end

After Phases 13-16 land:

| Metric | Today | Target |
|---|---|---|
| Curated benchmark factual_correctness A | 50/50 | unchanged |
| Variant benchmark factual_correctness A | 15/50 | ≥ 40/50 |
| Variant benchmark `unknown` generationSource | 27/50 (54%) | ≤ 5/50 (10%) |
| Curated p50 latency | 50ms | unchanged |
| Variant p50 latency | 15s | ≤ 5s |
| Variant p95 latency | 33s | ≤ 12s |
| Cost per LLM-gen question | ~$0.20 | ~$0.06 |
| Production cache-hit rate | unknown | measured + reported weekly |
| Production thumb-down rate | unknown | measured + reported weekly |
| "Who won X / pole at Y" answerable | NO | YES |
| Public-readiness score | 5/10 | 7-8/10 |

This moves the chat from "useful internal tool" to "publicly
defensible product" in roughly 3-4 weeks of focused work, ordered
so each phase's wins are visible before the next phase starts.
