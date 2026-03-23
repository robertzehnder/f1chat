# OpenF1 Database Context for LLM-Assisted Analysis

Use this document as a grounding pack for another LLM chat that needs to understand the OpenF1 PostgreSQL warehouse, the data-model caveats, and the specific natural-language-to-SQL problem being solved.

## Why this document exists

The goal is to build an analyst-style experience where a user can ask natural-language questions about historical F1 race data and get:

- a grounded answer
- a trustworthy SQL query or structured query plan
- supporting rows or aggregates
- awareness of missing or incomplete data

This is not a generic SQL-generation problem. The hard part is not only SQL syntax. The harder problem is semantic resolution:

- a user says "Abu Dhabi 2025"
- the database often stores that concept as `country_name='United Arab Emirates'`, `location='Yas Island'`, `circuit_short_name='Yas Marina Circuit'`
- `meeting_name` is blank across the `raw.meetings` table in the current load

That means the system needs entity resolution and schema grounding before it asks an LLM to write SQL.

## Problem Statement for the LLM Layer

The product being built is a web app for exploratory analysis of Formula 1 data stored in PostgreSQL.

The app should:

- let users browse sessions, drivers, laps, telemetry, and events without writing SQL
- support an analyst-chat workflow where users ask questions in plain English
- generate read-only SQL safely
- show supporting rows and explain the basis of the answer
- avoid misleading answers when data is sparse, semantically inconsistent, or missing

The main challenge is:

- plain text references do not reliably map to raw database labels
- table grain changes across the warehouse
- telemetry tables are extremely large
- some tables are currently empty
- some sessions are placeholders or partially populated

## Current Data Platform

- Database: PostgreSQL
- Schemas: `raw`, `core`
- `raw`: imported OpenF1-like source tables with minimal transformation
- `core`: app-facing relational views for browsing and future semantic modeling

## Observed Warehouse Snapshot

Approximate row counts below come from `pg_stat_user_tables` as of 2026-03-15.

| Object | Approx rows |
|---|---:|
| `raw.car_data` | 50,351,578 |
| `raw.location` | 51,636,520 |
| `raw.intervals` | 1,713,817 |
| `raw.laps` | 79,299 |
| `raw.position_history` | 35,511 |
| `raw.weather` | 11,368 |
| `raw.race_control` | 6,565 |
| `raw.team_radio` | 6,129 |
| `raw.stints` | 4,071 |
| `raw.pit` | 2,390 |
| `raw.drivers` | 1,551 |
| `raw.sessions` | 95 |
| `raw.meetings` | 95 |
| `raw.ingestion_files` | 4,165 |
| `raw.ingestion_runs` | 1 |
| `raw.session_result` | 0 |
| `raw.starting_grid` | 0 |
| `raw.overtakes` | 0 |
| `raw.championship_drivers` | 0 |
| `raw.championship_teams` | 0 |
| `core.sessions` | 95 |
| `core.meetings` | 95 |
| `core.session_drivers` | 1,551 |
| `core.driver_dim` | 33 |

## Critical Semantic Caveats

These are especially important for any LLM or agent trying to translate natural language into correct SQL.

### 1. `meeting_name` is currently blank

All 95 rows in `raw.meetings` have null or empty `meeting_name`.

This means phrases like:

- "Abu Dhabi 2025"
- "British Grand Prix 2025"
- "Monaco 2024"

should not rely only on `meeting_name`.

The resolver must also search:

- `country_name`
- `location`
- `circuit_short_name`
- possibly `session_key`
- and potentially a manual synonym layer

### 2. "Abu Dhabi 2025" is stored as Yas Island / UAE

Concrete example from the local warehouse:

```json
{
  "meeting_key": 1276,
  "meeting_name": null,
  "meeting_official_name": null,
  "year": 2025,
  "country_name": "United Arab Emirates",
  "location": "Yas Island",
  "circuit_short_name": "Yas Marina Circuit",
  "date_start": null
}
```

Associated race session:

```json
{
  "session_key": 9839,
  "meeting_key": 1276,
  "session_name": "Race",
  "year": 2025,
  "country_name": "United Arab Emirates",
  "location": "Yas Island",
  "circuit_short_name": "Yas Marina Circuit",
  "date_start": "2025-12-07T13:00:00+00:00"
}
```

This is why a natural-language query such as "who was the fastest driver at the Abu Dhabi 2025 race" may fail if the generated SQL filters only on `meeting_name ILIKE '%Abu Dhabi%'`.

### 3. Some tables are empty in the current load

The following tables currently have zero rows:

- `raw.session_result`
- `raw.starting_grid`
- `raw.overtakes`
- `raw.championship_drivers`
- `raw.championship_teams`

The assistant should not assume these domains are populated.

### 4. Telemetry tables are huge

The assistant should never default to unconstrained scans on:

