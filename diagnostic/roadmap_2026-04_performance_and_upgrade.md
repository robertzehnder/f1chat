# OpenF1 Upgrade Roadmap — Performance + Quality (v2)

**Date:** 2026-04-25
**Author:** Claude, revised after OpenAI Codex review
**Scope:** end-to-end upgrade plan for the OpenF1 analytics + chat runtime, with a primary focus on LLM-to-database latency, secondary focus on closing residual semantic-conformance gaps, and tertiary focus on repo hygiene and runtime maintainability.

**Production deployment context:** Postgres is hosted on **Neon** (serverless, autosuspend, pooled endpoint, branching available). Local dev runs Postgres 16 in Docker via `docker-compose.yml`. Both must keep working.

**Companion documents:**
- [diagnostic/openai_codex_roadmap_2026-04_project_upgrade.md](openai_codex_roadmap_2026-04_project_upgrade.md) — Codex's independent review (preserved as audit record)
- [diagnostic/prompt_07_prioritized_implementation_order.md](prompt_07_prioritized_implementation_order.md) — historical priority list referenced in this roadmap

---

## 0. Comparison with Codex Assessment

This v2 roadmap absorbs OpenAI Codex's review of the v1 draft. The summarized diff:

| Topic | v1 Claude draft | v2 (this doc) | Why changed |
|---|---|---|---|
| Semantic-first framing | "Wave 1 partially implemented" | "Dominant but inconsistent" | Codex grepped chatRuntime / anthropic / deterministicSql and confirmed `core.*` is already the default path |
| Repo hygiene phase | absent | New Phase 0 | Codex flagged tracked `tsconfig.tsbuildinfo`, no CI, npm audit issues, `next/font/google` build dep |
| Neon driver swap | Phase 1 (early) | Phase 6 (deferred) | No measurement justifies a speculative driver swap; gate on Phase 1 numbers |
| Runtime refactor | absent | New Phase 9 | Five fat TS modules (chatRuntime 2,036 LOC etc.) will gate the next feature wave |
| Warehouse size claim | "~15 GB" | concrete row counts | Codex captured 387 sessions, 159K raw laps, 167K enriched, 114M car_data rows, 125M location rows |
| Quality Track | parallel rail | folded into Phases 8 / 9 / 10 / 11 | One project, one roadmap |
| Anthropic prompt caching | Phase 2 | Phase 2 (kept) | Cheap, self-contained, ~2–4× LLM-stage win — survives the reorder |
| LLM call inventory | "classification + SQL-gen + synthesis" | **SQL-gen + repair + synthesis** (no classification LLM call) | gpt5.5 audit: classification is local in `chatRuntime.ts:516`; renamed `classify_llm` → `runtime_classify` |
| Phase 4 index list | included `is_pit_in_lap`, `st_compound` on `raw.laps` | schema-verified columns only | gpt5.5 audit: those columns don't exist on `raw.laps`; compound is on `raw.stints`, pit-in is derived from `raw.pit` |
| "All contracts are views" | all of `006`/`007` | only the hot analytical summaries | gpt5.5 audit: lookup/governance contracts (`compound_alias_lookup`, `valid_lap_policy`, `metric_registry`, `replay_contract_registry`) are already real tables |
| API surface | "5 routes" | 13 `route.ts` files across families | gpt5.5 audit: per-session detail endpoints (`completeness`, `drivers`, `laps`, `race-control`, `telemetry`, `weather`) were uncounted |
| Benchmark freshness | quoted 2026-03-17 numbers as current | flagged as stale; Phase 0 reruns | gpt5.5 audit: 6-week gap; Q31/Q45/Q46 references may not reflect today |
| Perf log sink | unlabeled file | labeled local/dev-only | gpt5.5 audit: serverless filesystems are ephemeral; production sink is a separate decision |
| Phase 3 sequencing | view→thin-select replacement | `core_build.*` source-definition layer first | gpt5.5 audit: replacing the view destroys the canonical query refresh and parity depend on |
| Phase 3 effort | "1–1.5 days" total | 1.5–2 days for prototype + ~1 d each scale-out | gpt5.5 audit: original estimate was optimistic given parity + incremental refresh |
| Phase 3 grain assumption | "PK on `(session_key, driver_number, …)`" | grain-discovery query required first | gpt5.5 audit r2: `core.laps_enriched` is non-unique on the obvious triple |
| Phase 3 parity SQL | one-direction, source unfiltered | bidirectional, both sides filtered by session | gpt5.5 audit r2: original SQL would have surfaced false positives and missed extra mat rows |
| Phase 7 framing | "speculative synthesis priming" + "1.3–1.5×" | speculative priming removed; 1.1–1.3× | gpt5.5 audit r2: prompt caching primes itself on first real use; placeholder calls add cost without producing a usable answer |
| §0 reframed thesis | "the latest benchmark shows" | "the historical benchmark (to be rerun in Phase 0) showed" | gpt5.5 audit r2: stale wording residue |
| Risk #6 | "parallelizing classification + resolver" | rewritten around speculative LLM priming | gpt5.5 audit r2: classification-LLM was already removed from the doc; risk needed re-aiming |
| Parity SQL (round 3) | bidirectional `EXCEPT` | bidirectional `EXCEPT ALL` | gpt5.5 audit r3: plain `EXCEPT` collapses duplicates and would mask multiplicity drift in the non-unique contracts Phase 3 explicitly accommodates |
| Phase 7 file references | "audit `chatRuntime.ts:737`" | `deterministicSql.ts:30` + `route.ts:367` | gpt5.5 audit r3: line 737 of `chatRuntime.ts` is unrelated session-scoring tail; the 0-LLM SQL path lives in `buildDeterministicSqlTemplate` |
| Phase 0 benchmark command | "`healthcheck:chat:intense` + grader" | explicit two-step flow with both scripts | gpt5.5 audit r3: under-specified; named both `healthcheck:chat:intense` and `healthcheck:grade:intense` |
| Env docs | only root `.env.example` | root `.env.example` + `web/.env.local.example` | gpt5.5 audit r3: web runtime reads from a separate Next env file |
| Risk #11 | "parity check is `core_build EXCEPT core.*_mat`" | matches Phase 3: bidirectional + session-scoped + `EXCEPT ALL` | gpt5.5 audit r3: risk wording was lagging the corrected Phase 3 plan |

