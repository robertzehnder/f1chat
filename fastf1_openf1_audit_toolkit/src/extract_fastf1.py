from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Iterable, List

import fastf1
import pandas as pd
from dotenv import load_dotenv

from .db import get_engine


load_dotenv()


DEFAULT_SESSION_TYPES = ["Race"]


def session_uid(year: int, round_number: int | None, event_name: str, session_name: str) -> str:
    rn = round_number if round_number is not None else 0
    return f"{year}_{rn}_{event_name}_{session_name}".replace(" ", "_").replace("/", "-")


def normalize_seconds(series: pd.Series) -> pd.Series:
    try:
        return pd.to_timedelta(series).dt.total_seconds()
    except Exception:
        return pd.Series([None] * len(series))


def safe_col(df: pd.DataFrame, col: str):
    return df[col] if col in df.columns else None


def prepare_sessions(years: Iterable[int], wanted_session_types: List[str]) -> list[tuple[int, int, str]]:
    tasks: list[tuple[int, int, str]] = []
    for year in years:
        schedule = fastf1.get_event_schedule(year)
        for _, row in schedule.iterrows():
            round_number = int(row.get("RoundNumber", 0)) if pd.notna(row.get("RoundNumber")) else 0
            event_name = str(row.get("EventName"))
            event = fastf1.get_event(year, round_number)
            for session_name in wanted_session_types:
                try:
                    _ = event.get_session_name(session_name)
                    tasks.append((year, round_number, session_name))
                except Exception:
                    continue
    return tasks