- `raw.car_data`
- `raw.location`
- `raw.intervals`
- `raw.position_history`

Telemetry queries should almost always be narrowed by:

- `session_key`
- optionally `driver_number`
- optionally date window or lap window

### 5. Some source attributes are sparse or null

Observed examples:

- `meeting_name` often blank
- `date_start` in `raw.meetings` may be null
- some telemetry/event tables may contain rows with null `date`
- `country_code` in drivers may be null

## Recommended NL-to-SQL Workflow

This is the recommended architecture for a robust analyst-chat pipeline.

### Step 1: Resolve entities before SQL generation

Translate phrases such as:

- "Abu Dhabi 2025"
- "Suzuka 2025"
- "Max in Monaco"

into canonical IDs and structured context, for example:

```json
{
  "session_key": 9839,
  "meeting_key": 1276,
  "country_name": "United Arab Emirates",
  "location": "Yas Island",
  "circuit_short_name": "Yas Marina Circuit",
  "confidence": "high"
}
```

### Step 2: Choose the analytical grain

The assistant should decide whether the question is about:

- session-level metadata
- driver roster
- lap-level timing
- stint strategy
- weather or race-control timeline
- telemetry samples

### Step 3: Generate SQL against a constrained semantic layer

Prefer:

- `core.sessions`
- `core.session_drivers`
- curated derived views such as `core.session_completeness`, `core.driver_session_summary`, `core.grid_vs_finish`

Use raw tables only when necessary.

### Step 4: Validate and preview

Before returning an answer:

- ensure SQL is read-only
- ensure only one statement is present
- enforce row limits
- preview rows first
- catch schema or semantic errors
- repair or fall back if needed

### Step 5: Explain caveats

Every answer should be able to say:

- what tables were used
- what IDs or filters were applied
- whether the data is complete enough to support the claim

## Operational Runtime Workflow Spec

The earlier workflow is directionally correct, but an implementation should not let one model jump directly from user text to SQL. The runtime system should be split into explicit stages with clear contracts.

### Stage Overview

| Stage | Component | Primary responsibility | Output |
|---|---|---|---|
| `0` | intake + classifier | determine question class and whether this is a follow-up | `question_type`, `analysis_class`, `follow_up_flag` |
| `1` | entity resolver | resolve meeting/session/driver/team/session-type references | ranked candidates + confidence |
| `2` | ambiguity manager | decide whether to proceed, warn, or ask a clarification question | `resolution_status` |
| `3` | completeness checker | verify relevant tables exist and target session has usable data | availability + caveats + fallback options |
| `4` | grain selector | choose the analytical grain and expected row volume | `grain`, `row_volume`, `recommended_tables` |
| `5` | query planner | create structured intermediate plan | plan JSON |
| `6` | SQL generator | generate read-only PostgreSQL from the plan | SQL |
| `7` | validator + guardrail layer | reject dangerous or overbroad SQL | validated SQL or failure |
| `8` | preview executor | run a small preview to confirm the path is sane | preview result |
| `9` | final executor | run final query or bounded telemetry query | final result |
| `10` | answer synthesizer | package answer, evidence, SQL, and caveats | final response object |
| `11` | memory manager | update conversation state for follow-up turns | structured memory state |

### Runtime Orchestration Rule

The system should move left to right through the stages, but it must also be allowed to loop:

- if entity resolution is ambiguous, route to clarification before planning SQL
- if completeness checks fail, route to fallback selection or explicit unavailability response
- if preview results are empty or clearly wrong, route back to resolver or planner
- if SQL validation fails, route to planner repair or SQL repair, not directly to user unless repair confidence is low

## Question Taxonomy

The system should classify each user question into one of the following classes before any SQL is generated.

| Question class | Example | Typical first tables |
|---|---|---|
| `entity_lookup` | "What session key is Abu Dhabi 2025 race?" | `core.sessions` |
| `metadata_lookup` | "Who drove in Suzuka 2025?" | `core.session_drivers`, `raw.drivers` |
| `aggregate_analysis` | "Who had the fastest lap at Abu Dhabi 2025?" | `raw.laps`, `core.session_drivers` |
| `comparison_analysis` | "Compare Verstappen and Leclerc on lap degradation" | `raw.laps`, `raw.stints` |
| `event_timeline_analysis` | "Show the weather and race control timeline" | `raw.weather`, `raw.race_control`, `raw.team_radio` |
| `telemetry_analysis` | "Where did Verstappen lose time in sector 3?" | `raw.car_data`, `raw.location`, `raw.laps` |
| `data_health_question` | "Which sessions have missing telemetry?" | derived completeness views, ingestion audit tables |

Question class drives:

- whether `core` is enough
- whether `raw` is needed
- whether telemetry sampling is required
- whether a chart should be preferred over a table
- whether the system should ask for clarification

