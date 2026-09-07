-- Deploy openf1:061_analyst_corpus to pg
-- requires: 060_fantasy_projection
--
-- Analyst-corpus G1 (diagnostic/analyst-corpus-ingestion-plan-2026-09-06.md):
-- rights registry + provenance-preserving document store for the per-race
-- analysis corpus. Fetch artifacts and derivations are append-only evidence;
-- document metadata and link assignments are mutable (run manifests pin what
-- any distillation/eval run consumed). Raw artifact BYTES live outside the
-- DB in git-ignored corpus-artifacts/, addressed by sha256.
--
-- Rights registry rows are seeded here as config-as-data (like 057's scoring
-- rules). rights_basis records a RISK decision by the owner, not permission
-- from the rightsholder; user sign-offs recorded 2026-09-06
-- (diagnostic/g0_capability_matrix_2026-09-06.md).

BEGIN;

CREATE TABLE IF NOT EXISTS raw.analyst_sources (
  source_key          TEXT PRIMARY KEY,
  kind                TEXT NOT NULL CHECK (kind IN ('rss','html','youtube','manual')),
  config              JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  rights_state        TEXT NOT NULL CHECK (rights_state IN ('pending','approved_private','prohibited','approved_commercial')),
  approved_uses       TEXT[] NOT NULL DEFAULT '{}' CHECK (approved_uses <@ ARRAY['style_research','eval_reference','question_mining','format_study']::text[]),
  allowed_methods     TEXT[] NOT NULL DEFAULT '{}',
  may_store_full_text BOOLEAN NOT NULL DEFAULT FALSE,
  may_llm_process     BOOLEAN NOT NULL DEFAULT FALSE,
  retention_days      INT,
  deletion_required   BOOLEAN NOT NULL DEFAULT FALSE,
  rights_basis        TEXT NOT NULL,
  reviewed_at         TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS raw.analyst_documents (
  doc_id          BIGSERIAL PRIMARY KEY,
  source_key      TEXT NOT NULL REFERENCES raw.analyst_sources (source_key),
  source_id       TEXT NOT NULL,
  url             TEXT,
  author          TEXT,
  title           TEXT,
  published_at    TIMESTAMPTZ,
  doc_type        TEXT NOT NULL CHECK (doc_type IN ('race_analysis','driver_ratings','strategy_report','transcript','facts_stats','question_notes')),
  session_scope   TEXT NOT NULL DEFAULT 'unknown' CHECK (session_scope IN ('race','qualifying','sprint','weekend','season','unknown')),
  meeting_key     INT,
  session_key     INT,
  link_confidence REAL CHECK (link_confidence IS NULL OR (link_confidence >= 0 AND link_confidence <= 1)),
  link_reason     TEXT,
  linker_version  TEXT,
  link_status     TEXT NOT NULL DEFAULT 'review_queue' CHECK (link_status IN ('linked','review_queue','excluded','unlinkable')),
  corpus_split    TEXT CHECK (corpus_split IN ('dev','validation','holdout')),
  UNIQUE (source_key, source_id)
);

-- Immutable, append-only fetch revisions. artifact_path points into the
-- git-ignored corpus-artifacts/ store; purge nulls it and flips status.
CREATE TABLE IF NOT EXISTS raw.analyst_fetches (
  fetch_id        BIGSERIAL PRIMARY KEY,
  doc_id          BIGINT NOT NULL REFERENCES raw.analyst_documents (doc_id),
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  http_status     INT,
  etag            TEXT,
  last_modified   TEXT,
  mime_type       TEXT,
  raw_sha256      TEXT NOT NULL,
  artifact_path   TEXT,
  artifact_status TEXT NOT NULL DEFAULT 'stored' CHECK (artifact_status IN ('stored','purged')),
  UNIQUE (doc_id, raw_sha256)
);

-- Normalizations AND LLM outputs, append-only. parent_derivation_id gives
-- derivation-from-derivation lineage (llm_cleanup derives from caption_dedup).
-- A purged derivation cannot retain text (CHECK).
CREATE TABLE IF NOT EXISTS raw.analyst_derivations (
  derivation_id        BIGSERIAL PRIMARY KEY,
  fetch_id             BIGINT NOT NULL REFERENCES raw.analyst_fetches (fetch_id),
  parent_derivation_id BIGINT REFERENCES raw.analyst_derivations (derivation_id),
  kind                 TEXT NOT NULL CHECK (kind IN ('normalize_md','caption_dedup','llm_cleanup','claim_extraction')),
  tool_version         TEXT NOT NULL,
  input_sha256         TEXT,
  output_sha256        TEXT,
  output_text          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status               TEXT NOT NULL DEFAULT 'unreviewed' CHECK (status IN ('unreviewed','approved','rejected','purged')),
  CHECK ((status = 'purged') = (output_text IS NULL))
);

CREATE TABLE IF NOT EXISTS raw.analyst_link_overrides (
  source_key  TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  meeting_key INT,
  session_key INT,
  decided_by  TEXT NOT NULL,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note        TEXT,
  PRIMARY KEY (source_key, source_id)
);

CREATE TABLE IF NOT EXISTS raw.analyst_deletions (
  deletion_id     BIGSERIAL PRIMARY KEY,
  target_kind     TEXT NOT NULL CHECK (target_kind IN ('fetch_artifact','derivation_text')),
  target_id       BIGINT NOT NULL,
  artifact_sha256 TEXT,
  reason          TEXT NOT NULL,
  deleted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------ registry
-- Final rows per diagnostic/g0_capability_matrix_2026-09-06.md.
INSERT INTO raw.analyst_sources
  (source_key, kind, config, enabled, rights_state, approved_uses, allowed_methods,
   may_store_full_text, may_llm_process, retention_days, deletion_required, rights_basis, reviewed_at)
VALUES
  ('the_race', 'rss',
   '{"sitemap":"https://www.the-race.com/sitemap-posts.xml","rss":"https://www.the-race.com/rss/"}'::jsonb,
   TRUE, 'approved_private', ARRAY['style_research','eval_reference'], ARRAY['rss','md_endpoint','sitemap'],
   TRUE, TRUE, NULL, FALSE,
   'Risk decision, not permission. Terms = personal-use license, no scraping/TDM clause; robots permissive; site publishes /llms.txt offering "Public Ghost content for AI and LLM tooling" + .md endpoints. Commercial re-review gate stands.',
   '2026-09-06T00:00:00Z'),
  ('f1com', 'html',
   '{"sitemap_index":"https://www.formula1.com/en/latest/article/sitemap.xml"}'::jsonb,
   TRUE, 'approved_private', ARRAY['style_research','eval_reference'], ARRAY['sitemap','html'],
   TRUE, TRUE, NULL, FALSE,
   'Risk decision, not permission. Legal notices = personal, non-commercial; automation clause is App-specific; no TDM clause; robots permissive with published sitemap. Commercial re-review gate stands.',
   '2026-09-06T00:00:00Z'),
  ('substack:f1debrief', 'rss',
   '{"feed":"https://f1debrief.substack.com/feed"}'::jsonb,
   TRUE, 'approved_private', ARRAY['style_research','eval_reference'], ARRAY['rss'],
   TRUE, TRUE, NULL, FALSE,
   'Risk decision, not permission. Substack ToS bans page crawling and storing significant portions of platform content; RSS is published for syndication and volume is one newsletter''s free posts. RSS ONLY, never HTML.',
   '2026-09-06T00:00:00Z'),
  ('youtube:formula1', 'youtube',
   '{"channel":"FORMULA 1","series":"Jolyon Palmer''s F1 TV Analysis","max_videos_per_season":30}'::jsonb,
   TRUE, 'approved_private', ARRAY['style_research','eval_reference'], ARRAY['yt_dlp_captions'],
   TRUE, TRUE, 30, FALSE,
   'USER DECISION 2026-09-06: approved for private research. yt-dlp captions are not an authorized API path; risk accepted at ~30 videos/season, no republication, raw VTT purged at 30 days, HARD re-review before any commercial/public use of transcript-derived text.',
   '2026-09-06T00:00:00Z'),
  ('reddit', 'manual', '{}'::jsonb,
   FALSE, 'prohibited', ARRAY['question_mining'], ARRAY[]::text[],
   FALSE, FALSE, NULL, TRUE,
   'USER DECISION 2026-09-06: prohibited for automation (API terms restrict AI use of user content + deletion flow-down incompatible with immutable snapshots). Substitute: hand-written per-race question notes in corpus/questions/ (owner''s own words, no stored user content).',
   '2026-09-06T00:00:00Z'),
  ('x_exemplars', 'manual', '{}'::jsonb,
   TRUE, 'approved_private', ARRAY['format_study'], ARRAY['manual_inbox'],
   TRUE, FALSE, NULL, FALSE,
   'Risk decision, not permission. Manual screenshots for format study only; never enters distillation/eval (purpose-gated); nothing republished.',
   '2026-09-06T00:00:00Z')
ON CONFLICT (source_key) DO NOTHING;

COMMIT;
