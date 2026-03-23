from __future__ import annotations

import re
from datetime import datetime


_WS_RE = re.compile(r"\s+")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9 ]")


def normalize_text(value: str | None) -> str:
    if value is None:
        return ""
    text = value.lower().strip()
    text = text.replace("grand prix", "")
    text = text.replace("gp", "")
    text = _NON_ALNUM_RE.sub(" ", text)
    text = _WS_RE.sub(" ", text).strip()
    return text


def normalize_session_name(value: str | None) -> str:
    normalized = normalize_text(value)
    aliases = {
        "race": "race",
        "qualifying": "qualifying",
        "quali": "qualifying",
        "sprint": "sprint",
        "sprint qualifying": "sprint qualifying",
        "sprint quali": "sprint qualifying",
        "shootout": "sprint qualifying",
        "practice 1": "practice 1",
        "practice 2": "practice 2",
        "practice 3": "practice 3",
        "fp1": "practice 1",
        "fp2": "practice 2",
        "fp3": "practice 3",
    }
    return aliases.get(normalized, normalized)


def parse_csv_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def parse_bool(value: str | bool | None, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def parse_optional_int(value: str | None) -> int | None:
    if value is None or str(value).strip() == "":
        return None
    return int(value)


def parse_dt(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def day_diff(lhs, rhs) -> int | None:
    left = parse_dt(lhs)
    right = parse_dt(rhs)
    if left is None or right is None:
        return None
    return abs((left - right).days)