## Resolver Contract

The resolver should operate before SQL generation and return structured candidates rather than a single guessed answer.

### Resolver Input

```json
{
  "user_text": "Compare Max and Charles in Abu Dhabi 2025 race",
  "conversation_context": {
    "active_session_key": null,
    "active_driver_numbers": [],
    "last_question_type": null
  }
}
```

### Resolver Output

```json
{
  "meeting_candidates": [
    {
      "meeting_key": 1276,
      "label": "United Arab Emirates / Yas Island / Yas Marina Circuit / 2025",
      "confidence": 0.96,
      "matched_on": ["venue alias", "year"]
    }
  ],
  "session_candidates": [
    {
      "session_key": 9839,
      "session_name": "Race",
      "confidence": 0.98,
      "matched_on": ["resolved meeting", "session type"]
    }
  ],
  "driver_candidates": [
    {
      "driver_number": 1,
      "full_name": "Max VERSTAPPEN",
      "confidence": 0.99,
      "matched_on": ["first name alias"]
    },
    {
      "driver_number": 16,
      "full_name": "Charles LECLERC",
      "confidence": 0.99,
      "matched_on": ["first name alias"]
    }
  ],
  "needs_clarification": false
}
```

### Alias and Synonym Rules

The resolver should support:

- venue aliases:
  - `Abu Dhabi` -> `Yas Island`, `Yas Marina`, `United Arab Emirates`
  - `Silverstone` -> `British GP`, `Great Britain`
- session aliases:
  - `race` -> `Race`
  - `quali` -> `Qualifying`
  - `sprint quali` -> `Sprint Qualifying`
- driver aliases:
  - `Max` -> `Max VERSTAPPEN`
  - `Charles` -> `Charles LECLERC`
  - acronym handling such as `VER`, `LEC`, `NOR`

The resolver must not rely on `meeting_name` alone.

## Ambiguity Policy

The runtime system should have an explicit ambiguity policy rather than pretending every query resolves cleanly.

### Confidence Thresholds

- `high_confidence`: one clear candidate, confidence `>= 0.90`
  - proceed automatically
- `medium_confidence`: a few plausible candidates, confidence `0.60 - 0.89`
  - proceed only with visible warning or offer disambiguation
- `low_confidence`: no strong candidate, confidence `< 0.60`
  - ask a clarification question before any heavy query

### Clarification Triggers

Ask a clarification question when:

- more than one session in the same weekend matches the request
- a driver reference maps to multiple plausible candidates
- the user says "Monaco 2025" without specifying session type
- a telemetry question lacks a session or driver and the estimated result set would be too large

## Completeness and Availability Check

Completeness checking should be a formal stage, not just a note attached to the final answer.

### Completeness Input

```json
{
  "question_type": "aggregate_analysis",
  "resolved_entities": {
    "session_key": 9839
  },
  "candidate_tables": ["raw.laps", "core.session_drivers"]
}
```

### Completeness Output

```json
{
  "available": true,
  "table_checks": [
    {
      "table": "raw.laps",
      "session_rows": 1156,
      "status": "usable"
    },
    {
      "table": "core.session_drivers",
      "session_rows": 20,
      "status": "usable"
    }
  ],
  "warnings": [],
  "fallback_options": []
}
```

### Completeness Rules

- if a required table is globally empty, do not attempt that path
- if a session has zero rows in a required table, fail early and offer fallback or unavailability
- if the table is present but sparse, continue with explicit warning
- if join keys are null-heavy, warn before synthesis

Examples:

- question asks for overtakes -> `raw.overtakes` currently empty -> return unavailable or infer cautiously from `raw.position_history`
- question asks for starting grid -> `raw.starting_grid` currently empty -> return unavailable
- question asks for telemetry in a session with no `raw.car_data` -> fail before SQL generation

## Analytical Grain Selection

The planner should explicitly choose a grain before SQL generation.

Supported grains:

- `session`
- `driver_session`
- `lap`
- `stint`
- `event`
- `telemetry_point`
- `telemetry_window`

### Grain Selection Example

```json
{
  "question_type": "aggregate_analysis",
  "grain": "driver_session",
  "expected_row_volume": "small",
  "recommended_tables": ["raw.laps", "core.session_drivers"]
}
```

## Query Plan Contract

The runtime system should generate an intermediate query-plan object before SQL.

### Query Plan Example

```json
{
  "question_type": "fastest_lap",
  "resolved_entities": {
    "session_key": 9839
  },
  "grain": "driver_session",
  "primary_tables": ["raw.laps", "core.session_drivers"],
  "joins": [
    "raw.laps.session_key = core.session_drivers.session_key",
    "raw.laps.driver_number = core.session_drivers.driver_number"
  ],
  "filters": [
    "raw.laps.session_key = 9839",
    "raw.laps.lap_duration IS NOT NULL"
  ],
  "aggregation": "MIN(raw.laps.lap_duration) by driver",
  "ordering": "best_lap_duration ASC",
  "limit": 5,
  "risk_flags": [],
  "expected_row_count": "small"
}
```

