"""Discover OpenF1 CSV files and map them to destination tables."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .mappings import FILE_TO_TABLE, LOAD_ORDER

SESSION_KEY_RE = re.compile(r"_session_(\d+)")
MEETING_KEY_RE = re.compile(r"meeting_(\d+)")


@dataclass(frozen=True)
class DiscoveredFile:
    table: str
    path: Path
    session_key: int | None
    meeting_key: int | None


def _extract_keys(path: Path) -> tuple[int | None, int | None]:
    as_text = str(path)
    session_key_match = SESSION_KEY_RE.search(as_text)
    meeting_key_match = MEETING_KEY_RE.search(as_text)
    session_key = int(session_key_match.group(1)) if session_key_match else None
    meeting_key = int(meeting_key_match.group(1)) if meeting_key_match else None
    return session_key, meeting_key


def _table_from_path(path: Path) -> str | None:
    stem = path.stem.lower()
    parent = path.parent.name.lower()

    # Single file form: laps.csv, drivers.csv, etc.
    if stem in FILE_TO_TABLE:
        return FILE_TO_TABLE[stem]

    # Chunk/per-driver form: car_data_*.csv, location_*.csv, etc.
    for prefix, table in FILE_TO_TABLE.items():
        if stem.startswith(prefix + "_"):
            return table

    # Directory-hinted form
    if parent in FILE_TO_TABLE:
        return FILE_TO_TABLE[parent]

    return None


def discover_files(data_dir: str | Path) -> list[DiscoveredFile]:
    base = Path(data_dir)
    if not base.exists():
        raise FileNotFoundError(f"Data directory not found: {base}")

    discovered: list[DiscoveredFile] = []
    for path in base.rglob("*.csv"):
        if not path.is_file():
            continue
        table = _table_from_path(path)
        if table is None:
            continue
        session_key, meeting_key = _extract_keys(path)
        discovered.append(
            DiscoveredFile(
                table=table,
                path=path,
                session_key=session_key,
                meeting_key=meeting_key,
            )
        )

    order_index = {table: idx for idx, table in enumerate(LOAD_ORDER)}
    discovered.sort(key=lambda f: (order_index.get(f.table, 10_000), f.path.as_posix()))
    return discovered
