from __future__ import annotations

THEMES = [
    "session_coverage",
    "session_naming_quality",
    "driver_roster_coverage",
    "driver_team_mapping",
    "lap_timing_quality",
    "sector_timing_quality",
    "pit_and_stint_quality",
    "result_finishing_order_quality",
    "starting_grid_quality",
    "telemetry_usefulness",
    "weather_coverage",
    "race_progression_quality",
    "strategy_analysis_usefulness",
]

USE_CASE_THEME_MAP = {
    "session resolution": ["session_coverage", "session_naming_quality"],
    "clean-lap logic": ["lap_timing_quality", "sector_timing_quality"],
    "pace comparisons": ["lap_timing_quality", "sector_timing_quality", "race_progression_quality"],
    "pit/strategy analysis": ["pit_and_stint_quality", "strategy_analysis_usefulness"],
    "result/final classification": ["result_finishing_order_quality", "starting_grid_quality"],
    "telemetry overlays": ["telemetry_usefulness", "race_progression_quality", "weather_coverage"],
}

NUMERIC_TOLERANCES = {
    "lap_count": 2,
    "best_lap": 0.25,
    "avg_lap": 0.25,
    "sector": 0.15,
    "pit_count": 2,
    "stint_count": 4,
    "result_count": 2,
    "grid_count": 2,
}
