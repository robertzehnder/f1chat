from __future__ import annotations

import os
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import text

from .db import get_engine


load_dotenv()


def q(engine, sql: str) -> pd.DataFrame:
    with engine.begin() as conn:
        return pd.read_sql(text(sql), conn)


def main():
    report_dir = Path(os.environ.get("REPORT_DIR", "./reports"))
    report_dir.mkdir(parents=True, exist_ok=True)

    openf1_engine = get_engine("OPENF1")
    fastf1_engine = get_engine("FASTF1")

    fast_sessions = q(
        fastf1_engine,
        """
        SELECT year, round_number, event_name, session_name, session_type, session_uid, event_date, session_date
        FROM fastf1_raw.sessions
        WHERE year IN (2023, 2024, 2025)
        """,
    )

    open_sessions = q(
        openf1_engine,
        """
        SELECT year,
               session_key,
               meeting_key,
               COALESCE(meeting_name, country_name || ' ' || location) AS event_name,
               session_name,
               session_type,
               date_start
        FROM core.sessions
        WHERE year IN (2023, 2024, 2025)
        """,
    )

    open_sessions["event_name_norm"] = (
        open_sessions["event_name"].astype(str).str.lower().str.replace("grand prix", "", regex=False).str.replace("  ", " ", regex=False).str.strip()
    )
    fast_sessions["event_name_norm"] = (
        fast_sessions["event_name"].astype(str).str.lower().str.replace("grand prix", "", regex=False).str.replace("  ", " ", regex=False).str.strip()
    )

    session_merge = fast_sessions.merge(
        open_sessions,
        how="outer",
        on=["year", "session_name"],
        suffixes=("_fastf1", "_openf1"),
        indicator=True,
    )
    session_merge.to_csv(report_dir / "session_level_diffs.csv", index=False)

    fast_rosters = q(
        fastf1_engine,
        """
        SELECT s.year, s.event_name, s.session_name, d.driver_number, d.full_name, d.team_name
        FROM fastf1_raw.drivers d
        JOIN fastf1_raw.sessions s ON s.session_uid = d.session_uid
        WHERE s.year IN (2023, 2024, 2025)
        """,
    )
    open_rosters = q(
        openf1_engine,
        """
        SELECT s.year, COALESCE(s.meeting_name, s.country_name || ' ' || s.location) AS event_name,
               s.session_name, d.driver_number, d.full_name, d.team_name
        FROM core.session_drivers d
        JOIN core.sessions s ON s.session_key = d.session_key
        WHERE s.year IN (2023, 2024, 2025)
        """,
    )
    fast_rosters["event_name_norm"] = fast_rosters["event_name"].astype(str).str.lower().str.replace("grand prix", "", regex=False).str.strip()
    open_rosters["event_name_norm"] = open_rosters["event_name"].astype(str).str.lower().str.replace("grand prix", "", regex=False).str.strip()

    roster_compare = (
        fast_rosters.groupby(["year", "event_name_norm", "session_name"])["driver_number"].nunique().reset_index(name="fastf1_driver_count")
        .merge(
            open_rosters.groupby(["year", "event_name_norm", "session_name"])["driver_number"].nunique().reset_index(name="openf1_driver_count"),
            how="outer",
            on=["year", "event_name_norm", "session_name"],
        )
    )
    roster_compare["driver_count_diff"] = roster_compare["fastf1_driver_count"].fillna(0) - roster_compare["openf1_driver_count"].fillna(0)
    roster_compare.to_csv(report_dir / "driver_roster_diffs.csv", index=False)

    fast_lap_metrics = q(
        fastf1_engine,
        """
        SELECT s.year,
               s.event_name,
               s.session_name,
               l.driver_number,
               COUNT(*) AS fastf1_lap_count,
               MIN(l.lap_time_seconds) AS fastf1_best_lap,
               AVG(l.lap_time_seconds) AS fastf1_avg_lap
        FROM fastf1_raw.laps l
        JOIN fastf1_raw.sessions s ON s.session_uid = l.session_uid
        WHERE s.year IN (2023, 2024, 2025)
          AND l.lap_time_seconds IS NOT NULL
        GROUP BY s.year, s.event_name, s.session_name, l.driver_number
        """,
    )
    open_lap_metrics = q(
        openf1_engine,
        """
        SELECT s.year,
               COALESCE(s.meeting_name, s.country_name || ' ' || s.location) AS event_name,
               s.session_name,
               l.driver_number,
               COUNT(*) AS openf1_lap_count,
               MIN(l.lap_duration) AS openf1_best_lap,
               AVG(l.lap_duration) AS openf1_avg_lap
        FROM raw.laps l
        JOIN core.sessions s ON s.session_key = l.session_key
        WHERE s.year IN (2023, 2024, 2025)
          AND l.lap_duration IS NOT NULL
        GROUP BY s.year, event_name, s.session_name, l.driver_number
        """,
    )
    fast_lap_metrics["event_name_norm"] = fast_lap_metrics["event_name"].astype(str).str.lower().str.replace("grand prix", "", regex=False).str.strip()
    open_lap_metrics["event_name_norm"] = open_lap_metrics["event_name"].astype(str).str.lower().str.replace("grand prix", "", regex=False).str.strip()

    lap_compare = fast_lap_metrics.merge(
        open_lap_metrics,
        how="outer",
        on=["year", "event_name_norm", "session_name", "driver_number"],
    )
    lap_compare["lap_count_diff"] = lap_compare["fastf1_lap_count"].fillna(0) - lap_compare["openf1_lap_count"].fillna(0)
    lap_compare["best_lap_diff"] = lap_compare["fastf1_best_lap"] - lap_compare["openf1_best_lap"]
    lap_compare["avg_lap_diff"] = lap_compare["fastf1_avg_lap"] - lap_compare["openf1_avg_lap"]
    lap_compare.to_csv(report_dir / "lap_metric_diffs.csv", index=False)

    summary = pd.DataFrame([
        {
            "theme": "session_presence",
            "fastf1_rows": len(fast_sessions),
            "openf1_rows": len(open_sessions),
            "notes": "Compare session-level event/session coverage across 2023-2025.",
        },
        {
            "theme": "driver_roster",
            "fastf1_rows": len(fast_rosters),
            "openf1_rows": len(open_rosters),
            "notes": "Compare driver participation counts by normalized event/session.",
        },
        {
            "theme": "lap_metrics",
            "fastf1_rows": len(fast_lap_metrics),
            "openf1_rows": len(open_lap_metrics),
            "notes": "Compare lap counts, best laps, and average laps by driver-session.",
        },
    ])
    summary.to_csv(report_dir / "source_audit_summary.csv", index=False)

    md = ["# Source Audit Summary", ""]
    for row in summary.to_dict(orient="records"):
        md.append(f"## {row['theme']}")
        md.append(f"- FastF1 rows: {row['fastf1_rows']}")
        md.append(f"- OpenF1 rows: {row['openf1_rows']}")
        md.append(f"- Notes: {row['notes']}")
        md.append("")
    (report_dir / "source_audit_summary.md").write_text("\n".join(md), encoding="utf-8")
    print(f"Wrote reports to {report_dir}")


if __name__ == "__main__":
    main()
