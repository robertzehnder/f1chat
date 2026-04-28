# Template-cache coverage audit (slice 05)

**Date:** 2026-04-28
**Source of truth for template inventory:** `web/src/lib/deterministicSql.ts`
(no `web/src/lib/templates/` directory exists; templates are inline `templateKey: "..."` literals.)

## Headline finding

**No template currently short-circuits to a cached deterministic *response*.**
Coverage gap = 100% (32 of 32 templates).

The "cache short-circuit path" referenced in the slice inputs
(`web/src/lib/resolverCache.ts`) caches **resolver lookups**
(`sessions_for_resolution`, `drivers_for_resolution`,
`sessions_from_search_lookup`, `drivers_from_identity_lookup`) — i.e. the
entity-resolution layer that runs upstream of template selection. It does
**not** cache the output of any deterministic SQL template.

`web/src/lib/chatRuntime.ts` contains two prompt-specific *resolver-skip*
fast paths that short-circuit entity resolution but still re-execute the
template's SQL on every request:

| Fast-path id (chatRuntime stage log)             | Gating predicate                                                                              | Templates it can land on                                                                  |
|---                                                | ---                                                                                           | ---                                                                                       |
| `coverage_prompt_fast_path` (line 1394)          | `isMostCompleteCoveragePrompt`                                                                | `sessions_most_complete_downstream_coverage`                                              |
| `abu_dhabi_2025_deterministic_fast_path` (1508)  | `isAbuDhabi2025QualifyingImprovementPrompt` OR `isAbuDhabi2025WeekendSpreadPrompt`            | `max_leclerc_qualifying_improvement`, `abu_dhabi_weekend_smallest_spread_and_comparison`  |

In `web/src/app/api/chat/route.ts` (line 400-406) the deterministic
template's SQL is handed straight to `runReadOnlySql` (line 461) — there is
no template-keyed answer cache between the two. Conclusion: **even the
three templates whose prompts match a runtime fast path still re-run their
SQL against Postgres on every request.** They are the closest things to
"already short-circuited" templates today, but they short-circuit
*resolution*, not *response*.

## Coverage table

Columns:
- **template** — `templateKey` literal as it appears in `deterministicSql.ts`.
- **cache-eligible (Y/N)** — does the synthesis path *currently* short-circuit to a **cached deterministic response**? (Today, every row is **N** — see headline.)
- **reason if N** — why the row is N today, plus the disposition for future template-cache slices: whether it's a strong candidate (`future-Y`), candidate with caveats (`future-Y, with TTL/invalidation`), or weak candidate (`future-N`).

| template                                              | cache-eligible (Y/N) | reason if N                                                                                                                                                                              |
|---                                                    | ---                  | ---                                                                                                                                                                                       |
| abu_dhabi_weekend_smallest_spread_and_comparison      | N                    | No template-keyed answer cache exists; SQL re-runs each request. Prompt does match `abu_dhabi_2025_deterministic_fast_path` (resolver skip only). Future-Y: deterministic in the 2025 Abu Dhabi weekend; canonical inputs are stable. |
| canonical_id_lookup_abu_dhabi_2025_race               | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: pure historical session-row lookup, output stable once Abu Dhabi 2025 race rows are ingested. |
| fastest_lap_by_driver                                 | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y per-`sessionKey`: deterministic given a finalized session; key on `(templateKey, sessionKey)`. |
| max_leclerc_avg_clean_lap_pace                        | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: stable for finalized sessionKey + Max/Leclerc pair (driverPairSql is fixed). |
| max_leclerc_common_lap_window_pace                    | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_compounds_used                            | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_fastest_lap_per_driver                    | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_fastest_lap_telemetry_window              | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`; telemetry window snapshot is stable post-ingest. |
| max_leclerc_final_third_pace                          | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_fresh_vs_used_tires                       | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_lap_consistency                           | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_lap_degradation_by_stint                  | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_lap_pace_summary                          | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_opening_closing_stint_lengths             | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_pit_laps                                  | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_pit_stop_count                            | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_position_change_around_pit_cycle          | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_positions_gained_or_lost                  | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_post_pit_pace                             | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_pre_post_pit_pace                         | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_qualifying_improvement                    | N                    | No template-keyed answer cache exists; SQL re-runs each request. Prompt does match `abu_dhabi_2025_deterministic_fast_path` (resolver skip only). Future-Y: deterministic in Abu Dhabi 2025 qualifying session + Max/Leclerc pair. |
| max_leclerc_running_order_progression                 | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_sector_comparison                         | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_shortest_pit_stop                         | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_stint_lengths                             | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_stint_pace_vs_tire_age                    | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_strategy_type                             | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_top_speed                                 | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| max_leclerc_total_pit_time                            | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y: deterministic in `(sessionKey, driverPair)`. |
| practice_laps_vs_race_pace_same_meeting               | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y per-`(sessionKey, driverNumber)`: deterministic once both practice and race sessions of the meeting are finalized. |
| sessions_most_complete_downstream_coverage            | N                    | No template-keyed answer cache exists; SQL re-runs each request. Prompt does match `coverage_prompt_fast_path` (resolver skip only). Future-Y with TTL/invalidation: scans every `core.sessions` row plus `EXISTS` probes across raw.* tables, so the result drifts as new ingests arrive — cache safely only with a short TTL or an ingest-event invalidator. |
| top10_fastest_laps_overall                            | N                    | No template-keyed answer cache exists; SQL re-runs each request. Future-Y per-`sessionKey`: deterministic given a finalized session. |

## Excluded

_None._ All 32 distinct `templateKey` literals from `deterministicSql.ts` appear as a row in the table above.

## Recommended cache-key design (informational, for follow-on slices)

- For per-session/per-driver templates (29 of 32), key the future template
  cache on `(templateKey, sessionKey, sortedDriverNumbers, year)` — the
  same canonical inputs that drive `buildDeterministicSqlTemplate`'s
  branch selection.
- For `canonical_id_lookup_abu_dhabi_2025_race` and the two Abu-Dhabi-2025
  fast-path prompts, key on `templateKey` alone (their inputs are baked
  into the template branch).
- For `sessions_most_complete_downstream_coverage`, key on `templateKey`
  alone but bound the entry with a short TTL (or invalidate on ingest)
  because the underlying `EXISTS` probes flip as new raw rows arrive.
