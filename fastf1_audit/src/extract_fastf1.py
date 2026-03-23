from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import fastf1
import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import text

from .db import get_engine
from .logging_utils import setup_logger
from .normalization import normalize_session_name, normalize_text, parse_bool, parse_csv_list, parse_optional_int


load_dotenv()
logger = setup_logger("extract_fastf1")


DEFAULT_SESSION_TYPES = ["Race"]
SESSION_REQUEST_MAP = {
    "race": "Race",
    "qualifying": "Qualifying",
    "sprint": "Sprint",
    "sprint qualifying": "Sprint Qualifying",
    "practice 1": "Practice 1",
    "practice 2": "Practice 2",
    "practice 3": "Practice 3",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract FastF1 data into fastf1_audit warehouse")
    parser.add_argument("--years", nargs="+", type=int, default=None)
    parser.add_argument("--session-types", nargs="+", default=None)
    parser.add_argument("--include-telemetry", default=None)
    parser.add_argument(
        "--telemetry-mode",
        choices=["fastest-lap-only", "all-loaded-laps"],
        default=None,
    )
    parser.add_argument("--resume", default=None)
    parser.add_argument("--max-sessions", type=int, default=None)
    return parser.parse_args()


def build_runtime_config(args: argparse.Namespace) -> dict:
    years = args.years or [int(x) for x in parse_csv_list(os.environ.get("AUDIT_YEARS", "2023,2024,2025"))]
    session_types = args.session_types or parse_csv_list(os.environ.get("AUDIT_SESSION_TYPES", "Race"))
    if not session_types:
        session_types = DEFAULT_SESSION_TYPES

    include_telemetry = parse_bool(args.include_telemetry, parse_bool(os.environ.get("INCLUDE_TELEMETRY"), False))
    telemetry_mode = args.telemetry_mode or os.environ.get("TELEMETRY_MODE", "fastest-lap-only")
    resume_mode = parse_bool(args.resume, parse_bool(os.environ.get("RESUME_MODE"), True))
    max_sessions = args.max_sessions if args.max_sessions is not None else parse_optional_int(os.environ.get("MAX_SESSIONS"))

    return {
        "years": years,
        "session_types": session_types,
        "include_telemetry": include_telemetry,
        "telemetry_mode": telemetry_mode,
        "resume_mode": resume_mode,
        "max_sessions": max_sessions,
    }


def normalize_seconds(series: pd.Series | None) -> pd.Series | None:
    if series is None:
        return None
    return pd.to_timedelta(series, errors="coerce").dt.total_seconds()


def safe_col(df: pd.DataFrame, col: str):
    return df[col] if col in df.columns else None


def sanitize_uid_part(value: str) -> str:
    return normalize_text(value).replace(" ", "_")


def session_uid(year: int, round_number: int | None, event_name: str, session_name: str) -> str:
    rn = round_number if round_number is not None else 0
    event_part = sanitize_uid_part(event_name)
    session_part = sanitize_uid_part(session_name)
    return f"{year}_{rn}_{event_part}_{session_part}"


def canonical_fastf1_session_name(value: str) -> str:
    normalized = normalize_session_name(value)
    return SESSION_REQUEST_MAP.get(normalized, value)


def table_replace_session(df: pd.DataFrame, table: str, engine, uid: str) -> int:
    if df is None or df.empty:
        return 0
    with engine.begin() as conn:
        conn.exec_driver_sql(f"DELETE FROM fastf1_raw.{table} WHERE session_uid = %s", (uid,))
    df.to_sql(table, engine, schema="fastf1_raw", if_exists="append", index=False, method="multi", chunksize=5000)
    return len(df)


def upsert_session_start_log(engine, run_id: int, task: dict) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO fastf1_core.extraction_session_log
                (run_id, session_uid, year, round_number, event_name, session_name, status, message)
                VALUES (:run_id, :session_uid, :year, :round_number, :event_name, :session_name, 'started', 'started')
                """
            ),
            {
                "run_id": run_id,
                "session_uid": task["session_uid"],
                "year": task["year"],
                "round_number": task["round_number"],
                "event_name": task["event_name"],
                "session_name": task["session_name"],
            },
        )


def update_session_log(engine, run_id: int, session_uid_value: str, status: str, message: str, row_counts: dict | None = None):
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE fastf1_core.extraction_session_log
                SET status = :status,
                    message = :message,
                    row_counts_json = :row_counts_json,
                    finished_at = NOW()
                WHERE run_id = :run_id
                  AND session_uid = :session_uid
                  AND status = 'started'
                """
            ),
            {
                "status": status,
                "message": message,
                "row_counts_json": json.dumps(row_counts or {}),
                "run_id": run_id,
                "session_uid": session_uid_value,
            },
        )


