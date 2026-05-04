#!/usr/bin/env python3
"""
Phase 17 chat-route smoke test. Runs three 2025-season questions of
increasing complexity through the local /api/chat endpoint, captures
per-stage spans, and prints a punch list of where time goes.

Usage (dev server must be running on http://localhost:3000):
    python scripts/phase17_chat_smoke.py
    python scripts/phase17_chat_smoke.py --warm-only
    python scripts/phase17_chat_smoke.py --base http://localhost:3000

What it does:
    For each query, fire it twice (cold then warm) so you can see the
    cache_hit difference. Reads the trace JSONL at
    web/logs/chat_query_trace.jsonl after each request to extract the
    span tree. Prints a per-question summary at the end.

Why 2025: per the user's note that 2025 has the most complete data on
Neon (raw + core both populated for all sessions).
"""

from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
TRACE_FILE = REPO_ROOT / "web" / "logs" / "chat_query_trace.jsonl"

# 2024-2025 race venues confirmed populated on Neon (queried 2026-05-02).
# We sample from this pool every run so back-to-back tests can't reuse a
# warm answer cache. Mixing 2024+2025 also sanity-checks both seasons.
VENUES_2024: list[dict[str, str]] = [
    {"phrase": "Bahrain Grand Prix 2024", "year": "2024", "circuit": "Bahrain"},
    {"phrase": "Saudi Arabian Grand Prix 2024", "year": "2024", "circuit": "Jeddah"},
    {"phrase": "Australian Grand Prix 2024", "year": "2024", "circuit": "Melbourne"},
    {"phrase": "Japanese Grand Prix 2024", "year": "2024", "circuit": "Suzuka"},
    {"phrase": "Chinese Grand Prix 2024", "year": "2024", "circuit": "Shanghai"},
    {"phrase": "Miami Grand Prix 2024", "year": "2024", "circuit": "Miami"},
    {"phrase": "Emilia Romagna Grand Prix 2024", "year": "2024", "circuit": "Imola"},
    {"phrase": "Monaco Grand Prix 2024", "year": "2024", "circuit": "Monaco"},
    {"phrase": "Canadian Grand Prix 2024", "year": "2024", "circuit": "Montreal"},
    {"phrase": "Spanish Grand Prix 2024", "year": "2024", "circuit": "Barcelona"},
    {"phrase": "Austrian Grand Prix 2024", "year": "2024", "circuit": "Spielberg"},
    {"phrase": "British Grand Prix 2024", "year": "2024", "circuit": "Silverstone"},
    {"phrase": "Hungarian Grand Prix 2024", "year": "2024", "circuit": "Budapest"},
    {"phrase": "Belgian Grand Prix 2024", "year": "2024", "circuit": "Spa"},
    {"phrase": "Dutch Grand Prix 2024", "year": "2024", "circuit": "Zandvoort"},
    {"phrase": "Italian Grand Prix 2024", "year": "2024", "circuit": "Monza"},
    {"phrase": "Azerbaijan Grand Prix 2024", "year": "2024", "circuit": "Baku"},
    {"phrase": "Singapore Grand Prix 2024", "year": "2024", "circuit": "Marina Bay"},
    {"phrase": "United States Grand Prix 2024", "year": "2024", "circuit": "Austin"},
    {"phrase": "Mexico City Grand Prix 2024", "year": "2024", "circuit": "Mexico City"},
    {"phrase": "Brazilian Grand Prix 2024", "year": "2024", "circuit": "São Paulo"},
    {"phrase": "Las Vegas Grand Prix 2024", "year": "2024", "circuit": "Las Vegas"},
    {"phrase": "Qatar Grand Prix 2024", "year": "2024", "circuit": "Lusail"},
    {"phrase": "Abu Dhabi Grand Prix 2024", "year": "2024", "circuit": "Yas Island"},
]
VENUES_2025: list[dict[str, str]] = [
    {"phrase": "Bahrain Grand Prix 2025", "year": "2025", "circuit": "Bahrain"},
    {"phrase": "Saudi Arabian Grand Prix 2025", "year": "2025", "circuit": "Jeddah"},
    {"phrase": "Australian Grand Prix 2025", "year": "2025", "circuit": "Melbourne"},
    {"phrase": "Japanese Grand Prix 2025", "year": "2025", "circuit": "Suzuka"},
    {"phrase": "Chinese Grand Prix 2025", "year": "2025", "circuit": "Shanghai"},
    {"phrase": "Miami Grand Prix 2025", "year": "2025", "circuit": "Miami Gardens"},
    {"phrase": "Emilia Romagna Grand Prix 2025", "year": "2025", "circuit": "Imola"},
    {"phrase": "Monaco Grand Prix 2025", "year": "2025", "circuit": "Monaco"},
    {"phrase": "Canadian Grand Prix 2025", "year": "2025", "circuit": "Montreal"},
    {"phrase": "Spanish Grand Prix 2025", "year": "2025", "circuit": "Barcelona"},
    {"phrase": "Austrian Grand Prix 2025", "year": "2025", "circuit": "Spielberg"},
    {"phrase": "British Grand Prix 2025", "year": "2025", "circuit": "Silverstone"},
    {"phrase": "Hungarian Grand Prix 2025", "year": "2025", "circuit": "Budapest"},
    {"phrase": "Belgian Grand Prix 2025", "year": "2025", "circuit": "Spa"},
    {"phrase": "Dutch Grand Prix 2025", "year": "2025", "circuit": "Zandvoort"},
    {"phrase": "Italian Grand Prix 2025", "year": "2025", "circuit": "Monza"},
    {"phrase": "Azerbaijan Grand Prix 2025", "year": "2025", "circuit": "Baku"},
    {"phrase": "Singapore Grand Prix 2025", "year": "2025", "circuit": "Marina Bay"},
    {"phrase": "United States Grand Prix 2025", "year": "2025", "circuit": "Austin"},
    {"phrase": "Mexico City Grand Prix 2025", "year": "2025", "circuit": "Mexico City"},
    {"phrase": "Brazilian Grand Prix 2025", "year": "2025", "circuit": "São Paulo"},
    {"phrase": "Las Vegas Grand Prix 2025", "year": "2025", "circuit": "Las Vegas"},
    {"phrase": "Qatar Grand Prix 2025", "year": "2025", "circuit": "Lusail"},
    {"phrase": "Abu Dhabi Grand Prix 2025", "year": "2025", "circuit": "Yas Island"},
]
# Phase 17 smoke restricts to 2025 — the season with the most complete
# data on Neon (raw + core both fully populated for every session).
ALL_VENUES: list[dict[str, str]] = VENUES_2025

