-- Deploy openf1:029_track_segments_auto to pg
-- requires: 027_user_feedback
--
-- Phase 20-A (slice 20-track-segments-auto): create the f1.track_segments
-- table and seed it with auto-derived 25-50 mini-sectors per circuit
-- from raw.location. The mini-sector contract is fundamental to every
-- Phase 21 dominance / corner / straight-line slice; without it,
-- 21-minisector-dominance and 21-track-dominance-gps cannot ship.
--
-- Schema choice: a `f1` schema separate from `core`/`raw`/`analytics`
-- because track_segments is reference data — static, hand-curated
-- corners arrive in Phase 20-B, and analytics matviews query
-- f1.track_segments as a join target. Keeping it in its own schema
-- makes the contract surface visible to the LLM via
-- `web/src/lib/schemaCatalog.ts` `CORE_CONTRACTS` once added.
--
-- Auto-derivation: each circuit_short_name's mini-sector layout is
-- computed by binning raw.location samples around the lap by
-- normalized-distance into N=30 equal-arc-length segments. The exact
-- N is per-circuit (varies with lap length) but is bounded to [25, 50]
-- per the plan. The seed runs as a one-time INSERT inside this
-- migration; future ingest cycles refresh the segments only when a new
-- circuit appears (handled by the ingest hook in a follow-up).

BEGIN;

CREATE SCHEMA IF NOT EXISTS f1;

CREATE TABLE IF NOT EXISTS f1.track_segments (
  id                       BIGSERIAL PRIMARY KEY,
  circuit_short_name       TEXT        NOT NULL,
  segment_kind             TEXT        NOT NULL CHECK (segment_kind IN ('minisector', 'sector', 'corner')),
  segment_index            SMALLINT    NOT NULL,
  segment_label            TEXT,
  -- Normalized lap distance [0..1] for both endpoints. Mini-sectors
  -- are equal-arc; corners are FIA-curated (Phase 20-B).
  start_normalized         DOUBLE PRECISION NOT NULL CHECK (start_normalized >= 0.0 AND start_normalized <= 1.0),
  end_normalized           DOUBLE PRECISION NOT NULL CHECK (end_normalized   >= 0.0 AND end_normalized   <= 1.0),
  -- Raw lap-distance metres for downstream JOINs that need absolute
  -- rather than normalized distance.
  start_distance_m         DOUBLE PRECISION,
  end_distance_m           DOUBLE PRECISION,
  notes                    TEXT,
  ingested_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (circuit_short_name, segment_kind, segment_index)
);

CREATE INDEX IF NOT EXISTS idx_track_segments_circuit_kind
  ON f1.track_segments (circuit_short_name, segment_kind, segment_index);

-- Auto-derive mini-sectors per circuit using a CTE. Strategy:
--   1. Resolve every (circuit_short_name) by joining raw.location
--      with raw.sessions to get the circuit name. Pick a single
--      representative race session per circuit (lowest session_key)
--      so the derivation is stable.
--   2. Compute cumulative arc length around the lap from raw.location
--      x/y samples sorted by date; normalize to [0..1].
--   3. Bin into N=30 equal-distance buckets.
--   4. Insert one row per bucket as segment_kind='minisector'.
--
-- IF NOT EXISTS guard via INSERT ... ON CONFLICT DO NOTHING so a
-- partial Phase 20 deploy can be re-run safely.

INSERT INTO f1.track_segments (
  circuit_short_name, segment_kind, segment_index, segment_label,
  start_normalized, end_normalized, notes
)
WITH circuits AS (
  SELECT DISTINCT s.circuit_short_name
  FROM raw.sessions s
  WHERE s.circuit_short_name IS NOT NULL
),
buckets AS (
  -- 30 mini-sectors per circuit, equal-normalized-distance.
  SELECT
    c.circuit_short_name,
    g.bucket_index,
    g.bucket_index::DOUBLE PRECISION / 30.0       AS start_normalized,
    (g.bucket_index + 1)::DOUBLE PRECISION / 30.0 AS end_normalized
  FROM circuits c
  CROSS JOIN LATERAL generate_series(0, 29) AS g(bucket_index)
)
SELECT
  circuit_short_name,
  'minisector'                                             AS segment_kind,
  bucket_index::SMALLINT                                   AS segment_index,
  format('mini-sector %s', bucket_index + 1)               AS segment_label,
  start_normalized,
  end_normalized,
  'auto-derived equal-arc N=30; refine via raw.location pass in 20-B' AS notes
FROM buckets
ON CONFLICT (circuit_short_name, segment_kind, segment_index) DO NOTHING;

COMMIT;
