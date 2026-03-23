#!/usr/bin/env python3
import argparse
import csv
import json
import os
import re
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

BASE_URL = "https://api.openf1.org/v1"
DATA_DIR_DEFAULT = "data"
STATE_FILE_NAME = "extract_state.json"
ERROR_LOG_NAME = "extraction_errors.log"
MISSING_DATA_STATUS_CODES = {400, 404}
TELEMETRY_FALLBACK_STATUS_CODES = {422, 500}
DEFAULT_SESSION_NAMES = [
    "Race",
    "Qualifying",
    "Sprint",
    "Sprint Qualifying",
    "Practice 1",
    "Practice 2",
    "Practice 3",
]

# Endpoints that should be fetched once per session
SESSION_WIDE_ENDPOINTS = [
    "race_control",
    "weather",
    "intervals",
    "laps",
    "pit",
    "position",
    "stints",
    "team_radio",
]

# Large telemetry endpoints: fetch in time chunks
TIME_CHUNKED_ENDPOINTS = [
    "car_data",
    "location",
]


class PauseExtraction(Exception):
    def __init__(self, reason: str, context: dict[str, Any]) -> None:
        super().__init__(reason)
        self.reason = reason
        self.context = context


class DualRateLimiter:
    """Enforce both per-second and per-minute request limits."""

    def __init__(self, per_second: int = 3, per_minute: int = 30) -> None:
        self.per_second = per_second
        self.per_minute = per_minute
        self.second_window: deque[float] = deque()
        self.minute_window: deque[float] = deque()

    def _prune(self, now: float) -> None:
        while self.second_window and now - self.second_window[0] >= 1.0:
            self.second_window.popleft()
        while self.minute_window and now - self.minute_window[0] >= 60.0:
            self.minute_window.popleft()

    def wait_for_slot(self) -> None:
        while True:
            now = time.monotonic()
            self._prune(now)

            if len(self.second_window) < self.per_second and len(self.minute_window) < self.per_minute:
                return

            wait_for_second = 0.0
            wait_for_minute = 0.0

            if len(self.second_window) >= self.per_second:
                wait_for_second = max(0.0, 1.0 - (now - self.second_window[0]))
            if len(self.minute_window) >= self.per_minute:
                wait_for_minute = max(0.0, 60.0 - (now - self.minute_window[0]))

            sleep_for = max(wait_for_second, wait_for_minute, 0.05)
            time.sleep(sleep_for)

    def mark_request(self) -> None:
        now = time.monotonic()
        self.second_window.append(now)
        self.minute_window.append(now)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def log(message: str) -> None:
    print(message, flush=True)


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return value.strip("_") or "unknown"


def write_state(path: str, state: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    state["updated_at_utc"] = utc_now_iso()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, sort_keys=True)


def load_state(path: str) -> dict[str, Any] | None:
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def update_state(path: str, state: dict[str, Any], **updates: Any) -> None:
    state.update(updates)
    write_state(path, state)


def session_key_from_state(state: dict[str, Any]) -> int | None:
    for key in ("pause_context", "current_checkpoint", "last_success"):
        ctx = state.get(key)
        if isinstance(ctx, dict) and ctx.get("session_key") is not None:
            try:
                return int(ctx["session_key"])
            except (TypeError, ValueError):
                continue
    return None


def parse_iso_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def to_api_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_file_safe_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")


def iter_time_windows(start: datetime, end: datetime, chunk_minutes: int) -> list[tuple[datetime, datetime]]:
    windows: list[tuple[datetime, datetime]] = []
    cursor = start
    step = timedelta(minutes=chunk_minutes)
    while cursor < end:
        nxt = min(cursor + step, end)
        windows.append((cursor, nxt))
        cursor = nxt
    return windows


