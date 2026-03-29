# OpenF1 Local Analytics and Semantic Query Project

`openf1` is a local PostgreSQL analytics project built around OpenF1 CSV data. It is designed for two jobs at the same time:

1. ingest a large amount of motorsport data into a warehouse that still looks recognizable to someone familiar with the source data, and
2. expose a semantic layer that makes the data much easier, safer, and more useful for applications, analysts, and LLM-driven query systems.

The repo is intentionally "production-minded local": the SQL and architectural choices are meant to work well on a laptop today and migrate cleanly to Supabase or another managed Postgres deployment later.

## What Problem This Project Solves

Raw OpenF1-style data is rich, but it is not naturally pleasant to work with at the question level.

Examples:

- A user asks for "Abu Dhabi 2025 Race", but the raw data may represent that session through country, location, circuit alias, meeting key, and session key rather than one stable human-facing identifier.
- A user asks "who had better clean-lap pace?", but raw laps alone are not enough. You need lap hygiene rules, compound normalization, pit-in/pit-out treatment, and a repeatable notion of validity.
- A user asks "was there an undercut?", but that is not a single raw fact. It is an evidence-based conclusion that depends on pit windows, relative position, pace before and after stops, and confidence gating.
- A user asks for "running order progression", and raw event streams may require several joins and heuristics before they become something safe to summarize.

This project addresses that gap by keeping the raw warehouse intact while adding a `core` semantic layer with resolver, normalization, governance, and summary contracts.

## Project Goals

- Preserve source fidelity in `raw`.
- Expose app-friendly, analysis-friendly interfaces in `core`.
- Make common F1 questions answerable through stable contracts rather than one-off joins.
- Reduce prompt complexity and query brittleness for the web/chat runtime.
- Support evidence-bearing answers instead of overconfident synthesis.
- Keep the model portable to Supabase and other Postgres environments.

## Architecture Overview

At a high level, the system looks like this:

```text
CSV files under data/
  -> Python ingestion pipeline
  -> raw.* tables (source-aligned storage)
  -> core.* base views and helper lookup contracts
  -> semantic lap + summary contracts
  -> web runtime / deterministic SQL / chat planner / query APIs
```

In practice the flow is:

1. `src/ingest.py` discovers CSV files and loads them into `raw`.
2. SQL migrations in `sql/` create schemas, tables, indexes, helper views, and semantic contracts.
3. `core` provides normalized access patterns for sessions, drivers, teams, laps, strategy, and progression.
4. The web app uses those semantic contracts as the default query surface for analytical question families.

## Repository Layout

```text
openf1/
  docker-compose.yml
  requirements.txt
  README.md
  sql/
    001_create_schemas.sql
    002_create_tables.sql
    003_indexes.sql
    004_constraints.sql
    005_helper_tables.sql
    006_semantic_lap_layer.sql
    007_semantic_summary_contracts.sql
  scripts/
    init_db.sh
    load_codex_helpers.sh
  src/
    db.py
    file_discovery.py
    ingest.py
    mappings.py
  web/
    src/app/api/...
    src/lib/chatRuntime.ts
    src/lib/deterministicSql.ts
    src/lib/queries.ts
    src/lib/answerSanity.ts
  docs/
    semantic_contract_map.md
    semantic_runtime_adoption.md
    transformed_lap_schema.md
    ...
  data/
    ... OpenF1 CSV files ...
```

## Data Modeling Strategy

### `raw` schema

`raw` is the source-aligned storage layer.

It is optimized for:

- faithful ingestion,
- idempotent reload/upsert behavior,
- recognizable field naming,
- minimal loss of source detail.

Representative raw tables include:

- `raw.meetings`
- `raw.sessions`
- `raw.drivers`
- `raw.laps`
- `raw.car_data`
- `raw.location`
- `raw.position_history`
- `raw.pit`
- `raw.stints`
- `raw.team_radio`
- `raw.weather`
- `raw.race_control`
- `raw.session_result`
- `raw.starting_grid`

This layer is valuable because it keeps the warehouse honest. If a downstream semantic contract looks wrong, the raw data is still available as the inspectable substrate.