### Why the Plan Layer Matters

- easier SQL validation
- easier logging and debugging
- easier answer explanation
- easier repair when generated SQL fails
- easier benchmark evaluation

## Telemetry-Specific Workflow

Telemetry-heavy questions should follow a separate execution path.

### Telemetry Path

1. resolve session
2. resolve driver or driver set
3. determine lap window or date window
4. choose telemetry fields needed
5. estimate row volume
6. sample or aggregate if needed
7. run bounded query
8. return chart-oriented result plus preview rows

### Telemetry Rules

- never query `raw.car_data` or `raw.location` without `session_key`
- strongly prefer `driver_number`
- default to `telemetry_window` grain instead of `telemetry_point` when result volume is high
- cap returned rows
- suggest a chart instead of a giant table
- use `raw.laps` first to identify lap boundaries when the user asks for lap-specific telemetry

### Telemetry Plan Example

```json
{
  "question_type": "telemetry_analysis",
  "resolved_entities": {
    "session_key": 9839,
    "driver_numbers": [1, 16]
  },
  "grain": "telemetry_window",
  "primary_tables": ["raw.laps", "raw.car_data"],
  "filters": [
    "raw.car_data.session_key = 9839",
    "raw.car_data.driver_number IN (1,16)",
    "raw.car_data.date BETWEEN lap_window_start AND lap_window_end"
  ],
  "sampling_strategy": "windowed or downsampled",
  "risk_flags": ["telemetry_large_table"]
}
```

## Fallback Table Policy

The system should not fail hard whenever the ideal table is empty. It should have declared fallbacks by question type.

| Question | Preferred source | Fallback | Caveat |
|---|---|---|---|
| final classification | `raw.session_result` | infer from latest `raw.position_history` or `raw.intervals` | inferred, unofficial |
| starting grid | `raw.starting_grid` | none in current warehouse | unavailable |
| overtakes | `raw.overtakes` | infer from `raw.position_history` plus `raw.pit` | inferred, not official |
| fastest lap | `raw.laps` | none needed | direct observation |
| weather change | `raw.weather` | none needed | direct observation |
| telemetry comparison | `raw.car_data`, `raw.location` | sampled or lap-windowed telemetry only | may be partial due to sampling |

## SQL Validation Rules

Validation should happen after SQL generation and before execution.

Required checks:

- one statement only
- `SELECT` / read-only only
- no DDL or DML
- mandatory narrowing for telemetry tables
- enforced row limits
- no invalid table or column references
- expected row-volume sanity where possible

If validation fails:

- attempt plan repair or SQL repair if confidence remains high
- otherwise ask the user a clarification question or return a safe failure

## Answer Format Contract

Every successful analyst response should follow a consistent structure.

### Standard Answer Object

```json
{
  "direct_answer": "Charles LECLERC had the fastest lap in the Abu Dhabi 2025 race.",
  "evidence": {
    "resolved_entities": {
      "session_key": 9839
    },
    "tables_used": ["raw.laps", "core.session_drivers"],
    "filters_applied": ["session_key = 9839", "lap_duration IS NOT NULL"],
    "completeness_status": "usable"
  },
  "supporting_rows": [
    {
      "driver_number": 16,
      "full_name": "Charles LECLERC",
      "best_lap_duration": 86.725
    }
  ],
  "query_artifact": {
    "query_plan": "optional",
    "sql": "SELECT ..."
  },
  "caveats": [],
  "chart_recommendation": "lap duration distribution by driver"
}
```

### Answer Synthesis Rules

- distinguish observed facts from inferred conclusions
- attach completeness notes when data is sparse
- include the resolved session and key filters
- for telemetry questions, prefer chart-oriented outputs plus small previews

## Conversation Memory Model

Follow-up turns should not require the user to restate every entity.

### Memory State Example

```json
{
  "active_session_key": 9839,
  "active_meeting_key": 1276,
  "active_driver_numbers": [1, 16],
  "last_question_type": "comparison_analysis",
  "last_grain": "lap",
  "last_tables_used": ["raw.laps", "core.session_drivers"],
  "known_caveats": ["meeting_name blank in raw.meetings"]
}
```

### Memory Rules

- persist active session if the user asks a follow-up like "now just show me sector 2"
- persist active drivers for follow-up comparisons
- do not silently carry context too far across unrelated turns
- surface carried context in the answer or UI when it materially affects the result

## Metadata Catalog Contract

The runtime system should expose machine-usable metadata, not just natural-language docs.

### Metadata Example