**Reframed thesis.** Semantic-first planning is no longer the question. The semantic layer is built, the runtime already prefers it, and the historical benchmark (2026-03-17, to be rerun in Phase 0) showed answer correctness at 38 A / 7 B / 5 C. The bottleneck is operational: views aggregate `raw.laps` on every call, no caching layer is engaged today, and the runtime has grown into modules large enough to slow the next feature wave. The work below is **make semantic-first fast / observable / consistent / maintainable**.

---

## 1. Current State Summary

### Project shape
- **Warehouse:** Python ingestion (`src/ingest.py`) into Postgres. Raw schema + core (semantic) schema. Production runs on Neon; local dev in Docker.
- **Semantic layer (SQL):** Contracts in [sql/006_semantic_lap_layer.sql](../sql/006_semantic_lap_layer.sql) and [sql/007_semantic_summary_contracts.sql](../sql/007_semantic_summary_contracts.sql). The **hot analytical summary contracts are views** (not materialized): `laps_enriched`, `lap_semantic_bridge`, `driver_session_summary`, `stint_summary`, `strategy_summary`, `pit_cycle_summary`, `strategy_evidence_summary`, `grid_vs_finish`, `race_progression_summary`, `lap_phase_summary`, `lap_context_summary`, `telemetry_lap_bridge`, `replay_lap_frames`. Governance / lookup contracts are already real tables: `core.compound_alias_lookup`, `core.valid_lap_policy`, `core.metric_registry`, `core.replay_contract_registry`.
- **Web runtime:** Next.js 15, React 19. ~7K LOC TypeScript. Heaviest modules: [chatRuntime.ts](../web/src/lib/chatRuntime.ts) (2,036 lines), [deterministicSql.ts](../web/src/lib/deterministicSql.ts) (1,480), [queries.ts](../web/src/lib/queries.ts) (1,011), [route.ts](../web/src/app/api/chat/route.ts) (816), [answerSanity.ts](../web/src/lib/answerSanity.ts) (609), [anthropic.ts](../web/src/lib/anthropic.ts) (499). API surface is **13 route.ts files** across families: `chat`, `query/{run,preview}`, `schema`, `saved-analyses`, top-level `sessions`, plus per-session detail endpoints (`completeness`, `drivers`, `laps`, `race-control`, `telemetry`, `weather`, root). CI / build coverage and Phase 10 product-surface planning must account for the per-session detail endpoints, not just the top-level five.

### Warehouse snapshot (Codex read-only audit, 2026-04-25)
- `core.sessions`: **387** across 2023–2026. Latest session date: 2026-12-06.
- `core.session_completeness`: 242 analytic-ready · 34 partially loaded · 16 metadata-only · 95 future placeholders.
- `raw.laps`: 159,793 · `core.laps_enriched`: 167,172.
- `raw.car_data`: 114,823,541 · `raw.location`: 125,287,376.
- `core.stint_summary`: 20,654 · `core.strategy_summary`: 5,554 · `core.race_progression_summary`: 17,864.

### Quality signal (historical intense benchmark — **stale, must be rerun**)
File: [chat_health_check_baseline_2026-03-17T12-33-12-125Z.summary.json](../web/logs/chat_health_check_baseline_2026-03-17T12-33-12-125Z.summary.json), dated 2026-03-17. This roadmap is dated 2026-04-25; the runtime has moved since (semantic-runtime adoption, deterministic-template expansion). Treat the numbers below as historical until Phase 0 reruns the intense benchmark.

| Axis | A | B | C |
|---|---:|---:|---:|
| Overall | 20 | 7 | 23 |
| Answer correctness | 38 | 7 | 5 |
| Semantic conformance | 28 | 4 | 18 |

Historical top root causes: `semantic_contract_missed` (8), `structured_rows_summarized` (5), `raw_table_regression` (3), `resolver_failure` (2), `summary_contract_missing` (2). The Q31 / Q45 / Q46 references later in this doc may not reflect current behavior — Phase 0 will rerun the benchmark and Phase 11 will re-target whichever question IDs surface as residual.