### `core` schema

`core` is the application-facing and analysis-facing layer.

It has several different kinds of objects:

- base views and dimensions,
- resolver and identity lookups,
- completeness and governance views,
- semantic lap contracts,
- semantic summary contracts.

The important design choice is that `core` is not just a nicer set of names. It encodes domain rules, reusable joins, evidence logic, and metric definitions.

## Why the Semantic Layer Exists

The semantic layer is the part of the system that turns "a pile of F1 tables" into "a data model you can ask meaningful questions of".

It adds value in five major ways.

### 1. It makes entity resolution reliable

Real users do not think in raw keys.

They ask for:

- "Abu Dhabi"
- "Yas Marina"
- "Yas Island"
- "UAE"
- "Max"
- "Verstappen"
- "RB"
- "Racing Bulls"

The semantic layer provides canonical resolver contracts so those references can be normalized before analytical SQL is generated.

Key contracts:

- `core.session_search_lookup`
- `core.driver_identity_lookup`
- `core.team_identity_lookup`
- `core.session_completeness`

Value:

- fewer failed lookups,
- less prompt engineering,
- more deterministic session and driver selection,
- better behavior in chat and API flows.

### 2. It defines what a "good lap" actually is

Raw lap data is not analytically clean by default.

If you compare drivers on raw laps without a consistent policy, you can easily mix:

- pit-out laps,
- pit-in laps,
- laps with missing sectors,
- laps on non-slick compounds,
- implausible lap durations,
- source-specific inconsistencies.

The semantic lap layer solves that by versioning and centralizing lap hygiene.

Key contracts:

- `core.compound_alias_lookup`
- `core.valid_lap_policy`
- `core.metric_registry`
- `core.lap_semantic_bridge`
- `core.laps_enriched`

Value:

- "clean-lap pace" becomes a defined concept instead of an ad hoc convention,
- compound normalization is centralized,
- metric meaning is documented in the data model itself,
- downstream templates can trust the same validity logic across questions.

### 3. It compresses multi-join analysis into stable question-level contracts

Many user questions are not about rows. They are about concepts:

- stint length,
- strategy type,
- post-pit pace,
- positions gained,
- running-order progression,
- final-third pace,
- fresh vs used tire performance.

The semantic summary layer turns these concepts into reusable contracts so the runtime does not have to rediscover the same joins repeatedly.

Key contracts:

- `core.driver_session_summary`
- `core.stint_summary`
- `core.strategy_summary`
- `core.pit_cycle_summary`
- `core.strategy_evidence_summary`
- `core.grid_vs_finish`
- `core.race_progression_summary`
- `core.lap_phase_summary`
- `core.lap_context_summary`
- `core.telemetry_lap_bridge`

Value:

- much simpler SQL generation,
- more consistent answers across question families,
- easier auditing when results look suspicious,
- lower chance that two query templates define the same metric differently.

### 4. It supports evidence-bearing answers instead of loose storytelling

Some F1 questions invite overstatement:

- "Did a driver benefit from an undercut?"
- "Who gained track position around the pit cycle?"
- "Who improved more?"

The semantic layer does not just summarize results. It also carries evidence sufficiency information so the runtime can say "insufficient evidence" when the data does not support a claim.

That is especially important in chat systems, where a plausible narrative can sound convincing even when the underlying joins are incomplete.

Value:

- safer synthesis,
- fewer false strategic claims,
- better trust in the product,
- cleaner separation between "what happened" and "what we can prove from available data".

### 5. It gives the web runtime a canonical default path

The web app is semantic-first for analytical families.

Implementation points:

- `web/src/lib/chatRuntime.ts`
- `web/src/lib/deterministicSql.ts`
- `web/src/lib/queries.ts`
- `web/src/lib/answerSanity.ts`
- `web/src/app/api/chat/route.ts`

Instead of sending the planner straight into raw tables every time, the runtime can start from the best available semantic contract for the question family and only fall back to raw where necessary.

Value:

- smaller planning space,
- better template reuse,
- more stable benchmarks,
- easier testing,
- more explainable system behavior.

## Semantic Layer Deep Dive

### Resolver and governance contracts

