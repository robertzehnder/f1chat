# Morning-after recap automation — plan (rev 5, 2026-09-09)

Rev 5 after GPT-5.6 Sol review pass 4 (REVISE). Changes: result phrases must resolve to one
colocated typed claim whose subject and meaning match, under a closed result grammar that fails
unfamiliar constructions, with a defined result taxonomy; an explicit transition table replaces the
retry/terminal prose, every `unsupported` verdict blocks, and `paraphrase` is a claim kind; a bounded
readiness loop handles normal API lag and `final` means the FIA final classification; the standings
watermark checks against an independently snapshotted calendar and requires complete prior
classifications; ingest uses immutable run-scoped directories; source identity is per kind with
container hash, record id, transform and normalized-text hash; promotion is new-slug-only and fails
before mutation; every attempt writes only under its run directory and the orchestrator verifies the
fence before installing results.

Rev 4 after GPT-5.6 Sol review pass 3 (REVISE). Changes: a finalization checkpoint re-ingests the
classification before drafting and records provisional/final; loader success is proven from
`raw.ingestion_files` for a caller-supplied run id against an expected-file manifest; the data
closure includes the season's prior Race/Sprint results (warehouse watermark) for standings; a
result-phrase lexicon forces typed position claims and the evidence review inspects the whole body
for undeclared paraphrases; reporting entries and the candidate manifest carry raw-text hashes,
tool hashes and a pinned commit; the state table has nine calls, a bound-qualification rule, a
`failed_no_draft` terminal and retry limits; builds and exports gain `--out-dir`, promotion installs
assets first and the post JSON last; the packet gains country and location for the fallback, and
the constructor is cross-checked against the packet.

Rev 3 after GPT-5.6 Sol review pass 2 (REVISE). Changes: the race-finished wait polls OpenF1 and
FIA directly instead of the warehouse; ingest covers the packet's whole dependency closure (race +
qualifying + sprint sessions) and reads the loader's run records; the binder's acceptance suite is
split from the evidence-review suite and semantic positions are typed; source spans and prose
locations carry hashes and offsets; the context fallback resolves identities from the packet and
Jolpica history with explicit failure modes; the candidate snapshots every verifier input; the
review loop is a state machine with defined terminal states; mutual exclusion uses an atomic lock
plus fencing token; C11 is resolved; promotion installs a built payload and confirms deployment;
automatic promotion is removed; Google News discovery is dropped; this work needs its own brief.

## Goal

By ~08:00 local on the morning after a grand prix, a **machine-gated draft** of the race article is
waiting for one approval, produced with no human step between the chequered flag and that approval.

Machine-gated, precisely: every number in the prose equals the packet value at the path it cites
(per path); every figure re-renders byte-identically from its recipe; every attribution cites a
registered reporting entry and a hashed span of that entry's stored text; every link is a registered
source; style lint and the machine-readable content contract pass. Typed position claims ("won", "runner-up",
"on the podium", "retired", "finished Nth") are recomputed deterministically from `results`, and a
lexicon forces every such phrase to carry one. Not machine-checked, and labelled so: that a cited
row entails the sentence (causal claims, paraphrases). Those carry `model_reviewed:<verdict>` from an independent evidence pass and are
what the owner reads in the morning. The writer never writes a review outcome.

The owner chose this horizon over a live recap (2026-09-09): the evening delivers quotes
(Formula1.com reactions 15:38–19:51 UTC across Zandvoort and Monza), stewards' documents (16:43–20:30
UTC) and the classification, so one gated article replaces a live-then-verified pair.

## What exists (all on `main`, 2026-09-09)

