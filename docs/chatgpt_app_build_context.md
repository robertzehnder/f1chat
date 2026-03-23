# OpenF1 App Build Context

Use this document as high-detail context for generating a web app build spec, product requirements, UX flows, data access patterns, or agent behavior for an OpenF1 analytics application.

## Product Goal

Build a web app for exploratory analysis of Formula 1 data stored in PostgreSQL.

The app should combine:

- A data explorer UI for browsing tables, filters, and joins in tabular form.
- Rich race/session/driver exploration views.
- A conversational LLM-style analyst panel that can answer questions about the data, generate SQL-like analyses, summarize findings, compare drivers/sessions, and explain results in plain language.
- A workflow that feels like a human analyst replacement for ad hoc SQL work, but with strong grounding in the actual schema and actual data.

The app is not only a dashboard. It is an interactive analysis environment over a structured motorsport data warehouse.

### Primary User Types

The product should be designed for more than one kind of user:

- Data-oriented F1 fans who want to explore sessions, compare drivers, and inspect telemetry without writing SQL.
- Analysts or technical users who want transparent SQL-backed exploration with strong schema grounding.
- Product-builder / solo developer workflows where the app doubles as both a research surface and a debugging surface for the underlying warehouse.

This means the UX should support both guided exploration and expert-style drill-down.

## Current Data Platform

The database is PostgreSQL with a `raw` schema and a `core` schema.

- `raw` contains imported OpenF1 data with source-like field names and high fidelity.
- `core` contains app-friendly views for relational browsing and future semantic modeling.

This design is meant to migrate cleanly to Supabase later.

## Non-Goals

To keep the app focused, the following are not primary goals for the first versions:

- Real-time race timing or live telemetry streaming.
- Fantasy or betting workflows.
- Social/community features.
- General F1 news aggregation.
- Manual data editing of warehouse records from the UI.
- Unbounded autonomous agent behavior.

The app is primarily a read-oriented analytics and exploration environment over historical OpenF1 data.

## What Data Exists

The database currently contains OpenF1-derived historical race data across multiple seasons.

Observed scale snapshot at time of validation:

- `raw.sessions`: 95 rows
- `raw.drivers`: 1,551 rows
- `raw.laps`: 79,299 rows
- `raw.intervals`: 1,714,299 rows
- `raw.car_data`: 50,504,592 rows
- `raw.location`: 51,770,819 rows

Data quality findings from validation:

- No orphan `drivers.session_key` values relative to `raw.sessions`.
- No orphan `intervals.session_key` values relative to `raw.sessions`.
- No duplicate logical telemetry keys where `date IS NOT NULL` for:
  - `raw.intervals`
  - `raw.location`
  - `raw.car_data`
  - `raw.position_history`
- Some telemetry/event tables contain a small number of rows where `date IS NULL`.
- Some future or placeholder sessions exist in `raw.sessions` and may have session rows and drivers but zero telemetry/event rows.
- Certain OpenF1 source sessions can be sparse or unavailable; the app should not assume every session has complete data across all tables.

## Success Criteria

The app should be considered successful if an end user can:

- Find a session quickly.
- Understand what data is available for that session.
- Compare drivers without needing SQL.
- Ask a natural-language question and receive a grounded answer with evidence.
- Inspect the supporting rows, chart, and query logic behind the answer.
- Move fluidly between structured browsing and conversational analysis.

Operational success criteria:

- Telemetry-heavy views should remain responsive through filtering, previewing, sampling, and server-side query limits.
- The LLM layer should reduce ad hoc SQL effort, not obscure the underlying data.
- Users should be able to tell when an answer is based on complete data versus sparse or incomplete data.

## App Intent

The app should let a user do all of the following without writing SQL directly:

- Browse meetings, sessions, drivers, laps, telemetry, and event data.
- Filter by year, country, circuit, meeting, session, driver, team, lap range, and time range.
- Compare drivers within a session.
- Compare sessions across years at the same venue.
- Inspect telemetry in both tabular and chart form.
- Ask natural-language questions such as:
  - "Show me Verstappen's lap time trend in Suzuka 2025."
  - "Compare top speed and throttle traces for the top 3 finishers."
  - "Which sessions have missing telemetry?"
  - "Find races where weather changed mid-session and summarize the impact."
  - "Explain why this driver lost places after lap 35."