These contracts are responsible for normalization, coverage awareness, and governance.

#### `core.session_search_lookup`

Alias-aware session resolution surface built from:

- intrinsic session fields,
- venue aliases,
- session-type aliases.

This is the contract that lets the system treat "Yas Marina", "Yas Island", and "United Arab Emirates" as related search surfaces rather than unrelated strings.

#### `core.driver_identity_lookup`

Canonical driver identity surface that normalizes aliases and session-scoped driver records into a stable lookup interface.

This matters because driver resolution is often messier than it first appears, especially across seasons, abbreviations, and helper data.

#### `core.team_identity_lookup`

Canonical team identity surface that handles naming drift and alias forms such as rebrands or shorthand references.

#### `core.session_completeness`

Coverage and gating contract that lets the runtime understand whether a session is sufficiently populated for a given class of question.

This is critical because some failures are not SQL failures. They are data availability failures.

#### Under-adopted but useful governance contracts

- `core.weekend_session_coverage`
- `core.weekend_session_expectation_audit`
- `core.source_anomaly_tracking`
- `core.metric_registry`

These are valuable for planner guidance and auditing even if they are not yet the dominant default query surfaces.

### Semantic lap contracts

These contracts establish lap-grain semantics.

#### `core.compound_alias_lookup`

Normalizes raw compound labels into canonical compound families.

This prevents repeated "is `C3` medium or soft in this context?" logic from leaking into application code or prompts.

#### `core.valid_lap_policy`

Versioned lap-validity policy.

The default policy enforces a clean-lap style interpretation:

- lap duration must be within a sane range,
- pit-out and pit-in laps are excluded,
- sector data must exist,
- compound must be known,
- compound must be slick.

That policy is not a cosmetic detail. It is what makes pace comparisons reproducible.

#### `core.metric_registry`

Registry for semantic metric definitions and status.

This is valuable because metrics such as `delta_to_rep` and `pct_from_fastest` should be discoverable and governed, not hidden inside one-off SQL.

#### `core.lap_semantic_bridge`

Cross-table lap-grain bridge that aligns:

- lap records,
- session metadata,
- driver identity,
- stint context,
- compound normalization,
- pit context,
- position context,
- race control flag context.

This is the foundational contract that turns isolated lap rows into contextualized analytical objects.

#### `core.laps_enriched`

Primary lap analytics contract.

This is the canonical surface for pace, sector, clean-lap, degradation, and many head-to-head analyses.

It adds fields such as:

- canonical driver/session context,
- normalized compound metadata,
- lap validity flags,
- representative-lap deltas,
- fastest-lap deltas,
- lap-number representative deltas,
- fuel-adjusted experimental fields,
- lap-level positional context.

If you think of `raw.laps` as the source row and `core.laps_enriched` as the analysis row, the value of the semantic layer becomes very concrete.

### Semantic summary contracts

These contracts operate above lap grain and are closer to the way people naturally ask questions.

#### `core.driver_session_summary`

Driver/session level summary with pace, sector, consistency, and strategy context.

Great for:

- overall pace comparison,
- consistency analysis,
- best/average/median lap surfaces,
- session-level overview questions.

#### `core.stint_summary`

Stint-level analytics contract.

Great for:

- stint lengths,
- compounds used,
- degradation slope,
- average pace by stint,
- stint-by-stint comparison.

#### `core.strategy_summary`

Driver/session strategy rollup.

Great for:

- one-stop vs two-stop classification,
- opening and closing stint lengths,
- compounds used,
- total pit duration,
- pit laps.

#### `core.pit_cycle_summary`

Explicit pit-cycle evidence contract.

Great for:

- track-position change around stop windows,
- pit-cycle gain/loss analysis,
- evidence-bearing pit narratives.

#### `core.strategy_evidence_summary`

Undercut/overcut evidence contract.

Great for:

- determining whether a strategic claim is actually supportable,
- preventing the runtime from overstating what the data proves.

#### `core.grid_vs_finish`

Grid/finish reconciliation with source provenance and fallback behavior.

Great for:

- positions gained/lost,
- grid-to-finish delta,
- result summary questions.

