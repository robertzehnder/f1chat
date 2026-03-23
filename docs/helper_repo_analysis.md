# Helper Repo Analysis

This note reviews the two helper repos under `openf1/helper-repos` and identifies what is most worth adopting into `openf1`.

## Executive Summary

The two repos help in different ways:

- `Armchair-Strategist` is the better source for **analytics semantics** and **derived lap metrics**.
- `f1-race-replay` is the better source for **replay architecture**, **telemetry frame design**, and **multi-window insight patterns**.

For the current `openf1` repo, the highest-value adoption path is:

1. Add an enriched lap analytics surface based on the `Armchair-Strategist` transformed-lap ideas.
2. Keep replay-oriented ideas from `f1-race-replay` in a second wave, after the core analytics layer is stronger.

## Repo-by-Repo Assessment

### 1. `Armchair-Strategist`

Best use: semantic contract and derivation logic.

Most useful source files:

- `helper-repos/Armchair-Strategist/SCHEMA.md`
- `helper-repos/Armchair-Strategist/f1_visualization/preprocess.py`
- `helper-repos/Armchair-Strategist/f1_visualization/consts.py`

What is worth taking:

- A clear distinction between raw lap data and transformed/enriched lap data.
- A derived lap model with strong analytical fields:
  - `IsSlick`
  - `CompoundName`
  - `IsValid`
  - `DeltaToRep`, `PctFromRep`
  - `DeltaToFastest`, `PctFromFastest`
  - `DeltaToLapRep`, `PctFromLapRep`
  - `FuelAdjLapTime`
- Compound normalization logic and season-aware compound interpretation.
- A policy mindset for lap validity and representative pace, rather than ad hoc per-query logic.

Why it fits `openf1` well:

- `openf1` already has a `raw + core` model, so these ideas belong naturally in a `core.laps_enriched` view or materialized table.
- We already added portability notes in `f1_codex_helpers/lap_semantics_portability.*`, so this repo confirms the next implementation targets rather than changing direction.

What not to take directly:

- FastF1 ingestion/loading code.
- CSV-first storage conventions.
- Dashboard app structure.

Why not:

- `openf1` is already centered on PostgreSQL-backed canonical tables.
- Direct code copy would pull FastF1 assumptions into an OpenF1 warehouse project.

### 2. `f1-race-replay`

Best use: replay product architecture and telemetry consumption patterns.

Most useful source files:

- `helper-repos/f1-race-replay/telemetry.md`
- `helper-repos/f1-race-replay/src/services/stream.py`
- `helper-repos/f1-race-replay/src/gui/pit_wall_window.py`
- `helper-repos/f1-race-replay/roadmap.md`

What is worth taking:

- A concrete telemetry frame contract for downstream consumers.
- A simple local stream server/client model for broadcasting session frames.
- A modular "pit wall" pattern where multiple insight windows consume the same live replay stream.
- Good product thinking around:
  - race progression replay
  - track position views
  - telemetry comparison windows
  - weather overlays
  - event/status overlays

Why it fits `openf1` later:

- `openf1` already stores the raw ingredients needed for replay-style products:
  - `raw.location`
  - `raw.car_data`
  - `raw.position_history`
  - `raw.weather`
  - `raw.race_control`
- If the repo grows toward a local analysis app or richer web UI, this repo provides strong inspiration for the runtime data contract.

What not to take directly:

- PySide/Arcade desktop UI implementation.
- FastF1 session-loading code.
- Any rendering-specific assumptions.

Why not:

- `openf1` is currently a database and web-oriented project, not a desktop replay app.
- The reusable part is the architecture and data model, not the GUI stack.

## Concrete Recommendations For `openf1`

### Priority 1: Take from `Armchair-Strategist` now

Implement these as first-class analytics surfaces:

1. `core.laps_enriched`
2. `core.valid_lap_policy`
3. `core.compound_alias_lookup` or equivalent normalized compound mapping

Recommended fields for `core.laps_enriched`:

- identifiers: `session_key`, `meeting_key`, `driver_number`, `lap_number`
- joins/context: driver name, team name, session type, stint number, compound
- policy fields: `is_slick`, `is_valid`, `validity_rule_version`
- pace fields: `delta_to_rep`, `pct_from_rep`, `delta_to_fastest`, `pct_from_fastest`
- lap-context fields: `delta_to_lap_rep`, `pct_from_lap_rep`
- experimental field: `fuel_adj_lap_time`

Important caveat:

- `IsAccurate` does not have strict OpenF1 parity today, so `IsValid` should be versioned and documented as an approximation unless a stronger signal is introduced.

### Priority 2: Use `Armchair-Strategist` to improve query quality

Use these semantics to support better chat/database answers for:

- clean-lap pace
- representative race pace
- stint degradation
- pace vs tire age
- fastest-lap context
- lap-by-lap relative performance

This should materially improve answer quality for benchmark questions that currently fall back to generic lap averages.

### Priority 3: Borrow replay patterns from `f1-race-replay` later

If `openf1` grows into a richer app, add:

1. a derived replay frame builder from warehouse tables
2. a local stream endpoint for live/replay frame broadcast
3. modular insight consumers for telemetry, track map, and strategy panes

This is valuable, but it should come after the analytical semantics layer because the replay layer will be much better if it sits on top of cleaner enriched data.

## Suggested Adoption Order

### Phase A: Analytics semantics

- Build `core.laps_enriched`
- Add a validity-policy table/config
- Add representative pace metrics
- Add compound normalization support

### Phase B: Higher-level summaries

- Add driver/session pace summary views
- Add stint summary and strategy summary views
- Add grid-vs-finish and race progression helper views

### Phase C: Replay/runtime layer

- Define a replay frame JSON contract
- Generate timeline frames from warehouse tables
- Expose a simple streaming interface
- Build UI consumers only after the contract is stable

## Bottom Line

If the goal is to best assist `openf1` right now:

- take **semantics and derived metrics** from `Armchair-Strategist`
- take **runtime/replay architecture ideas** from `f1-race-replay`
- do **not** directly import either repo's application stack

The strongest immediate payoff is to turn `openf1` into a better lap-analysis warehouse before turning it into a replay product.