```json
{
  "table": "raw.car_data",
  "description": "High-volume per-driver telemetry points",
  "grain": "telemetry_point",
  "required_filters": ["session_key"],
  "recommended_optional_filters": ["driver_number", "date range"],
  "avoid_unbounded_scan": true,
  "best_for": ["speed trace", "throttle", "brake", "gear", "drs"],
  "join_keys": ["session_key", "driver_number"],
  "current_row_count_approx": 50351578
}
```

### Metadata Requirements

The catalog should provide:

- table descriptions
- column descriptions
- join hints
- grain
- row-count estimates
- safe usage notes
- recommended question types
- required filters for large tables

## Evaluation Plan

The analyst system should be measured, not just prompt-tuned.

### Benchmark Categories

- entity resolution correctness
- session resolution correctness
- ambiguity handling correctness
- grain selection correctness
- table-routing correctness
- SQL correctness
- answer faithfulness
- caveat correctness

### Benchmark Example Record

```json
{
  "question": "Who had the fastest lap at Abu Dhabi 2025 race?",
  "expected_entities": {
    "session_key": 9839
  },
  "expected_grain": "driver_session",
  "preferred_tables": ["raw.laps", "core.session_drivers"],
  "acceptable_sql_patterns": ["MIN(lap_duration)", "session_key = 9839"],
  "expected_answer_shape": "direct answer + evidence + supporting rows",
  "expected_caveats": []
}
```

## Concrete Missing Artifacts

If this system is going to become reliable, the following artifacts should exist as first-class product/runtime components.

### 1. Session alias layer

Examples:

- `Abu Dhabi`
- `Yas Marina`
- `Yas Island`
- `UAE`
- `United Arab Emirates`
- `Abu Dhabi GP`

Each alias should map to canonical meeting/session candidates.

### 2. Driver alias layer

Examples:

- `Max`
- `Verstappen`
- `VER`
- `Charles`
- `Leclerc`
- `LEC`

### 3. Derived completeness views

Recommended:

- `core.session_completeness`
- `core.table_population_summary`
- `core.session_table_row_counts`

### 4. Derived summary views

Recommended:

- `core.driver_session_summary`
- `core.lap_pace_summary`
- `core.stint_summary`
- `core.weather_timeline`
- `core.race_control_timeline`

### 5. Lap-window bridge

This would map lap numbers to timestamp windows by session and driver, making telemetry retrieval much easier for lap-specific analysis.

## Recommended Implementation Priority

If this needs to become a real analyst system rather than a prompt experiment, the most useful build order is:

1. build the resolver layer first
2. define and enforce the intermediate query-plan schema
3. build completeness and table-availability views
4. build a small set of derived summary views for common questions
5. add telemetry-specific windowing and sampling helpers
6. create benchmark question sets and evaluation criteria
7. refine prompts only after the workflow and metadata layers are stable

## Real Example: Fastest Driver at Abu Dhabi 2025

A robust approach should resolve "Abu Dhabi 2025 race" to `session_key=9839`, then query the relevant table.

In the current warehouse, the best-lap result for that session is:

```json
{
  "session_key": 9839,
  "driver_number": 16,
  "full_name": "Charles LECLERC",
  "team_name": "Ferrari",
  "best_lap_duration": 86.725
}
```

That example is useful because it illustrates:

- the semantic mismatch between user language and stored attributes
- the importance of resolving sessions first
- the usefulness of `raw.laps` for "fastest lap" style questions

## Table and View Reference

The following sections summarize each table or view, why it exists, how to join it, and a representative sample.

---

## `raw.meetings`

- Purpose: one row per meeting / grand prix weekend context
- Grain: one row per `meeting_key`
- Primary join key: `meeting_key`
- Key fields:
  - `meeting_key`
  - `meeting_name`
  - `meeting_official_name`
  - `year`
  - `country_name`
  - `location`
  - `circuit_short_name`
  - `date_start`
- Caveat: `meeting_name` is blank in the current load, so this table is weak for direct NL matching

Sample:

```json
{
  "meeting_key": 1276,
  "meeting_name": null,
  "meeting_official_name": null,
  "year": 2025,
  "country_name": "United Arab Emirates",
  "location": "Yas Island",
  "circuit_short_name": "Yas Marina Circuit",
  "date_start": null
}
```

## `raw.sessions`

- Purpose: one row per session
- Grain: one row per `session_key`
- Primary join key: `session_key`
- Important foreign key: `meeting_key`
- Key fields:
  - `session_key`
  - `meeting_key`
  - `session_name`
  - `session_type`
  - `session_number`
  - `date_start`
  - `year`
  - `country_name`
  - `location`
  - `circuit_short_name`

Sample:

```json
{
  "session_key": 9839,
  "meeting_key": 1276,
  "session_name": "Race",
  "year": 2025,
  "country_name": "United Arab Emirates",
  "location": "Yas Island",
  "circuit_short_name": "Yas Marina Circuit",
  "date_start": "2025-12-07T13:00:00+00:00"
}
```