#### `core.race_progression_summary`

Running-order and progression-oriented summary contract.

Great for:

- race narrative summaries,
- driver progression through the session,
- lap-window progression questions.

#### `core.telemetry_lap_bridge`

Telemetry/lap alignment contract used where a question needs lap-aware telemetry context rather than raw sample streams alone.

This is a good example of the semantic layer helping even when raw high-frequency data still matters.

## Raw vs Semantic: Why the Semantic Layer Is Better for Interaction

Here is the practical difference.

### Example: "Who had better average clean-lap pace?"

Without the semantic layer, you have to decide:

- which laps count,
- whether pit-out laps are excluded,
- whether wet/intermediate laps count,
- what to do with missing sector data,
- how to normalize compounds,
- whether to use means or medians,
- how to join driver identity safely.

With the semantic layer, that analysis starts from `core.laps_enriched` and its validity policy.

### Example: "Did either driver benefit from an undercut?"

Without the semantic layer, you need to hand-build:

- pit windows,
- pre- and post-pit position logic,
- relative rival comparison,
- evidence sufficiency gates,
- pace deltas around the stop.

With the semantic layer, that analysis can use `core.strategy_evidence_summary`, which is explicitly designed to answer the question in an evidence-bearing way.

### Example: "Which sessions have the best downstream coverage?"

Without the semantic layer, you are manually probing raw table presence.

With the semantic layer, `core.session_completeness` gives you a standard surface for that question family.

### Example: "What happened over the course of the race?"

Without the semantic layer, you are working from raw progression streams and event timing.

With the semantic layer, `core.race_progression_summary` gives you a much more stable narrative surface.

## Semantic Contract Policy

The project is semantic-first for analytical question families, but not semantic-only.

### Canonical semantic-first areas

These should default to `core.*` contracts:

- resolver normalization,
- lap pace and clean-lap analysis,
- sector analysis,
- stint and strategy analysis,
- pit-cycle and undercut evidence,
- positions gained/lost,
- running-order progression.

### Canonical raw fact areas

These remain valid direct raw sources because the high-frequency source facts are the product:

- `raw.car_data`
- `raw.location`
- `raw.weather`
- `raw.race_control`
- `raw.team_radio`

The rule is not "never use raw". The rule is "use semantic contracts by default when the question is analytical, and use raw directly when the fact domain is genuinely raw-sample oriented."

## How the Web Runtime Uses the Semantic Layer

The web app is not just a thin SQL client. It is a semantic query system with guardrails.

### Runtime behavior

Analytical question families route through semantic-first defaults:

- pace/sector/head-to-head -> `core.laps_enriched`, `core.driver_session_summary`
- stint/strategy -> `core.stint_summary`, `core.strategy_summary`
- pit-cycle/undercut evidence -> `core.pit_cycle_summary`, `core.strategy_evidence_summary`
- position and progression -> `core.grid_vs_finish`, `core.race_progression_summary`
- telemetry-lap questions -> `core.telemetry_lap_bridge`, with raw fallback where necessary

### Guardrails

Answer-level sanity checks live in:

- `web/src/lib/answerSanity.ts`
- `web/src/app/api/chat/route.ts`

Current focus areas include:

- stop/stint consistency,
- sector-summary consistency,
- pit-cycle evidence sufficiency,
- grid/finish evidence for positions-gained claims.

This is where the semantic layer really compounds in value: the contracts are structured so the runtime can not only answer questions, but also validate whether the answer shape matches the evidence.

## SQL Modules

### `sql/001_create_schemas.sql`

Creates the top-level schema structure.

### `sql/002_create_tables.sql`

Creates raw ingestion tables and foundational storage objects.

### `sql/003_indexes.sql`

Adds performance indexes for ingestion and query paths.

### `sql/004_constraints.sql`

Adds integrity and uniqueness constraints to support idempotent loading and cleaner downstream assumptions.

### `sql/005_helper_tables.sql`

Creates resolver, alias, coverage, and governance contracts such as:

- `core.session_search_lookup`
- `core.driver_identity_lookup`
- `core.team_identity_lookup`
- `core.session_completeness`

