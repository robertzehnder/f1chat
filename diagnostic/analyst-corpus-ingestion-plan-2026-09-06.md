# Analyst Corpus Ingestion — Converged Plan (2026-09-06)

**Status: CONVERGED (SHIP) — 6-pass GPT-5.6 Sol review, findings narrowing 8 → 7 → 5 → 3 → 1 → 0.**
Parent project: analyst agents producing per-race F1 analysis (newsletter/social),
voiced via a distilled style guide; corpus doubles as a per-race paired eval set
for platform-gap mining. This document is the plan of record for the scraping /
ingestion / distillation pipeline. Implementation has NOT started.

Sources (every-race publishers only): The Race (Mark Hughes analysis, Edd Straw
ratings), Formula1.com analysis/strategy/facts-stats, per-race Substacks,
YouTube captions (Palmer's Analysis, Tech Talk, The Race videos), Reddit
post-race threads (question mining), X (manual format reference).

Corpus purposes:
1. STYLE corpus → hand-reviewed style guide (rules, not text; no fine-tuning;
   ~50-150 docs total).
2. PER-RACE PAIRED EVAL SET → docs linked to meeting_key/session_key for
   platform-gap mining and agent-vs-pro comparison.

Use context: personal research project today; stated long-term commercialization
ambition → per-source rights gating now, hard registry-wide re-review gate
before anything public or paid ships.

---

## Design principles

1. **Curation over crawling.** Explicit allowlist of feeds/channels/authors;
   nothing follows links; ~50-150 style docs + per-race eval docs.
2. **Append-only evidence, weekly cadence.** Immutability guarantee, stated
   narrowly: fetch artifacts and derivations are never mutated or deleted
   outside the retention/purge flow (which tombstones). Document metadata and
   link assignments ARE mutable; link changes are recorded (linker_version +
   link_reason on the doc, manual decisions in the overrides table).
3. **Warehouse-native metadata, artifact-store text.** Metadata + normalized
   text in Neon; immutable zstd raw artifacts (HTML/VTT/JSON) in git-ignored
   `corpus-artifacts/` named by sha256; no copyrighted full text in git — only
   style guides (rules) and claim files (short spans + provenance pointers).
4. **Rights as a fail-closed control over the FULL lifecycle.** Registry fields
   per source: `rights_state` ENUM('pending','approved_private','prohibited',
   'approved_commercial'), `approved_uses text[]` (⊆ {'style_research',
   'eval_reference','question_mining','format_study'}), `allowed_methods
   text[]` (e.g. '{rss}', '{json_api,html}', '{yt_dlp_captions}',
   '{manual_inbox}'), `may_store_full_text`, `may_llm_process`,
   `retention_days`, `deletion_required`, `rights_basis` (explicitly records
   that sign-off is a RISK decision by the owner, not permission from the
   rightsholder), `reviewed_at`.

   Enforcement — two shared fail-closed helpers in one module every pipeline
   stage imports:
   - `assertAcquireAllowed(source_key, method)` — called by every fetcher AND
     the inbox processor. Unknown/pending/prohibited → refused/quarantined.
   - `assertUseAllowed(source_key, use, purpose)` with
     use ∈ {'store_full_text','llm_process'} and purpose ∈ the approved_uses
     enum — refuses unless the use flag permits AND purpose ∈ approved_uses.
     Called immediately before writing ANY artifact (raw HTML/VTT/JSON in
     fetchers — acquisition permission does not imply storage permission),
     before persisting normalized full text, and before EVERY model call
     (llm_cleanup, distillation, claim extraction), each caller passing its
     actual purpose — so a format-study-only source can never enter
     distillation or evaluation. Missing registry row or NULL flag = refuse.

   Retention: `corpus_retention.mjs` in the weekly run purges expired content
   per retention_days — sets derivation status='purged' AND output_text=NULL
   (enforced by CHECK), nulls fetch artifact_path, physically deletes the
   artifact file only after a live-reference check (no other non-purged fetch
   row shares raw_sha256), and writes a `raw.analyst_deletions` audit row; the
   corpus-artifacts/ backup (single rsync target) has the purge run against it
   too.
5. **Source decisions (initial registry rows, user signs off at G0):**
   - **Reddit = prohibited** for automation in v1 (API terms: AI-use
     restrictions + deletion flow-down incompatible with immutable snapshots).
     Substitute: human-written per-race question notes (`corpus/questions/`,
     our own words, no stored user content). Revisit API approval only if
     commercialization justifies a proper agreement.
   - **YouTube = pending → user decides approved_private or prohibited at G0
     preflight** (yt-dlp captions are not an authorized API path; the official
     captions endpoint only works for owned videos). If approved: private
     research only, ~30 videos/season, normalized transcripts retained, raw
     VTT retention_days=30, hard re-review before any commercial/public use.
     If prohibited: manual watch-and-note fallback.
   - **X = approved_private**, methods '{manual_inbox}', format-study only.
   - **The Race / F1.com / Substack free posts = approved_private**, methods
     proven at G0, full-text retention for private research, re-reviewed at
     the commercialization gate.

## G0 — Preflight, then viability spike (BEFORE schema lock; ~2-3 evenings)

**Step 1 — no-fetch preflight:** read ToS/robots/API docs for each source;
draft registry rows incl. rights_state and allowed_methods; user signs off on
the YouTube call and the Reddit exclusion. No probe touches a source whose
drafted state is prohibited/pending.

**Step 2 — probe** (approved sources only; three weekends: one ordinary, one
sprint, one double-header) → written **capability matrix** per source:
- discovery mechanism; full-text vs truncated; history depth/pagination;
  bot-blocking behavior; whether conditional GET (ETag/Last-Modified) is
  actually honored
- stable identity: canonical ID/URL behavior, redirects, syndicated
  duplicates; correction detection: do edits change the feed GUID/updated
  timestamp
- author attribution; timezone quality of published_at
- session-scope evidence: do race/quali/sprint pieces carry reliable
  title/body signals for the linker, or must source metadata / manual review
  be primary (F1.com Facts & Stats spans sessions — verify wording patterns)
- expected per-source coverage: which 2026 rounds actually have a doc
  (publishers skip races, archives vanish) → realistic coverage baseline
- observed failure modes

EXIT: matrix written; registry rows finalized with user sign-off;
schema/estimates lock only now. Specifically to be PROVEN, not assumed:
whether the-race.com exposes a usable feed and whether it's full-text; whether
F1.com has a stable article JSON endpoint vs sitemap+HTML fallback; whether
Palmer's Analysis videos reliably carry auto-captions.

## Storage (migration 061 — full sqitch set deploy/revert/verify + sqitch.plan through the chain gate)

```
raw.analyst_sources (source_key PK, kind, config jsonb, enabled bool,
  rights_state CHECK IN ('pending','approved_private','prohibited','approved_commercial'),
  approved_uses text[] CHECK (approved_uses <@ ARRAY['style_research','eval_reference','question_mining','format_study']),
  allowed_methods text[], may_store_full_text bool, may_llm_process bool,
  retention_days int, deletion_required bool, rights_basis text, reviewed_at timestamptz)

raw.analyst_documents (doc_id PK, source_key FK, source_id, UNIQUE(source_key, source_id),
  url, author, title, published_at,
  doc_type CHECK IN ('race_analysis','driver_ratings','strategy_report','transcript','facts_stats','question_notes'),
  session_scope CHECK IN ('race','qualifying','sprint','weekend','season','unknown'),
  meeting_key int NULL, session_key int NULL,          -- soft refs (core.sessions is a view; house style)
  link_confidence real CHECK (NULL or 0..1), link_reason, linker_version,
  link_status CHECK IN ('linked','review_queue','excluded','unlinkable'),
  corpus_split CHECK IN ('dev','validation','holdout') NULL)

raw.analyst_fetches (fetch_id PK, doc_id FK, fetched_at, http_status, etag, last_modified,
  mime_type, raw_sha256, artifact_path,
  artifact_status CHECK IN ('stored','purged'),
  UNIQUE(doc_id, raw_sha256))                          -- dedup: unchanged re-checks land no new row
  -- conditional-GET 304s recorded in fetch-run logs, not as fetch rows

raw.analyst_derivations (derivation_id PK, fetch_id FK,
  parent_derivation_id bigint NULL FK,                 -- lineage: llm_cleanup derives FROM caption_dedup
  kind CHECK IN ('normalize_md','caption_dedup','llm_cleanup','claim_extraction'),
  tool_version, input_sha256, output_sha256, output_text, created_at,
  status CHECK IN ('unreviewed','approved','rejected','purged'),
  CHECK ((status='purged') = (output_text IS NULL)))   -- purged rows cannot retain text

raw.analyst_link_overrides (source_key, source_id, meeting_key, session_key,
  decided_by, decided_at, note, PK(source_key, source_id))

raw.analyst_deletions (deletion_id PK, target_kind, target_id, artifact_sha256,
  reason, deleted_at)                                   -- purge audit
```

## Pipeline (`web/scripts/corpus/*.mjs`, house style: pg + web/.env.local)

**Fetchers** — `fetch_rss.mjs`, `fetch_f1com.mjs`, `fetch_youtube.mjs`
(methods per matrix), each calling `assertAcquireAllowed` before any request
and `assertUseAllowed(…, 'store_full_text', purpose)` before writing any
artifact.

**Inbox** — `corpus/inbox/` drop dir; processor requires a sidecar declaring
BOTH source_key AND purpose (purpose validated against the enum; missing or
invalid → quarantine — never inferred or auto-selected from approved_uses),
runs the SAME two helpers with that declared purpose, quarantines anything
failing them. No manual bypass of gating.

**Normalization** (deterministic, versioned, fixture-snapshot test per parser):
- `normalize_md` — HTML→markdown boilerplate strip.
- `caption_dedup` — VTT→de-duplicated verbatim text, cue timestamps kept
  ~30s, NO word changes. **Canonical evidentiary text for transcripts.**
- `llm_cleanup` — separate derivation with parent_derivation_id →
  caption_dedup; style-reading only, never evidentiary.
- Parser fix → bump tool_version, re-derive from stored artifacts; old rows
  remain for audit.

**Linker** (versioned): candidates from core.sessions actual session
date_start (race/sprint/quali), window [start−1d, start+7d] on published_at ×
title/body GP-name or circuit-alias match (migration-049 alias approach) ×
per-source scope patterns from the matrix; sets meeting_key always,
session_key when scope is session-specific; low-confidence/multi-candidate →
link_status='review_queue' surfaced by a report script, resolved into
overrides; season pieces → 'excluded'/'unlinkable'.

**Link history via run manifests, not row versioning**: the document row
carries only the CURRENT link; every distillation or evaluation run writes a
git-committed manifest (JSON: run id + doc_id → {fetch_id, derivation_id,
meeting_key, session_key, corpus_split}) pinning exactly what it consumed —
later relinking can never silently change what a past run meant.

**Leakage boundary & holdout policy:**
- Season's races partitioned once (~60/20/20 dev/validation/holdout),
  committed to git; every linked doc stamped.
- Style distillation reads ONLY dev docs. Claim triage/platform-gap mining
  runs on ALL races (contamination irrelevant to "can the warehouse verify
  claim X"). The agent-vs-pro paired QUALITY eval runs ONLY on holdout races;
  embargo permanent for that season's reported numbers. Objective: gap mining
  = every race; quality measurement = a fixed ~20% sample.
- Distillation: dimension docs (structure / evidentiary practice / register /
  pacing) per (author, doc_type), then a deliberate composite voice assembled
  from dimensions — an intentional new voice, no named-analyst branding.
- Similarity guard: shingle-overlap of style guide and agent outputs vs
  corpus; flags block release.

**Claim extraction & verification (interface defined now; harness later):**
- Extraction (LLM, over canonical text only) → claim rows: verbatim char-span
  (checked as exact substring pre-storage), cue timestamp for transcripts,
  provenance (fetch_id, derivation_id, model, prompt_version), status.
- Verifier record per claim: warehouse snapshot identifier (git SHA of
  migrations + refresh timestamp), SQL/computation attempted (or 'none
  possible'), evidence found, verdict ∈ 6-way taxonomy:
  reproducible | calculable-but-missing-metric | source-only-reporting |
  unsupported-assertion | opinion | insufficient-evidence,
  verifier version, reviewer decision.
- **Category-2 (calculable-but-missing) requires human adjudication before it
  enters the platform roadmap** — the costly-if-wrong category. Category-3
  (paddock reporting, quotes, visual observation) is expected and is NOT a
  platform gap.

## Gates

- **G0** — preflight + spike (above).
- **G1 — Schema + provenance** (~1 day). EXIT: chain gate PASS; one doc
  round-trips documents→fetch→derivation; purge script tombstones a test
  artifact with audit row AND output_text nulled AND shared-sha live-reference
  respected; refusal tests pass for both helpers (assertAcquireAllowed:
  prohibited source, pending source, disallowed method, unknown inbox
  source_key; assertUseAllowed: llm_process=false blocks a model call,
  store_full_text=false blocks BOTH raw-artifact write and normalized-text
  persistence, disallowed purpose refused; inbox: sidecar missing purpose →
  quarantine, sidecar declaring unapproved purpose → quarantine).
- **G2 — One approved source end-to-end** (~1 day): easiest full-text source
  per matrix; backfill 2026. EXIT: every doc DISCOVERED for that source is
  accounted for — linked, excluded, unlinkable, or in review queue with zero
  silent drops — and coverage matches the G0 expected-coverage baseline (not
  "every race covered").
- **G3 — Expand approved sources** (~1-2 days): remaining approved sources
  incl. YouTube iff approved_private; inbox + quarantine flow. EXIT: same
  full-accounting invariant per source; canonical + cleaned transcript pairs
  present where YouTube approved.
- **G4 — Split + distillation** (~1 day). EXIT: split committed; dimension
  docs + composite guide v1 hand-approved; similarity guard clean.
- **G5 — Extraction quality** (~half day+): claim extraction starting from
  2-3 holdout races, expanding the race set until the sample quota is met.
  EXIT, two separate bars: (a) span/provenance validity ≥98% on the full
  extracted set (mechanical check); (b) taxonomy agreement: stratified
  human-labeled sample targeting ≥10 claims per occupied category —
  underpopulated categories get an explicit 'insufficient sample' outcome and
  REMAIN OPEN (never auto-passed, never padded); simple agreement ≥80% AND
  every candidate category-2 claim individually human-adjudicated.
- **Steady state:** `corpus_weekly.mjs` = fetch→normalize→link→
  retention-purge→review-queue report, appended to the existing weekly
  checklist; distillation only when adding voices; extraction on new races per
  the holdout policy.

## Failure modes

Redesigns → fixture tests fail loudly, raw artifact still lands (when storage
is permitted for that source). Feed truncation → length monitor + HTML
fallback (if method allowed) + inbox. Captions missing → skip + report. Terms
change → rights_state flipped, all paths (incl. inbox) refuse via
assertAcquireAllowed/assertUseAllowed. Retention → weekly purge + audit,
backups included. Commercialization → standing registry-wide re-review gate
before anything public/paid.

## Non-goals

No fine-tuning, no crawling, no X automation, no Reddit API in v1, no
paywall/DRM bypass, no Whisper in v1, no republication of source text
anywhere, no full text in git.

---

## Review log (GPT-5.6 Sol, 6 passes, 2026-09-06)

- **Pass 1 (REVISE, 8 findings):** compliance overstated (Reddit AI-use terms,
  yt-dlp not an authorized API); run a source-viability spike before schema
  lock; upsert-overwrite schema loses evidence needed for reproducibility
  (split into documents/fetches/derivations); linker missing session_key +
  confidence + versioning; LLM transcript cleanup must not become evidentiary
  text; style/eval leakage boundary needed; claim taxonomy needed
  source-only-reporting category; sqitch full-set + gate-based phasing.
- **Pass 2 (REVISE, 7):** rights gating must be enforceable (preflight before
  any probe, rights_state enum, inbox same-checks, retention enforcement with
  audit); verifier interface must be defined with human-gated category-2; G5
  bar split into span validity vs taxonomy agreement; coverage gates →
  full-accounting gates; schema CHECKs/dedup/lineage/tombstones; G0 identity +
  correction-detection tests; holdout policy clarified (gap mining = all
  races, quality eval = holdout sample).
- **Pass 3 (REVISE, 5):** enforcement must cover storage/LLM-processing, not
  just acquisition; approved_use scalar → array; link-history via run
  manifests (reviewer's simpler option); shared-sha purge live-reference
  check; G5 sample quota realism (expand or record insufficient-sample).
- **Pass 4 (REVISE, 3):** purpose-aware assertUseAllowed (format-study-only
  source must never enter distillation); raw-artifact write guarded by
  store_full_text; stale helper-name references fixed.
- **Pass 5 (REVISE, 1):** inbox sidecar must declare purpose (never inferred).
- **Pass 6 (SHIP):** "coherent, testable, and implementation-ready."

Reviewer's standing caveat, recorded as policy: ToS/robots review and owner
sign-off are RISK decisions, not permission from rightsholders; the registry
re-review + fixture monitoring are the proportionate controls at hobby scale.