# Drivers we know exist in 2024-2025 datasets (per core.driver_identity_lookup).
DRIVERS: list[str] = [
    "Max Verstappen",
    "Lando Norris",
    "Charles Leclerc",
    "Carlos Sainz",
    "Oscar Piastri",
    "George Russell",
    "Lewis Hamilton",
    "Fernando Alonso",
    "Sergio Perez",
    "Yuki Tsunoda",
    "Esteban Ocon",
    "Pierre Gasly",
    "Alex Albon",
    "Nico Hulkenberg",
    "Lance Stroll",
    "Valtteri Bottas",
]


def make_queries(seed: int | None) -> list[dict[str, Any]]:
    """
    Pick a fresh (venue, driver_pair) for each complexity tier so the
    answer-cache and synthesis-cache LRUs cannot serve a previous run's
    result. Same seed → same picks (for reproducible debugging).
    """
    rng = random.Random(seed) if seed is not None else random.SystemRandom()

    venue_low = rng.choice(ALL_VENUES)
    venue_medium = rng.choice([v for v in ALL_VENUES if v["phrase"] != venue_low["phrase"]])
    venue_high = rng.choice([
        v for v in ALL_VENUES if v["phrase"] not in {venue_low["phrase"], venue_medium["phrase"]}
    ])
    driver_a = rng.choice(DRIVERS)
    driver_b = rng.choice([d for d in DRIVERS if d != driver_a])

    return [
        {
            "label": "low",
            "complexity": f"metadata lookup → {venue_low['phrase']}",
            "question": f"What session corresponds to {venue_low['phrase']} Race in canonical IDs?",
            # Either path is acceptable: only the canonical Abu-Dhabi 2025
            # phrasing has a hardcoded template; other venues fall through to
            # anthropic, which is fine.
            "accept_paths": ["deterministic_template", "anthropic"],
            "expect_max_s": 15.0,
        },
        {
            "label": "medium",
            "complexity": f"single-session driver roster → {venue_medium['phrase']}",
            "question": f"Who drove in the {venue_medium['phrase']} race?",
            "accept_paths": ["anthropic", "anthropic_repaired"],
            "expect_max_s": 30.0,
        },
        {
            "label": "high",
            "complexity": (
                f"per-driver stint listing → {venue_high['phrase']}, {driver_a}"
            ),
            # Phrasing that is NOT matched by any deterministic template (no
            # "compare A vs B", no "fastest lap", no "smallest spread"). Forces
            # the LLM-gen path — exactly what Phase 17 is meant to make robust.
            "question": (
                f"For the {venue_high['phrase']} race, list each tyre stint "
                f"that {driver_a} ran with the start lap, end lap, compound, "
                f"and stint length."
            ),
            "accept_paths": ["anthropic", "anthropic_repaired"],
            "expect_max_s": 90.0,
        },
    ]