## `raw.drivers`

- Purpose: session-specific driver roster and identity attributes
- Grain: effectively unique on `(session_key, driver_number)`
- Join keys:
  - `session_key`
  - `driver_number`
- Key fields:
  - `full_name`
  - `broadcast_name`
  - `team_name`
  - `name_acronym`
  - `country_code`

Sample:

```json
{
  "session_key": 9839,
  "driver_number": 1,
  "full_name": "Max VERSTAPPEN",
  "team_name": "Red Bull Racing",
  "country_code": null,
  "broadcast_name": "M VERSTAPPEN"
}
```

## `raw.laps`

- Purpose: lap-level timing and sector data
- Grain: effectively unique on `(session_key, driver_number, lap_number)`
- Join keys:
  - `session_key`
  - `driver_number`
- Key fields:
  - `lap_number`
  - `lap_duration`
  - `duration_sector_1`
  - `duration_sector_2`
  - `duration_sector_3`
  - `date_start`
- Best table for:
  - fastest lap
  - lap pace trend
  - sector analysis
  - lap degradation

Sample:

```json
{
  "session_key": 9839,
  "driver_number": 16,
  "lap_number": 45,
  "lap_duration": 86.725,
  "duration_sector_1": 17.525,
  "duration_sector_2": 37.608,
  "duration_sector_3": 31.592,
  "date_start": "2025-12-07T14:09:32.857+00:00"
}
```

## `raw.pit`

- Purpose: pit stop events and durations
- Grain: effectively unique on `(session_key, driver_number, lap_number, date)`
- Join keys:
  - `session_key`
  - `driver_number`
- Key fields:
  - `lap_number`
  - `pit_duration`
  - `date`
- Best table for:
  - stop timing
  - undercut/overcut framing
  - pit strategy timelines

Sample:

```json
{
  "session_key": 11245,
  "driver_number": 31,
  "lap_number": 46,
  "pit_duration": 47.067,
  "date": "2026-03-15T08:23:53.817+00:00"
}
```

## `raw.stints`

- Purpose: tire stint metadata
- Grain: effectively unique on `(session_key, driver_number, stint_number)`
- Join keys:
  - `session_key`
  - `driver_number`
- Key fields:
  - `stint_number`
  - `lap_start`
  - `lap_end`
  - `compound`
  - `tyre_age_at_start`
  - `fresh_tyre`

Sample:

```json
{
  "session_key": 9839,
  "driver_number": 1,
  "stint_number": 1,
  "lap_start": 1,
  "lap_end": 23,
  "compound": "MEDIUM",
  "tyre_age_at_start": 0,
  "fresh_tyre": null
}
```

## `raw.team_radio`

- Purpose: driver/session-linked radio clip references
- Grain: effectively unique on `(session_key, driver_number, date, recording_url)`
- Join keys:
  - `session_key`
  - `driver_number`
- Key fields:
  - `date`
  - `recording_url`
- Useful for:
  - attaching qualitative context to race moments
  - explaining incidents or strategy changes

Sample:

```json
{
  "session_key": 9839,
  "driver_number": 1,
  "date": "2025-12-07T14:33:14.515+00:00",
  "recording_url": "https://livetiming.formula1.com/static/2025/2025-12-07_Abu_Dhabi_Grand_Prix/2025-12-07_Race/TeamRadio/MAXVER01_1_20251207_183223.mp3"
}
```

## `raw.race_control`

- Purpose: official race-control messages and control events
- Grain: effectively unique on `(session_key, date, category, driver_number, message)`
- Join keys:
  - `session_key`
  - optional `driver_number`
- Key fields:
  - `date`
  - `category`
  - `flag`
  - `scope`
  - `lap_number`
  - `driver_number`
  - `message`

Sample:

```json
{
  "session_key": 11245,
  "date": "2026-03-15T08:41:05+00:00",
  "category": "Other",
  "flag": null,
  "scope": null,
  "lap_number": 56,
  "driver_number": null,
  "message": "ALL PASS HOLDERS MAY ACCESS THE PIT LANE"
}
```

## `raw.weather`

- Purpose: environmental time series during a session
- Grain: effectively unique on `(session_key, date)`
- Join keys:
  - `session_key`
- Key fields:
  - `date`
  - `air_temperature`
  - `track_temperature`
  - `humidity`
  - `rainfall`
  - `wind_speed`

Sample:

```json
{
  "session_key": 9839,
  "date": "2025-12-07T14:39:07.948+00:00",
  "air_temperature": 25.9,
  "track_temperature": 28.9,
  "humidity": 66,
  "rainfall": false,
  "wind_speed": 1.5
}
```

## `raw.session_result`

