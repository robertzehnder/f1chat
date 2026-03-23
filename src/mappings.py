"""Table mapping and ingestion metadata for OpenF1 CSV ingestion."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TableSpec:
    table: str
    conflict_columns: tuple[str, ...]
    timestamp_columns: tuple[str, ...] = ()


# Filename/endpoint -> raw table
FILE_TO_TABLE: dict[str, str] = {
    "meetings": "meetings",
    "sessions": "sessions",
    "sessions_index": "sessions",
    "race_sessions_index": "sessions",
    "session_metadata": "sessions",
    "drivers": "drivers",
    "laps": "laps",
    "car_data": "car_data",
    "location": "location",
    "intervals": "intervals",
    "pit": "pit",
    "position": "position_history",
    "position_history": "position_history",
    "race_control": "race_control",
    "session_result": "session_result",
    "starting_grid": "starting_grid",
    "stints": "stints",
    "team_radio": "team_radio",
    "weather": "weather",
    "overtakes": "overtakes",
    "championship_drivers": "championship_drivers",
    "championship_teams": "championship_teams",
}


TABLE_SPECS: dict[str, TableSpec] = {
    "meetings": TableSpec("meetings", ("meeting_key",), ("date_start",)),
    "sessions": TableSpec("sessions", ("session_key",), ("date_start", "date_end")),
    "drivers": TableSpec("drivers", ("session_key", "driver_number"), ()),
    "laps": TableSpec("laps", ("session_key", "driver_number", "lap_number"), ("date_start",)),
    "pit": TableSpec("pit", ("session_key", "driver_number", "lap_number", "date"), ("date",)),
    "stints": TableSpec("stints", ("session_key", "driver_number", "stint_number"), ()),
    "team_radio": TableSpec(
        "team_radio", ("session_key", "driver_number", "date", "recording_url"), ("date",)
    ),
    "race_control": TableSpec(
        "race_control", ("session_key", "date", "category", "driver_number", "message"), ("date",)
    ),
    "weather": TableSpec("weather", ("session_key", "date"), ("date",)),
    "session_result": TableSpec("session_result", ("session_key", "driver_number"), ()),
    "starting_grid": TableSpec("starting_grid", ("session_key", "driver_number"), ()),
    "overtakes": TableSpec(
        "overtakes", ("session_key", "date", "overtaker_driver_number", "overtaken_driver_number"), ("date",)
    ),
    "championship_drivers": TableSpec("championship_drivers", ("session_key", "driver_number"), ()),
    "championship_teams": TableSpec("championship_teams", ("session_key", "team_name"), ()),
    "car_data": TableSpec("car_data", ("session_key", "driver_number", "date"), ("date",)),
    "location": TableSpec("location", ("session_key", "driver_number", "date"), ("date",)),
    "intervals": TableSpec("intervals", ("session_key", "driver_number", "date"), ("date",)),
    "position_history": TableSpec(
        "position_history", ("session_key", "driver_number", "date"), ("date",)
    ),
}


# Load order: dimensions first, then events, then heavy telemetry.
LOAD_ORDER: list[str] = [
    "meetings",
    "sessions",
    "drivers",
    "starting_grid",
    "session_result",
    "championship_teams",
    "championship_drivers",
    "race_control",
    "weather",
    "team_radio",
    "laps",
    "pit",
    "stints",
    "overtakes",
    "intervals",
    "position_history",
    "location",
    "car_data",
]
