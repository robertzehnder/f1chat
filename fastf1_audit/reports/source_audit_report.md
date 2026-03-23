# FastF1 vs OpenF1 Source Audit

Generated at: 2026-03-16T23:42:42.411570+00:00

## Theme Summary

- `driver_roster_coverage`: winner=`tie` (rows=49; mismatches=1; missing_openf1=0; missing_fastf1=0)
- `driver_team_mapping`: winner=`tie` (rows=49; mismatches=1; missing_openf1=0; missing_fastf1=0)
- `lap_timing_quality`: winner=`tie` (rows=147; mismatches=31; missing_openf1=0; missing_fastf1=0)
- `pit_and_stint_quality`: winner=`tie` (rows=98; mismatches=12; missing_openf1=0; missing_fastf1=0)
- `race_progression_quality`: winner=`tie` (rows=49; mismatches=48; missing_openf1=0; missing_fastf1=0)
- `result_finishing_order_quality`: winner=`tie` (rows=49; mismatches=49; missing_openf1=0; missing_fastf1=0)
- `sector_timing_quality`: winner=`tie` (rows=147; mismatches=0; missing_openf1=0; missing_fastf1=0)
- `session_coverage`: winner=`openf1` (rows=71; mismatches=0; missing_openf1=0; missing_fastf1=0)
- `session_naming_quality`: winner=`tie` (rows=49; mismatches=49; missing_openf1=0; missing_fastf1=0)
- `starting_grid_quality`: winner=`tie` (rows=49; mismatches=49; missing_openf1=0; missing_fastf1=0)
- `strategy_analysis_usefulness`: winner=`tie` (rows=49; mismatches=6; missing_openf1=0; missing_fastf1=0)
- `telemetry_usefulness`: winner=`tie` (rows=49; mismatches=49; missing_openf1=0; missing_fastf1=0)
- `weather_coverage`: winner=`tie` (rows=49; mismatches=0; missing_openf1=0; missing_fastf1=0)

## Use-Case Recommendations

- `session resolution` -> `openf1` (confidence=high; action=Keep OpenF1 as source of truth; use FastF1 only for edge-case checks.)
- `clean-lap logic` -> `tie` (confidence=low; action=Maintain dual-source audit and prioritize semantic-layer normalization.)
- `pace comparisons` -> `tie` (confidence=low; action=Maintain dual-source audit and prioritize semantic-layer normalization.)
- `pit/strategy analysis` -> `tie` (confidence=low; action=Maintain dual-source audit and prioritize semantic-layer normalization.)
- `result/final classification` -> `tie` (confidence=low; action=Maintain dual-source audit and prioritize semantic-layer normalization.)
- `telemetry overlays` -> `tie` (confidence=low; action=Maintain dual-source audit and prioritize semantic-layer normalization.)

## Files

- source_comparison_tests.csv/json
- source_theme_summary.csv/json
- benchmark_audit_summary.csv/json
- source_recommendation_summary.csv/json