- Generate derived insights that combine multiple tables.

## MVP Scope vs Later Phases

### MVP

The MVP should focus on:

- Session browser
- Session detail pages
- Driver-in-session detail pages
- Telemetry explorer with charting for a bounded set of metrics
- Read-only analyst chat with SQL transparency
- Saved analyses / saved query presets
- Session completeness indicators
- Export for result tables

### Phase 2

Potential expansion areas:

- Cross-session benchmark workspaces
- Team and season summary pages
- User-defined dashboards
- Heavier semantic modeling in `core`
- Cached derived metrics and aggregate tables
- More advanced replay-style track visualizations
- LLM-generated comparison narratives or report exports

### Phase 3

Longer-term possibilities:

- Multi-user collaboration
- Shareable notebooks / analysis documents
- Alerting on anomalies or pattern matches across seasons
- Fine-tuned semantic layer for motorsport-specific analytics workflows

## Recommended Interaction Model

The app should expose two complementary modes:

### 1. Structured Explorer

This mode is for users who want confidence and visibility:

- Table browser
- Schema browser
- Filters
- Sort
- Pagination / virtualization
- Saved views
- Linked drill-down
- CSV export
- Session and driver detail pages

### 2. Analyst Chat

This mode is for natural-language analysis:

- User asks analytical questions in plain English.
- The LLM is grounded in the schema and available metrics.
- The system can generate SQL or semantic query plans behind the scenes.
- The app returns:
  - natural language answer
  - supporting tabular result
  - charts where helpful
  - the actual SQL or query explanation for transparency

Important: the chat should be treated as an analysis assistant, not a freeform chatbot disconnected from the data.

### Cross-Mode Workflow Expectation

The app should support a workflow where a user can:

- Start in structured explorer mode
- Narrow to a session, driver, lap range, or time range
- Send the current state into analyst chat as context
- Receive a grounded answer with supporting SQL and results
- Pivot the answer back into a chart, table, or saved analysis

The two modes should feel tightly linked, not like separate products.

## Schema Overview

### Schemas

- `raw`
- `core`

### Important Conceptual Entities

- Meeting: a race weekend / grand prix event context.
- Session: a specific event instance such as Race, Qualifying, Sprint, etc. In this dataset, the main ingestion focus is Race sessions.
- Session driver: a driver participating in a specific session.
- Telemetry/event fact tables: high-volume records tied to session and usually driver.

### High-Level Relationships

- One `meeting` has many `sessions`.
- One `session` has many `drivers`.
- One `session` has many laps, telemetry rows, and event rows.
- Most high-volume tables use `session_key` and often `driver_number` as their practical join backbone.

## Important Identifiers

These identifiers are central to the app and should be first-class in any API and UI design:

- `meeting_key`: external meeting identifier from OpenF1
- `session_key`: external session identifier from OpenF1
- `driver_number`: car number / driver number within a session

The app should treat `session_key` as the most common query anchor.

## Additional Derived Concepts the App Should Support

The app should support derived concepts even when they are not stored as explicit source tables:

- Session completeness score
- Position gained vs starting grid
- Pit window and undercut / overcut framing
- Lap-time degradation trends
- Safety car / VSC / flag windows
- Driver stint summaries
- Weather regime changes
- Telemetry comparisons over aligned lap traces

These can be delivered initially through derived queries and later through materialized views or precomputed summary tables.

## Table Catalog

Below is the current schema-level interpretation of the main tables.

### `raw.meetings`

Purpose:

- Stores one row per meeting / grand prix weekend context.

Grain:

- One row per `meeting_key`

Important fields:

- `meeting_key`
- `meeting_name`
- `meeting_official_name`
- `year`
- `country_key`
- `country_code`
- `country_name`
- `location`
- `circuit_key`
- `circuit_short_name`
- `date_start`
- `gmt_offset`

Common app uses:

- Season schedule browsing
- Grouping sessions by weekend
- Venue-based analysis
- Cross-year circuit comparisons

### `raw.sessions`

Purpose:

- Stores one row per session.

Grain:

- One row per `session_key`

Important fields:

- `session_key`
- `meeting_key`
- `session_name`
- `session_type`
- `session_number`
- `date_start`
- `date_end`
- `gmt_offset`
- `year`
- `country_name`
- `location`
- `circuit_short_name`

Common app uses:

- Main entry point for browsing races
- Session selector
- Join base for all event/telemetry analysis

Important note:

- Some future sessions may exist with low completeness.
- The app should surface completeness, not assume every session has all downstream data.

### `raw.drivers`

Purpose:

- Session-specific driver participation data.

Grain:

- Practical uniqueness on `(session_key, driver_number)`

Important fields:

- `session_key`
- `meeting_key`
- `driver_number`
- `broadcast_name`
- `full_name`
- `first_name`
- `last_name`
- `name_acronym`
- `team_name`
- `team_colour`
- `country_code`
- `headshot_url`

Common app uses:

- Driver roster for a session
- Driver detail panel
- Team grouping
- Driver comparison UI

Important note:

- Driver identity is stored session-by-session.
- The `core.driver_dim` view provides a deduplicated driver dimension by `driver_number`.

### `raw.laps`

Purpose:

- Lap-level timing and sector data for drivers.

Grain:

- Practical uniqueness on `(session_key, driver_number, lap_number)`

Important fields:

- `session_key`
- `meeting_key`
- `driver_number`
- `lap_number`
- `i1_speed`
- `i2_speed`
- `st_speed`
- `is_pit_out_lap`
- `duration_sector_1`
- `duration_sector_2`
- `duration_sector_3`
- `lap_duration`
- `date_start`
- `segments_sector_1`
- `segments_sector_2`
- `segments_sector_3`

Common app uses:

- Lap table browser
- Lap time trend chart
- Sector comparison
- Pace analysis
- Pit out identification

### `raw.pit`

Purpose:

- Pit stop events and duration.

Grain:

- Practical uniqueness on `(session_key, driver_number, lap_number, date)`

Important fields:

- `session_key`
- `driver_number`
- `lap_number`
- `pit_duration`
- `date`

Common app uses:

- Pit stop strategy analysis
- Undercut / overcut investigation
- Pit stop timing tables

### `raw.stints`

Purpose:

- Tire stint metadata.

Grain:

- Practical uniqueness on `(session_key, driver_number, stint_number)`

Important fields:

- `session_key`
- `driver_number`
- `stint_number`
- `lap_start`
- `lap_end`
- `compound`
- `tyre_age_at_start`
- `fresh_tyre`

Common app uses:

- Strategy overlays
- Tire life analysis
- Stint-by-stint session summaries

### `raw.team_radio`

Purpose:

- Team radio clip references for a session and driver.

Grain:

- Practical uniqueness on `(session_key, driver_number, date, recording_url)`

Important fields:

- `session_key`
- `driver_number`
- `date`
- `recording_url`

Common app uses:

- Event timeline enrichment
- Explain strategy changes or incidents
- Link audio moments to telemetry windows

### `raw.race_control`

Purpose:

- Official race control messages and control events.

Grain:

- Practical uniqueness on `(session_key, date, category, driver_number, message)`

Important fields:

- `session_key`
- `date`
- `category`
- `flag`
- `scope`
- `sector`
- `lap_number`
- `driver_number`
- `message`

Common app uses:

- Timeline of race events
- Safety car / yellow flag context
- Incident correlation with pace and position changes

### `raw.weather`

Purpose:

- Time-series environmental data during the session.

Grain:

- Practical uniqueness on `(session_key, date)`

Important fields:

- `session_key`
- `date`
- `air_temperature`
- `track_temperature`
- `humidity`
- `pressure`
- `rainfall`
- `wind_direction`
- `wind_speed`

Common app uses:

- Weather timeline
- Wet/dry transition analysis
- Environmental context for performance changes

### `raw.session_result`

Purpose:

- Final or official classification/result rows.

Grain:

- Practical uniqueness on `(session_key, driver_number)`

Important fields:

- `session_key`
- `driver_number`
- `position`
- `points`
- `status`
- `classified`

Common app uses:

- Final classification table
- Result cards
- Linking finishing order to telemetry and laps

### `raw.starting_grid`

Purpose:

- Starting grid positions.

Grain:

- Practical uniqueness on `(session_key, driver_number)`

Important fields:

- `session_key`
- `driver_number`
- `grid_position`

Common app uses:

- Compare start vs finish
- Position gained/lost analysis

### `raw.overtakes`

Purpose:

- Recorded overtaking events.

Grain:

- Practical uniqueness on `(session_key, date, overtaker_driver_number, overtaken_driver_number)`

Important fields:

- `session_key`
- `date`
- `lap_number`
- `overtaker_driver_number`
- `overtaken_driver_number`

Common app uses:

- Overtake timelines
- Aggression / racecraft summaries
- Incident and strategy context

### `raw.championship_drivers`

Purpose:

- Driver championship standings snapshots tied to session context.

Grain:

- Practical uniqueness on `(session_key, driver_number)`

Important fields:

- `session_key`
- `driver_number`
- `position`
- `points`
- `wins`

Common app uses:

- Standings panels
- Season progression views

### `raw.championship_teams`

Purpose:

- Team championship standings snapshots tied to session context.

Grain:

- Practical uniqueness on `(session_key, team_name)`

Important fields:

- `session_key`
- `team_name`
- `position`
- `points`
- `wins`

Common app uses:

- Constructors standings view
- Team season summaries

### `raw.car_data`

Purpose:

- High-volume per-driver telemetry.

Grain:

- Practical uniqueness on `(session_key, driver_number, date)`

Important fields:

- `session_key`
- `driver_number`
- `date`
- `rpm`
- `speed`
- `n_gear`
- `throttle`
- `brake`
- `drs`

Common app uses:

- Telemetry trace plotting
- Straight-line speed analysis
- Brake/throttle overlays
- Gear usage studies
- DRS behavior investigation

Important note:

- This is one of the largest tables.
- The app should never default to loading full-session raw telemetry into the browser without narrowing filters.

### `raw.location`

Purpose:

- High-volume spatial telemetry.

Grain:

- Practical uniqueness on `(session_key, driver_number, date)`

Important fields:

- `session_key`
- `driver_number`
- `date`
- `x`
- `y`
- `z`

Common app uses:

- Track map traces
- Position-on-track visualization
- Replay-style charts
- Sector and racing line exploration

Important note:

- This table is also extremely large.
- The UI should use aggressive filtering, pagination, or server-side aggregation.

### `raw.intervals`

Purpose:

- Relative time gap / interval history.

Grain:

- Practical uniqueness on `(session_key, driver_number, date)` when `date` is populated

Important fields:

- `session_key`
- `driver_number`
- `date`
- `interval`
- `gap_to_leader`

Common app uses:

- Gap-to-leader plots
- Interval trend charts
- Race evolution summaries

Important note:

- Some rows can have `date IS NULL`.
- App logic should distinguish between fully keyed interval rows and partial source rows.

### `raw.position_history`

Purpose:

- Time-series position changes for drivers.

Grain:

- Practical uniqueness on `(session_key, driver_number, date)` when `date` is populated

Important fields:

- `session_key`
- `driver_number`
- `date`
- `position`

Common app uses:

- Position change charts
- Overtake context
- Race flow storytelling

## Core Views

### `core.meetings`

- Direct view over `raw.meetings`
- Good default for UI listing pages

### `core.sessions`

- Joins sessions to meeting context
- Adds:
  - `meeting_name`
  - `meeting_country_name`
  - `meeting_circuit_short_name`

Recommended default session browser source.

### `core.session_drivers`

- Session-level driver projection
- Good for roster and selector UIs

### `core.driver_dim`

- Deduplicated driver dimension using latest available row per `driver_number`
- Useful for app-wide driver search and identity display

## Missing Data and Completeness Modeling

Because OpenF1 coverage is uneven across sessions and endpoints, the app should treat completeness as a first-class concept.