def post_chat(base: str, message: str) -> tuple[dict[str, Any], float]:
    """Call /api/chat with curl, return (parsed_json, wall_clock_s)."""
    body = json.dumps({"message": message, "debug": {"trace": True}})
    started = time.time()
    proc = subprocess.run(
        [
            "curl", "-s", "-X", "POST",
            f"{base}/api/chat",
            "-H", "content-type: application/json",
            "-d", body,
            "-w", "\n%{http_code}",
            "--max-time", "120",
        ],
        capture_output=True,
        text=True,
    )
    elapsed = time.time() - started
    raw = proc.stdout.strip()
    if not raw:
        return ({"error": f"curl produced no output, stderr={proc.stderr!r}"}, elapsed)
    # Last line is the HTTP code (from -w); body is everything before it.
    parts = raw.rsplit("\n", 1)
    if len(parts) != 2:
        return ({"error": f"unparseable curl output: {raw[:200]}"}, elapsed)
    body_text, http_code = parts
    try:
        payload = json.loads(body_text)
    except json.JSONDecodeError as exc:
        return ({"error": f"non-JSON response (http {http_code}): {body_text[:200]}", "exc": str(exc)}, elapsed)
    payload["__http_code"] = http_code
    return (payload, elapsed)


def find_trace_for_request(request_id: str) -> list[dict[str, Any]]:
    """Return all chat_query_trace.jsonl lines for the given requestId."""
    if not TRACE_FILE.exists():
        return []
    matches: list[dict[str, Any]] = []
    with TRACE_FILE.open("r", encoding="utf-8") as fh:
        for raw in fh:
            if request_id not in raw:
                continue
            try:
                matches.append(json.loads(raw))
            except json.JSONDecodeError:
                continue
    return matches


def extract_spans(trace_lines: list[dict[str, Any]]) -> list[tuple[str, float]]:
    """Pull the spans array from any flushTrace line."""
    for entry in reversed(trace_lines):  # flushTrace usually last
        spans = entry.get("spans")
        if isinstance(spans, list):
            return [(s["name"], float(s["elapsedMs"])) for s in spans if "name" in s and "elapsedMs" in s]
    return []


def cache_hit_flag(trace_lines: list[dict[str, Any]]) -> bool | None:
    for entry in trace_lines:
        if entry.get("cache_hit") is not None:
            return bool(entry["cache_hit"])
    return None


def color(s: str, c: str) -> str:
    if not sys.stdout.isatty():
        return s
    codes = {"green": "32", "red": "31", "yellow": "33", "dim": "2", "bold": "1"}
    return f"\x1b[{codes.get(c, '0')}m{s}\x1b[0m"


