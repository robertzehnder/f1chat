#!/usr/bin/env python3
"""Phase 24-B failure-mode classifier.

Reads a graded question result (single row from a baseline JSON or
question-iteration JSON) and emits a structured failure-mode tag plus
the recommended fix vector. Deterministic, rule-based.

Output (stdout JSON):
  {
    "questionId": <int>,
    "failureMode": "<tag>",
    "rationale": "<one-line>",
    "fixVector": "<one-line concrete fix recipe>",
    "primaryFiles": [<repo-relative paths>]
  }

Failure modes (mutually exclusive, evaluated in order):
  - proprietary_leak_missed
  - clarification_overfire
  - venue_resolution_mismatch
  - column_hallucination
  - timeout_via_proximity_join
  - timeout_other
  - repaired_to_zero_rows
  - wrong_rows_synthesis
  - proven_data_unavailable
  - requires_phase21_lift
  - unknown
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Optional


PROXIMITY_JOIN_RE = re.compile(
    r"abs\s*\(\s*extract\s*\(\s*epoch\s+from",
    re.IGNORECASE,
)


def has_proximity_shape(sql: Optional[str]) -> bool:
    if not sql or not isinstance(sql, str):
        return False
    if not ("raw.car_data" in sql.lower() and "raw.location" in sql.lower()):
        return False
    return bool(PROXIMITY_JOIN_RE.search(sql))


def classify(row: Dict[str, Any]) -> Dict[str, Any]:
    grade = row.get("baselineGrade")
    gen = (row.get("generationSource") or "").lower()
    expected_outcome = row.get("expected_outcome")
    expected_path = row.get("expected_path")
    floor_active_after_slice = row.get("floor_active_after_slice")
    rowCount = int(row.get("rowCount") or 0)
    sql = row.get("sql") or ""
    missing_cols = row.get("missingColumns") or []

    qid = row.get("id")

    def out(mode: str, rationale: str, fix: str, files: list[str]) -> Dict[str, Any]:
        return {
            "questionId": qid,
            "failureMode": mode,
            "rationale": rationale,
            "fixVector": fix,
            "primaryFiles": files,
        }

    # 1. proprietary_leak_missed: an insufficient_data question that
    # got a normal answer (the no_data_refusal route didn't fire).
    if expected_outcome == "insufficient_data" and gen != "no_data_refusal":
        return out(
            "proprietary_leak_missed",
            "Question expected proprietary refusal but generationSource=" + (gen or "?"),
            "Extend PROPRIETARY_NO_DATA_TOPICS to cover the phrasing that should have tripped.",
            ["web/src/lib/chatRuntime/proprietaryNoData.ts"],
        )

    # 2. timeout_via_proximity_join: heuristic_after_sql_timeout AND
    # SQL contains the raw.car_data × raw.location proximity shape.
    if gen == "heuristic_after_sql_timeout" and has_proximity_shape(sql):
        return out(
            "timeout_via_proximity_join",
            "SQL ran out the 15s budget on raw.car_data × raw.location timestamp-proximity JOIN",
            "Extend joinPatternsCheck.ts to flag this exact pattern; orchestration repair branch should fire pre-execution.",
            ["web/src/lib/sqlValidation/joinPatternsCheck.ts"],
        )

    # 3. timeout_other: timeout but not the known proximity shape.
    if gen == "heuristic_after_sql_timeout":
        return out(
            "timeout_other",
            "SQL timed out; not the known raw.car_data × raw.location proximity pattern. Needs case-by-case investigation.",
            "Inspect the failing SQL for a different expensive-join shape (cross telemetry × intervals, large GROUP BY without indexes, etc.). Possibly requires a Phase 21 matview.",
            ["web/src/app/api/chat/orchestration.ts"],
        )

    # 4. column_hallucination: validator caught nonexistent column.
    if gen == "sql_generation_failed" and missing_cols:
        cols = ", ".join(
            f"{m.get('table','?')}.{m.get('column','?')}"
            for m in missing_cols[:3]
        )
        return out(
            "column_hallucination",
            f"17-C validator caught hallucinated columns: {cols}",
            "Extend the hand-curated raw-table reminder block in anthropic.ts:80 with the actual column list for the offending table.",
            ["web/src/lib/anthropic.ts"],
        )

    # 5. clarification_overfire: question routes to clarification but
    # has venue+year context OR is a season-wide question that doesn't
    # need session resolution. Two sub-cases:
    if gen == "runtime_clarification":
        question_text = (row.get("question") or "").lower()
        has_year = bool(re.search(r"\b20\d{2}\b", question_text))
        has_venue = any(
            v in question_text
            for v in [
                "monza", "spa", "silverstone", "suzuka", "monaco",
                "abu dhabi", "yas marina", "bahrain", "sakhir",
                "baku", "imola", "hungaroring", "hungary",
                "zandvoort", "austria", "spielberg", "saudi",
                "jeddah", "australia", "melbourne", "vegas", "qatar",
                "singapore", "mexico", "brazil", "sao paulo",
                "miami", "shanghai", "china",
            ]
        )
        season_wide_markers = [
            "across the 2025 season", "across the season",
            "for the 2025 season", "for the season", "the 2025 calendar",
            "season so far", "list all", "every weekend",
            "which weekends", "which sessions", "which 2025 sessions",
            "across all 2025"
        ]
        is_season_wide = any(m in question_text for m in season_wide_markers)

        if has_year and has_venue:
            return out(
                "clarification_overfire",
                "Question names a venue and year but routed to runtime_clarification.",
                "Extend RACE_SHAPED_MARKERS in chatRuntime.ts to catch this question's phrasing without false-positives on session-type-sensitive markers.",
                ["web/src/lib/chatRuntime.ts"],
            )
        if is_season_wide:
            return out(
                "clarification_overfire_season_wide",
                "Question is season-wide (no specific session needed) but routed to runtime_clarification.",
                "Extend the season-wide / metadata fast-path in chatRuntime.ts so questions that don't need session resolution skip clarification.",
                ["web/src/lib/chatRuntime.ts"],
            )
        return out(
            "clarification_underspecified",
            "Question routed to runtime_clarification and is genuinely underspecified (no venue+year, not season-wide).",
            "This may be a correct clarification. Either the question text needs editing OR the resolver needs a new fast-path. Manual triage required.",
            ["web/scripts/chat-health-check.questions." + (row.get("category") or "?").lower().replace(" ", "_") + ".json"],
        )

    # 5b. venue_resolution_mismatch: question text mentions a
    # specific venue but the resolved session's country/location
    # doesn't match. This is the demonym-mismatch class found
    # during Phase 25.1: the alias-derivation step emits demonym
    # tokens (hungarian/australian/italian) that don't match the
    # country-name aliases (hungary/australia/italy) in
    # core.session_search_lookup, so the lookup falls through to
    # generic-token matches (gp/grand prix) and tie-breaks to the
    # latest 2025 race (Abu Dhabi 9839 / Qatar 9850 / Vegas / Brazil).
    #
    # The fix is in chatRuntime.ts:extractVenueHints (the
    # VENUE_DEMONYM_ALIASES table); the Phase 25.1 commit a9fa902
    # shipped 24 demonym entries. New venues need similar entries.
    #
    # Recommend running the two probe scripts BEFORE generating a
    # code hypothesis — they pinpoint the alias mismatch in <5 min:
    #   web/scripts/phase25_probe_session_search_lookup.mjs
    #   web/scripts/phase25_probe_alias_derivation.mjs
    DEMONYM_TO_COUNTRY = {
        "hungarian":  ["hungary", "hungaroring", "budapest"],
        "australian": ["australia", "melbourne"],
        "italian":    ["italy", "monza", "imola"],
        "british":    ["united kingdom", "silverstone"],
        "belgian":    ["belgium", "spa"],
        "dutch":      ["netherlands", "zandvoort"],
        "spanish":    ["spain", "barcelona"],
        "japanese":   ["japan", "suzuka"],
        "chinese":    ["china", "shanghai"],
        "saudi":      ["saudi arabia", "jeddah"],
        "bahraini":   ["bahrain", "sakhir"],
        "azerbaijani":["azerbaijan", "baku"],
        "monégasque": ["monaco"],
        "monegasque": ["monaco"],
        "canadian":   ["canada", "montreal"],
        "austrian":   ["austria", "spielberg"],
        "qatari":     ["qatar", "lusail"],
        "mexican":    ["mexico", "mexico city"],
        "brazilian":  ["brazil", "são paulo", "sao paulo", "interlagos"],
        "emirati":    ["abu dhabi", "yas marina circuit"],
    }
    selected_label = (
        (row.get("runtime") or {}).get("resolution", {}) or {}
    ).get("selectedSession", {}).get("label", "") or ""
    selected_label = selected_label.lower()
    question_lower = (row.get("question") or "").lower()
    if grade != "A" and selected_label and gen != "runtime_clarification":
        for demonym, expected_aliases in DEMONYM_TO_COUNTRY.items():
            if demonym in question_lower and not any(
                alias in selected_label for alias in expected_aliases
            ):
                return out(
                    "venue_resolution_mismatch",
                    f"Question mentions '{demonym}' but resolver pinned '{selected_label}' (no alias match for {expected_aliases[:2]}).",
                    "Run web/scripts/phase25_probe_session_search_lookup.mjs and phase25_probe_alias_derivation.mjs to confirm. Then add the demonym to VENUE_DEMONYM_ALIASES in chatRuntime.ts:extractVenueHints with the country-name + circuit_short_name alias list that matches core.session_search_lookup.",
                    [
                        "web/src/lib/chatRuntime.ts",
                        "web/scripts/phase25_probe_session_search_lookup.mjs",
                        "web/scripts/phase25_probe_alias_derivation.mjs",
                    ],
                )

    # 6. repaired_to_zero_rows: anthropic_repaired but 0 rows.
    if gen == "anthropic_repaired" and rowCount == 0 and grade != "A":
        return out(
            "repaired_to_zero_rows",
            "Repair LLM stripped expensive shapes but the simplified SQL returned 0 rows.",
            "Extend the repair prompt to preserve the question's filter intent OR extend column reminders so first-pass SQL succeeds.",
            ["web/src/lib/anthropic.ts"],
        )

    # 7. wrong_rows_synthesis: SQL ran with rows but the synthesizer
    # produced a wrong/contradictory answer.
    if rowCount > 0 and gen in ("anthropic", "anthropic_repaired", "deterministic_template") and grade != "A":
        # Distinguish from proven_data_unavailable cases by checking
        # baselineAnswerability — those are 0-row outcomes anyway.
        return out(
            "wrong_rows_synthesis",
            f"SQL returned {rowCount} rows but answer graded {grade}; synthesis path likely chose wrong fields or made a contradictory claim.",
            "Inspect the synthesizer's prompt and the answer text against the row data; extend system prompt to guide field selection.",
            ["web/src/lib/anthropic.ts"],
        )

    # 7b. anthropic_zero_rows: SQL ran via the LLM (no repair, no
    # column-validation failure) but returned 0 rows, and the grade
    # is C. This is a wrong-filter or unsupported-shape case that
    # the existing rev6 grader couldn't classify. Common on broad
    # data_health / metadata questions that span seasons.
    if gen == "anthropic" and rowCount == 0 and grade != "A":
        return out(
            "anthropic_zero_rows",
            "LLM-generated SQL ran clean but returned 0 rows and graded C. Either the filter predicate misses the intended rows, or the question requires data we don't ingest.",
            "Inspect the SQL's WHERE clause vs the question intent. If the filter is too narrow, prompt-engineer field selection. If the data shape doesn't fit, the question is a candidate for SKIP.",
            ["web/src/lib/anthropic.ts"],
        )

    # 7c. anthropic_repaired_no_a: repair path fired and returned
    # rows but graded < A. Distinct from repaired_to_zero_rows.
    if gen == "anthropic_repaired" and rowCount > 0 and grade != "A":
        return out(
            "anthropic_repaired_no_a",
            f"Repair LLM produced rows ({rowCount}) but answer still graded {grade}; the repair simplification cost factual accuracy.",
            "Refine the repair prompt to preserve more of the original SQL's intent OR extend column reminders so the first-pass SQL doesn't need repair.",
            ["web/src/lib/anthropic.ts"],
        )

    # 8. proven_data_unavailable: graded B with the rev6 classifier
    # already promoting from C → B. No further action needed.
    answerability = row.get("baselineAnswerability")
    if grade == "B" and answerability == "answerable_but_unanswered":
        # The Fix 6 classifier already lifted this from C→B.
        return out(
            "proven_data_unavailable",
            "Snapshot reports zero upstream rows for the touched (session_key, table) pair; honest no-data outcome.",
            "No code change. Question correctly graded B; A would require ingesting more data.",
            [],
        )

    # 9. requires_phase21_lift: floor_active_after_slice points at an
    # unshipped Phase 21+ slice AND no other fix vector applies.
    if floor_active_after_slice and floor_active_after_slice.startswith(("21-", "22-", "23-")):
        return out(
            "requires_phase21_lift",
            f"Question deferred to {floor_active_after_slice}; needs that lift slice to ship.",
            f"Skip until {floor_active_after_slice} merges; this slice's PR will lift the question to A as part of its acceptance.",
            [],
        )

    # 10. unknown: fall-through.
    return out(
        "unknown",
        f"Unmatched failure pattern; gen={gen} grade={grade} rows={rowCount}",
        "Manual investigation required. Inspect SQL, answer text, and runtime resolution stage logs.",
        [],
    )


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--baseline", required=True, help="Path to baseline JSON")
    p.add_argument("--question", type=int, default=None, help="Single question ID to classify")
    p.add_argument(
        "--non-a-only",
        action="store_true",
        help="Classify all questions where baselineGrade !== 'A'",
    )
    p.add_argument(
        "--active-floor-only",
        action="store_true",
        help="Only include questions with floor_active_after_slice == null",
    )
    args = p.parse_args()

    blob = json.loads(Path(args.baseline).read_text(encoding="utf8"))
    rows = blob.get("results") or blob.get("attempts") or []

    targets: list[Dict[str, Any]] = []
    for r in rows:
        if args.question is not None and r.get("id") != args.question:
            continue
        if args.non_a_only and r.get("baselineGrade") == "A":
            continue
        if args.active_floor_only and r.get("floor_active_after_slice") is not None:
            continue
        targets.append(r)

    if not targets:
        print(json.dumps({"error": "no matching rows"}, indent=2))
        return 2

    classifications = [classify(r) for r in targets]
    # If a single question was requested, emit a single object;
    # otherwise emit an array.
    if args.question is not None and len(classifications) == 1:
        print(json.dumps(classifications[0], indent=2))
    else:
        print(json.dumps(classifications, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
