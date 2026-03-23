from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import text

from .db import execute, get_engine
from .logging_utils import setup_logger
from .metric_catalog import NUMERIC_TOLERANCES, THEMES, USE_CASE_THEME_MAP
from .normalization import day_diff, normalize_session_name, normalize_text, parse_bool, parse_csv_list


load_dotenv()
logger = setup_logger("compare_fastf1_openf1")


def q(engine, sql: str) -> pd.DataFrame:
    with engine.begin() as conn:
        return pd.read_sql(text(sql), conn)


def maybe_float(value):
    try:
        if value is None or (isinstance(value, float) and pd.isna(value)):
            return None
        return float(value)
    except Exception:
        return None


def format_result(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    if isinstance(value, float):
        return f"{value:.6f}"
    return str(value)


def row_out(
    theme: str,
    test_name: str,
    year,
    session_id,
    event_name,
    session_type,
    openf1_result,
    fastf1_result,
    match_status,
    severity,
    notes,
    recommended_source,
):
    return {
        "theme": theme,
        "test_name": test_name,
        "year": year,
        "session_key_or_equivalent": session_id,
        "event_name": event_name,
        "session_type": session_type,
        "openf1_result": format_result(openf1_result),
        "fastf1_result": format_result(fastf1_result),
        "match_status": match_status,
        "severity": severity,
        "notes": notes,
        "recommended_source": recommended_source,
    }


def compare_numeric(open_value, fast_value, tolerance: float):
    o = maybe_float(open_value)
    f = maybe_float(fast_value)

    if o is None and f is None:
        return "both_missing", "medium", "review"
    if o is None:
        return "missing_openf1", "high", "fastf1"
    if f is None:
        return "missing_fastf1", "high", "openf1"

    if abs(o - f) <= tolerance:
        return "match", "low", "either"
    return "mismatch", "medium", "review"


def compare_string(open_value, fast_value):
    o = normalize_text(str(open_value)) if open_value is not None and str(open_value) != "" else ""
    f = normalize_text(str(fast_value)) if fast_value is not None and str(fast_value) != "" else ""

    if o == "" and f == "":
        return "both_missing", "medium", "review"
    if o == "":
        return "missing_openf1", "high", "fastf1"
    if f == "":
        return "missing_fastf1", "high", "openf1"

    if o == f:
        return "match", "low", "either"
    return "mismatch", "medium", "review"


def load_fast_sessions(engine, years: list[int], session_types: list[str]) -> pd.DataFrame:
    years_sql = ",".join(str(y) for y in years)
    session_filters = ",".join(f"'{normalize_session_name(s)}'" for s in session_types)
    return q(
        engine,
        f"""
        SELECT
            session_uid,
            year,
            round_number,
            event_name,
            official_event_name,
            country,
            location,
            session_name,
            session_type,
            event_date,
            session_date
        FROM fastf1_raw.sessions
        WHERE year IN ({years_sql})
          AND session_type IN ({session_filters})
        """,
    )


def load_open_sessions(engine, years: list[int], session_types: list[str]) -> pd.DataFrame:
    years_sql = ",".join(str(y) for y in years)
    session_filters = ",".join(f"'{normalize_session_name(s)}'" for s in session_types)
    return q(
        engine,
        f"""
        SELECT
            session_key,
            meeting_key,
            year,
            meeting_name,
            session_name,
            session_type,
            country_name,
            location,
            circuit_short_name,
            date_start
        FROM core.sessions
        WHERE year IN ({years_sql})
          AND lower(session_name) IN ({session_filters})
        """,
    )


def add_session_norm_cols(df: pd.DataFrame, source: str) -> pd.DataFrame:
    out = df.copy()
    out["session_name_norm"] = out["session_name"].apply(normalize_session_name)

    if source == "fastf1":
        out["event_name_norm"] = out["event_name"].fillna("").apply(normalize_text)
        out["country_norm"] = out["country"].fillna("").apply(normalize_text)
        out["location_norm"] = out["location"].fillna("").apply(normalize_text)
        out["session_dt"] = pd.to_datetime(out["session_date"], utc=True, errors="coerce")
    else:
        out["event_name"] = out["meeting_name"].fillna(out["country_name"].fillna("") + " " + out["location"].fillna(""))
        out["event_name_norm"] = out["event_name"].fillna("").apply(normalize_text)
        out["country_norm"] = out["country_name"].fillna("").apply(normalize_text)
        out["location_norm"] = out["location"].fillna("").apply(normalize_text)
        out["session_dt"] = pd.to_datetime(out["date_start"], utc=True, errors="coerce")

    return out


def map_sessions(fast_df: pd.DataFrame, open_df: pd.DataFrame) -> pd.DataFrame:
    records = []

    for _, f in fast_df.iterrows():
        candidates = open_df[
            (open_df["year"] == f["year"])
            & (open_df["session_name_norm"] == f["session_name_norm"])
        ]

        if candidates.empty:
            records.append(
                {
                    "map_status": "missing_in_openf1",
                    "year": f["year"],
                    "session_uid": f["session_uid"],
                    "session_key": None,
                    "event_name_fastf1": f["event_name"],
                    "event_name_openf1": None,
                    "session_name": f["session_name"],
                    "session_type": f["session_type"],
                    "score": 0,
                }
            )
            continue

        best = None
        best_score = -1
        best_day = None

        for _, o in candidates.iterrows():
            score = 0
            if f["country_norm"] and o["country_norm"] and f["country_norm"] == o["country_norm"]:
                score += 2
            if f["location_norm"] and o["location_norm"] and f["location_norm"] == o["location_norm"]:
                score += 2

            # Event-name overlap fallback.
            if f["event_name_norm"] and o["event_name_norm"]:
                ft = set(f["event_name_norm"].split())
                ot = set(o["event_name_norm"].split())
                if ft.intersection(ot):
                    score += 1

            d = day_diff(f["session_dt"], o["session_dt"])
            if d is not None:
                if d <= 1:
                    score += 2
                elif d <= 3:
                    score += 1

            if score > best_score or (score == best_score and (best_day is None or (d is not None and d < best_day))):
                best = o
                best_score = score
                best_day = d

        if best is None or best_score < 2:
            records.append(
                {
                    "map_status": "low_confidence",
                    "year": f["year"],
                    "session_uid": f["session_uid"],
                    "session_key": None,
                    "event_name_fastf1": f["event_name"],
                    "event_name_openf1": None,
                    "session_name": f["session_name"],
                    "session_type": f["session_type"],
                    "score": best_score,
                }
            )
        else:
            records.append(
                {
                    "map_status": "matched",
                    "year": f["year"],
                    "session_uid": f["session_uid"],
                    "session_key": int(best["session_key"]),
                    "event_name_fastf1": f["event_name"],
                    "event_name_openf1": best["event_name"],
                    "session_name": f["session_name"],
                    "session_type": f["session_type"],
                    "score": best_score,
                }
            )

    return pd.DataFrame(records)


def load_open_session_metrics(engine, years: list[int]) -> pd.DataFrame:
    years_sql = ",".join(str(y) for y in years)
    return q(
        engine,
        f"""
        WITH base AS (
            SELECT session_key, year, session_name
            FROM core.sessions
            WHERE year IN ({years_sql})
        ),
        roster AS (
            SELECT session_key, COUNT(DISTINCT driver_number) AS roster_count
            FROM core.session_drivers
            GROUP BY session_key
        ),
        laps AS (
            SELECT
                session_key,
                COUNT(*) AS lap_count,
                MIN(lap_duration) FILTER (WHERE lap_duration > 0) AS best_lap,
                AVG(lap_duration) FILTER (WHERE lap_duration > 0) AS avg_lap,
                MIN(duration_sector_1) FILTER (WHERE duration_sector_1 > 0) AS best_s1,
                MIN(duration_sector_2) FILTER (WHERE duration_sector_2 > 0) AS best_s2,
                MIN(duration_sector_3) FILTER (WHERE duration_sector_3 > 0) AS best_s3,
                COUNT(*) FILTER (WHERE duration_sector_1 IS NOT NULL) AS s1_rows,
                COUNT(*) FILTER (WHERE duration_sector_2 IS NOT NULL) AS s2_rows,
                COUNT(*) FILTER (WHERE duration_sector_3 IS NOT NULL) AS s3_rows
            FROM raw.laps
            GROUP BY session_key
        ),
        pit AS (
            SELECT session_key, COUNT(*) AS pit_count
            FROM raw.pit
            GROUP BY session_key
        ),
        stints AS (
            SELECT session_key, COUNT(DISTINCT CONCAT(driver_number, '-', stint_number)) AS stint_count
            FROM raw.stints
            GROUP BY session_key
        ),
        results AS (
            SELECT session_key, COUNT(*) AS result_count
            FROM raw.session_result
            GROUP BY session_key
        ),
        grids AS (
            SELECT session_key, COUNT(*) AS grid_count
            FROM raw.starting_grid
            GROUP BY session_key
        ),
        telemetry AS (
            SELECT session_key, COUNT(*) AS telemetry_rows
            FROM raw.car_data
            GROUP BY session_key
        ),
        weather AS (
            SELECT session_key, COUNT(*) AS weather_rows
            FROM raw.weather
            GROUP BY session_key
        ),
        progression AS (
            SELECT session_key, COUNT(*) AS progression_rows
            FROM raw.position_history
            GROUP BY session_key
        ),
        location_rows AS (
            SELECT session_key, COUNT(*) AS location_rows
            FROM raw.location
            GROUP BY session_key
        )
        SELECT
            b.session_key,
            b.year,
            b.session_name,
            COALESCE(r.roster_count, 0) AS roster_count,
            COALESCE(l.lap_count, 0) AS lap_count,
            l.best_lap,
            l.avg_lap,
            l.best_s1,
            l.best_s2,
            l.best_s3,
            COALESCE(l.s1_rows, 0) AS s1_rows,
            COALESCE(l.s2_rows, 0) AS s2_rows,
            COALESCE(l.s3_rows, 0) AS s3_rows,
            COALESCE(p.pit_count, 0) AS pit_count,
            COALESCE(st.stint_count, 0) AS stint_count,
            COALESCE(rs.result_count, 0) AS result_count,
            COALESCE(g.grid_count, 0) AS grid_count,
            COALESCE(t.telemetry_rows, 0) AS telemetry_rows,
            COALESCE(w.weather_rows, 0) AS weather_rows,
            COALESCE(pr.progression_rows, 0) AS progression_rows,
            COALESCE(lr.location_rows, 0) AS location_rows
        FROM base b
        LEFT JOIN roster r ON r.session_key = b.session_key
        LEFT JOIN laps l ON l.session_key = b.session_key
        LEFT JOIN pit p ON p.session_key = b.session_key
        LEFT JOIN stints st ON st.session_key = b.session_key
        LEFT JOIN results rs ON rs.session_key = b.session_key
        LEFT JOIN grids g ON g.session_key = b.session_key
        LEFT JOIN telemetry t ON t.session_key = b.session_key
        LEFT JOIN weather w ON w.session_key = b.session_key
        LEFT JOIN progression pr ON pr.session_key = b.session_key
        LEFT JOIN location_rows lr ON lr.session_key = b.session_key
        """,
    )


def load_fast_session_metrics(engine, years: list[int]) -> pd.DataFrame:
    years_sql = ",".join(str(y) for y in years)
    return q(
        engine,
        f"""
        WITH base AS (
            SELECT session_uid, year, session_name
            FROM fastf1_raw.sessions
            WHERE year IN ({years_sql})
        ),
        roster AS (
            SELECT session_uid, COUNT(DISTINCT driver_number) AS roster_count
            FROM fastf1_raw.drivers
            GROUP BY session_uid
        ),
        laps AS (
            SELECT
                session_uid,
                COUNT(*) AS lap_count,
                MIN(lap_time_seconds) FILTER (WHERE lap_time_seconds > 0) AS best_lap,
                AVG(lap_time_seconds) FILTER (WHERE lap_time_seconds > 0) AS avg_lap,
                MIN(sector1_time_seconds) FILTER (WHERE sector1_time_seconds > 0) AS best_s1,
                MIN(sector2_time_seconds) FILTER (WHERE sector2_time_seconds > 0) AS best_s2,
                MIN(sector3_time_seconds) FILTER (WHERE sector3_time_seconds > 0) AS best_s3,
                COUNT(*) FILTER (WHERE sector1_time_seconds IS NOT NULL) AS s1_rows,
                COUNT(*) FILTER (WHERE sector2_time_seconds IS NOT NULL) AS s2_rows,
                COUNT(*) FILTER (WHERE sector3_time_seconds IS NOT NULL) AS s3_rows,
                COUNT(*) FILTER (WHERE pit_in_time_seconds IS NOT NULL) AS pit_count,
                COUNT(DISTINCT CONCAT(driver_number, '-', COALESCE(stint::TEXT, 'na'))) AS stint_count,
                COUNT(*) FILTER (WHERE position IS NOT NULL) AS progression_rows
            FROM fastf1_raw.laps
            GROUP BY session_uid
        ),
        results AS (
            SELECT session_uid, COUNT(*) AS result_count
            FROM fastf1_raw.results
            GROUP BY session_uid
        ),
        grids AS (
            SELECT session_uid, COUNT(*) FILTER (WHERE grid_position IS NOT NULL) AS grid_count
            FROM fastf1_raw.results
            GROUP BY session_uid
        ),
        telemetry AS (
            SELECT session_uid, COUNT(*) AS telemetry_rows
            FROM fastf1_raw.telemetry
            GROUP BY session_uid
        ),
        weather AS (
            SELECT session_uid, COUNT(*) AS weather_rows
            FROM fastf1_raw.weather
            GROUP BY session_uid
        )
        SELECT
            b.session_uid,
            b.year,
            b.session_name,
            COALESCE(r.roster_count, 0) AS roster_count,
            COALESCE(l.lap_count, 0) AS lap_count,
            l.best_lap,
            l.avg_lap,
            l.best_s1,
            l.best_s2,
            l.best_s3,
            COALESCE(l.s1_rows, 0) AS s1_rows,
            COALESCE(l.s2_rows, 0) AS s2_rows,
            COALESCE(l.s3_rows, 0) AS s3_rows,
            COALESCE(l.pit_count, 0) AS pit_count,
            COALESCE(l.stint_count, 0) AS stint_count,
            COALESCE(rs.result_count, 0) AS result_count,
            COALESCE(g.grid_count, 0) AS grid_count,
            COALESCE(t.telemetry_rows, 0) AS telemetry_rows,
            COALESCE(w.weather_rows, 0) AS weather_rows,
            COALESCE(l.progression_rows, 0) AS progression_rows,
            0::BIGINT AS location_rows
        FROM base b
        LEFT JOIN roster r ON r.session_uid = b.session_uid
        LEFT JOIN laps l ON l.session_uid = b.session_uid
        LEFT JOIN results rs ON rs.session_uid = b.session_uid
        LEFT JOIN grids g ON g.session_uid = b.session_uid
        LEFT JOIN telemetry t ON t.session_uid = b.session_uid
        LEFT JOIN weather w ON w.session_uid = b.session_uid
        """,
    )


def load_team_maps(engine, source: str, years: list[int]) -> pd.DataFrame:
    years_sql = ",".join(str(y) for y in years)
    if source == "openf1":
        return q(
            engine,
            f"""
            SELECT s.year, s.session_key::TEXT AS session_id, d.driver_number, d.team_name
            FROM core.session_drivers d
            JOIN core.sessions s ON s.session_key = d.session_key
            WHERE s.year IN ({years_sql})
            """,
        )

    return q(
        engine,
        f"""
        SELECT s.year, d.session_uid AS session_id, d.driver_number, d.team_name
        FROM fastf1_raw.drivers d
        JOIN fastf1_raw.sessions s ON s.session_uid = d.session_uid
        WHERE s.year IN ({years_sql})
        """,
    )


def load_result_positions(engine, source: str, years: list[int]) -> pd.DataFrame:
    years_sql = ",".join(str(y) for y in years)
    if source == "openf1":
        return q(
            engine,
            f"""
            SELECT s.year, r.session_key::TEXT AS session_id, r.driver_number, r.position
            FROM raw.session_result r
            JOIN core.sessions s ON s.session_key = r.session_key
            WHERE s.year IN ({years_sql})
            """,
        )
    return q(
        engine,
        f"""
        SELECT s.year, r.session_uid AS session_id, r.driver_number, r.position
        FROM fastf1_raw.results r
        JOIN fastf1_raw.sessions s ON s.session_uid = r.session_uid
        WHERE s.year IN ({years_sql})
        """,
    )


def build_test_rows(
    mapping: pd.DataFrame,
    open_metrics: pd.DataFrame,
    fast_metrics: pd.DataFrame,
    open_teams: pd.DataFrame,
    fast_teams: pd.DataFrame,
    open_positions: pd.DataFrame,
    fast_positions: pd.DataFrame,
) -> pd.DataFrame:
    open_m = open_metrics.set_index("session_key")
    fast_m = fast_metrics.set_index("session_uid")

    rows = []

    # Coverage rows for unmatched sessions.
    for _, m in mapping[mapping["map_status"] != "matched"].iterrows():
        rows.append(
            row_out(
                theme="session_coverage",
                test_name="session_presence",
                year=m["year"],
                session_id=m["session_uid"],
                event_name=m["event_name_fastf1"],
                session_type=m["session_type"],
                openf1_result="missing",
                fastf1_result="present",
                match_status="missing_in_openf1",
                severity="high",
                notes=f"mapping_status={m['map_status']}; score={m['score']}",
                recommended_source="fastf1",
            )
        )

    matched = mapping[mapping["map_status"] == "matched"]

    for _, m in matched.iterrows():
        sk = int(m["session_key"])
        suid = m["session_uid"]

        o = open_m.loc[sk] if sk in open_m.index else pd.Series(dtype=object)
        f = fast_m.loc[suid] if suid in fast_m.index else pd.Series(dtype=object)

        # 0. Session coverage (matched pair)
        rows.append(
            row_out(
                theme="session_coverage",
                test_name="session_presence",
                year=m["year"],
                session_id=f"{sk}|{suid}",
                event_name=m["event_name_openf1"] or m["event_name_fastf1"],
                session_type=m["session_type"],
                openf1_result="present",
                fastf1_result="present",
                match_status="match",
                severity="low",
                notes=f"mapped session pair; score={m['score']}",
                recommended_source="either",
            )
        )

        # 1. Session naming
        ms, sev, rec = compare_string(m["event_name_openf1"], m["event_name_fastf1"])
        rows.append(
            row_out(
                "session_naming_quality",
                "event_name_alignment",
                m["year"],
                f"{sk}|{suid}",
                m["event_name_openf1"] or m["event_name_fastf1"],
                m["session_type"],
                m["event_name_openf1"],
                m["event_name_fastf1"],
                ms,
                sev,
                f"mapping_score={m['score']}",
                rec,
            )
        )

        # 2. Driver roster
        ms, sev, rec = compare_numeric(o.get("roster_count"), f.get("roster_count"), 0)
        rows.append(
            row_out(
                "driver_roster_coverage",
                "driver_count_alignment",
                m["year"],
                f"{sk}|{suid}",
                m["event_name_openf1"] or m["event_name_fastf1"],
                m["session_type"],
                o.get("roster_count"),
                f.get("roster_count"),
                ms,
                sev,
                "distinct drivers per session",
                rec,
            )
        )

        # 3. Team mapping mismatch count
        ot = open_teams[open_teams["session_id"] == str(sk)][["driver_number", "team_name"]].copy()
        ft = fast_teams[fast_teams["session_id"] == str(suid)][["driver_number", "team_name"]].copy()

        if ot.empty and ft.empty:
            team_mismatch = None
        else:
            merged_t = ot.merge(ft, on="driver_number", how="outer", suffixes=("_open", "_fast"))
            merged_t["team_name_open"] = merged_t["team_name_open"].fillna("").apply(normalize_text)
            merged_t["team_name_fast"] = merged_t["team_name_fast"].fillna("").apply(normalize_text)
            team_mismatch = int((merged_t["team_name_open"] != merged_t["team_name_fast"]).sum())

        ms, sev, rec = compare_numeric(team_mismatch, 0, 0)
        rows.append(
            row_out(
                "driver_team_mapping",
                "driver_team_alignment",
                m["year"],
                f"{sk}|{suid}",
                m["event_name_openf1"] or m["event_name_fastf1"],
                m["session_type"],
                team_mismatch,
                0,
                ms,
                sev,
                "number of mismatched driver->team labels",
                rec if rec != "either" else "openf1",
            )
        )

        # 4. Lap timing quality (count / best / avg)
        for metric_name, tolerance in [
            ("lap_count", NUMERIC_TOLERANCES["lap_count"]),
            ("best_lap", NUMERIC_TOLERANCES["best_lap"]),
            ("avg_lap", NUMERIC_TOLERANCES["avg_lap"]),
        ]:
            ms, sev, rec = compare_numeric(o.get(metric_name), f.get(metric_name), tolerance)
            rows.append(
                row_out(
                    "lap_timing_quality",
                    f"{metric_name}_alignment",
                    m["year"],
                    f"{sk}|{suid}",
                    m["event_name_openf1"] or m["event_name_fastf1"],
                    m["session_type"],
                    o.get(metric_name),
                    f.get(metric_name),
                    ms,
                    sev,
                    f"tolerance={tolerance}",
                    rec,
                )
            )

        # 5. Sector timing quality
        for metric_name in ["best_s1", "best_s2", "best_s3"]:
            ms, sev, rec = compare_numeric(o.get(metric_name), f.get(metric_name), NUMERIC_TOLERANCES["sector"])
            rows.append(
                row_out(
                    "sector_timing_quality",
                    f"{metric_name}_alignment",
                    m["year"],
                    f"{sk}|{suid}",
                    m["event_name_openf1"] or m["event_name_fastf1"],
                    m["session_type"],
                    o.get(metric_name),
                    f.get(metric_name),
                    ms,
                    sev,
                    f"tolerance={NUMERIC_TOLERANCES['sector']}",
                    rec,
                )
            )

        # 6. Pit/stint quality
        for metric_name, tolerance in [
            ("pit_count", NUMERIC_TOLERANCES["pit_count"]),
            ("stint_count", NUMERIC_TOLERANCES["stint_count"]),
        ]:
            ms, sev, rec = compare_numeric(o.get(metric_name), f.get(metric_name), tolerance)
            rows.append(
                row_out(
                    "pit_and_stint_quality",
                    f"{metric_name}_alignment",
                    m["year"],
                    f"{sk}|{suid}",
                    m["event_name_openf1"] or m["event_name_fastf1"],
                    m["session_type"],
                    o.get(metric_name),
                    f.get(metric_name),
                    ms,
                    sev,
                    f"tolerance={tolerance}",
                    rec,
                )
            )

        # 7. Result and grid quality
        for metric_name, theme_name, test_name in [
            ("result_count", "result_finishing_order_quality", "result_count_alignment"),
            ("grid_count", "starting_grid_quality", "grid_count_alignment"),
        ]:
            ms, sev, rec = compare_numeric(o.get(metric_name), f.get(metric_name), NUMERIC_TOLERANCES[metric_name])
            rows.append(
                row_out(
                    theme_name,
                    test_name,
                    m["year"],
                    f"{sk}|{suid}",
                    m["event_name_openf1"] or m["event_name_fastf1"],
                    m["session_type"],
                    o.get(metric_name),
                    f.get(metric_name),
                    ms,
                    sev,
                    f"tolerance={NUMERIC_TOLERANCES[metric_name]}",
                    rec,
                )
            )

        # 8. Telemetry usefulness
        ms, sev, rec = compare_numeric(o.get("telemetry_rows"), f.get("telemetry_rows"), 1000)
        rows.append(
            row_out(
                "telemetry_usefulness",
                "telemetry_row_availability",
                m["year"],
                f"{sk}|{suid}",
                m["event_name_openf1"] or m["event_name_fastf1"],
                m["session_type"],
                o.get("telemetry_rows"),
                f.get("telemetry_rows"),
                ms,
                sev,
                "raw telemetry rows (large differences are expected)",
                rec,
            )
        )

        # 9. Weather coverage
        ms, sev, rec = compare_numeric(o.get("weather_rows"), f.get("weather_rows"), 5)
        rows.append(
            row_out(
                "weather_coverage",
                "weather_row_availability",
                m["year"],
                f"{sk}|{suid}",
                m["event_name_openf1"] or m["event_name_fastf1"],
                m["session_type"],
                o.get("weather_rows"),
                f.get("weather_rows"),
                ms,
                sev,
                "weather sample count",
                rec,
            )
        )

        # 10. Race progression quality
        ms, sev, rec = compare_numeric(o.get("progression_rows"), f.get("progression_rows"), 100)
        rows.append(
            row_out(
                "race_progression_quality",
                "progression_signal_availability",
                m["year"],
                f"{sk}|{suid}",
                m["event_name_openf1"] or m["event_name_fastf1"],
                m["session_type"],
                o.get("progression_rows"),
                f.get("progression_rows"),
                ms,
                sev,
                "OpenF1 uses position_history rows, FastF1 uses laps.position rows",
                rec,
            )
        )

        # 11. Strategy usefulness heuristic.
        open_strategy = int((o.get("lap_count", 0) > 0) and (o.get("pit_count", 0) > 0) and (o.get("stint_count", 0) > 0))
        fast_strategy = int((f.get("lap_count", 0) > 0) and (f.get("pit_count", 0) > 0) and (f.get("stint_count", 0) > 0))
        ms, sev, rec = compare_numeric(open_strategy, fast_strategy, 0)
        rows.append(
            row_out(
                "strategy_analysis_usefulness",
                "strategy_signal_presence",
                m["year"],
                f"{sk}|{suid}",
                m["event_name_openf1"] or m["event_name_fastf1"],
                m["session_type"],
                open_strategy,
                fast_strategy,
                ms,
                sev,
                "1 = lap + pit + stint data present",
                rec,
            )
        )

        # 12. Result position alignment sample mismatch count.
        op = open_positions[open_positions["session_id"] == str(sk)][["driver_number", "position"]].copy()
        fp = fast_positions[fast_positions["session_id"] == str(suid)][["driver_number", "position"]].copy()
        if not op.empty and not fp.empty:
            mpos = op.merge(fp, on="driver_number", how="outer", suffixes=("_open", "_fast"))
            mpos["position_open"] = pd.to_numeric(mpos["position_open"], errors="coerce")
            mpos["position_fast"] = pd.to_numeric(mpos["position_fast"], errors="coerce")
            mismatch_count = int((mpos["position_open"] != mpos["position_fast"]).sum())
            ms, sev, rec = compare_numeric(mismatch_count, 0, 0)
            rows.append(
                row_out(
                    "result_finishing_order_quality",
                    "driver_finish_position_alignment",
                    m["year"],
                    f"{sk}|{suid}",
                    m["event_name_openf1"] or m["event_name_fastf1"],
                    m["session_type"],
                    mismatch_count,
                    0,
                    ms,
                    sev,
                    "number of mismatched finishing positions by driver",
                    rec if rec != "either" else "openf1",
                )
            )

    out = pd.DataFrame(rows)
    # Keep only known themes for cleanliness.
    out = out[out["theme"].isin(THEMES)].copy()
    return out


def score_theme_rows(df: pd.DataFrame) -> pd.DataFrame:
    summaries = []
    for theme, group in df.groupby("theme"):
        open_score = 0.0
        fast_score = 0.0

        for _, row in group.iterrows():
            status = row["match_status"]
            recommended = row["recommended_source"]

            if status == "match":
                open_score += 1
                fast_score += 1
            elif recommended == "openf1":
                open_score += 1
            elif recommended == "fastf1":
                fast_score += 1

        if open_score > fast_score:
            winner = "openf1"
            action = "Keep OpenF1 primary for this theme; use FastF1 for spot-validation."
        elif fast_score > open_score:
            winner = "fastf1"
            action = "Use FastF1 to supplement this theme while keeping OpenF1 primary overall."
        else:
            winner = "tie"
            action = "No clear source winner; keep OpenF1 primary and maintain comparison checks."

        mismatch_count = int((group["match_status"] == "mismatch").sum())
        missing_open = int((group["match_status"] == "missing_openf1").sum())
        missing_fast = int((group["match_status"] == "missing_fastf1").sum())
        rationale = (
            f"rows={len(group)}; mismatches={mismatch_count}; "
            f"missing_openf1={missing_open}; missing_fastf1={missing_fast}"
        )

        summaries.append(
            {
                "theme": theme,
                "openf1_score": open_score,
                "fastf1_score": fast_score,
                "winner": winner,
                "rationale": rationale,
                "recommended_action": action,
            }
        )

    return pd.DataFrame(summaries)


def build_use_case_recommendations(theme_summary: pd.DataFrame) -> pd.DataFrame:
    by_theme = theme_summary.set_index("theme") if not theme_summary.empty else pd.DataFrame()

    rows = []
    for use_case, themes in USE_CASE_THEME_MAP.items():
        relevant = [by_theme.loc[t] for t in themes if t in by_theme.index]
        if not relevant:
            rows.append(
                {
                    "use_case": use_case,
                    "preferred_source": "openf1",
                    "confidence": "low",
                    "rationale": "No theme data available.",
                    "recommended_action": "Run comparison first.",
                }
            )
            continue

        open_score = sum(float(r["openf1_score"]) for r in relevant)
        fast_score = sum(float(r["fastf1_score"]) for r in relevant)

        if open_score > fast_score:
            preferred = "openf1"
            confidence = "high" if open_score >= fast_score + 2 else "medium"
            action = "Keep OpenF1 as source of truth; use FastF1 only for edge-case checks."
        elif fast_score > open_score:
            preferred = "fastf1"
            confidence = "high" if fast_score >= open_score + 2 else "medium"
            action = "Supplement OpenF1 with FastF1-derived logic for this use case."
        else:
            preferred = "tie"
            confidence = "low"
            action = "Maintain dual-source audit and prioritize semantic-layer normalization."

        rationale = f"themes={','.join(themes)}; openf1_score={open_score}; fastf1_score={fast_score}"

        rows.append(
            {
                "use_case": use_case,
                "preferred_source": preferred,
                "confidence": confidence,
                "rationale": rationale,
                "recommended_action": action,
            }
        )

    return pd.DataFrame(rows)


def load_benchmark_rows(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()

    try:
        obj = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return pd.DataFrame()

    if isinstance(obj, list):
        df = pd.DataFrame(obj)
    elif isinstance(obj, dict) and isinstance(obj.get("results"), list):
        df = pd.DataFrame(obj.get("results"))
    else:
        return pd.DataFrame()

    if df.empty:
        return df

    if "questionType" in df.columns:
        df["question_type"] = df["questionType"]
    elif "question_type" not in df.columns:
        df["question_type"] = "unknown"

    if "adequacyGrade" in df.columns:
        df["adequacy_grade"] = df["adequacyGrade"]
    elif "adequacy_grade" not in df.columns:
        df["adequacy_grade"] = None

    return df


def build_benchmark_summary(theme_summary: pd.DataFrame, benchmark_df: pd.DataFrame, map_csv: Path) -> pd.DataFrame:
    if benchmark_df.empty or (not map_csv.exists()):
        return pd.DataFrame()

    family_map = pd.read_csv(map_csv)
    family_map["question_type"] = family_map["question_type"].astype(str)

    merged = benchmark_df.merge(family_map, on="question_type", how="left")
    merged["pass_flag"] = merged["adequacy_grade"].astype(str).str.upper().isin(["A", "B"]).astype(int)

    theme_winner = theme_summary.set_index("theme")["winner"].to_dict() if not theme_summary.empty else {}

    rows = []
    for (q_family, q_type), g in merged.groupby(["question_family", "question_type"], dropna=False):
        related_themes = str(g["related_themes"].dropna().iloc[0]) if g["related_themes"].notna().any() else ""
        related_list = [x.strip() for x in related_themes.split(";") if x.strip()]

        winners = [theme_winner.get(t) for t in related_list if t in theme_winner]
        if winners:
            open_count = winners.count("openf1")
            fast_count = winners.count("fastf1")
            if open_count > fast_count:
                winner = "openf1"
            elif fast_count > open_count:
                winner = "fastf1"
            else:
                winner = "tie"
        else:
            winner = "unknown"

        pass_rate = float(g["pass_flag"].mean()) if len(g) else 0.0

        if pass_rate < 0.8 and winner == "openf1":
            likely_issue = "logic_or_prompt_gap"
            recommendation = "Data source likely sufficient; focus on SQL/template and resolver improvements."
        elif pass_rate < 0.8 and winner == "fastf1":
            likely_issue = "openf1_source_gap"
            recommendation = "OpenF1 limitation likely for this family; use FastF1 supplementation."
        elif pass_rate < 0.8 and winner in {"tie", "unknown"}:
            likely_issue = "mixed_or_unclear"
            recommendation = "Need deeper per-question diagnostics before source decision."
        else:
            likely_issue = "healthy_or_minor"
            recommendation = "Keep current approach with periodic audit checks."

        rows.append(
            {
                "question_family": q_family,
                "question_type": q_type,
                "benchmark_count": int(len(g)),
                "openf1_above_c_rate": round(pass_rate, 4),
                "related_themes": related_themes,
                "theme_winner": winner,
                "likely_issue_driver": likely_issue,
                "recommendation": recommendation,
            }
        )

    return pd.DataFrame(rows)


def write_outputs(report_dir: Path, tests: pd.DataFrame, theme_summary: pd.DataFrame, benchmark_summary: pd.DataFrame, use_case_summary: pd.DataFrame):
    report_dir.mkdir(parents=True, exist_ok=True)

    tests_csv = report_dir / "source_comparison_tests.csv"
    tests_json = report_dir / "source_comparison_tests.json"
    theme_csv = report_dir / "source_theme_summary.csv"
    theme_json = report_dir / "source_theme_summary.json"
    bench_csv = report_dir / "benchmark_audit_summary.csv"
    bench_json = report_dir / "benchmark_audit_summary.json"
    rec_csv = report_dir / "source_recommendation_summary.csv"
    rec_json = report_dir / "source_recommendation_summary.json"

    tests.to_csv(tests_csv, index=False)
    tests.to_json(tests_json, orient="records", indent=2)

    theme_summary.to_csv(theme_csv, index=False)
    theme_summary.to_json(theme_json, orient="records", indent=2)

    benchmark_summary.to_csv(bench_csv, index=False)
    benchmark_summary.to_json(bench_json, orient="records", indent=2)

    use_case_summary.to_csv(rec_csv, index=False)
    use_case_summary.to_json(rec_json, orient="records", indent=2)

    md_lines = ["# FastF1 vs OpenF1 Source Audit", ""]
    md_lines.append(f"Generated at: {datetime.now(timezone.utc).isoformat()}")
    md_lines.append("")

    md_lines.append("## Theme Summary")
    md_lines.append("")
    if theme_summary.empty:
        md_lines.append("No theme summary rows were generated.")
    else:
        for row in theme_summary.to_dict(orient="records"):
            md_lines.append(f"- `{row['theme']}`: winner=`{row['winner']}` ({row['rationale']})")

    md_lines.append("")
    md_lines.append("## Use-Case Recommendations")
    md_lines.append("")
    if use_case_summary.empty:
        md_lines.append("No use-case rows were generated.")
    else:
        for row in use_case_summary.to_dict(orient="records"):
            md_lines.append(
                f"- `{row['use_case']}` -> `{row['preferred_source']}` "
                f"(confidence={row['confidence']}; action={row['recommended_action']})"
            )

    md_lines.append("")
    md_lines.append("## Files")
    md_lines.append("")
    md_lines.append("- source_comparison_tests.csv/json")
    md_lines.append("- source_theme_summary.csv/json")
    md_lines.append("- benchmark_audit_summary.csv/json")
    md_lines.append("- source_recommendation_summary.csv/json")

    (report_dir / "source_audit_report.md").write_text("\n".join(md_lines), encoding="utf-8")


def maybe_write_reports_to_db(fast_engine, tests: pd.DataFrame, theme_summary: pd.DataFrame, benchmark_summary: pd.DataFrame, use_case_summary: pd.DataFrame):
    write_to_db = parse_bool(os.environ.get("WRITE_REPORTS_TO_DB"), True)
    if not write_to_db:
        return

    generated_at = datetime.now(timezone.utc)

    execute(fast_engine, "DELETE FROM fastf1_core.source_comparison_tests")
    execute(fast_engine, "DELETE FROM fastf1_core.source_comparison_theme_summary")
    execute(fast_engine, "DELETE FROM fastf1_core.benchmark_audit_summary")
    execute(fast_engine, "DELETE FROM fastf1_core.source_recommendation_summary")

    if not tests.empty:
        tests2 = tests.copy()
        tests2.insert(0, "report_generated_at", generated_at)
        tests2.to_sql("source_comparison_tests", fast_engine, schema="fastf1_core", if_exists="append", index=False, method="multi")

    if not theme_summary.empty:
        t2 = theme_summary.copy()
        t2.insert(0, "report_generated_at", generated_at)
        t2.to_sql("source_comparison_theme_summary", fast_engine, schema="fastf1_core", if_exists="append", index=False, method="multi")

    if not benchmark_summary.empty:
        b2 = benchmark_summary.copy()
        b2.insert(0, "report_generated_at", generated_at)
        b2.to_sql("benchmark_audit_summary", fast_engine, schema="fastf1_core", if_exists="append", index=False, method="multi")

    if not use_case_summary.empty:
        u2 = use_case_summary.copy()
        u2.insert(0, "report_generated_at", generated_at)
        u2.to_sql("source_recommendation_summary", fast_engine, schema="fastf1_core", if_exists="append", index=False, method="multi")


def main():
    years = [int(y) for y in parse_csv_list(os.environ.get("AUDIT_YEARS", "2023,2024,2025"))]
    session_types = parse_csv_list(os.environ.get("AUDIT_SESSION_TYPES", "Race")) or ["Race"]

    report_dir = Path(os.environ.get("REPORT_DIR", "./reports"))
    benchmark_json = Path(os.environ.get("BENCHMARK_RESULTS_JSON", "../web/logs/chat_health_check_2026-03-16T00-48-15-801Z.json"))
    benchmark_map_csv = Path("./config/benchmark_family_map.csv")

    open_engine = get_engine("OPENF1")
    fast_engine = get_engine("FASTF1")

    fast_sessions = add_session_norm_cols(load_fast_sessions(fast_engine, years, session_types), "fastf1")
    open_sessions = add_session_norm_cols(load_open_sessions(open_engine, years, session_types), "openf1")

    mapping = map_sessions(fast_sessions, open_sessions)

    # Open-only sessions not mapped from fast side.
    mapped_open_keys = set(mapping["session_key"].dropna().astype(int).tolist())
    open_unmapped = open_sessions[~open_sessions["session_key"].isin(mapped_open_keys)].copy()

    open_metrics = load_open_session_metrics(open_engine, years)
    fast_metrics = load_fast_session_metrics(fast_engine, years)

    open_teams = load_team_maps(open_engine, "openf1", years)
    fast_teams = load_team_maps(fast_engine, "fastf1", years)

    open_positions = load_result_positions(open_engine, "openf1", years)
    fast_positions = load_result_positions(fast_engine, "fastf1", years)

    tests = build_test_rows(mapping, open_metrics, fast_metrics, open_teams, fast_teams, open_positions, fast_positions)

    # Add open-only coverage misses.
    for _, row in open_unmapped.iterrows():
        tests = pd.concat(
            [
                tests,
                pd.DataFrame(
                    [
                        row_out(
                            theme="session_coverage",
                            test_name="session_presence",
                            year=row["year"],
                            session_id=str(row["session_key"]),
                            event_name=row["event_name"],
                            session_type=row["session_type"],
                            openf1_result="present",
                            fastf1_result="missing",
                            match_status="missing_in_fastf1",
                            severity="high",
                            notes="open session has no mapped fastf1 session",
                            recommended_source="openf1",
                        )
                    ]
                ),
            ],
            ignore_index=True,
        )

    tests = tests.sort_values(["theme", "year", "event_name", "test_name"]).reset_index(drop=True)

    theme_summary = score_theme_rows(tests)
    use_case_summary = build_use_case_recommendations(theme_summary)

    benchmark_df = load_benchmark_rows(benchmark_json)
    benchmark_summary = build_benchmark_summary(theme_summary, benchmark_df, benchmark_map_csv)

    write_outputs(report_dir, tests, theme_summary, benchmark_summary, use_case_summary)
    maybe_write_reports_to_db(fast_engine, tests, theme_summary, benchmark_summary, use_case_summary)

    logger.info("Wrote comparison outputs to %s", report_dir)


if __name__ == "__main__":
    main()