def increment_run_counter(engine, run_id: int, field: str):
    with engine.begin() as conn:
        conn.execute(
            text(f"UPDATE fastf1_core.extraction_runs SET {field} = {field} + 1 WHERE run_id = :run_id"),
            {"run_id": run_id},
        )


def start_run(engine, cfg: dict, total_tasks: int) -> int:
    with engine.begin() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO fastf1_core.extraction_runs
                (years_csv, session_types_csv, include_telemetry, telemetry_mode, resume_mode, max_sessions, total_tasks)
                VALUES (:years_csv, :session_types_csv, :include_telemetry, :telemetry_mode, :resume_mode, :max_sessions, :total_tasks)
                RETURNING run_id
                """
            ),
            {
                "years_csv": ",".join(str(y) for y in cfg["years"]),
                "session_types_csv": ",".join(cfg["session_types"]),
                "include_telemetry": cfg["include_telemetry"],
                "telemetry_mode": cfg["telemetry_mode"],
                "resume_mode": cfg["resume_mode"],
                "max_sessions": cfg["max_sessions"],
                "total_tasks": total_tasks,
            },
        )
        return int(result.scalar_one())


def finish_run(engine, run_id: int, status: str):
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE fastf1_core.extraction_runs
                SET status = :status,
                    finished_at = NOW()
                WHERE run_id = :run_id
                """
            ),
            {"status": status, "run_id": run_id},
        )


def session_exists(engine, uid: str) -> bool:
    with engine.begin() as conn:
        row = conn.execute(
            text("SELECT 1 FROM fastf1_raw.sessions WHERE session_uid = :session_uid LIMIT 1"),
            {"session_uid": uid},
        ).fetchone()
    return row is not None


def prepare_tasks(cfg: dict) -> list[dict]:
    tasks: list[dict] = []
    for year in cfg["years"]:
        schedule = fastf1.get_event_schedule(year)
        for _, row in schedule.iterrows():
            round_value = row.get("RoundNumber")
            round_number = int(round_value) if pd.notna(round_value) else 0
            # FastF1 testing events can appear with round 0 and are not loadable by round number.
            if round_number <= 0:
                continue
            event_name = str(row.get("EventName") or "unknown_event")
            for requested_session_name in cfg["session_types"]:
                canonical_session_name = canonical_fastf1_session_name(requested_session_name)
                uid = session_uid(year, round_number, event_name, canonical_session_name)
                tasks.append(
                    {
                        "year": year,
                        "round_number": round_number,
                        "event_name": event_name,
                        "session_name": canonical_session_name,
                        "session_uid": uid,
                    }
                )
    if cfg["max_sessions"] is not None:
        tasks = tasks[: cfg["max_sessions"]]
    return tasks