def parse_csv_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def classify_session_name(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    if "sprint qualifying" in normalized or "sprint shootout" in normalized:
        return "Sprint Qualifying"
    if "sprint" in normalized:
        return "Sprint"
    if "qualifying" in normalized or "quali" in normalized:
        return "Qualifying"
    if "practice" in normalized or normalized.startswith("fp"):
        return "Practice"
    if "race" in normalized:
        return "Race"
    return "Other"


def fetch_sessions(
    session: requests.Session,
    limiter: DualRateLimiter,
    timeout: int,
    max_retries: int,
    session_names: list[str],
) -> list[dict[str, Any]]:
    if not session_names:
        return get_json(session, limiter, "sessions", {}, timeout, max_retries)

    by_session_key: dict[int, dict[str, Any]] = {}
    for session_name in session_names:
        payload = get_json(
            session,
            limiter,
            "sessions",
            {"session_name": session_name},
            timeout,
            max_retries,
        )
        for row in payload:
            key_raw = row.get("session_key")
            try:
                key = int(key_raw)
            except (TypeError, ValueError):
                continue
            by_session_key[key] = row
    return list(by_session_key.values())


def get_with_limits(
    session: requests.Session,
    limiter: DualRateLimiter,
    endpoint: str,
    params: dict[str, Any],
    timeout: int,
    max_retries: int,
) -> requests.Response:
    url = f"{BASE_URL}/{endpoint}"
    backoff = 2.0

    for attempt in range(1, max_retries + 1):
        limiter.wait_for_slot()
        limiter.mark_request()

        try:
            response = session.get(url, params=params, timeout=timeout)
        except requests.RequestException:
            if attempt == max_retries:
                raise
            time.sleep(backoff)
            backoff = min(backoff * 2.0, 60.0)
            continue

        if response.status_code == 429:
            retry_after = response.headers.get("Retry-After")
            try:
                wait_seconds = float(retry_after) if retry_after is not None else backoff
            except ValueError:
                wait_seconds = backoff

            if attempt == max_retries:
                response.raise_for_status()
            time.sleep(max(wait_seconds, 1.0))
            backoff = min(backoff * 2.0, 60.0)
            continue

        if 500 <= response.status_code < 600:
            if attempt == max_retries:
                response.raise_for_status()
            time.sleep(backoff)
            backoff = min(backoff * 2.0, 60.0)
            continue

        response.raise_for_status()
        return response

    raise RuntimeError("Unexpected retry loop exit")


def get_json(
    session: requests.Session,
    limiter: DualRateLimiter,
    endpoint: str,
    params: dict[str, Any],
    timeout: int,
    max_retries: int,
) -> list[dict[str, Any]]:
    response = get_with_limits(session, limiter, endpoint, params, timeout, max_retries)
    payload = response.json()
    if not isinstance(payload, list):
        raise ValueError(f"Expected list JSON from endpoint {endpoint}")
    return payload


def get_json_allow_missing(
    session: requests.Session,
    limiter: DualRateLimiter,
    endpoint: str,
    params: dict[str, Any],
    timeout: int,
    max_retries: int,
    missing_status_codes: set[int] | None = None,
) -> tuple[list[dict[str, Any]], str]:
    allowed = set(MISSING_DATA_STATUS_CODES)
    if missing_status_codes:
        allowed.update(missing_status_codes)
    try:
        payload = get_json(session, limiter, endpoint, params, timeout, max_retries)
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code in allowed:
            return [], f"missing_{exc.response.status_code}"
        raise
    return payload, "downloaded"


def download_csv(
    session: requests.Session,
    limiter: DualRateLimiter,
    endpoint: str,
    params: dict[str, Any],
    out_path: str,
    timeout: int,
    max_retries: int,
    overwrite: bool,
    allow_missing: bool = False,
    allow_missing_status_codes: set[int] | None = None,
) -> tuple[bool, str]:
    if not overwrite and os.path.exists(out_path):
        return False, "skipped_existing"

    csv_params = dict(params)
    csv_params["csv"] = "true"

    try:
        response = get_with_limits(session, limiter, endpoint, csv_params, timeout, max_retries)
    except requests.HTTPError as exc:
        allowed = set(MISSING_DATA_STATUS_CODES)
        if allow_missing_status_codes:
            allowed.update(allow_missing_status_codes)
        if (
            allow_missing
            and exc.response is not None
            and exc.response.status_code in allowed
        ):
            return False, f"missing_{exc.response.status_code}"
        raise

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(response.content)
    return True, "downloaded"


def write_sessions_index(sessions: list[dict[str, Any]], out_path: str) -> None:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    fieldnames = [
        "session_key",
        "session_name",
        "session_type",
        "date_start",
        "date_end",
        "location",
        "country_name",
        "circuit_short_name",
        "meeting_key",
        "meeting_name",
        "year",
    ]

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for s in sessions:
            writer.writerow(
                {
                    "session_key": s.get("session_key"),
                    "session_name": s.get("session_name"),
                    "session_type": s.get("session_type"),
                    "date_start": s.get("date_start"),
                    "date_end": s.get("date_end"),
                    "location": s.get("location"),
                    "country_name": s.get("country_name"),
                    "circuit_short_name": s.get("circuit_short_name"),
                    "meeting_key": s.get("meeting_key"),
                    "meeting_name": s.get("meeting_name"),
                    "year": s.get("year"),
                }
            )


def session_output_dir(base_data_dir: str, race_session: dict[str, Any]) -> str:
    year = str(race_session.get("year", "unknown"))
    meeting_name_raw = (
        race_session.get("meeting_name")
        or race_session.get("location")
        or race_session.get("circuit_short_name")
        or race_session.get("country_name")
        or "unknown_meeting"
    )
    meeting_name = slugify(str(meeting_name_raw))
    session_key = race_session.get("session_key", "unknown")
    date_start = str(race_session.get("date_start", ""))[:10]
    folder_name = f"{date_start}_session_{session_key}"
    return os.path.join(base_data_dir, year, meeting_name, folder_name)


def record_checkpoint(
    state_path: str,
    state: dict[str, Any],
    race_session: dict[str, Any],
    endpoint: str,
    out_path: str,
    driver_number: int | None = None,
) -> None:
    checkpoint = {
        "session_key": race_session.get("session_key"),
        "date_start": race_session.get("date_start"),
        "meeting_name": race_session.get("meeting_name") or race_session.get("location"),
        "endpoint": endpoint,
        "driver_number": driver_number,
        "out_path": out_path,
        "recorded_at_utc": utc_now_iso(),
    }
    update_state(state_path, state, current_checkpoint=checkpoint)


def mark_success(
    state_path: str,
    state: dict[str, Any],
    race_session: dict[str, Any],
    endpoint: str,
    out_path: str,
    status: str,
    driver_number: int | None = None,
) -> None:
    success = {
        "session_key": race_session.get("session_key"),
        "date_start": race_session.get("date_start"),
        "endpoint": endpoint,
        "driver_number": driver_number,
        "out_path": out_path,
        "status": status,
        "recorded_at_utc": utc_now_iso(),
    }
    update_state(state_path, state, last_success=success)


def handle_pause_exception(
    exc: Exception,
    state_path: str,
    state: dict[str, Any],
    race_session: dict[str, Any],
    endpoint: str,
    out_path: str,
    driver_number: int | None,
    errors_log_path: str,
) -> None:
    status_code = None
    if isinstance(exc, requests.HTTPError) and exc.response is not None:
        status_code = exc.response.status_code

    reason = "request_failed"
    if status_code == 429:
        reason = "rate_limited"

    context = {
        "session_key": race_session.get("session_key"),
        "date_start": race_session.get("date_start"),
        "endpoint": endpoint,
        "driver_number": driver_number,
        "out_path": out_path,
        "error_type": type(exc).__name__,
        "error": str(exc),
        "status_code": status_code,
        "paused_at_utc": utc_now_iso(),
    }

    with open(errors_log_path, "a", encoding="utf-8") as f:
        f.write(
            f"paused session={context['session_key']} endpoint={endpoint} driver={driver_number} "
            f"reason={reason} status={status_code} error={type(exc).__name__}:{exc}\n"
        )

    update_state(
        state_path,
        state,
        status="paused",
        pause_reason=reason,
        pause_context=context,
    )
    raise PauseExtraction(reason, context) from exc


def extract_session(
    http: requests.Session,
    limiter: DualRateLimiter,
    race_session: dict[str, Any],
    data_dir: str,
    timeout: int,
    max_retries: int,
    overwrite: bool,
    chunk_minutes: int,
    telemetry_mode: str,
    errors_log_path: str,
    state_path: str,
    state: dict[str, Any],
) -> None:
    session_key = race_session["session_key"]
    out_dir = session_output_dir(data_dir, race_session)
    os.makedirs(out_dir, exist_ok=True)

    display_name = race_session.get("meeting_name") or race_session.get("location") or "unknown_meeting"
    log(
        f"\n[Session {session_key}] {display_name} ({race_session.get('date_start')})"
    )

    try:
        drivers_json, drivers_json_status = get_json_allow_missing(
            http,
            limiter,
            "drivers",
            {"session_key": session_key},
            timeout,
            max_retries,
        )
    except Exception as exc:
        handle_pause_exception(
            exc,
            state_path,
            state,
            race_session,
            "drivers",
            os.path.join(out_dir, "drivers.csv"),
            None,
            errors_log_path,
        )

    driver_numbers = sorted({d.get("driver_number") for d in drivers_json if d.get("driver_number") is not None})
    if drivers_json_status.startswith("missing_"):
        log(f"  drivers JSON {drivers_json_status}; continuing without driver list")
    else:
        log(f"  drivers in session: {len(driver_numbers)}")

    session_meta_path = os.path.join(out_dir, "session_metadata.csv")
    with open(session_meta_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(race_session.keys()))
        writer.writeheader()
        writer.writerow(race_session)

    drivers_path = os.path.join(out_dir, "drivers.csv")
    record_checkpoint(state_path, state, race_session, "drivers", drivers_path)
    try:
        _, status = download_csv(
            http,
            limiter,
            "drivers",
            {"session_key": session_key},
            drivers_path,
            timeout,
            max_retries,
            overwrite,
            allow_missing=True,
        )
    except Exception as exc:
        handle_pause_exception(
            exc,
            state_path,
            state,
            race_session,
            "drivers",
            drivers_path,
            None,
            errors_log_path,
        )
    mark_success(state_path, state, race_session, "drivers", drivers_path, status)
    log(f"  drivers.csv {status}")

    for endpoint in SESSION_WIDE_ENDPOINTS:
        out_path = os.path.join(out_dir, f"{endpoint}.csv")
        record_checkpoint(state_path, state, race_session, endpoint, out_path)
        try:
            _, status = download_csv(
                http,
                limiter,
                endpoint,
                {"session_key": session_key},
                out_path,
                timeout,
                max_retries,
                overwrite,
                allow_missing=True,
            )
        except Exception as exc:
            handle_pause_exception(
                exc,
                state_path,
                state,
                race_session,
                endpoint,
                out_path,
                None,
                errors_log_path,
            )

        mark_success(state_path, state, race_session, endpoint, out_path, status)
        log(f"  {endpoint}.csv {status}")

    session_start_raw = race_session.get("date_start")
    session_end_raw = race_session.get("date_end")
    if not session_start_raw or not session_end_raw:
        raise PauseExtraction(
            "missing_session_dates",
            {
                "session_key": race_session.get("session_key"),
                "date_start": session_start_raw,
                "date_end": session_end_raw,
                "paused_at_utc": utc_now_iso(),
            },
        )

    session_start = parse_iso_datetime(str(session_start_raw))
    session_end = parse_iso_datetime(str(session_end_raw))
    if session_end <= session_start:
        raise PauseExtraction(
            "invalid_session_window",
            {
                "session_key": race_session.get("session_key"),
                "date_start": session_start_raw,
                "date_end": session_end_raw,
                "paused_at_utc": utc_now_iso(),
            },
        )

    if telemetry_mode == "per_driver":
        if not driver_numbers:
            log("  no driver list available; skipping per-driver telemetry endpoints")
            return

        log(f"  telemetry mode: per_driver ({len(driver_numbers)} drivers)")
        for endpoint in TIME_CHUNKED_ENDPOINTS:
            endpoint_dir = os.path.join(out_dir, endpoint)
            os.makedirs(endpoint_dir, exist_ok=True)
            for driver_number in driver_numbers:
                out_path = os.path.join(endpoint_dir, f"{endpoint}_{driver_number}.csv")
                record_checkpoint(state_path, state, race_session, endpoint, out_path, driver_number)
                try:
                    wrote, status = download_csv(
                        http,
                        limiter,
                        endpoint,
                        {"session_key": session_key, "driver_number": driver_number},
                        out_path,
                        timeout,
                        max_retries,
                        overwrite,
                        allow_missing=True,
                        allow_missing_status_codes=TELEMETRY_FALLBACK_STATUS_CODES,
                    )
                except Exception as exc:
                    handle_pause_exception(
                        exc,
                        state_path,
                        state,
                        race_session,
                        endpoint,
                        out_path,
                        driver_number,
                        errors_log_path,
                    )
                mark_success(state_path, state, race_session, endpoint, out_path, status, driver_number)
                if wrote:
                    log(f"  {endpoint}/{os.path.basename(out_path)} downloaded")
                else:
                    log(f"  {endpoint}/{os.path.basename(out_path)} {status}")
        return

    windows = iter_time_windows(session_start, session_end, chunk_minutes)
    log(f"  telemetry mode: chunked ({len(windows)} windows x {chunk_minutes}m)")

    for endpoint in TIME_CHUNKED_ENDPOINTS:
        endpoint_dir = os.path.join(out_dir, endpoint)
        os.makedirs(endpoint_dir, exist_ok=True)
        driver_fallback_dir = os.path.join(endpoint_dir, "by_driver")
        os.makedirs(driver_fallback_dir, exist_ok=True)

        for window_start, window_end in windows:
            start_api = to_api_utc(window_start)
            end_api = to_api_utc(window_end)
            start_file = to_file_safe_utc(window_start)
            end_file = to_file_safe_utc(window_end)
            out_path = os.path.join(endpoint_dir, f"{endpoint}_{start_file}__{end_file}.csv")
            record_checkpoint(state_path, state, race_session, endpoint, out_path)

            try:
                wrote, status = download_csv(
                    http,
                    limiter,
                    endpoint,
                    {
                        "session_key": session_key,
                        "date>=": start_api,
                        "date<": end_api,
                    },
                    out_path,
                    timeout,
                    max_retries,
                    overwrite,
                    allow_missing=True,
                    allow_missing_status_codes=TELEMETRY_FALLBACK_STATUS_CODES,
                )
            except Exception as exc:
                handle_pause_exception(
                    exc,
                    state_path,
                    state,
                    race_session,
                    endpoint,
                    out_path,
                    None,
                    errors_log_path,
                )

            if wrote:
                mark_success(state_path, state, race_session, endpoint, out_path, status)
                log(f"  {endpoint}/{os.path.basename(out_path)} downloaded")
                continue

            if status in {f"missing_{code}" for code in TELEMETRY_FALLBACK_STATUS_CODES} and driver_numbers:
                fallback_downloaded = 0
                for driver_number in driver_numbers:
                    driver_out_path = os.path.join(
                        driver_fallback_dir,
                        f"{endpoint}_{driver_number}_{start_file}__{end_file}.csv",
                    )
                    record_checkpoint(
                        state_path,
                        state,
                        race_session,
                        endpoint,
                        driver_out_path,
                        driver_number,
                    )
                    try:
                        driver_wrote, driver_status = download_csv(
                            http,
                            limiter,
                            endpoint,
                            {
                                "session_key": session_key,
                                "driver_number": driver_number,
                                "date>=": start_api,
                                "date<": end_api,
                            },
                            driver_out_path,
                            timeout,
                            max_retries,
                            overwrite,
                            allow_missing=True,
                            allow_missing_status_codes=TELEMETRY_FALLBACK_STATUS_CODES,
                        )
                    except Exception as exc:
                        handle_pause_exception(
                            exc,
                            state_path,
                            state,
                            race_session,
                            endpoint,
                            driver_out_path,
                            driver_number,
                            errors_log_path,
                        )

                    mark_success(
                        state_path,
                        state,
                        race_session,
                        endpoint,
                        driver_out_path,
                        driver_status,
                        driver_number,
                    )
                    if driver_wrote:
                        fallback_downloaded += 1

                if fallback_downloaded > 0:
                    log(
                        f"  {endpoint}/{os.path.basename(out_path)} {status}; "
                        f"fallback downloaded {fallback_downloaded}/{len(driver_numbers)} driver chunks"
                    )
                else:
                    log(
                        f"  {endpoint}/{os.path.basename(out_path)} {status}; "
                        f"fallback missing for all {len(driver_numbers)} drivers"
                    )
                mark_success(state_path, state, race_session, endpoint, out_path, status)
                continue

            mark_success(state_path, state, race_session, endpoint, out_path, status)
            log(f"  {endpoint}/{os.path.basename(out_path)} {status}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Download OpenF1 session data from earliest available session to latest, "
            "respecting rate limits of 3 req/sec and 30 req/min."
        )
    )
    parser.add_argument(
        "--data-dir",
        default=DATA_DIR_DEFAULT,
        help="Output root folder (default: data)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=120,
        help="Per-request timeout in seconds (default: 120)",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=6,
        help="Max retries for transient failures/429/5xx (default: 6)",
    )
    parser.add_argument(
        "--start-session-key",
        type=int,
        default=None,
        help="Optional session_key to resume from",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing CSV files",
    )
    parser.add_argument(
        "--ignore-state",
        action="store_true",
        help="Ignore any existing extract_state.json and start normal scan",
    )
    parser.add_argument(
        "--pause-wait-minutes",
        type=int,
        default=60,
        help=(
            "When extraction pauses (rate limit/request failure), wait this many minutes "
            "and retry automatically. Set 0 to exit immediately. (default: 60)"
        ),
    )
    parser.add_argument(
        "--chunk-minutes",
        type=int,
        default=5,
        help="Chunk size (minutes) for car_data/location downloads. (default: 5)",
    )
    parser.add_argument(
        "--telemetry-mode",
        choices=["chunked", "per_driver"],
        default="chunked",
        help="Telemetry download strategy for car_data/location. (default: chunked)",
    )
    parser.add_argument(
        "--session-names",
        default=",".join(DEFAULT_SESSION_NAMES),
        help=(
            "Comma-separated session_name values to fetch from /sessions "
            "(default: Race,Qualifying,Sprint,Sprint Qualifying,Practice 1,Practice 2,Practice 3). "
            "Use 'all' to fetch all session names returned by OpenF1."
        ),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    os.makedirs(args.data_dir, exist_ok=True)
    if args.chunk_minutes <= 0:
        raise ValueError("--chunk-minutes must be > 0")
    session_names = parse_csv_list(args.session_names)
    if len(session_names) == 1 and session_names[0].lower() == "all":
        session_names = []

    limiter = DualRateLimiter(per_second=3, per_minute=30)
    errors_log_path = os.path.join(args.data_dir, ERROR_LOG_NAME)
    state_path = os.path.join(args.data_dir, STATE_FILE_NAME)

    state: dict[str, Any] = {
        "status": "running",
        "started_at_utc": utc_now_iso(),
        "data_dir": os.path.abspath(args.data_dir),
        "limits": {"per_second": 3, "per_minute": 30},
        "chunk_minutes": args.chunk_minutes,
        "telemetry_mode": args.telemetry_mode,
        "session_names": session_names if session_names else ["all"],
    }

    if not args.ignore_state:
        existing_state = load_state(state_path)
        if existing_state:
            state.update(existing_state)
            state["resumed_at_utc"] = utc_now_iso()
            state["status"] = "running"
            log(f"Resuming from existing state: {state_path}")
            checkpoint = existing_state.get("current_checkpoint")
            if checkpoint:
                log(
                    "Last checkpoint: "
                    f"session={checkpoint.get('session_key')} "
                    f"endpoint={checkpoint.get('endpoint')} "
                    f"driver={checkpoint.get('driver_number')}"
                )

    write_state(state_path, state)

    wait_seconds = max(args.pause_wait_minutes, 0) * 60

    while True:
        with requests.Session() as http:
            if session_names:
                log(f"Fetching sessions for names: {', '.join(session_names)}")
            else:
                log("Fetching all session names (no session_name filter)...")
            try:
                sessions = fetch_sessions(
                    http,
                    limiter,
                    args.timeout,
                    args.max_retries,
                    session_names,
                )
            except Exception as exc:
                status_code = None
                if isinstance(exc, requests.HTTPError) and exc.response is not None:
                    status_code = exc.response.status_code
                reason = "rate_limited" if status_code == 429 else "request_failed"
                update_state(
                    state_path,
                    state,
                    status="waiting",
                    pause_reason=reason,
                    pause_context={
                        "session_key": None,
                        "endpoint": "sessions",
                        "driver_number": None,
                        "status_code": status_code,
                        "error_type": type(exc).__name__,
                        "error": str(exc),
                        "paused_at_utc": utc_now_iso(),
                    },
                )
                log(
                    f"Failed to fetch sessions list (status={status_code}). "
                    f"reason={reason}. error={type(exc).__name__}: {exc}"
                )
                if wait_seconds <= 0:
                    log("Auto-wait disabled; exiting now.")
                    return
                resume_at = datetime.now(timezone.utc).timestamp() + wait_seconds
                update_state(
                    state_path,
                    state,
                    wait_started_at_utc=utc_now_iso(),
                    wait_minutes=args.pause_wait_minutes,
                    next_resume_at_utc=datetime.fromtimestamp(
                        resume_at, tz=timezone.utc
                    ).isoformat(timespec="seconds"),
                )
                log(
                    f"Sleeping for {args.pause_wait_minutes} minutes before retrying "
                    "(auto-resume enabled)."
                )
                time.sleep(wait_seconds)
                update_state(state_path, state, status="running", resumed_at_utc=utc_now_iso())
                continue

            if not sessions:
                update_state(state_path, state, status="completed", completed_at_utc=utc_now_iso())
                log("No sessions returned by OpenF1 API.")
                return

            # Sort oldest -> newest
            sessions.sort(
                key=lambda s: (
                    str(s.get("date_start", "")),
                    int(s.get("session_key", 0)),
                )
            )

            resume_session_key = args.start_session_key
            if resume_session_key is None and not args.ignore_state:
                resume_session_key = session_key_from_state(state)

            if resume_session_key is not None:
                sessions = [s for s in sessions if int(s.get("session_key", 0)) >= int(resume_session_key)]
                log(f"Resuming session scan from session_key >= {int(resume_session_key)}")

            if not sessions:
                update_state(state_path, state, status="completed", completed_at_utc=utc_now_iso())
                log("No sessions to process after applying filters.")
                return

            index_path = os.path.join(args.data_dir, "sessions_index.csv")
            write_sessions_index(sessions, index_path)

            race_sessions = [
                s
                for s in sessions
                if classify_session_name(str(s.get("session_name") or s.get("session_type"))) == "Race"
            ]
            legacy_race_index_path = os.path.join(args.data_dir, "race_sessions_index.csv")
            write_sessions_index(race_sessions, legacy_race_index_path)

            session_type_counts: dict[str, int] = {}
            for row in sessions:
                normalized = classify_session_name(str(row.get("session_name") or row.get("session_type")))
                session_type_counts[normalized] = session_type_counts.get(normalized, 0) + 1
            type_counts_text = ", ".join(
                f"{session_type}={count}" for session_type, count in sorted(session_type_counts.items())
            )

            first = sessions[0]
            last = sessions[-1]
            log(
                f"Found {len(sessions)} sessions ({type_counts_text}). "
                f"Range: {first.get('date_start')} (session {first.get('session_key')}) "
                f"to {last.get('date_start')} (session {last.get('session_key')})."
            )
            log(f"Writing all data under: {os.path.abspath(args.data_dir)}")

            try:
                for idx, race_session in enumerate(sessions, start=1):
                    log(f"\n=== [{idx}/{len(sessions)}] ===")
                    extract_session(
                        http,
                        limiter,
                        race_session,
                        args.data_dir,
                        args.timeout,
                        args.max_retries,
                        args.overwrite,
                        args.chunk_minutes,
                        args.telemetry_mode,
                        errors_log_path,
                        state_path,
                        state,
                    )
            except PauseExtraction as pause:
                log(
                    "Paused extraction. "
                    f"reason={pause.reason}, session={pause.context.get('session_key')}, "
                    f"endpoint={pause.context.get('endpoint')}, driver={pause.context.get('driver_number')}, "
                    f"paused_at_utc={pause.context.get('paused_at_utc')}"
                )
                if wait_seconds <= 0:
                    log("Auto-wait disabled; exiting now. Run again later to resume.")
                    return

                resume_at = datetime.now(timezone.utc).timestamp() + wait_seconds
                update_state(
                    state_path,
                    state,
                    status="waiting",
                    wait_started_at_utc=utc_now_iso(),
                    wait_minutes=args.pause_wait_minutes,
                    next_resume_at_utc=datetime.fromtimestamp(
                        resume_at, tz=timezone.utc
                    ).isoformat(timespec="seconds"),
                )
                log(
                    f"Sleeping for {args.pause_wait_minutes} minutes before retrying "
                    "(auto-resume enabled)."
                )
                time.sleep(wait_seconds)
                update_state(state_path, state, status="running", resumed_at_utc=utc_now_iso())
                continue

        update_state(state_path, state, status="completed", completed_at_utc=utc_now_iso())
        log("\nAll done.")
        return


if __name__ == "__main__":
    main()