Recommended derived completeness signals per `session_key`:

- has_drivers
- has_laps
- has_intervals
- has_position_history
- has_car_data
- has_location
- has_weather
- has_race_control
- has_pit
- has_stints
- has_team_radio
- has_session_result
- row counts for each major table
- first and last observed timestamp for each time-series table

Recommended product behavior:

- Show completeness badges in session lists and session detail pages.
- Warn users when they ask analyst-chat questions against sparse sessions.
- Let users filter for sessions with complete telemetry coverage.

## Recommended App Information Architecture

### Main Navigation Areas

- Home
- Seasons
- Meetings / Grand Prix weekends
- Sessions
- Drivers
- Teams
- Telemetry Explorer
- Analyst Chat
- Saved Analyses
- Data Catalog / Schema Explorer
- Admin / Data Health

### Primary Screens

#### Session Browser

- Filter by year, country, circuit, session type
- Show completeness indicators
- Link into session detail

#### Session Detail

- Session metadata
- Driver roster
- Result table
- Starting grid vs finish
- Race control timeline
- Weather timeline
- Tabs for laps, intervals, positions, stints, pit, radio

#### Compare Drivers

- Select one session and multiple drivers
- Compare lap times, sector times, stints, position history, and telemetry traces
- Overlay laps or aggregate by lap windows
- Highlight deltas in pace, top speed, braking, throttle application, and tire strategy
- Allow sending the comparison directly into analyst chat for explanation

#### Driver-in-Session Detail

- Driver profile summary
- Lap table
- Stint summary
- Position history
- Gap trend
- Telemetry charts
- Team radio events

#### Telemetry Explorer

- Session selector
- Driver selector
- Time range and lap range filters
- Choose metrics:
  - speed
  - throttle
  - brake
  - rpm
  - gear
  - drs
- Optional track map panel using `location`
- Sampling / downsampling controls
- Aligned-lap comparison mode
- Chart export
- Toggle between raw points and aggregated windows

#### Analyst Chat

- Chat history on left or center
- Result table panel
- SQL / reasoning / source panel
- Quick actions:
  - "compare drivers"
  - "explain race"
  - "find anomalies"
  - "summarize strategy"
  - "show raw SQL"

#### Data Health / Coverage

- Session completeness dashboard
- Table row-count summary
- Missing-data diagnostics
- Telemetry coverage summary by session
- Validation checks and warehouse freshness indicators

## Recommended LLM Behavior

The LLM layer should be grounded and tool-using rather than improvisational.

The model should:

- Use actual schema metadata.
- Prefer `core.*` views for broad exploration and user-friendly joins.
- Use `raw.*` tables when high-fidelity telemetry/event analysis is required.
- Be explicit about filters, assumptions, and grain.
- Show the SQL or a structured query plan for trust.
- Avoid claiming data exists when a session is incomplete.
- Warn when querying huge telemetry ranges without filters.

The model should not:

- Invent columns or tables.
- Mix incompatible grains without explaining the aggregation.
- Assume all sessions are fully populated.
- Run unconstrained full-table telemetry scans by default.

## Recommended LLM Tooling Responsibilities

The analyst assistant should be implemented as a tool-using system, not as a single freeform model call.

Recommended tool responsibilities:

- Schema introspection
- Session and driver lookup
- Safe SQL generation
- SQL validation
- Read-only query execution
- Result summarization
- Chart recommendation
- Missing-data / completeness checks

Recommended answer structure:

- direct answer
- why this answer is supported
- supporting result table or summary rows
- chart recommendation or rendered chart where helpful
- SQL or structured query explanation
- caveats / missing-data notes

## Recommended LLM System Guidance

The following behavioral constraints are desirable for the app's analyst assistant:

- You are a read-only analytics assistant over an OpenF1 PostgreSQL database.
- You may generate SQL, but only `SELECT` queries unless explicitly authorized otherwise.
- Always identify the tables and join keys you rely on.
- Prefer small preview queries before large scans.
- When telemetry tables are involved, require a session and preferably driver/time filter.
- If data is incomplete or missing, say that clearly.
- When possible, return:
  - short answer
  - supporting table
  - query used
  - caveats