def extract_one_session(year: int, round_number: int, session_name: str, include_telemetry: bool, telemetry_mode: str):
    session = fastf1.get_session(year, round_number, session_name)
    session.load(telemetry=include_telemetry, weather=True, messages=False)

    event = session.event
    uid = session_uid(year, round_number, str(event.get("EventName") or "unknown_event"), str(session.name))

    sessions_df = pd.DataFrame(
        [
            {
                "session_uid": uid,
                "year": year,
                "round_number": round_number,
                "country": event.get("Country"),
                "location": event.get("Location"),
                "event_name": event.get("EventName"),
                "official_event_name": event.get("OfficialEventName"),
                "session_name": session.name,
                "session_type": normalize_session_name(session.name),
                "event_date": pd.to_datetime(event.get("EventDate"), utc=True, errors="coerce"),
                "session_date": pd.to_datetime(getattr(session, "date", None), utc=True, errors="coerce"),
            }
        ]
    )

    drivers_rows = []
    for drv in session.drivers:
        info = session.get_driver(drv)
        drivers_rows.append(
            {
                "session_uid": uid,
                "driver_number": int(info.get("DriverNumber")),
                "driver_code": info.get("Abbreviation"),
                "broadcast_name": info.get("BroadcastName"),
                "full_name": info.get("FullName"),
                "team_name": info.get("TeamName"),
                "team_color": info.get("TeamColor"),
                "country_code": info.get("CountryCode"),
            }
        )
    drivers_df = pd.DataFrame(drivers_rows)

    results_df = pd.DataFrame()
    if hasattr(session, "results") and session.results is not None and len(session.results) > 0:
        r = session.results.copy()
        results_df = pd.DataFrame(
            {
                "session_uid": uid,
                "driver_number": pd.to_numeric(safe_col(r, "DriverNumber"), errors="coerce"),
                "position": pd.to_numeric(safe_col(r, "Position"), errors="coerce"),
                "classified_position": safe_col(r, "ClassifiedPosition"),
                "points": pd.to_numeric(safe_col(r, "Points"), errors="coerce"),
                "status": safe_col(r, "Status"),
                "grid_position": pd.to_numeric(safe_col(r, "GridPosition"), errors="coerce"),
                "q1": normalize_seconds(safe_col(r, "Q1")),
                "q2": normalize_seconds(safe_col(r, "Q2")),
                "q3": normalize_seconds(safe_col(r, "Q3")),
                "time_seconds": normalize_seconds(safe_col(r, "Time")),
            }
        )
        results_df = results_df.dropna(subset=["driver_number"])

    laps_df = pd.DataFrame()
    if hasattr(session, "laps") and session.laps is not None and len(session.laps) > 0:
        l = session.laps.copy()
        fresh_col = safe_col(l, "FreshTyre")
        track_status_col = safe_col(l, "TrackStatus")
        laps_df = pd.DataFrame(
            {
                "session_uid": uid,
                "driver_number": pd.to_numeric(safe_col(l, "DriverNumber"), errors="coerce"),
                "lap_number": pd.to_numeric(safe_col(l, "LapNumber"), errors="coerce"),
                "stint": pd.to_numeric(safe_col(l, "Stint"), errors="coerce"),
                "lap_time_seconds": normalize_seconds(safe_col(l, "LapTime")),
                "sector1_time_seconds": normalize_seconds(safe_col(l, "Sector1Time")),
                "sector2_time_seconds": normalize_seconds(safe_col(l, "Sector2Time")),
                "sector3_time_seconds": normalize_seconds(safe_col(l, "Sector3Time")),
                "compound": safe_col(l, "Compound"),
                "tyre_life": pd.to_numeric(safe_col(l, "TyreLife"), errors="coerce"),
                "fresh_tyre": fresh_col.astype(str) if fresh_col is not None else None,
                "team": safe_col(l, "Team"),
                "track_status": track_status_col.astype(str) if track_status_col is not None else None,
                "position": pd.to_numeric(safe_col(l, "Position"), errors="coerce"),
                "is_accurate": safe_col(l, "IsAccurate"),
                "is_personal_best": safe_col(l, "IsPersonalBest"),
                "pit_in_time_seconds": normalize_seconds(safe_col(l, "PitInTime")),
                "pit_out_time_seconds": normalize_seconds(safe_col(l, "PitOutTime")),
                "lap_start_time_seconds": normalize_seconds(safe_col(l, "LapStartTime")),
            }
        )
        laps_df = laps_df.dropna(subset=["driver_number", "lap_number"])

    weather_df = pd.DataFrame()
    if hasattr(session, "weather_data") and session.weather_data is not None and len(session.weather_data) > 0:
        w = session.weather_data.copy()
        weather_df = pd.DataFrame(
            {
                "session_uid": uid,
                "time_seconds": normalize_seconds(safe_col(w, "Time")),
                "air_temp": pd.to_numeric(safe_col(w, "AirTemp"), errors="coerce"),
                "humidity": pd.to_numeric(safe_col(w, "Humidity"), errors="coerce"),
                "pressure": pd.to_numeric(safe_col(w, "Pressure"), errors="coerce"),
                "rainfall": safe_col(w, "Rainfall"),
                "track_temp": pd.to_numeric(safe_col(w, "TrackTemp"), errors="coerce"),
                "wind_direction": pd.to_numeric(safe_col(w, "WindDirection"), errors="coerce"),
                "wind_speed": pd.to_numeric(safe_col(w, "WindSpeed"), errors="coerce"),
            }
        )

    telemetry_rows = []
    if include_telemetry and hasattr(session, "laps") and session.laps is not None and len(session.laps) > 0:
        if telemetry_mode == "fastest-lap-only":
            fastest = session.laps.pick_fastest()
            source_laps = fastest.to_frame().T if fastest is not None else pd.DataFrame()
        else:
            source_laps = session.laps

        for _, lap in source_laps.iterrows():
            drv = int(lap["DriverNumber"])
            lap_no = float(lap["LapNumber"])
            try:
                car = lap.get_car_data().add_distance()
                pos = lap.get_pos_data()
                merged = car.copy().reset_index(drop=True)
                if pos is not None and len(pos) > 0:
                    pos2 = pos.copy().reset_index(drop=True)
                    limit = min(len(merged), len(pos2))
                    merged = pd.concat(
                        [merged.iloc[:limit], pos2.iloc[:limit][[c for c in ["X", "Y", "Z"] if c in pos2.columns]]],
                        axis=1,
                    )
                for _, row in merged.iterrows():
                    telemetry_rows.append(
                        {
                            "session_uid": uid,
                            "driver_number": drv,
                            "lap_number": lap_no,
                            "sample_time_seconds": pd.to_timedelta(row.get("Time"), errors="coerce").total_seconds()
                            if pd.notna(row.get("Time"))
                            else None,
                            "speed": row.get("Speed"),
                            "throttle": row.get("Throttle"),
                            "brake": row.get("Brake"),
                            "n_gear": row.get("nGear"),
                            "rpm": row.get("RPM"),
                            "drs": row.get("DRS"),
                            "x": row.get("X"),
                            "y": row.get("Y"),
                            "z": row.get("Z"),
                        }
                    )
            except Exception:
                continue

    telemetry_df = pd.DataFrame(telemetry_rows)

    return {
        "session_uid": uid,
        "sessions": sessions_df,
        "drivers": drivers_df,
        "results": results_df,
        "laps": laps_df,
        "weather": weather_df,
        "telemetry": telemetry_df,
    }