### `sql/006_semantic_lap_layer.sql`

Creates the formal semantic lap layer:

- compound normalization,
- lap validity policy,
- metric registry,
- lap bridge,
- enriched lap contract,
- replay-oriented intermediate contracts.

### `sql/007_semantic_summary_contracts.sql`

Creates higher-level semantic summary contracts for:

- pace summaries,
- stint summaries,
- strategy summaries,
- pit-cycle evidence,
- strategy evidence,
- grid-vs-finish,
- race progression.

## Ingestion Strategy

The ingestion flow is designed to be repeatable and source-tolerant.

Key behavior:

- discovers files recursively under `data/`,
- maps filenames/prefixes to destination tables,
- loads in dependency-aware order,
- normalizes columns,
- injects `session_key` and `meeting_key` from path context when needed,
- adds `source_file`,
- normalizes timestamps to UTC,
- bulk loads via temp tables and upsert logic where appropriate,
- logs ingestion status and row counts into audit tables.

This keeps the raw layer faithful while still making reruns practical.

## Local Setup

### 1. Copy the environment template

```bash
cd openf1
cp .env.example .env
```

### 2. Start PostgreSQL with Docker

```bash
docker compose up -d
```

### 3. Initialize schemas, tables, indexes, and views

```bash
./scripts/init_db.sh
```

If `f1_codex_helpers/` exists, helper alias seeds are loaded automatically.

To reload helper seeds manually:

```bash
./scripts/load_codex_helpers.sh
```

### 4. Create a Python environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 5. Run ingestion

Reload mode:

```bash
python -m src.ingest --data-dir ./data --mode reload
```

Upsert mode:

```bash
python -m src.ingest --data-dir ./data --mode upsert
```

Optional chunk tuning:

```bash
python -m src.ingest --data-dir ./data --mode upsert --chunk-size 200000
```

## Useful Validation Queries

```sql
-- Count sessions
SELECT COUNT(*) FROM raw.sessions;

-- Count laps for one session
SELECT session_key, COUNT(*)
FROM raw.laps
WHERE session_key = 9839
GROUP BY session_key;

-- Count telemetry rows for one driver in one session
SELECT COUNT(*)
FROM raw.car_data
WHERE session_key = 9839 AND driver_number = 55;

-- Semantic session surface
SELECT s.session_key, s.session_name, s.meeting_key, s.country_name, s.location
FROM core.sessions s
ORDER BY s.date_start DESC
LIMIT 25;

-- Semantic driver/session summary
SELECT session_key, driver_number, driver_name, avg_valid_lap, strategy_type
FROM core.driver_session_summary
WHERE session_key = 9839
ORDER BY avg_valid_lap ASC;

-- Strategy summary
SELECT driver_number, driver_name, pit_stop_count, strategy_type, compounds_used
FROM core.strategy_summary
WHERE session_key = 9839
ORDER BY driver_number;
```

## Why This Design Works Well for LLM and App Interaction

If the only goal were warehouse storage, `raw` would be enough.

If the goal is meaningful interaction with the data, `raw` is necessary but not sufficient.

The semantic layer adds value because it:

- translates source tables into domain concepts,
- centralizes business logic and data hygiene,
- stabilizes common analytical interfaces,
- reduces query-planner ambiguity,
- gives the runtime evidence-bearing answer paths,
- preserves raw access where raw facts are still the right source.

That is the core philosophy of this repo: keep the source honest, but do not force every user or every query generator to rediscover F1 semantics from scratch.

## Related Documentation

- `docs/semantic_contract_map.md`
- `docs/semantic_runtime_adoption.md`
- `docs/transformed_lap_schema.md`
- `docs/source_audit_runbook.md`
- `docs/helper_repo_adoption_status.md`

## Supabase Migration Notes

- The SQL is written for PostgreSQL-compatible environments.
- The `raw + core` separation maps cleanly to a Supabase migration approach.
- Core semantic views can move into managed migrations directly.
- Large-volume tables such as telemetry/location are good candidates for future partitioning.

## Recommended Local DB Defaults

- Database: `openf1`
- User: `openf1`
- Password: `openf1_local_dev`