- When possible, ask clarifying follow-up questions only when a user query is materially ambiguous.
- Prefer returning preview results before recommending broader scans.
- When comparing drivers, make the comparison grain explicit: lap, stint, telemetry window, or session summary.
- Distinguish clearly between observed facts, derived metrics, and interpretive conclusions.

## Recommended Query Patterns

### Good Default Join Keys

- `sessions.meeting_key = meetings.meeting_key`
- `drivers.session_key = sessions.session_key`
- `laps.session_key = sessions.session_key`
- `laps.session_key + driver_number` to `drivers`
- `car_data.session_key + driver_number` to `drivers`
- `location.session_key + driver_number` to `drivers`
- `intervals.session_key + driver_number` to `drivers`
- `position_history.session_key + driver_number` to `drivers`

### Important Query Guardrails

- Always filter telemetry by `session_key`.
- Prefer also filtering telemetry by `driver_number`.
- For browser tables, paginate large result sets.
- For charts, aggregate or window when appropriate.

## Recommended Derived Views and Aggregates

The app will likely benefit from a small library of prebuilt derived views or materialized views.

Recommended candidates:

- `core.session_completeness`
- `core.driver_session_summary`
- `core.session_result_enriched`
- `core.grid_vs_finish`
- `core.weather_timeline`
- `core.race_control_timeline`
- `core.stint_summary`
- `core.lap_pace_summary`

Purpose:

- simplify common UI queries
- reduce repeated join logic
- improve analyst-chat grounding
- avoid unnecessary direct scans of the largest raw tables

## Performance and UX Constraints

The app must respect the size of telemetry tables.

Recommended behavior:

- Use server-side pagination for all raw table explorers.
- Limit default rows returned.
- Introduce sampled previews for telemetry.
- Cache common session summaries.
- Consider precomputed aggregates for:
  - lap summaries
  - session completeness
  - driver/session overview cards
  - weather and race-control timelines

## API and Route Design Suggestions

Suggested frontend route structure:

- `/`
- `/sessions`
- `/sessions/:sessionKey`
- `/sessions/:sessionKey/drivers/:driverNumber`
- `/compare?sessionKey=...&drivers=...`
- `/telemetry`
- `/chat`
- `/catalog`
- `/saved`
- `/admin/data-health`

Suggested backend API surface:

- `GET /api/schema`
- `GET /api/sessions`
- `GET /api/sessions/:sessionKey`
- `GET /api/sessions/:sessionKey/completeness`
- `GET /api/sessions/:sessionKey/drivers`
- `GET /api/sessions/:sessionKey/laps`
- `GET /api/sessions/:sessionKey/telemetry`
- `GET /api/sessions/:sessionKey/weather`
- `GET /api/sessions/:sessionKey/race-control`
- `POST /api/query/preview`
- `POST /api/query/run`
- `POST /api/chat`
- `GET /api/saved-analyses`

## Data Quality and Source Caveats

The app should surface these realities to users:

- Some future sessions exist as schedule/session placeholders with zero downstream data.
- Some tables can contain rows with `date IS NULL`.
- Source completeness can vary by session and endpoint.
- Telemetry and event completeness is not identical across all sessions.

Recommended UI pattern:

- Add completeness badges per session:
  - drivers loaded
  - laps loaded
  - intervals loaded
  - telemetry loaded
  - weather loaded
  - race control loaded

## Suggested Backend Capabilities

The app backend should ideally provide:

- Schema metadata endpoint
- Table preview endpoint
- Saved query endpoint
- Read-only SQL execution service with safety checks
- LLM tool layer for:
  - schema introspection
  - SQL execution
  - result summarization
  - chart recommendation

## Backend Query and Safety Model

The backend should use a constrained read-only query layer.

Recommended principles:

- Only allow read-only execution for analyst-facing queries.
- Add query timeout limits.
- Add row-return limits for previews.
- Require explicit narrowing for telemetry-heavy scans.
- Log generated queries, execution time, and row counts.
- Support cancellation for long-running queries.
- Maintain a clear separation between user prompt, generated query, executed query, and summarized answer.