- Purpose: final or official classification
- Grain: effectively unique on `(session_key, driver_number)`
- Join keys:
  - `session_key`
  - `driver_number`
- Key fields:
  - `position`
  - `points`
  - `status`
  - `classified`
- Current state: no rows loaded in the current local warehouse

Sample:

```json
null
```

## `raw.starting_grid`

- Purpose: starting order metadata
- Grain: effectively unique on `(session_key, driver_number)`
- Join keys:
  - `session_key`
  - `driver_number`
- Key fields:
  - `grid_position`
- Current state: no rows loaded in the current local warehouse

Sample:

```json
null
```

## `raw.overtakes`

- Purpose: overtaking-event history
- Grain: effectively unique on `(session_key, date, overtaker_driver_number, overtaken_driver_number)`
- Join keys:
  - `session_key`
  - `overtaker_driver_number`
  - `overtaken_driver_number`
- Current state: no rows loaded in the current local warehouse

Sample:

```json
null
```

## `raw.championship_drivers`

- Purpose: driver standings snapshots tied to session context
- Grain: effectively unique on `(session_key, driver_number)`
- Current state: no rows loaded in the current local warehouse

Sample:

```json
null
```

## `raw.championship_teams`

- Purpose: team standings snapshots tied to session context
- Grain: effectively unique on `(session_key, team_name)`
- Current state: no rows loaded in the current local warehouse

Sample:

```json
null
```

## `raw.car_data`

- Purpose: high-volume per-driver telemetry
- Grain: effectively unique on `(session_key, driver_number, date)`
- Join keys:
  - `session_key`
  - `driver_number`
- Key fields:
  - `date`
  - `rpm`
  - `speed`
  - `n_gear`
  - `throttle`
  - `brake`
  - `drs`
- Best table for:
  - speed traces
  - brake/throttle overlays
  - gear usage
  - DRS behavior
- Caveat: massive table; never query without a session filter

Sample:

```json
{
  "session_key": 9839,
  "driver_number": 1,
  "date": "2025-12-07T12:06:20.939+00:00",
  "rpm": 0,
  "speed": 0,
  "n_gear": 0,
  "throttle": 0,
  "brake": 0,
  "drs": 0
}
```

## `raw.location`

- Purpose: high-volume spatial telemetry
- Grain: effectively unique on `(session_key, driver_number, date)`
- Join keys:
  - `session_key`
  - `driver_number`
- Key fields:
  - `date`
  - `x`
  - `y`
  - `z`
- Best table for:
  - track map traces
  - on-track position replay
  - racing line exploration
- Caveat: also massive; always constrain by session and preferably driver/time

Sample:

```json
{
  "session_key": 9839,
  "driver_number": 1,
  "date": "2025-12-07T12:05:36.891+00:00",
  "x": 0,
  "y": 0,
  "z": 0
}
```

## `raw.intervals`

- Purpose: relative gap / interval history
- Grain: effectively unique on `(session_key, driver_number, date)` when `date` is populated
- Join keys:
  - `session_key`
  - `driver_number`
- Key fields:
  - `date`
  - `interval`
  - `gap_to_leader`
- Best table for:
  - gap-to-leader charts
  - race compression/expansion analysis
  - interval trends

Sample:

```json
{
  "session_key": 9839,
  "driver_number": 1,
  "date": "2025-12-07T12:05:11.22+00:00",
  "interval": "0.0",
  "gap_to_leader": "0.0"
}
```

## `raw.position_history`

- Purpose: time-series position changes
- Grain: effectively unique on `(session_key, driver_number, date)` when `date` is populated
- Join keys:
  - `session_key`
  - `driver_number`
- Key fields:
  - `date`
  - `position`
- Best table for:
  - position-over-time views
  - gained/lost position analysis

Sample:

```json
{
  "session_key": 9839,
  "driver_number": 1,
  "date": "2025-12-07T12:05:19.767+00:00",
  "position": 1
}
```

## `raw.ingestion_runs`

- Purpose: operational audit table for ingestion runs
- Grain: one row per ingestion run
- Key fields:
  - `run_id`
  - `started_at`
  - `finished_at`
  - `mode`
  - `data_dir`
  - `status`
- Useful for:
  - operational debugging
  - freshness checks
  - load-history inspection

Sample:

```json
{
  "run_id": "7a79fce8-2924-492d-a1d3-70ccb5f5ca01",
  "started_at": "2026-03-15T17:37:25.02485+00:00",
  "finished_at": "2026-03-15T18:41:39.003003+00:00",
  "mode": "upsert",
  "data_dir": "/Users/robertzehnder/Documents/coding/f1/openf1/data",
  "status": "completed"
}
```

## `raw.ingestion_files`

- Purpose: per-file ingestion audit table
- Grain: one row per file processed per ingestion run
- Key fields:
  - `run_id`
  - `table_name`
  - `source_file`
  - `rows_loaded`
  - `status`
  - `error_message`
  - `loaded_at`
