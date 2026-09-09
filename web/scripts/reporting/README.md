# Reporting layer (owner decisions 2026-09-09)

The analyst packet is the evidence for numbers; this layer supplies the
**reporting** an article may attribute: official documents, outlet articles
and paddock sentiment. Output per meeting: `analyst/<meeting>/reporting.json`
(committed: metadata, links, tiers, roles, short excerpts of official
documents). Raw text lives only in the git-ignored
`corpus-artifacts/<source_key>/reporting/<meeting>/`.

| Tier | Source | Script | Cost |
|---|---|---|---|
| 1 | FIA event documents (decisions, infringements, classifications, notes) | `fia_docs.mjs --meeting 2026_1293` | free |
| 2 | Registered outlet articles (Formula1.com, The Race) | `build_reporting.mjs --meeting … --add-url <url>` | free |
| 3 | X lean list — qualifying / sprint / race windows only | `x_poll.mjs --meeting …` (`--resolve` first) | pay-per-use, ≈ $4–8 a weekend |
| 3 | X hand-picked posts via the public oEmbed endpoint | `x_oembed.mjs --meeting …` (URLs in `corpus/inbox/x_urls.txt`) | free |
| 3 | Bluesky curated list | `bsky_poll.mjs --meeting …` (`--search` to find handles) | free |

Then `build_reporting.mjs --meeting …` compiles `reporting.json`.

Rules (enforced by `scripts/corpus/lib/rights.mjs` rows from migration 063):
facts are citable from tiers 1–2; tier 3 is paraphrased sentiment attributed by
name with the post link; verbatim quotes ≤ 4 words; every `attribution` claim
in `sidecar.json` must cite `reporting:<id>`, and every link in the article
must be a registered entry (`verify_draft.mjs` fails otherwise).

Env: `X_BEARER_TOKEN` (app-only) and `NEON_DB_*` in `web/.env.local`
(`set -a; . ./.env.local; set +a` before running). PDF text extraction uses
PDFKit via `lib/pdftext.swift`, compiled once to `corpus-artifacts/bin/pdftext`.
