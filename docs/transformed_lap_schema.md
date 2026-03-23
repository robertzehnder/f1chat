# Transformed Lap Schema

This document defines the formal semantic lap contract now implemented in SQL.

## Core objects

- `core.compound_alias_lookup`
  - Canonical mapping from raw compound values to normalized compound families.
- `core.valid_lap_policy`
  - Versioned and configurable lap hygiene policy.
- `core.metric_registry`
  - Canonical registry for semantic metrics and their definitions.
- `core.lap_semantic_bridge`
  - Cross-table bridge view that aligns lap, stint, pit, position, and flag context at lap grain.
- `core.laps_enriched`
  - Primary transformed-lap contract view for analytics and downstream query templates.
- `core.replay_contract_registry`
  - Versioned metadata contract for replay consumers.
- `core.replay_lap_frames`
  - Intermediate replay frame view at lap grain.

## `core.laps_enriched` contract

### Identity fields

- `session_key`
- `meeting_key`
- `year`
- `session_name`
- `session_type`
- `driver_number`
- `lap_number`

### Context fields

- `driver_name`
- `team_name`
- `country_name`
- `location`
- `circuit_short_name`
- `lap_start_ts`
- `lap_end_ts`
- `stint_number`
- `compound_raw`
- `compound_name`
- `is_slick`
- `tyre_age_at_start`
- `tyre_age_on_lap`
- `is_pit_out_lap`
- `is_pit_lap`
- `pit_duration`
- `position_end_of_lap`
- `track_flag`

### Policy fields

- `validity_policy_key`
- `validity_rule_version`
- `is_valid`
- `invalid_reason`

### Pace and derived metric fields

- `lap_duration`
- `duration_sector_1`
- `duration_sector_2`
- `duration_sector_3`
- `is_personal_best_proxy`
- `rep_lap_session`
- `fastest_valid_lap`
- `lap_rep_time`
- `delta_to_rep`
- `pct_from_rep`
- `delta_to_fastest`
- `pct_from_fastest`
- `delta_to_lap_rep`
- `pct_from_lap_rep`
- `fuel_adj_lap_time` (experimental)

## Valid-lap policy behavior (default v1)

The default policy (`openf1_semantic` v1) marks a lap valid when:

- `lap_duration` is in bounds (`50` to `200` seconds)
- lap is not pit-out
- lap is not pit-in
- all three sectors are present and positive
- compound is known
- compound is slick

This intentionally prioritizes clean-lap pace analysis and is versioned for future revisions.

## Replay intermediate contract

`core.replay_lap_frames` exposes lap-indexed frame rows with:

- frame identity (`session_key`, `meeting_key`, `lap_number`, `frame_time`)
- race progression (`leader_driver_number`, `leader_position`)
- pace summary (`best_valid_lap_on_lap`, `avg_valid_lap_on_lap`)
- environmental overlays (`weather_track_temperature`, `weather_air_temperature`)
- event signal (`race_control_flag`)

This is a stable intermediate contract for future stream or UI replay consumers.