- Useful for:
  - ingestion debugging
  - backfill validation
  - identifying partial loads

Sample:

```json
{
  "run_id": "7a79fce8-2924-492d-a1d3-70ccb5f5ca01",
  "table_name": "car_data",
  "source_file": "data/2026/shanghai/2026-03-15_session_11245/car_data/car_data_87.csv",
  "rows_loaded": 33799,
  "status": "success",
  "loaded_at": "2026-03-15T18:41:38.554509+00:00"
}
```

---

## `core.meetings`

- Type: direct view over `raw.meetings`
- Purpose: app-facing meeting list
- Row count: 95
- Caveat: still inherits the blank `meeting_name` issue from raw

Sample:

```json
{
  "meeting_key": 1276,
  "meeting_name": null,
  "year": 2025,
  "country_name": "United Arab Emirates",
  "location": "Yas Island",
  "circuit_short_name": "Yas Marina Circuit",
  "date_start": null
}
```

## `core.sessions`

- Type: join of `raw.sessions` with meeting context
- Purpose: default session browser source
- Row count: 95
- Best use:
  - session search
  - metadata browsing
  - driving entity resolution before raw-table analysis

Sample:

```json
{
  "session_key": 9839,
  "meeting_name": null,
  "session_name": "Race",
  "year": 2025,
  "country_name": "United Arab Emirates",
  "location": "Yas Island",
  "circuit_short_name": "Yas Marina Circuit",
  "date_start": "2025-12-07T13:00:00+00:00"
}
```

## `core.session_drivers`

- Type: driver projection view
- Purpose: app-friendly roster table
- Row count: 1,551
- Best use:
  - driver lookup within a session
  - compare-driver flows
  - chat context resolution

Sample:

```json
{
  "session_key": 9839,
  "driver_number": 1,
  "full_name": "Max VERSTAPPEN",
  "team_name": "Red Bull Racing",
  "country_code": null,
  "broadcast_name": "M VERSTAPPEN"
}
```

## `core.driver_dim`

- Type: deduplicated driver dimension
- Purpose: app-wide driver lookup
- Row count: 33
- Caveat:
  - this is a latest-row-per-`driver_number` projection
  - `driver_number` is not a timeless universal driver identity across all eras

Sample:

```json
{
  "driver_number": 1,
  "full_name": "Lando NORRIS",
  "first_name": "Lando",
  "last_name": "Norris",
  "name_acronym": "NOR",
  "country_code": null
}
```

## Best Tables by Question Type

Use this as a routing hint for another LLM.

| Question type | Best starting table(s) |
|---|---|
| Session search / find race | `core.sessions` |
| Driver roster | `core.session_drivers`, `raw.drivers` |
| Fastest lap / lap pace | `raw.laps` |
| Pit strategy | `raw.pit`, `raw.stints` |
| Weather changes | `raw.weather` |
| Race events / flags | `raw.race_control` |
| Position changes | `raw.position_history` |
| Gap to leader / intervals | `raw.intervals` |
| Telemetry speed/brake/throttle | `raw.car_data` |
| Track map / spatial trace | `raw.location` |
| Data freshness / ingestion debugging | `raw.ingestion_runs`, `raw.ingestion_files` |

## Recommended Guardrails for Another LLM

- Always resolve a session first when the question references a race, GP, venue, year, or weekend.
- Prefer `session_key` over text filters once a session has been identified.
- Prefer `core.sessions` and `core.session_drivers` for search and lookup.
- Use raw telemetry tables only after strong narrowing.
- Do not assume `meeting_name` is populated.
- Do not assume `session_result`, `starting_grid`, `overtakes`, or championship tables are available in this local load.
- When answering, state the grain clearly:
  - session
  - driver-session
  - lap
  - stint
  - telemetry point

## Suggested Prompt Wrapper for Another LLM

Use this document together with an instruction like:

```text
You are helping analyze an OpenF1 PostgreSQL warehouse.

Use the attached markdown document as the schema and semantic source of truth. The hardest part is not just SQL syntax, but entity resolution and choosing the right grain. Before writing SQL, identify which session, driver, or venue the user is referring to. Prefer resolved IDs such as session_key over fuzzy text filters whenever possible.

Only generate read-only PostgreSQL queries. Explain what tables you are using, what assumptions you are making, and whether the available data is complete enough to support the conclusion.
```

## Final Recommendation

If this warehouse is going to power an analyst-chat product, the most important next step is not more prompting. It is a small semantic resolution layer, likely centered around:

- `core.session_search`
- `core.driver_search`
- derived session aliases
- venue synonym handling
- a resolver that turns plain text into canonical IDs before SQL generation

That will do more for accuracy than asking a larger model to guess better from raw table names alone.