def extract_one_session(year: int, round_number: int, session_name: str, include_telemetry: bool, telemetry_mode: str):
    session = fastf1.get_session(year, round_number, session_name)
    session.load(telemetry=include_telemetry, weather=True, messages=False)

    event = session.event
    uid = session_uid(year, round_number, str(event.get("EventName")), str(session.name))

    sessions_df = pd.DataFrame([
        {
            "session_uid": uid,
            "year": year,
            "round_number": round_number,
            "country": event.get("Country"),
            "location": event.get("Location"),
            "event_name": event.get("EventName"),
            "official_event_name": event.get("OfficialEventName"),
            "session_name": session.name,
            "session_type": session.type,
            "event_date": pd.to_datetime(event.get("EventDate"), utc=True, errors="coerce"),
            "session_date": pd.to_datetime(getattr(session, "date", None), utc=True, errors="coerce"),
        }
    ])

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
                "q1": normalize_seconds(safe_col(r, "Q1")) if safe_col(r, "Q1") is not None else None,
                "q2": normalize_seconds(safe_col(r, "Q2")) if safe_col(r, "Q2") is not None else None,
                "q3": normalize_seconds(safe_col(r, "Q3")) if safe_col(r, "Q3") is not None else None,
                "time_seconds": normalize_seconds(safe_col(r, "Time")) if safe_col(r, "Time") is not None else None,
            }
        )
        results_df = results_df.dropna(subset=["driver_number"]) if not results_df.empty else results_df

    laps_df = pd.DataFrame()
    if hasattr(session, "laps") and session.laps is not None and len(session.laps) > 0:
        l = session.laps.copy()
        laps_df = pd.DataFrame(
            {
                "session_uid": uid,
                "driver_number": pd.to_numeric(safe_col(l, "DriverNumber"), errors="coerce"),
                "lap_number": pd.to_numeric(safe_col(l, "LapNumber"), errors="coerce"),
                "stint": pd.to_numeric(safe_col(l, "Stint"), errors="coerce"),
                "lap_time_seconds": normalize_seconds(safe_col(l, "LapTime")) if safe_col(l, "LapTime") is not None else None,
                "sector1_time_seconds": normalize_seconds(safe_col(l, "Sector1Time")) if safe_col(l, "Sector1Time") is not None else None,
                "sector2_time_seconds": normalize_seconds(safe_col(l, "Sector2Time")) if safe_col(l, "Sector2Time") is not None else None,
                "sector3_time_seconds": normalize_seconds(safe_col(l, "Sector3Time")) if safe_col(l, "Sector3Time") is not None else None,
                "compound": safe_col(l, "Compound"),
                "tyre_life": pd.to_numeric(safe_col(l, "TyreLife"), errors="coerce"),
                "fresh_tyre": safe_col(l, "FreshTyre").astype(str) if safe_col(l, "FreshTyre") is not None else None,
                "team": safe_col(l, "Team"),
                "track_status": safe_col(l, "TrackStatus").astype(str) if safe_col(l, "TrackStatus") is not None else None,
                "position": pd.to_numeric(safe_col(l, "Position"), errors="coerce"),
                "is_accurate": safe_col(l, "IsAccurate"),
                "is_personal_best": safe_col(l, "IsPersonalBest"),
                "pit_in_time_seconds": normalize_seconds(safe_col(l, "PitInTime")) if safe_col(l, "PitInTime") is not None else None,
                "pit_out_time_seconds": normalize_seconds(safe_col(l, "PitOutTime")) if safe_col(l, "PitOutTime") is not None else None,
                "lap_start_time_seconds": normalize_seconds(safe_col(l, "LapStartTime")) if safe_col(l, "LapStartTime") is not None else None,
            }
        )
        laps_df = laps_df.dropna(subset=["driver_number", "lap_number"]) if not laps_df.empty else laps_df

    weather_df = pd.DataFrame()
    if hasattr(session, "weather_data") and session.weather_data is not None and len(session.weather_data) > 0:
        w = session.weather_data.copy()
        weather_df = pd.DataFrame(
            {
                "session_uid": uid,
                "time_seconds": normalize_seconds(safe_col(w, "Time")) if safe_col(w, "Time") is not None else None,
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
    if include_telemetry:
        if telemetry_mode == "fastest-lap-only":
            source_laps = session.laps.pick_fastest().to_frame().T if hasattr(session.laps, "pick_fastest") else pd.DataFrame()
        else:
            source_laps = session.laps

        if source_laps is not None and len(source_laps) > 0:
            for _, lap in source_laps.iterrows():
                drv = int(lap["DriverNumber"])
                lap_no = float(lap["LapNumber"])
                try:
                    car = lap.get_car_data().add_distance()
                    pos = lap.get_pos_data()
                    merged = car.copy()
                    if pos is not None and len(pos) > 0:
                        pos2 = pos.copy().reset_index(drop=True)
                        merged = merged.reset_index(drop=True)
                        limit = min(len(merged), len(pos2))
                        merged = pd.concat([merged.iloc[:limit], pos2.iloc[:limit][[c for c in ["X", "Y", "Z"] if c in pos2.columns]]], axis=1)
                    for _, row in merged.iterrows():
                        telemetry_rows.append(
                            {
                                "session_uid": uid,
                                "driver_number": drv,
                                "lap_number": lap_no,
                                "sample_time_seconds": pd.to_timedelta(row.get("Time")).total_seconds() if pd.notna(row.get("Time")) else None,
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
        "sessions": sessions_df,
        "drivers": drivers_df,
        "results": results_df,
        "laps": laps_df,
        "weather": weather_df,
        "telemetry": telemetry_df,
    }


def upsert_delete_then_append(df: pd.DataFrame, table: str, engine, session_uid_value: str):
    if df is None or df.empty:
        return 0
    with engine.begin() as conn:
        conn.exec_driver_sql(f"DELETE FROM fastf1_raw.{table} WHERE session_uid = %s", (session_uid_value,))
    df.to_sql(table, engine, schema="fastf1_raw", if_exists="append", index=False, method="multi", chunksize=5000)
    return len(df)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", nargs="+", type=int, required=True)
    parser.add_argument("--session-types", nargs="+", default=DEFAULT_SESSION_TYPES)
    parser.add_argument("--include-telemetry", type=lambda x: str(x).lower() == "true", default=False)
    parser.add_argument("--telemetry-mode", choices=["fastest-lap-only", "all-loaded-laps"], default="fastest-lap-only")
    args = parser.parse_args()

    cache_dir = Path(os.environ.get("FASTF1_CACHE_DIR", "./.fastf1_cache"))
    cache_dir.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(cache_dir))

    engine = get_engine("FASTF1")

    tasks = prepare_sessions(args.years, args.session_types)
    print(f"Prepared {len(tasks)} FastF1 extraction tasks")

    for year, round_number, sess_name in tasks:
        try:
            payload = extract_one_session(year, round_number, sess_name, args.include_telemetry, args.telemetry_mode)
            uid = payload["sessions"].iloc[0]["session_uid"]
            counts = {}
            for table in ["sessions", "drivers", "results", "laps", "weather", "telemetry"]:
                counts[table] = upsert_delete_then_append(payload[table], table, engine, uid)
            print(f"Loaded {uid}: {counts}")
        except Exception as exc:
            print(f"FAILED {year} round {round_number} {sess_name}: {exc}")


if __name__ == "__main__":
    main()