| Piece | State |
|---|---|
| Evidence packet (`race_packet.mjs --session`); reads race + qualifying sessions for grid and penalties | manual; Zandvoort + Monza loaded and packeted |
| Figures with slot-bound captions + strict `--verify`; per-meeting `recipes.mjs` | Monza and Zandvoort recipes hand-written |
| Draft verifier (global number set; C1–C10 hard-coded), style lint | green on Monza v11 |
| Reporting layer: FIA docs, articles by URL, X session poller, X oEmbed, Bluesky | shipped |
| Context agent (Jolpica); exits 2 when the round is absent | shipped |
| Fact sheet (`fact_sheet.mjs`) and binder v1 (`bind_claims.mjs`: spans, per-id renders, refs, causal coverage; causal outcomes unresolved) | drafted for the Dutch GP article |
| Writer = GPT-6 Astra via `codex exec`, request assembled by hand | manual |
| Blog: file-backed store of built `<slug>.json`; `public/` baked at build; deploy = push to `main` | publishes whatever is in `content/blog/` |
| Ingest: `openf1-full-history-extract.py` (all endpoints, lower-bound session key) + `src.ingest` (all CSVs in a dir; per-file failures logged to JSONL, run still `completed`) | manual, hours |

## Gaps, in critical-path order

1. **Data spine**: no exact-session, endpoint-selective ingest of the packet's dependency closure; no
   completeness gate; the loader's success is not its exit code.
2. **Race-finished signal**: nothing observes the flag before ingest.
3. **Context agent stops the run** when Jolpica lags.
4. **Binder is v1**: no offsets/hashes, verifier still uses a global number set, no evidence review.
5. **Collectors succeed silently** on partial data.
6. **No editor/evidence loop** outside the owner's chat; no candidate closure; no promotion.

## Design

### W0 — Brief and scope

This automation is a separate implementation brief (not the current orchestra Monza brief, whose
"no database access" rule it necessarily breaks). Surface changes (fetch edges, detectors) update
`web/scripts/health/a_surface_manifest.json` as the repo rules require.

### W1 — Orchestrator: `web/scripts/recap/run_morning.mjs --meeting 2026_1294`

Idempotent step runner. State `analyst/<meeting>/run.json` written atomically (temp + rename).
Mutual exclusion: an atomic `mkdir analyst/<meeting>/.run.lock` acquires the run; the lock holds
`{pid, host, fence, acquired_at}`; every step result records the fence token; a process whose fence
is stale stops writing. Heartbeat is written by the orchestrator process every 60 s independent of
the current child step. Recovery: the watchdog checks the lock's pid (alive → wait; dead → remove
lock, resume with a new fence).

Every attempt writes **only** under `analyst/<meeting>/runs/<run id>/<step>/<attempt>/`; no child
script touches a shared path (`race_packet.mjs --out`, `build_post.mjs --out-dir`, exports
`--out-dir`, collectors `--out-dir`). The orchestrator verifies the fence immediately before
atomically installing a step result into `run.json` or advancing the current-run pointer; an
orphaned child can therefore only fill its own attempt directory.

Step results are typed: `complete | degraded(reasons[]) | retryable_failure | fatal`. Degraded is
allowed only where the design below names it. Transitions (retry counters persisted in `run.json`;
the watchdog never resets them):

| Step | On `retryable_failure` | Budget | When exhausted |
|---|---|---|---|
| await_finish | poll again | until race end + 4 h | `fatal_data` |
| ingest_light / readiness loop | re-fetch + reload after 5 min | until race end + 4 h | `fatal_data` |
| collectors (FIA, articles, Bluesky, X) | retry with backoff 30 s / 2 min / 8 min | 3 | `degraded` (X, Bluesky) or `degraded` with reduced sources (articles); FIA absent → `degraded` |
| packet / context / figures / bind | none (deterministic) | 0 | `fatal_impl` |
| writer call | retry once | 1 per pass, 3 passes | no gated draft ever → `failed_no_draft`; gated draft exists → `review_required` |
| evidence / editorial call | retry once | 1 per pass | gated draft exists → `review_required` |
| export / notify | retry once | 1 | `review_required` with the preview omitted |

Terminal states: `candidate`, `review_required`, `failed_no_draft`, `fatal_data`, `fatal_impl`. All
five notify; the watchdog resumes only a run whose current step is in a retryable transition with
budget left and whose lock holder is dead.

Main DAG (blocking): `await_finish → ingest_light → gate_completeness → collect → finalize_result →
packet → context → reporting → fact_sheet → figures → draft → bind → gates → evidence_review →
editorial_review → (loop) → candidate → notify`. `finalize_result` (W2) sits between collection and
the packet so that late penalties cannot be frozen out. `ingest_telemetry` is started detached after `ingest_light` and nothing
waits for it.