def main() -> None:
    args = parse_args()
    cfg = build_runtime_config(args)

    cache_dir = Path(os.environ.get("FASTF1_CACHE_DIR", "./.fastf1_cache"))
    cache_dir.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(cache_dir))

    engine = get_engine("FASTF1")

    tasks = prepare_tasks(cfg)
    run_id = start_run(engine, cfg, len(tasks))
    logger.info("Starting extraction run_id=%s with %s tasks", run_id, len(tasks))

    failed = False

    for task in tasks:
        uid = task["session_uid"]

        if cfg["resume_mode"] and session_exists(engine, uid):
            upsert_session_start_log(engine, run_id, task)
            update_session_log(engine, run_id, uid, "skipped_existing", "session already loaded", {})
            increment_run_counter(engine, run_id, "skipped_tasks")
            logger.info("Skipped existing session_uid=%s", uid)
            continue

        upsert_session_start_log(engine, run_id, task)

        try:
            payload = extract_one_session(
                year=task["year"],
                round_number=task["round_number"],
                session_name=task["session_name"],
                include_telemetry=cfg["include_telemetry"],
                telemetry_mode=cfg["telemetry_mode"],
            )

            loaded_uid = payload["session_uid"]
            counts = {}
            for table_name in ["sessions", "drivers", "results", "laps", "weather", "telemetry"]:
                counts[table_name] = table_replace_session(payload[table_name], table_name, engine, loaded_uid)

            update_session_log(engine, run_id, uid, "success", "loaded", counts)
            increment_run_counter(engine, run_id, "completed_tasks")
            logger.info("Loaded session_uid=%s counts=%s", loaded_uid, counts)

        except Exception as exc:
            failed = True
            update_session_log(engine, run_id, uid, "failed", str(exc), {})
            increment_run_counter(engine, run_id, "failed_tasks")
            logger.exception(
                "FAILED year=%s round=%s session=%s",
                task["year"],
                task["round_number"],
                task["session_name"],
            )

    finish_run(engine, run_id, "failed" if failed else "success")
    logger.info("Finished extraction run_id=%s status=%s", run_id, "failed" if failed else "success")


if __name__ == "__main__":
    main()
