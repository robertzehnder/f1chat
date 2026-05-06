# V0 Visualization — phases needing dev environment

Phases 8, 12, 13, 15 from the merged plan require a running dev
server + Anthropic API key + (for Playwright) a browser install. They
were scaffolded in code where possible but their full activation is
gated on environment setup. This doc captures what's done and what
remains.

---

## Phase 8 — Adapter fixture capture from benchmark

**Status**: not scaffolded. Requires running the 167-question
benchmark against a live dev server with `ANTHROPIC_API_KEY` set,
which captures `ChatApiResponse` payloads to per-qid fixture files.

**To execute**:
```sh
# In one shell:
cd web && npm run dev

# In another:
cd web && OPENF1_CHAT_BASE_URL=http://127.0.0.1:3000 \
  node scripts/run_category_benchmarks.mjs --category all \
  --out ../diagnostic/phase_19_baseline_$(date +%Y-%m-%d).json
```

**Then**: write a small `web/scripts/capture-adapter-fixtures.mjs`
that walks the per-question result JSONs in `web/logs/` and
extracts each `ChatApiResponse` to `web/scripts/tests/fixtures/chat-api/q####.json`.

This task is ~1 hour once the benchmark has run. The benchmark itself
takes ~80 minutes wall-time.

---

## Phase 12 — Visual regression for `/mock`

**Status**: not scaffolded. Requires:
1. `npm install --save-dev @playwright/test`
2. `npx playwright install chromium`
3. Write `web/playwright.config.ts` with deterministic font loading
   and animation suppression
4. Write `web/tests/visual/mock-fixtures.spec.ts` that visits
   `http://localhost:3000/mock` and captures one screenshot per
   `data-testid="fixture-{m##}"` entry at 1440×1200 / 1280×900 /
   390×844
5. Generate baseline snapshots; commit under
   `web/tests/visual/mock-fixtures.spec.ts-snapshots/`

**Plan note**: each fixture already has `data-testid={`fixture-${id}`}`
on its outer `<section>` (added in Phase 1's /mock route rewrite),
so the Playwright selector is straightforward.

---

## Phase 13 — Visual regression for live pipeline

**Status**: not scaffolded. Requires Phase 8 (captured ChatApiResponse
fixtures) + Phase 12 (Playwright setup). Specifically:
1. Write `web/src/app/mock/live-fixtures/page.tsx` that imports each
   captured `ChatApiResponse` fixture, runs it through the real
   pipeline (`mapChatApiResponseToParts → foldPartsIntoInsight →
   applyResponseSemantics → applyScalarHero → applyVerdictSemantics →
   applyQuestionTitle → applyInsightFields → toCardProps →
   InsightCard`), and renders the result with a `data-testid={`live-${qid}`}`
2. Write `web/tests/visual/live-fixtures.spec.ts` that captures one
   screenshot per `data-testid` at the same three viewports

This proves the live pipeline produces visuals matching the static
fixtures.

---

## Phase 15 — Backend benchmark parity gate

**Status**: not run. The merged plan's gate is "backend A-rate ≥
104/167 (May-5 parity)." Run after all other phases have shipped:

```sh
cd web && npm run dev   # (in one shell)
cd web && OPENF1_CHAT_BASE_URL=http://127.0.0.1:3000 \
  node scripts/run_category_benchmarks.mjs --category all \
  --out ../diagnostic/phase_19_baseline_$(date +%Y-%m-%d).json
```

Compare the resulting A/B/C counts to `phase_19_baseline_2026-05-05.json`
(104/167 A from May-5). If A-rate drops, identify which Phase
introduced the regression by binary-searching commits between
`phase26.0/regression-recovery` head and the tip of
`ui/v0-frontend-replacement`.

The phases most likely to affect benchmark grading:
- **Phase 2** (synthesis prompt change) — added required keys
  ("answer" still required, others optional). Risk: low.
- **Phase 3** (per-shape prompt templates) — different few-shot
  examples per shape. Risk: medium; the verdict template starts the
  answer with explanation rather than the YES/NO word, which might
  confuse the grader rubric if it keys on "YES"/"NO" prefixes.
- All other phases (5, 6, 9, 10, 11, 16) are infrastructure / type /
  registry / telemetry / CI changes — no impact on `answer` text.

---

## Phase 7 — Discriminated `ChartSpec` union

**Status**: deliberately deferred. The full discriminated-union
refactor touches every chart renderer (`as any` cast removal across
17 cases) plus all detector `build()` return types. Estimated 4-5h
with non-trivial risk of breaking existing visual output if the
narrowing is done wrong.

**Trade-off**: Phase 7's value is type safety / preventing fixture
field drift onto the wrong chart shape. Today's flat optional
`ChartSpec` works at runtime; the fixtures are visually QA-able.
Skipping Phase 7 means a bad fixture field would be caught at
`/mock` review rather than at typecheck.

**Recommended follow-up**: ship Phase 7 in a dedicated PR after
visual regression (Phase 12-13) is in place — that way the migration
has a snapshot baseline to compare against.
