# Prod hotfixes (Neon warehouse)

The deployed **Neon** warehouse is **not** sqitch-managed (no `sqitch.changes`
registry) — it was built by running SQL directly and has diverged from the
`sql/migrations` chain (e.g. `core.grid_vs_finish` is a standalone view on prod
but a `_mat` heap + facade in the chain). These files are the Phase-3
data-correctness fixes **applied to prod** on 2026-07-02, kept here for
reproducibility since they can't cleanly re-enter the diverged sqitch chain.
Apply in order against the Neon warehouse. All are idempotent.

1. `001_dedup_seed_tables.sql` — remove duplicated seed rows in
   `core.compound_alias_lookup` (root cause of the historical laps_enriched 2×
   fanout) + `core.valid_lap_policy`; add the UNIQUE indexes prod was missing.
2. `002_grid_vs_finish_provisional_classification.sql` — rebuild
   `core.grid_vs_finish` so grid/finish from the position-history fallback are a
   UNIQUE 1..N provisional classification (finish ranked by laps-completed then
   track position, FIA-style), instead of raw feed positions that can tie. Still
   honestly flagged via `finish_source` (session_result is un-ingested).
3. `003_lap_semantic_bridge_stint_dedup.sql` — make the stint join in
   `core.lap_semantic_bridge` pick exactly one stint per lap (lowest
   stint_number = the in-lap on the old compound) via a LATERAL, so overlapping
   raw.stints boundaries (lap_end(N) == lap_start(N+1)) no longer double
   boundary laps. Also ~2× faster per-session (LIMIT 1 vs fanout).

After applying, REFRESH the analytics matviews that read `core.laps_enriched`.
Verify with `web/scripts/health/check_data_invariants.mjs --full`.