### Latency signal (user testing, unmeasured)
Chat responses are visibly slow. Hypothesized contributors, in order of likely impact:
1. **Up to 3 Anthropic calls per request** — SQL generation in [route.ts:381](../web/src/app/api/chat/route.ts#L381), repair-on-failure in [route.ts:502](../web/src/app/api/chat/route.ts#L502), synthesis in [route.ts:563](../web/src/app/api/chat/route.ts#L563). Each rebuilds a long static system prompt with no cache markers. Question classification is **deterministic local logic** in [chatRuntime.ts:516](../web/src/lib/chatRuntime.ts#L516), called from `buildChatRuntime()` at [chatRuntime.ts:1212](../web/src/lib/chatRuntime.ts#L1212) — not an LLM call.
2. **Postgres queries hit non-materialized views** stacked on `raw.laps` (160K rows) and `raw.car_data` (115M rows).
3. **Neon-specific overhead** — autosuspend cold start, per-request connection setup, default 0.25 CU compute size.
4. **No resolver / answer / template cache** — every request redoes alias lookups and prompt building.

Phase 1 instrumentation will replace these hypotheses with numbers before any deferred decision (Phases 6, 7) is locked in.

### Repo hygiene gaps (Codex audit)
- `web/tsconfig.tsbuildinfo` is tracked and changes after every typecheck.
- No GitHub Actions CI. Tests exist (`npm run test:grading`) but are not gated on push.
- `npm audit --omit=dev`: high-severity in `next` (15.5.12 → 15.5.15 patch available), moderate in `postcss` (8.5.8 → 8.5.10).
- `npm run build` hard-depends on `next/font/google` network fetches; offline CI environments fail.
- No Python tooling — no `ruff`, no `pytest`, no fixture-driven ingestion test.

---

## 2. Performance Strategy

The mental model: a chat request today does **up to 3 LLM round-trips** (SQL-gen, optional repair, synthesis — classification is local, not an LLM call) **+ ~1 Postgres round-trip + connection setup + possible autosuspend wake**, with **no caching layer engaged**. Three layers of caching attack three different bottlenecks:

| Layer | Cache | Wins |
|---|---|---|
| **LLM** | Anthropic prompt caching | drops repeated system-prompt cost/latency by ~90% per call |
| **DB** | Materialized summaries (real tables) + indexes | drops complex-aggregation queries from seconds to tens of ms |
| **App** | Resolver cache, deterministic templates, full-answer cache | bypasses one or more LLM calls entirely on hits |

Neon-specific work to remove cold starts and pick the right driver follows in §3 — but only after measurement (Phase 1) confirms the bottleneck.

---

## 3. Neon-Specific Constraints

> **Note:** every action derived from this section is **gated by Phase 1 measurements**. The constraints inform design throughout, but the corresponding work (Phase 6) only fires when numbers justify it.

These are the deltas vs. self-hosted Postgres:

1. **Connection setup is expensive.** Neon terminates idle connections aggressively and may need to wake the compute. First query after idle: ~1–3 s. Subsequent queries: normal.
2. **Pooled endpoint is mandatory for serverless web tier.** Use the `…-pooler.region.aws.neon.tech` URL and treat it as PgBouncer-in-transaction-mode — i.e. no implicit prepared statements that survive across checkouts.
3. **Driver choice matters.** `@neondatabase/serverless` (HTTP/WebSocket) is materially faster than `pg` over TCP from Vercel/Edge for short queries because it skips the TLS+startup handshake on each cold lambda. Drop-in replacement.
4. **Autosuspend causes user-visible cold starts.** Either disable autosuspend on the prod branch, or run a cron warm-keeper, or both.
5. **Refresh cost is real.** `REFRESH MATERIALIZED VIEW` over the full warehouse on Neon bills compute-seconds. Prefer **session-scoped real tables** populated incrementally at ingest over full matview refreshes.
6. **Branching is a feature.** Use Neon branching to validate matview / index changes against a clone of prod data before promoting.
7. **Read replicas exist.** Neon supports read replicas with near-zero lag against the same storage. Move chat-runtime reads to a replica so ingest does not compete with user queries.
8. **Compute size is configurable (CUs).** Default 0.25 CU is undersized for `core.laps_enriched` aggregations across a season. Enable autoscaling with a sane upper bound (1–2 CU) or fix the size.
9. **Cache placement.** Do not put hot caches (resolver lookups, answer cache) inside Neon — that re-introduces compute-wake. Use in-process LRU or a tiny Upstash Redis.

---

## 4. Phased Roadmap

Phases sized for one engineer with context. Effort estimates are calendar-time.

### Phase 0 — Hygiene & Baseline (1 day)

Goal: make the repo safe to upgrade. Without CI, every later refactor is one merge away from a regression.

1. Add `web/tsconfig.tsbuildinfo` to `.gitignore` and `git rm --cached` it.
2. Add GitHub Actions CI: `npm ci`, `npm run typecheck`, `npm run test:grading`, `npm run build`, Python `py_compile` over `src/`, `bash -n` over `scripts/`.
3. `npm audit fix` for patch-level Next/PostCSS fixes.
4. Patch low-risk deps:
   - `next` 15.5.12 → 15.5.15
   - `react` / `react-dom` 19.2.4 → 19.2.5
   - `postcss` 8.5.8 → 8.5.10
   - `autoprefixer` 10.4.27 → 10.5.0
   - `@types/pg` → 8.20.0
5. Document the `next/font/google` network dependency in `web/README.md`. Optionally self-host fonts.
6. Add a one-line `npm run verify` script that chains typecheck + grading + build.
7. **Rerun the intense benchmark** so all later work targets current quality numbers, not the stale 2026-03-17 baseline. Two-step flow:
   ```bash
   cd web
   npm run healthcheck:chat:intense   # produces chat_health_check_<ts>.json in web/logs/
   npm run healthcheck:grade:intense  # grades the latest run with the intense rubric
   ```

**Exit criterion:** clean CI on every push; `npm audit --omit=dev` reports no high-severity prod vulnerabilities; `npm run build` succeeds in the intended CI environment; a fresh intense-benchmark report exists in `web/logs/`.

---

### Phase 1 — Performance Instrumentation (½ day)

Goal: create a reliable before/after measurement system. Without numbers, every later step is guesswork.

1. Add per-stage timing helpers in [serverLog.ts](../web/src/lib/serverLog.ts) and emit from [route.ts](../web/src/app/api/chat/route.ts). Stages reflect the actual pipeline: `request_intake`, `runtime_classify` (local logic in `chatRuntime.ts:516`), `resolve_db`, `template_match`, `sqlgen_llm`, `execute_db`, `repair_llm`, `synthesize_llm`, `sanity_check`, `total`. Note: there is **no `classify_llm` stage** — classification is deterministic local code, not an Anthropic call.
2. Log stage timings as structured JSON to `web/logs/chat_query_trace.jsonl` (file already exists). **Local/dev sink only** — Vercel and other serverless filesystems are ephemeral and not shared across instances. For production, plan a separate sink (Phase 6 or Phase 12 candidate: Logflare, Axiom, Datadog, or a Postgres `core.perf_trace` table on the read replica).
3. Add a `web/src/app/api/admin/perf-summary/route.ts` that aggregates the most recent N traces and returns p50 / p95 per stage. Local/dev only until the production sink lands.
4. Run a fixed 10–20 question benchmark and snapshot to `web/logs/perf_baseline_<date>.json`.

**Exit criterion:** every later phase can quote concrete before/after numbers; slow requests can be attributed to DB, LLM (sql-gen / repair / synthesis), resolver, runtime classification, or cold start.

---

### Phase 2 — Anthropic Prompt Caching (1 day, biggest single LLM win)

[anthropic.ts](../web/src/lib/anthropic.ts) rebuilds a long static system prompt on every SQL-gen, repair, and synthesis call. Adding cache markers around the static blocks cuts repeated input cost ~90% and latency on the cache hit by a similar margin. **Classification is local, not an LLM call — it is excluded from this phase.**

1. Refactor each prompt builder (SQL-gen, repair, synthesis) so the **static prefix and dynamic suffix are separate strings**. Static: schema overview, semantic-contract list, table allowlist, few-shot examples. Dynamic: resolved entities + user question + (for repair) failed SQL + error.
2. Add `cache_control: { type: "ephemeral" }` markers on the static prefix blocks.
3. Verify with the `claude-api` skill that the model + SDK version supports prompt caching. Inspect response headers for `cache_read_input_tokens` to confirm hits.
4. Confirm we are on a current Claude family (Opus 4.7 or Sonnet 4.6). Don't pin to a deprecated model.

**Exit criterion:** SQL-gen, repair, and synthesis median latency on cache hit drops to ~300–800 ms each; cache hit ratio ≥ 80% across the benchmark.

---

### Phase 3 — Materialize Hot Semantic Contracts (1.5–2 days for the **first** contract; remaining contracts each ~½–1 day)

Promote the hot summary contracts to real tables, refreshed per session at ingest. On Neon, prefer real tables over `MATERIALIZED VIEW REFRESH` because (a) refresh cost is bounded to the new session(s), (b) we sidestep `REFRESH` semantics under the pooled endpoint, and (c) parity-checking tables against a preserved source definition is cleaner.

> **Critical sequencing issue caught in audit:** if we replace `core.driver_session_summary` (a view) with a thin select over `core.driver_session_summary_mat`, the canonical aggregating query is destroyed. Refresh and parity logic both need that query. **Preserve the source definition before materializing.**

**Source-definition strategy (do this first):**

1. Create a new schema `core_build` (or `core_source`). Move each hot view's *current* aggregating definition into `core_build.<name>` — same SELECT, same columns, same semantics.
2. Create the `core.<name>_mat` table whose schema mirrors `core_build.<name>` columns.
3. The refresh writer reads from `core_build.<name>` (the canonical query) and upserts into `core.<name>_mat` (the storage).
4. Replace the public `core.<name>` view with a thin `SELECT * FROM core.<name>_mat`.
5. The parity check is now well-defined: bidirectional `EXCEPT ALL` between `core_build.<name>` and `core.<name>_mat`, both sides filtered by `session_key` (full SQL in step 5 below).

**Prototype before scaling out.** Build the full pattern (build view → mat table → refresh script → parity check → public view facade → ingest hook) for **one** contract first. Recommended starter: `core.driver_session_summary` — small row count (≈ 5K), well-understood semantics, immediate latency win, easy parity check. Only after that prototype proves the pattern do we scale out.

**Implementation plan:**

1. New file `sql/008_materialized_summaries.sql` introducing `core_build` schema and the first contract's build view + mat table + facade.
2. **Discover and assert grain before defining keys.** Do not assume the obvious grain. Verified counterexample: `core.laps_enriched` has 167,172 rows but only 159,793 distinct `(session_key, driver_number, lap_number)` — a naive PK on that triple would fail. For each contract, run a discovery query before writing the key:
   ```sql
   SELECT count(*) AS rows,
          count(DISTINCT (<candidate_key_columns>)) AS distinct_keys
   FROM core_build.<contract_name>;
   -- rows must equal distinct_keys before the columns become a PK / UNIQUE
   ```
   For `core.driver_session_summary` the verified grain is `(session_key, driver_number)`. For `core.laps_enriched` the candidate triple does **not** uniquely identify rows; investigate (in-lap / out-lap duplicates? multiple lap-time sources?) and either pick a different key, add a discriminator column, or accept a non-unique table with non-unique indexes only.
3. New `src/refresh_summaries.py` admin module: `python -m src.refresh_summaries --contract driver_session_summary --session-key X` and `--all`.
4. Extend [src/ingest.py](../src/ingest.py) post-ingest hook: upsert only the affected `session_key`s into the `_mat` table.
5. **Parity check (bidirectional, session-scoped, multiplicity-preserving).** Both source-and-target sides must filter by the session being checked, we must detect drift in either direction, **and we must use `EXCEPT ALL` so duplicate-row drift is not silently collapsed by set semantics**:
   ```sql
   SELECT count(*) AS diff_rows FROM (
     (SELECT * FROM core_build.driver_session_summary WHERE session_key = $1
      EXCEPT ALL
      SELECT * FROM core.driver_session_summary_mat WHERE session_key = $1)
     UNION ALL
     (SELECT * FROM core.driver_session_summary_mat WHERE session_key = $1
      EXCEPT ALL
      SELECT * FROM core_build.driver_session_summary WHERE session_key = $1)
   ) AS diff;
   -- must be zero for parity
   ```
   `EXCEPT ALL` (not plain `EXCEPT`) is required because Phase 3 explicitly accommodates contracts whose grain is non-unique (e.g. `core.laps_enriched`). Plain `EXCEPT` collapses duplicates and would mask multiplicity drift exactly where we need to catch it. Equivalent alternative: `GROUP BY` every column with `count(*)` and compare counts. Earlier single-direction unfiltered versions of this check were also incorrect — they surfaced every other session's rows as false positives and missed extra rows in the mat table.
6. Validate on a Neon branch (clone of prod data) before promoting.

**Scale-out priority order** (each ½–1 day after the prototype lands):
- `core.laps_enriched` (hottest — feeds nearly every analytical query)
- `core.stint_summary`, `core.strategy_summary`
- `core.race_progression_summary`, `core.grid_vs_finish`
- `core.pit_cycle_summary`, `core.strategy_evidence_summary`
- `core.lap_phase_summary`, `core.lap_context_summary`
- `core.telemetry_lap_bridge` — **only if Phase 1 shows telemetry questions are slow** (this contract joins `raw.car_data` which is 115M rows; refresh cost may not be worth it)

Each table needs primary/unique keys per the **verified** grain — see the discovery step above. Any contract where the natural grain is non-unique either gets a discriminator column added or stays as a heap-with-indexes (no PK), and the refresh strategy switches from upsert to delete-then-insert per `session_key`.

**Exit criterion (prototype):** session-scoped queries on `core.driver_session_summary` drop from seconds to <100 ms p95; parity check returns zero rows for all sessions in `core.session_completeness` analytic-ready set.

**Exit criterion (full scale-out):** the priority list above is materialized, parity-checked, and refreshed automatically at ingest.

---

### Phase 4 — Targeted Indexes & Query Plans (2–4 hours)

[sql/003_indexes.sql](../sql/003_indexes.sql) is only 30 lines. Add to a new `sql/009_perf_indexes.sql`. **Index the columns that actually exist** — schema-verified against [sql/002_create_tables.sql](../sql/002_create_tables.sql):

- `raw.laps (session_key, driver_number, lap_number)` — primary access pattern
- `raw.laps (session_key) INCLUDE (lap_duration, is_pit_out_lap, duration_sector_1, duration_sector_2, duration_sector_3)` — index-only scans for valid-lap and sector filters. `raw.laps` has only `is_pit_out_lap` (no `is_pit_in_lap`), and **no compound column** — compound lives in `raw.stints.compound`.
- `raw.stints (session_key, driver_number, lap_start, lap_end) INCLUDE (compound)` — the compound dimension and stint-window join key
- `raw.pit (session_key, driver_number, lap_number)` — pit-in lap is derived from this table, not from `raw.laps`
- `raw.position_history (session_key, date)`
- Partial index: `raw.laps (session_key, driver_number) WHERE lap_duration IS NOT NULL` — valid-lap filter
- Indexes on `core.*_mat` keyed by `(session_key, driver_number, …)` per Phase 3 grain

For pit-in-lap filtering and compound-aware lap analysis, derive those signals at the **semantic / materialized layer** (`core.laps_enriched_mat` joins `raw.laps` × `raw.pit` × `raw.stints`) — not via raw indexes that don't have the columns.

Capture `EXPLAIN (ANALYZE, BUFFERS)` output before/after for each benchmark question and store in a diagnostic note.

**Exit criterion:** lap-aggregation query plans show index scans, not seq scans, on every benchmark question. No common chat path scans `raw.car_data` or `raw.location` unless the question genuinely needs them.

---

### Phase 5 — App-Layer Caches (1 day)

Three caches, all in-process or in Upstash Redis. **None go in Neon.**

1. **Resolver cache.** Wrap `core.session_search_lookup` and `core.driver_identity_lookup` calls in [chatRuntime.ts](../web/src/lib/chatRuntime.ts) with a process-level LRU keyed by query string, 15-minute TTL. Invalidate via `/api/admin/refresh` or a version key bumped at ingest.
2. **Deterministic-template cache.** Audit [deterministicSql.ts](../web/src/lib/deterministicSql.ts) coverage. Goal: ≥ 70% of benchmark questions take the 0-LLM-call-before-execute path.
3. **Full-answer cache.** Store `(question_hash → { sql, fact_payload, answer })`. On hit, return in <100 ms — no classification, SQL-gen, execute, or synthesis. Seed from `web/scripts/chat-health-check.questions.json`. Append ingest version to the hash for invalidation. In-process LRU first; Upstash later if multi-instance.

**Exit criterion:** repeat questions return < 200 ms; resolver lookup time → ~0 on warm cache.

---

### Phase 6 — Neon Production Plumbing (1 day, deferred)

**Gate:** Phase 1 baseline shows connection setup or autosuspend cold start dominates a meaningful share of latency. Without that signal, this phase is speculative.

1. **Swap driver:** [web/src/lib/db.ts](../web/src/lib/db.ts) → `@neondatabase/serverless` for the production path. Keep `pg` for the local Docker path keyed off `process.env.DB_HOST === '127.0.0.1'`.
2. **Use pooled URL in prod:** `NEON_DATABASE_URL` must point at the `-pooler` host. Add a startup assertion that prod builds use the pooler endpoint.
3. **Disable prepared-statement cache** when on the pooled endpoint (`statement_cache_size: 0`) to avoid `prepared statement "S_1" already exists` under load.
4. **Verify single `pg.Pool`** in the local path — no per-request client construction.
5. **Kill cold starts:** prefer a Vercel cron or GitHub Action pinging `/api/health` every 4 minutes; disable autosuspend only if cron coverage is insufficient.
6. **Right-size compute:** check Neon dashboard for CPU saturation during a benchmark run. If saturated, enable autoscaling with min 0.5 CU, max 2 CU.
7. New `web/src/app/api/health/route.ts` for the warm-keeper to ping.

**Exit criterion:** cold-start spikes are gone from the perf trace; p50 connection-setup time < 50 ms; prod / local connection paths are explicit and asserted at startup.

---

### Phase 7 — LLM Path Tightening + Streaming Synthesis (½–1 day)

Note: there is **no classification-LLM call to parallelize against** — classification is local logic in [chatRuntime.ts:516](../web/src/lib/chatRuntime.ts#L516). The wins here are:

1. **Tighten 0-LLM-call paths.** The deterministic SQL path is governed by `buildDeterministicSqlTemplate()` at [deterministicSql.ts:30](../web/src/lib/deterministicSql.ts#L30), invoked from the route at [route.ts:367](../web/src/app/api/chat/route.ts#L367). Audit those two sites — extend pattern coverage in `buildDeterministicSqlTemplate` and tighten the route branch so a deterministic match short-circuits the LLM SQL-gen call at [route.ts:381](../web/src/app/api/chat/route.ts#L381). Goal: more questions take the 0-LLM-call-before-execute path. (The earlier draft pointed at `chatRuntime.ts:737`, which is the tail of a session-scoring helper unrelated to deterministic SQL — corrected here so the implementer doesn't go spelunking in the wrong file.)
2. **Streaming synthesis.** Switch [route.ts:563](../web/src/app/api/chat/route.ts#L563) (synthesis call) to return a stream; have [AssistantMessage.tsx](../web/src/components/chat/AssistantMessage.tsx) render tokens as they arrive. Doesn't reduce total time, but time-to-first-token drops to ~400 ms.
3. **Skip repair on deterministic templates.** Repair-on-failure ([route.ts:502](../web/src/app/api/chat/route.ts#L502)) should only fire when SQL came from the LLM, not from a deterministic template. Verify this is the case; tighten if not.

**Removed from this phase (rejected by audit):** speculative synthesis priming with placeholder results was previously listed here as a way to warm the prompt cache. That doesn't work — Anthropic prompt caching writes the cache on first use of a prefix and reuses it on subsequent calls; you don't need a fake call to prime it, and a placeholder synthesis call would add cost and complexity without producing a usable answer. Reference: [Anthropic prompt-caching docs](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching). If anyone wants to revisit, scope it as an isolated experiment, not part of the expected 1.3–1.5× p50 gain.

**Exit criterion:** time-to-first-token < 600 ms warm, < 1.5 s cold; deterministic-template path makes zero Anthropic calls before SQL execution; modest p50 improvement (1.1–1.3×) from skipping repair on deterministic paths and tightening the 0-LLM fall-through. The larger speedups belong to Phases 2, 3, and 5.

---

### Phase 8 — Synthesis Hardening: Typed Fact Contracts + Validators (2 weeks)

Goal: kill `structured_rows_summarized` (5 rubric failures) and `synthesis_contradiction` (1 failure).

1. Insert a **typed fact-payload stage** between SQL execution and natural-language synthesis. One Zod (or equivalent) schema per question family.
2. Synthesis consumes the typed payload + a small row sample, not raw rows.
3. Extend [answerSanity.ts](../web/src/lib/answerSanity.ts) into a deterministic post-synthesis validator covering:
   - pit stops ↔ stints parity
   - sector winner consistency
   - grid ↔ finish claims
   - undercut / overcut evidence sufficiency
   - count / list parity
   - null-aware comparative claims
4. Make synthesis emit explicit `evidence_sufficiency` flags so the validator can downgrade overconfident prose.

**Exit criterion:** zero `structured_rows_summarized` and zero `synthesis_contradiction` rubric failures on the next benchmark; quality failures classify cleanly into resolver / SQL / data sufficiency / synthesis buckets.

---

### Phase 9 — Runtime Refactor (1 week)

**Gate:** Phase 0 CI is green; Phase 8 is at least architecturally complete (typed-fact stage exists) so the refactor doesn't fight a moving target.

Split the five fat modules:

- **[chatRuntime.ts](../web/src/lib/chatRuntime.ts) (2,036 LOC)** → `chat/classification.ts`, `chat/resolution.ts`, `chat/completeness.ts`, `chat/recommendations.ts`, `chat/planTrace.ts`.
- **[deterministicSql.ts](../web/src/lib/deterministicSql.ts) (1,480 LOC)** → `templates/pace.ts`, `templates/strategy.ts`, `templates/result.ts`, `templates/telemetry.ts`, `templates/dataHealth.ts`.
- **[queries.ts](../web/src/lib/queries.ts) (1,011 LOC)** → `queries/catalog.ts`, `queries/resolver.ts`, `queries/sessions.ts`, `queries/execute.ts`.
- **[route.ts](../web/src/app/api/chat/route.ts) (816 LOC)** → orchestration only; pull synthesis / sanity / repair into modules under `chat/`.
- **[answerSanity.ts](../web/src/lib/answerSanity.ts) (609 LOC)** → `validators/<family>.ts` per family.

**Exit criterion:** new question family can be added without editing a 1,000+ line file; existing tests pass unchanged; line count of every module < 600 LOC.

---

### Phase 10 — Product Surfaces Beyond Chat (3–4 weeks)

Goal: make the semantic warehouse useful even without free-form chat.

1. **Session detail upgrades:** driver roster, completeness status, lap-pace table/chart, stint timeline, strategy summary, grid-vs-finish — all backed by `core.*_mat`.
2. **Catalog page:** expose `core.session_completeness`, `core.weekend_session_coverage`, `core.source_anomaly_tracking`.
3. **Saved analyses:** persist SQL + typed fact payload + answer + chart config (existing `/api/saved-analyses` is a stub).
4. **Replay viewer:** use `core.replay_lap_frames` and `core.race_progression_summary`.

**Exit criterion:** the app is usable as a structured analyst console, not just a chat demo.

---

### Phase 11 — Quality Cleanup (1–2 weeks)

Residual conformance work after the architectural fixes have landed. **Re-target this phase against the fresh Phase 0 benchmark, not the stale 2026-03-17 numbers** — the question IDs flagged below come from the older run and may already be resolved.

1. Address remaining `raw_table_regression` cases (historical Q31 / Q45 / Q46 — re-confirm against the fresh Phase 0 benchmark) — point them at `core.*_mat`.
2. Promote `valid_lap_policy` to v2 (track-flag handling, richer invalid taxonomy). `valid_lap_policy` is already a real table at [sql/006_semantic_lap_layer.sql:50](../sql/006_semantic_lap_layer.sql#L50), so this is a row-level upgrade with a versioning column rather than a schema migration.
3. Tighten resolver disambiguation so historical Q8 / Q9 / Q15 / Q17-style intents stop over-clarifying — re-confirm against the fresh benchmark.
4. Multi-axis grader redesign — surface root-cause labels (already in JSON) into the markdown reports and a small trend dashboard.

**Exit criterion:** intense benchmark semantic-conformance ≥ 40 A/B out of 50 *on the post-Phase-0 baseline*; root-cause labels are visible in the human-readable report.

---

### Phase 12 — Production Deployment Hardening (½ day, conditional)

**Gate:** measurement shows ingest contention with chat traffic, OR multi-instance deployment is imminent.

1. Provision a Neon read replica. Add a second pool keyed by intent in [db.ts](../web/src/lib/db.ts): `pool.read` → replica, `pool.write` → primary.
2. Add environment assertions: prod must use Neon URL; local must use Docker.
3. Document `NEON_DATABASE_URL` and `NEON_DATABASE_URL_REPLICA` in `.env.example`.
4. Adopt a migration runner (sqitch / Atlas / minimal Python) so `sql/*.sql` becomes the source of truth instead of `init_db.sh` re-running everything.

**Exit criterion:** chat queries continue to work during a `python -m src.ingest --mode upsert` run; production / local connection behavior is explicit, measured, and documented.

---

## 5. Suggested Execution Order

| # | Phase | Effort | Gate | Expected impact |
|---|---|---|---|---|
| 0 | Hygiene & baseline (incl. fresh benchmark rerun) | 1 day | none | enables everything; replaces stale 2026-03-17 numbers |
| 1 | Performance instrumentation | ½ day | Phase 0 CI | enables every later quote of speedup |
| 2 | Anthropic prompt caching (SQL-gen + repair + synthesis) | 1 day | Phase 1 timings | 2–4× on LLM stages |
| 3 | Materialize hot summaries (prototype 1.5–2 d, scale-out ~1 d each) | 1.5 d + N×1 d | Phase 1 baseline | 5–50× on DB-heavy queries |
| 4 | Targeted indexes (schema-verified) | 2–4 hr | Phase 3 facade | 1.2–2× |
| 5 | App-layer caches | 1 day | Phase 1 baseline | -200 ms typical, near-instant on hits |
| 6 | Neon production plumbing | 1 day | Phase 1 numbers justify it | removes cold-start spikes |
| 7 | LLM path tightening + streaming | ½–1 day | Phases 2, 5 measurable | 1.1–1.3× + perceived latency |
| 8 | Synthesis hardening | 2 weeks | Phase 3 stable | quality, not speed |
| 9 | Runtime refactor | 1 week | Phase 0 CI; Phase 8 done | maintainability |
| 10 | Product surfaces | 3–4 weeks | Phase 9 recommended | product breadth |
| 11 | Quality cleanup | 1–2 weeks | Phase 8 typed-fact stage | remaining conformance |
| 12 | Prod deploy hardening | ½ day | measurement | isolation, portability |

Phases 4 and 5 can run in parallel with Phase 3. Phase 8 can begin once Phase 3 data shape stabilizes. Phase 11 can run alongside Phase 10.

### Realistic latency outcome on Neon

- **Cold request:** 8–12 s → 2–3 s (compute-wake + first LLM call dominate the floor)
- **Warm request:** 6–10 s → 400–800 ms
- **Cached-answer hit:** ~100 ms

---

## 6. Risks and Mitigations

1. **Risk:** `_mat` real tables drift from view definitions.
   **Mitigation:** keep original `core.*` views as thin selects from `_mat`; add a CI check that each `_mat` column list matches its source view.

2. **Risk:** Prompt-cache markers placed wrong → no hits, costs the same.
   **Mitigation:** assert `cache_read_input_tokens > 0` in `serverLog.ts` after warmup; alert in perf summary if hit rate < 50%.

3. **Risk:** Disabling autosuspend balloons Neon cost.
   **Mitigation:** start with a 4-min cron warm-keeper; only disable autosuspend if cron coverage is insufficient.

4. **Risk:** Read replica adds operational complexity for marginal gain.
   **Mitigation:** defer Phase 12 until ingest load measurably contends with chat traffic.

5. **Risk:** Answer cache returns stale answers after ingest.
   **Mitigation:** include the ingest version in the cache key; bump version at the end of every `ingest.py` run.

6. **Risk:** Speculative LLM priming (e.g. placeholder synthesis to warm the prompt cache) burns cost and tokens without producing a usable answer.
   **Mitigation:** prompt caching writes the cache on first real use of a static prefix; no priming call is required. Phase 7 explicitly excludes speculative priming. If revisited, scope as an isolated experiment, not part of the headline speedup.

7. **Risk:** Quality cleanup (Phase 11) before matview (Phase 3) regresses latency before it improves.
   **Mitigation:** order Phase 3 first, or sequence the deterministic-template rewrite to land *with* the matview cutover.

8. **Risk (Codex):** Refactoring Phase 9 before CI (Phase 0) creates silent regressions.
   **Mitigation:** Phase 9 is explicitly gated on green CI from Phase 0.

9. **Risk (Codex):** Speculative Neon driver swap (Phase 6) without measurement burns time on a non-bottleneck.
   **Mitigation:** Phase 6 is explicitly gated on Phase 1 numbers showing connection / cold-start dominance.

10. **Risk (Codex):** `next/font/google` build dependency fails offline CI.
    **Mitigation:** Phase 0 documents the dependency and offers self-hosting as the fallback if CI environment can't reach Google Fonts.

11. **Risk (gpt5.5 audit):** Replacing `core.*` views with thin selects over `_mat` tables destroys the canonical aggregating definition that refresh and parity logic depend on.
    **Mitigation:** Phase 3 introduces `core_build.*` (or `core_source.*`) as the source-definition layer. Refresh reads from `core_build`, writes to `core.*_mat`, exposes via `core.*` facade. Parity check is bidirectional and session-scoped, using `EXCEPT ALL` in both directions so duplicate-row drift is preserved for non-unique contracts (full SQL in Phase 3 step 5).

12. **Risk (gpt5.5 audit):** Indexing columns that don't exist (`is_pit_in_lap`, `st_compound` on `raw.laps`).
    **Mitigation:** Phase 4 index list is now schema-verified against [sql/002_create_tables.sql](../sql/002_create_tables.sql); pit-in and compound signals are derived at the semantic layer (`core.laps_enriched_mat`), not via raw indexes.

13. **Risk (gpt5.5 audit):** File-based perf logging is local-only and breaks on serverless filesystems.
    **Mitigation:** Phase 1 explicitly labels `web/logs/chat_query_trace.jsonl` and `/api/admin/perf-summary` as local/dev sinks; production sink (Logflare / Axiom / Datadog / `core.perf_trace` table) is deferred to Phase 6 or Phase 12.

14. **Risk (gpt5.5 audit):** Treating stale benchmark numbers (Q31/Q45/Q46 from 2026-03-17) as current.
    **Mitigation:** Phase 0 reruns the intense benchmark; Phase 11 explicitly re-targets against fresh numbers, not the historical IDs cited in this doc.

15. **Risk (gpt5.5 audit, round 2):** Materializing a contract whose natural grain is non-unique (e.g. `core.laps_enriched`: 167,172 rows vs 159,793 distinct `(session_key, driver_number, lap_number)`) — naive PK fails on table create.
    **Mitigation:** Phase 3 step 2 mandates a grain-discovery query before defining keys. Non-unique grains either get a discriminator column or stay as heap-with-indexes with delete-then-insert refresh.

16. **Risk (gpt5.5 audit, round 2):** Single-direction unfiltered parity check would falsely report drift across every other session and miss extra rows in `_mat`.
    **Mitigation:** Phase 3 step 5 specifies a bidirectional, session-filtered query using `EXCEPT ALL` (not plain `EXCEPT`) so duplicate-row drift is preserved for non-unique contracts.

---

## 7. Open Questions for Codex / User Review

1. Is Neon autosuspend currently disabled on the prod branch, or do we need the cron warm-keeper from Phase 6?
2. Is there a Neon compute-cost ceiling that constrains autoscaling bounds in Phase 6?
3. Full-answer cache placement: in-process LRU initially, or provision Upstash now to avoid the migration later?
4. Migration runner choice in Phase 12: sqitch, Atlas, minimal Python runner, or extend `scripts/init_db.sh`?
5. Refresh strategy in Phase 3: per-session incremental only, full rebuild only, or hybrid (per-session at ingest, full nightly)?
6. Product direction: chat-first, analyst-console-first, or both? Affects Phase 10 prioritization.
7. Should the migration to a typed-fact synthesis stage (Phase 8) use Zod, ts-pattern, or a hand-rolled discriminated-union schema set?

---

## 8. Files Touched (anticipated)

**New:**
- `.github/workflows/ci.yml` — Phase 0
- `web/.gitignore` update — Phase 0
- `web/src/app/api/admin/perf-summary/route.ts` (local/dev) — Phase 1
- `web/src/app/api/health/route.ts` — Phase 6
- `sql/008_materialized_summaries.sql` (introduces `core_build` schema) — Phase 3
- `sql/009_perf_indexes.sql` (schema-verified columns only) — Phase 4
- `src/refresh_summaries.py` — Phase 3
- `web/src/lib/perfTrace.ts` (or extension of `serverLog.ts`) — Phase 1
- `web/src/lib/factContracts/<family>.ts` — Phase 8
- Module splits per Phase 9 file list
- Production perf sink integration (Logflare / Axiom / Datadog / `core.perf_trace` table) — Phase 6 or 12

**Modified:**
- `web/src/lib/db.ts` — Neon serverless driver + dual pool (Phase 6)
- `web/src/lib/anthropic.ts` — prompt-cache markers, prompt restructure (Phase 2)
- `web/src/lib/chatRuntime.ts` — resolver cache, refactor (Phases 5, 9)
- `web/src/lib/deterministicSql.ts` — templates target `core.*_mat`, refactor (Phases 3, 9)
- `web/src/lib/answerSanity.ts` — typed-payload validators (Phase 8)
- `web/src/app/api/chat/route.ts` — parallelization, streaming, refactor (Phases 7, 9)
- `web/src/components/chat/AssistantMessage.tsx` — streaming UI (Phase 7)
- `src/ingest.py` — incremental summary refresh + ingest version bump (Phase 3)
- `sql/006_semantic_lap_layer.sql`, `sql/007_semantic_summary_contracts.sql` — view-over-mat conversion (Phase 3)
- `package.json` — patch deps + `npm run verify` script (Phase 0)
- `.env.example` (root, Python ingestion side) — `NEON_DATABASE_URL` (primary, pooled) in Phase 6; `NEON_DATABASE_URL_REPLICA` only if/when read replicas land in Phase 12
- `web/.env.local.example` (Next runtime side) — same Neon vars plus any Anthropic / Upstash keys introduced by Phases 2 / 5 (Phases 2, 5, 6, 12)

---

End of roadmap (v2).