Trigger: launchd runs the runner on race days at the scheduled race end (earliest poll only) from a
plist regenerated weekly from `core.sessions`. Watchdog: a second launchd job at race end + 6 h and
at 07:30 local reads `run.json` and the lock; a non-terminal run with a stale heartbeat (> 20 min)
or a dead lock holder is resumed under the transition table, otherwise the watchdog notifies from
its own process.

### W2 — Race-finished signal and data spine

`await_finish`: polls the OpenF1 API directly (not the warehouse) for the race session's
`race_control` chequered-flag message and `session_result` rows, and fia.com for the provisional
classification; proceeds on the first, waits a 20-minute quiet period, times out `fatal` at race end
+ 4 h. Delayed starts and red flags are covered because the scheduled end is only the first poll.

Readiness loop: shortly after the flag the OpenF1 endpoints are routinely incomplete, so
`ingest_light → refresh → gate_completeness` repeats every 5 minutes, each attempt into a fresh
run-scoped directory, until the gate is complete or the data deadline (race end + 4 h) passes; only
then does the run end `fatal_data`.

`scripts/ingest_session.mjs --meeting <key> --run-id <id> --endpoints light|telemetry`: fetches the packet's
**dependency closure** — the race session plus the qualifying session (starting grid, qualifying
result for grid penalties) and, on sprint weekends, sprint qualifying and sprint — into an immutable run-scoped directory
`data/ingest/meeting_<key>/<run id>/<light|telemetry>/<session>/<endpoint>.csv` (never reused, so
the loader's recursive discovery cannot pick up stale files); `light` = laps, intervals, position,
race_control, pit, stints, session_result, starting_grid, weather, drivers, sessions, meetings;
`telemetry` = car_data, location. `src.ingest` gains a caller-supplied `--run-id`; the
wrapper builds an expected-file manifest (session × endpoint) before loading, then queries
`raw.ingestion_files` for that run id and compares one-to-one: every expected canonical path must
have exactly one record with status `success` and `rows_loaded > 0` (or `empty` only where the
endpoint may legitimately be empty, e.g. weather); a missing, unexpected, empty-where-required or
failed record fails the step. The JSONL error log is not
consulted for success. Packet-relevant matviews are refreshed afterwards.

Season closure for standings: `packet.standings_after` reads every earlier Race and Sprint result
of the season, so `gate_completeness` asserts a watermark against an
**independently snapshotted season calendar** (`data/calendar/<year>.json`, written from the OpenF1
meetings/sessions API and Jolpica's schedule at season start and refreshed weekly): for every prior
Race/Sprint in the calendar, a complete classification exists in the warehouse (row count equals
the entry list, every row with a position or a non-finish status). The C7 fields (`before`, `after`
for the top five) are asserted, not just non-empty.

`finalize_result` (after `collect`, before `packet`): re-fetches `session_result`, `race_control`
and the grid from the OpenF1 API and re-ingests them under a new run id; compares the normalized
classification (driver, position, status, laps, points, penalties applied) across two polls 20
minutes apart for stability, and against the latest FIA classification document; records
`result_status: final` **only** when the FIA document is the Final Race Classification and matches,
otherwise `provisional`. The run records a snapshot hash of the finalized inputs; on resume, a
differing finalized input invalidates every downstream step record. A candidate built on a provisional result says so in the
notification and the article's data note.

`gate_completeness --meeting <key>`: session identity and type; entry list = classification rows;
winner present; total laps plausible for the circuit; lap coverage per classified driver ≥
`last_completed_lap`; ≥ 1 stint per classified driver; race control contains the chequered flag;
`intervals` cover the final lap; racing-state view refreshed after race end; qualifying result and
starting grid present (C5/C6/C11 inputs); pole-sitter resolvable. Missing stints, final-lap
intervals, race-control closure or grid → **fatal** (the figures and beats depend on them); missing
weather or drivers metadata → degraded. The proof asserts the packet fields the beats consume, not
that each CSV loaded.

Spike first: time `light` for Zandvoort (a re-load) and Madrid live; record durations.

### W3 — Collectors with typed results and a source manifest

Every collector returns `{status, counts, last_success_at, failures[]}` and the run writes
`analyst/<meeting>/sources.json`: per source, completed/degraded, last successful poll, cutoff, and
what was unavailable. FIA documents poll every 30 min from the flag to T+5 h, once at T+8 h.
Articles come from the Formula1.com sitemap (already used by `fetch_f1com.mjs`) filtered to race
day and the day after, title-matched to the meeting; Google News discovery is dropped (no
deterministic client). Sufficiency is a separate check: the race report plus at least one reaction
piece, else `degraded` and the writer receives a reduced source set. X is optional colour, off for
the first live run; Bluesky is polled at T+4 h. Reporting is ranked by role and relevance to the
packet's storyline; engagement last. The FIA press-conference transcript is out of scope.

### W4 — Fact sheet, claims, binder (deterministic) and evidence review (model)

`fact_sheet.mjs` (exists) renders packet, context and reporting into ids. The writer returns one
artifact, `draft.json`, schema-validated and written atomically to the run directory:
`{title, dek, body_md, claims[]}`. Each claim: `span` (exact text), `loc` = `{body_sha256, start,
end}` character offsets into `body_md`, `kind` (number | attribution | paraphrase | causal |
observation | position), `refs`.

Result language is a **closed grammar**. The binder segments sentences deterministically (the
style-lint splitter) and recognises result constructions from a fixed pattern list: `<Driver> won
| wins | took victory | took the flag`; `<Driver> (finished | came home | was classified | took |
claimed) (second | third | Nth | P<n> | runner-up | on the podium)`; `<Driver> retired | did not
finish | was out`; `<Driver> completed the podium`; `one-two`. Every match must resolve to exactly
one `position` claim whose `loc` covers the sentence, whose `driver` equals the parsed subject
(surname or code) and whose proposition equals the phrase's meaning (`won` ↔ position 1; `runner-up`
↔ 2; `podium` ↔ ≤ 3; `retired` ↔ taxonomy below). Any sentence containing a result verb or ordinal
result noun that the grammar does not recognise **fails the binder**; the writer is told to use a
recognised form. Result taxonomy from `results`: `won` = position 1; `finished Nth` = position N
with status `Finished`; `classified Nth` = position N with any status (a classified car that did not
reach the flag); `retired`/`did not finish` = status not `Finished` and no position; DSQ = status
`Disqualified`. Attribution refs are `{entry: "reporting:<id>", raw_ref, start, end, sha256}` of
the source substring. Position claims are typed propositions (`{driver, position}`,
`{driver, event: "won" | "podium" | "retired"}`) the binder recomputes from `results`.

Reporting entries gain a per-kind source identity: `artifact_sha256` (the stored container: the
article HTML, the FIA PDF, or the posts JSONL), `record_id` where the container holds many records
(the post id), `transform` (`textOfHtml@1` for articles, `pdftext@1` for FIA documents,
`post_text@1` for posts), `text_sha256` (the exact normalized text offsets are measured against) and
`offset_unit: "js_string_index"`. Source spans in claims are `{entry, text_sha256, start, end,
span_sha256}` so a span binds to a specific normalized text, never to a mutable path. Promotion
requires every referenced artifact to be present locally and hash-valid; a missing one fails closed.

`bind_claims.mjs` (v1 exists; v2 adds `loc`, source spans, typed positions and the per-path numeric
rule) derives `report.md`, `post.md`, `post.meta.json`, `sidecar.json` and fails closed on: span or
offsets not matching the body hash; ambiguous span without offsets; a number whose rendering ≠ the
cited id's rendering; a number with no id; an attribution without entry + source span, or whose
span hash does not match the stored text; a position proposition contradicted by `results`; a
result construction without exactly one colocated, subject-matching, meaning-matching position
claim, or a result construction outside the grammar; a causal sentence with no claim or a claim
covering part of it; stale claims after a rewrite (body
hash changes → all claims re-derived). `verify_draft.mjs` moves from the global number set to
"equals the cited path's value", keeping the whitelist for counts one to ten.

Binder acceptance (mutation tests, all must fail): correct number on the wrong id; false rendered
finishing position; a result phrase with no position claim; a result phrase with a valid but
unrelated position claim elsewhere; wrong driver in the claim; wrong event in the claim; an
unrecognised result construction; absent or ambiguous literal span; stale offsets; missing numeric
binding; partial causal coverage; attribution whose source span hash mismatches.

`evidence_review.mjs` (a second `codex exec`, read-only) receives the **whole body** plus the
declared claims with their cited rows and source spans. It returns, per declared causal/paraphrase
claim, `supported | qualified(qualification text) | unsupported` with the evidence used, and a list
of **undeclared** attributed or paraphrased sentences it found (any sentence with said / according /
explained / described / admitted / a source link, or a cause the packet cannot establish, that has no
claim). Undeclared sentences block candidacy like `unsupported`; **any** `unsupported` verdict blocks,
material or not. `qualified` blocks until the returned qualification text is bound as a span in the
body (the writer must add it). Written as
`review.outcome = model_reviewed:<verdict>`. Evidence-review acceptance (separate suite):
unrelated-but-existing span; unsupported paraphrase; an unsupported paraphrase deliberately omitted
from `claims[]`; unsupported causal inference — each must be caught.

The content contract becomes machine-readable (`corpus/style/content_contract.json`: every beat
C0–C13 with a resolution rule for the recap profile; C11 conditional on `grid_penalties` non-empty,
otherwise `not material` with the reason) and is the single source for prompt, binder and verifier.

### W5 — Writer, review loop and terminal states

`write_draft.mjs --meeting --pass N [--findings file]` assembles the request and runs
`codex exec -m gpt-6-astra -s read-only`, parsing the output as `draft.json` and refusing anything
else. The loop:

```
writer → bind + deterministic gates → evidence_review → editorial_review → writer (consolidated findings)
```

A pass that fails the deterministic gates returns to the writer with the failures only. A candidate
requires: gates pass, no material claim `model_reviewed:unsupported`, editorial verdict SHIP. Cap:
3 writer passes. If the cap is reached without a candidate, the run ends `review_required` with the
last gated draft (if any), the unresolved evidence verdicts and the editor's last findings; the
notification says "automation did not converge". `review_required` is a terminal state for the
watchdog; `fatal` is not.

`edit_pass.mjs` runs the consolidated editorial rubric (`corpus/style/editorial_rubric.md`, from
this week's three rounds). Cost per race: up to 3 writer + 3 evidence + 3 editorial calls = 9 GPT-6
calls before retries (each retried at most once).

### W6 — Figures, two to start, with typed omission

`figures_auto.mjs`: `strategy_split` (stint gantt; all classified finishers if fewer than eight) and
`gap_trace` (winner vs runner-up, full race, racing-state layer, pit dots, quality flags preserved).
`gap_trace` is **omitted with a typed reason** when the pair gap is missing or lapped for more than
a fifth of the race or the runner-up retired; the writer's figure list reflects the omission.
Conditional later: `charge` (deterministic picks with tie-breaks by finishing position; DNFs
excluded; absent grid → omitted) and `closing_rate` (green-flag window ≥ 6 laps, observed gaps,
no in/out laps, net closure ≥ 3 s). A hand-written `recipes.mjs` overrides when present.

### W7 — Candidate closure, notification, promotion

`build_post.mjs`, `export_figures.mjs` and `export_post_html.mjs` gain `--out-dir`; the unattended
run never writes under `web/content/blog/` or `web/public/`. The candidate
`analyst/<meeting>/candidate/<run id>/` snapshots **every verifier input and output**: packet.json,
context.json, reporting.json (with `raw_sha256` per entry; the protected source text itself stays in
the local raw store and is referenced by hash), sources.json, draft.json, report.md, post.md,
post.meta.json, sidecar.json, figures/*.json and *.png, the built `<slug>.json` payload, the
verifier and lint reports, evidence and editorial verdicts, and `manifest.json` listing each file's
sha256, the pinned repo commit, and the sha256 of the verifier, binder, content contract, lint
script, figure compiler and recipes used. `content_sha256` is computed over the listed files in
canonical order and excludes `manifest.json` itself.

`notify`: macOS notification + email with the single-file HTML preview, the verifier report, the
evidence verdicts, the editor's last findings, the source manifest and cost lines.

`promote_post.mjs --meeting --run <id>`: re-hashes the candidate against its manifest, re-runs the
verifier on the snapshot, requires the slug to be **new** (fails before any mutation if
`web/content/blog/<slug>.json` or `public/blog/<slug>/` exists; replacing a published post is out
of this milestone), then installs the assets directory first and the built `<slug>.json` last as
the visibility marker; on failure it removes only what this promotion created. Then it stops. Committing and pushing use the established git
workflow (the owner or the assistant on a branch, as today); the script does no git. After the push,
`confirm_deploy.mjs --slug` waits for the deployment and smoke-tests the public post, its figures
and the packet link before recording `published` in `run.json`. No automatic promotion.

### W8 — Context agent fallback (in slice 1)

When the current round is absent from Jolpica, `context_facts.mjs` resolves identities from the
packet and Jolpica history: driver by the packet's three-letter code against the season's driver
list (falls back to surname match; ambiguous or absent → the driver-specific facts are omitted with
a typed reason, e.g. a rookie); circuit by the Jolpica circuits list matched on the packet's
`session.circuit_short_name`, `session.country_name` and `session.location` (the packet schema gains
the last two from `core.sessions`; ambiguous or absent → circuit facts omitted); nationality from the
resolved driver's Jolpica record; constructor from the driver's most recent season result
**cross-checked against `packet.drivers[].team`** by constructor name (mismatch → constructor facts
omitted with a typed reason). Season wins = Jolpica season-to-date + the
packet's win; standings from `packet.standings_after`. Tests run both branches with the current-race
response removed, asserting circuit, nationality, season-win and pole facts.

## Sequencing (each slice lands on `main` with tests)

| Slice | Delivers | Proof |
|---|---|---|
| S1 data spine + signal | `ingest_session.mjs` (closure, light/telemetry, run-record check), `gate_completeness`, `await_finish` (OpenF1 + FIA polling), context fallback, lock/lease/watchdog | Zandvoort light re-load timed; gate passes on Zandvoort/Monza and fails on a truncated copy; `await_finish` replays a recorded race; context agent with the round removed |
| S2 minimal orchestrator | `run_morning.mjs` producing packet + candidate closure from an existing draft; telemetry detached | Zandvoort end to end with `--from packet`; manifest hashes verify |
| S3 binder v2 + per-path verifier | `draft.json` schema, offsets/hashes, typed positions, mutation suite | all binder mutations fail; Dutch GP draft binds without hand edits |
| S4 writer loop + evidence review + two figures | `write_draft.mjs`, `evidence_review.mjs`, `edit_pass.mjs`, rubric, `figures_auto.mjs` | Dutch GP article produced by the loop; evidence-review mutations return unsupported |
| S5 collectors + manifest | typed results, `sources.json`, sitemap discovery + sufficiency, relative FIA polling | Zandvoort reporting rebuilt from discovery alone; manifest lists cutoffs |
| S6 notification + promotion + deploy confirmation | `notify`, `promote_post.mjs`, `confirm_deploy.mjs` | a promoted candidate is smoke-tested on the deployed site |
| S7 live | Madrid (2026-09-13) unattended through `notify`; durations and degradations recorded | run.json + sources.json from the night |
| later | X colour, `charge`/`closing_rate` conditionals, telemetry-derived corners | |

## Risks

- Ingest over WAN: per-endpoint retries, isolated directories, run-record checks, telemetry decoupled.
- Codex unavailable or a call timing out: one retry, then `review_required` with the last gated draft.
- OpenF1 API lag after the flag: `await_finish` also accepts the FIA classification; both absent
  at T+4 h → fatal + notify.
- Playwright export needs the app: the runner starts the dev server on 3101.
- Jolpica down: context `degraded`; article proceeds without context facts.

## Open decisions (owner)

1. Promotion by running `promote_post.mjs` and pushing in the morning (only option in this milestone).
2. Local Mac trigger via launchd (recommended; codex, Playwright and git are local).
3. Whether the recap leads with the reporters' reading or the packet's storyline (recommended: the
   packet's storyline, the feed for colour).
4. X sentiment off for the first live run (recommended).