Recommended backend components:

- Metadata service for schema and column descriptions
- Query planner / validator for LLM-generated SQL
- Read-only SQL execution service
- Result formatter for tables and chart-ready series
- Audit/logging layer for query observability

## Suggested Frontend Capabilities

The app frontend should ideally support:

- Global filters
- Linked table selection
- Session detail routes
- Driver detail routes
- Tabular browsing with column visibility control
- Time-series charts
- Track map rendering
- Side-by-side comparisons
- Chat + result panes
- Export of query results

## Frontend UX and Visualization Guidance

Recommended chart types:

- Lap time line charts
- Gap-to-leader line charts
- Position-over-time step charts
- Speed / throttle / brake telemetry line charts
- Stint bars by lap range and compound
- Weather timeline overlays
- Race-control event timelines
- Scatter plots for pace vs top speed or pace vs tire age

Recommended UX principles:

- Always show the active grain and filters.
- Let users see where chart data came from.
- Keep table, chart, and SQL/query explanation tightly linked.
- Avoid hiding sampling or aggregation choices.
- Make large-query constraints visible, not mysterious.

## Example User Questions the App Should Support

- "Show every lap for Hamilton in Silverstone 2024."
- "Compare lap pace degradation for the top five finishers."
- "Which sessions have the most overtakes?"
- "Show me the weather and race control timeline for Monaco 2025."
- "Who gained the most positions relative to starting grid?"
- "Find sessions where rainfall became true mid-race."
- "Plot speed versus throttle for driver 1 in session 9839."
- "Summarize why the winning driver pulled away after lap 40."

## Additional Questions the App Should Also Support

- `Which race sessions in 2025 have full telemetry for all listed drivers?`
- `Show the sessions with the largest gap between starting grid and finishing order changes.`
- `Compare Verstappen and Norris on lap-time degradation in the final third of the race.`
- `Where did this driver lose the most time relative to the winner?`
- `Which sessions have strong evidence of a safety car materially changing race order?`
- `Show me only the sessions where rainfall or track temperature changed sharply mid-session.`
- `Which drivers gained the most places through pit strategy rather than on-track overtakes?`

## Recommended Technical Architecture Direction

A practical first implementation could use:

- Next.js or React-based frontend
- Server-side API layer for query safety and database access
- PostgreSQL / Supabase as the warehouse backend
- A charting library capable of time-series and overlays
- An LLM orchestration layer with tools for schema, SQL generation, validation, execution, and summarization

Key architectural rule:

The browser should not directly issue unconstrained warehouse queries. The server layer should own query validation, guardrails, and result shaping.

## Suggested Deliverable for App Spec Generation

When using this file with ChatGPT or another LLM, ask it to generate:

- product requirements
- information architecture
- route structure
- page specs
- data-access strategy
- chat analyst UX
- backend API contract
- query safety rules
- telemetry visualization strategy
- MVP scope and phased roadmap

## Suggested Prompt Wrapper

If you want a paste-ready instruction wrapper, use:

\"\"\"
You are helping design a web app for exploring OpenF1 data stored in PostgreSQL.

Use the following schema and data-platform context as the source of truth. Do not invent tables or columns outside this context. The app should be an exploratory analytics product with both a rich tabular UI and an LLM-style chat analyst that can answer questions over the data, run read-only SQL-like analyses, explain results, and help users inspect F1 race/session telemetry and event history.

Design the app as a serious data exploration tool, not a simple dashboard. Optimize for analyst workflows, browsing, comparison, and explainability.
\"\"\"

Paste the rest of this file below that wrapper when generating the build spec.

## Gaps This Document Now Explicitly Covers

This document now also clarifies:

- primary user types
- non-goals
- success criteria
- MVP vs later phases
- completeness modeling
- backend query safety
- route and API suggestions
- derived views and aggregates
- data health UX
- technical architecture direction

These additions are intended to make downstream app spec generation more complete and implementation-ready.

If you want, I can next turn the updated context doc into a polished PRD/app spec sheet with sections like MVP, routes, backend contracts, LLM workflow, and phased roadmap.