def run_one(base: str, q: dict[str, Any], pass_label: str) -> dict[str, Any]:
    print(color(f"\n[{q['label']}/{pass_label}] {q['question']}", "bold"))
    accept_str = "|".join(q["accept_paths"])
    print(color(f"  expected: {q['complexity']} → path∈{{{accept_str}}}, ≤{q['expect_max_s']}s", "dim"))

    payload, wall = post_chat(base, q["question"])
    if "error" in payload:
        print(color(f"  ✗ request failed: {payload['error']}", "red"))
        return {"label": q["label"], "pass": pass_label, "wall": wall, "ok": False, "error": payload["error"]}

    request_id = payload.get("requestId") or "<no-request-id>"
    gen_source = payload.get("generationSource", "unknown")
    answer_preview = (payload.get("answer") or "")[:160].replace("\n", " ")

    # Give flushTrace a beat to land — the orchestration's `finally` writes
    # the spans record but is not awaited by the response writer.
    time.sleep(0.4)
    trace_lines = find_trace_for_request(request_id)
    spans = extract_spans(trace_lines)
    cache_hit = cache_hit_flag(trace_lines)

    matched_path = gen_source in q["accept_paths"]
    within_budget = wall <= q["expect_max_s"]
    ok = matched_path and within_budget

    mark = color("✓", "green") if ok else color("✗", "red")
    print(f"  {mark} wall={wall:.2f}s  path={gen_source}  cache_hit={cache_hit}  request_id={request_id[:8]}")
    if answer_preview:
        print(color(f"  answer: {answer_preview}{'...' if len(payload.get('answer', '')) > 160 else ''}", "dim"))

    if spans:
        spans_sorted = sorted(spans, key=lambda x: -x[1])
        print(color("  top spans (slowest first):", "dim"))
        for name, ms in spans_sorted[:6]:
            tag = color(name, "yellow") if ms > 5000 else name
            print(f"    {ms:>8.0f}ms  {tag}")
    else:
        print(color("  (no spans recorded — likely early-return/timeout path)", "dim"))

    return {
        "label": q["label"],
        "pass": pass_label,
        "wall": wall,
        "path": gen_source,
        "cache_hit": cache_hit,
        "spans": spans,
        "ok": ok,
        "request_id": request_id,
        "answer_preview": answer_preview,
        "expected_path_matched": matched_path,
        "within_budget": within_budget,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default=os.environ.get("OPENF1_CHAT_BASE", "http://localhost:3000"))
    parser.add_argument("--warm-only", action="store_true", help="skip the cold pass")
    parser.add_argument("--seed", type=int, default=None,
                        help="random seed (default: random per run; pass an int to reproduce)")
    args = parser.parse_args()

    queries = make_queries(args.seed)

    print(color(f"Hitting {args.base}/api/chat — Phase 17 smoke", "bold"))
    print(color(f"Trace file: {TRACE_FILE}", "dim"))
    if args.seed is not None:
        print(color(f"Seed: {args.seed} (deterministic)", "dim"))
    else:
        print(color("Seed: <random>  (each run picks new venue/driver combos to defeat caches)", "dim"))

    results: list[dict[str, Any]] = []
    for q in queries:
        if not args.warm_only:
            results.append(run_one(args.base, q, "cold"))
        results.append(run_one(args.base, q, "warm"))

    # Punch-list summary.
    print(color("\n=== summary ===", "bold"))
    passed = sum(1 for r in results if r.get("ok"))
    total = len(results)
    line = f"{passed}/{total} runs met expectations"
    print(line + ("" if passed == total else color(" — investigate ✗ rows above", "red")))

    print(color("\nrun matrix:", "dim"))
    print("  label   pass   wall(s)  path                     cache_hit  ok")
    for r in results:
        ok_mark = "✓" if r.get("ok") else "✗"
        wall = f"{r.get('wall', 0):>6.2f}"
        cache = str(r.get("cache_hit"))
        path = (r.get("path") or "")[:24].ljust(24)
        print(f"  {r['label']:<6} {r['pass']:<6} {wall}   {path} {cache:<10} {ok_mark}")

    # Slowest span per request — quick "where to dig next" hint.
    print(color("\nslowest span per request:", "dim"))
    for r in results:
        spans = r.get("spans") or []
        if not spans:
            print(f"  {r['label']}/{r['pass']}: (no spans)")
            continue
        slowest = max(spans, key=lambda x: x[1])
        print(f"  {r['label']}/{r['pass']}: {slowest[0]} = {slowest[1]:.0f}ms")

    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
