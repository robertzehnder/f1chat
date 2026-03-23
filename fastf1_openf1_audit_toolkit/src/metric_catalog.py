from __future__ import annotations

COMPARISON_THEMES = [
    {
        "theme": "session_presence",
        "description": "Whether both sources contain the same session/event combinations for the audit period.",
    },
    {
        "theme": "driver_roster",
        "description": "Whether both sources agree on participating drivers and team labels.",
    },
    {
        "theme": "lap_counts",
        "description": "Whether both sources agree on lap counts by driver-session.",
    },
    {
        "theme": "best_lap",
        "description": "Whether best-lap values align by driver-session.",
    },
    {
        "theme": "average_lap",
        "description": "Whether average-lap values align by driver-session.",
    },
    {
        "theme": "result_positions",
        "description": "Whether finishing positions align where both sources have result data.",
    },
]
