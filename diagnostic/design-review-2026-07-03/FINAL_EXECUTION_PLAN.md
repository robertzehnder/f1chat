# Execution Plan — Finish the Final 5 Visual-QA Roadmap Items

> **⚠️ READ FIRST — where the verbatim edit bodies live.** This plan gives the
> ordered steps, corrected anchors, and baked-in fixes. Wherever a step says
> "use the spec's exact code / detail / full-file contents", the **verbatim
> bodies** (full new-file contents + exact OLD→NEW strings) are in
> **`diagnostic/design-review-2026-07-03/WORKFLOW_SPECS.json`** →
> `items[N].spec.files[]` (each has `path`, `action`, `detail`). It is keyed by
> item id (`A4-event-pin`, `A3-status-grid`, `A5-corner-delta`,
> `B19-dead-renderers`, `B17-clarification`). **Open it per item before editing.**
> Extract one item's file bodies with, e.g.:
> `python3 -c "import json;o=json.load(open('diagnostic/design-review-2026-07-03/WORKFLOW_SPECS.json'));[print('==',f['action'],f['path'],'==\n',f['detail']) for it in o['items'] if it['id'].startswith('A4-') for f in it['spec']['files']]"`
> **Always re-grep every OLD string against the current file before editing — line numbers WILL drift, but the OLD strings are still exact anchors.** The apply order, collision map, and baked fixes here take precedence over the raw spec where they differ (the specs predate this session's A1/B1/B14/B3 edits).

## 0. State recap (what is already done)

This is the `ui/v0-frontend-replacement` branch of the F1 chat app (repo root
`/Users/robertzehnder/Documents/coding/f1/openf1`, app in `web/`). The visual-QA
roadmap foundation and Waves 1–2 are complete and **already applied this
session**: the TrackMap primitive (`markers`/`mini`/`showCornerLabels`/
`showStartFinish`/`pointAt`), plus items **A2, A1, B1, B14, B3**. Concretely,
already on disk: `mapInsight.ts` gained exported `applyCornerMap()` and a
rewritten `applyQuestionTitle` + `isSelfTitle()`/`titleFromRows()`;
`page.tsx` imports `applyCornerMap` (first line of the `@/lib/mapInsight` import
block) and calls `folded = applyCornerMap(folded)` in the finalize pipeline;
`chart-types.ts` gained `corner_map` on `InsightMock` and `empty_axes?: string[]`
on `ChartSpec` (line 119, just before `rows?`); the radar detector in
`registry.ts` now retains all-zero axes and emits `empty_axes`; `line-chart.tsx`
got fastest-lap `ReferenceDot` diamonds; `radar-chart.tsx` was fully rewritten to
grey empty spokes. **Nothing is committed.** Only **5 items remain**:
B17-clarification, A4-event-pin, A3-status-grid, A5-corner-delta, B19-dead-renderers.

**CRITICAL:** the per-item specs in
`diagnostic/design-review-2026-07-03/WORKFLOW_SPECS.json` were generated BEFORE the
session edits above, so their OLD-string anchors may be stale. The corrected
anchors below were re-verified against the CURRENT files (confirmed at plan time:
`chart-types.ts` rows anchor at line 122, `empty_axes` at 119, `corner_map` at
227; `page.tsx` import block lines 16–24 with `applyCornerMap` first, fold at
272–279, render at 399; `index.tsx` `delta_comparison`/`timeline`/`DeltaComparison`
at 24/41–42/51/125; `deterministicSql.ts` imports 34/40/44/45, `type
DeterministicContext` at 47, `if (!targetSession)` at 165; `registry.ts`
detectors 599/622/809/1301/1329 and `CHART_DETECTORS` array 1616–1637;
`topicGuards.ts` `driver_pair_brake_zones` at 477, `TEMPLATE_TOPICS_EXEMPT` at
508; `orchestration.ts` `buildBrakeZonesInsight` import 46, ternary 1637–1638).
**Line numbers WILL drift as items land — re-grep every anchor immediately before
each edit rather than trusting a stated line number.** Use exact-string matching
on the OLD strings below; those are stable, the line numbers are not.

---

## 1. Apply order (chosen to minimize shared-file churn)

Files touched by **more than one** of the 5 items:

| File | Items that touch it |
|---|---|
| `web/src/lib/chart-types.ts` | B17, A4, A3, A5, B19 (all 5) |
| `web/src/lib/mapInsight/detectors/registry.ts` | A4, A3, A5 |
| `web/src/components/f1-chat/charts/index.tsx` | A5, B19 |
| `web/src/lib/deterministicSql.ts` | A5, B19 |
| `web/src/lib/deterministicSql/topicGuards.ts` | A5, B19 |
| `web/src/app/api/chat/orchestration.ts` | A5 only (single) |
| `web/src/app/page.tsx` | B17 only (single) |
| `web/src/lib/mapInsight.ts` | B17 only (single) |
| test harness (`template-router-topic-*.test.mjs`) | A5 (coverage), B19 (guards) |

**Apply order: A4 → A3 → A5 → B19 → B17.**

Rationale:
- **A4 first**: only shares `chart-types.ts` + `registry.ts`, both editing
  regions disjoint from the others. Get the additive-only detector/type work in
  first so later `registry.ts` edits sit on a known base.
- **A3 second**: shares the same two files (`chart-types.ts`,
  `registry.ts`), again disjoint regions (ChartSpec `venue_grid`/`venues` +
  `statusGridDetector.build()`). Landing A3 right after A4 keeps all
  `registry.ts` detector edits contiguous in time.
- **A5 third**: the heaviest fan-out (8 shared files). Doing it after A4/A3 means
  its `registry.ts` and `chart-types.ts` anchors only shift by A4/A3's additive
  insertions — re-grep and apply. A5 also introduces the topicGuards +
  deterministicSql + orchestration + index.tsx + coverage-test edits that B19
  will sit on top of.
- **B19 fourth**: deletions/migrations across `index.tsx`, `chart-types.ts`,
  `deterministicSql.ts`, `topicGuards.ts`, plus the guards test harness. Running
  it after A5 means B19 deletes `delta_comparison`/`timeline` **without** having
  to reconcile A5's new `corner_delta_grid` union member (A5 inserts it earlier
  in the union at the `track_corner_delta`/`track_speed_map` boundary; B19
  removes `timeline` near the top and `delta_comparison` at the tail — disjoint).
- **B17 last**: pure frontend/typing, single-file-heavy (`page.tsx`,
  `mapInsight.ts`, `insight-card.tsx`, `toCardProps.ts`, `chatTypes.ts`,
  `chart-types.ts`, `clarification-card.tsx`). Its only shared file is
  `chart-types.ts` (adds `clarification` after `corner_map`, the current last
  field) — landing last means that anchor is still the tail. Its `page.tsx`
  anchors are not touched by any other item.

After **each** item: run typecheck (§4) and re-grep the next item's anchors.
Do the live-UI screenshot sweep once at the very end (§5), but you MAY spot-check
per item if a render looks wrong.

---

## 2. Shared-file collision map (apply-order-sensitive edits)

- **`chart-types.ts`** — five non-overlapping insertions:
  - A4: extend `TimelineEvent` (adds `circuit?`/`corner_label?`/`corner_number?`) — lines ~51–57.
  - A3: append `VenueCoverage` interface after `StatusGridRow`; add `venue_grid?`/`venues?` after `rows?: StatusGridRow[];` (~line 122).
  - A5: add `| "corner_delta_grid"` to the ChartType union (between `track_corner_delta` and `track_speed_map`); add `corner_deltas?`/`corner_delta_drivers?` after `corner_zones?`.
  - B19: **remove** `| "timeline"` from the union (line 14–15) and `| "delta_comparison"` (the tail member, line 31).
  - B17: add `clarification?` to `InsightMock` after `corner_map?` (current last field, line 227).
  - These never touch the same lines; apply in the item order above and re-grep each OLD string.
- **`registry.ts`** — A4 edits `eventTimelineDetector` (599–620) + inserts `parseCornerFromMessage` above it; A3 edits `statusGridDetector.build()` (825–847); A5 inserts `cornerDeltaGridDetector` before `brakeZoneDeltaDetector` (1329) + adds it to `CHART_DETECTORS` (between `trackSpeedMapDetector,` and `brakeZoneDeltaDetector,`). All three detectors are distinct; no line collides but the `CHART_DETECTORS` array and later line numbers drift — re-grep.
- **`index.tsx`** — A5 adds `corner-delta-grid` import + `corner_delta_grid` case + re-export; B19 removes `delta_comparison` import/case/re-export and `timeline` case. Apply A5 first (additive), then B19's deletions.
- **`deterministicSql.ts`** — A5 adds `cornerDelta` import/export + a return-branch after `if (brakeZones) return brakeZones;`; B19 adds `sessionTypeShare` import (after the `dataHealth` import) + a return-branch before `if (!targetSession)`. Disjoint regions.
- **`topicGuards.ts`** — A5 adds `driver_pair_corner_delta: { owns: ["corner"] }` after the brakeZones entry (line 477); B19 populates `TEMPLATE_TOPICS_EXEMPT` (line 508). Disjoint.
- **Coverage/guards tests** — BOTH A5 and B19 now touch BOTH harnesses (additive, disjoint list entries): A5 adds `cornerDelta.ts` to coverage `SCAN_FILES` (A5.10) **and** to the guards transpile list + rewrites (A5.12, BLOCKING — breaks the moment A5 lands); B19 adds `sessionTypeShare.ts` to the guards transpile list + rewrites (B19.8, BLOCKING) **and** to coverage `SCAN_FILES` (B19.9). Same two files, non-overlapping array inserts.

---

## 3. Per-item steps

### ITEM 1 — A4-event-pin (Event-timeline corner-pin + per-driver lanes)

Verifier verdict: sound, no findings. Apply **chart-types BEFORE registry** (the
`build()` spread depends on the new `TimelineEvent` fields or tsc fails).

**Step A4.1 — `web/src/lib/chart-types.ts` (edit)** — extend `TimelineEvent`.
OLD (verbatim, ~lines 51–57):
```
export interface TimelineEvent {
  lap: number;
  driver: string;
  kind: string;
  team_color: string;
  message: string;
}
```
NEW: same block, adding before the closing `}`:
```
  /** A4: circuit_short_name from the row (core.sessions), for the on-track
   *  corner pin. Only present on live race-control rows; absent on mocks. */
  circuit?: string;
  /** A4: corner label parsed from the steward message_text (e.g. "Turn 7").
   *  Data-gated — set ONLY when the message explicitly names a corner. */
  corner_label?: string;
  /** A4: corner number parsed from message_text. The pin's lap-fraction is
   *  resolved client-side against the real track-outline corners, so no
   *  corner-fraction is stored here (kept honest — never invented). */
  corner_number?: number;
```

**Step A4.2 — `web/src/lib/deterministicSql/raceControlIncidents.ts` (edit, 2 sub-edits)**.
EDIT 1 — add `circuit_short_name` to the `sess` CTE. OLD (~52–57):
```
    sess AS (
      SELECT country_name, location, year, session_name
      FROM core.sessions
      WHERE session_key = ${targetSession}
      LIMIT 1
    )
```
NEW: same, `SELECT country_name, location, circuit_short_name, year, session_name`.
EDIT 2 — project it in the final SELECT. OLD (~66–69):
```
      (SELECT country_name FROM sess) AS country_name,
      (SELECT location FROM sess) AS location,
      (SELECT year FROM sess) AS year,
      (SELECT session_name FROM sess) AS session_name
```
NEW: insert `      (SELECT circuit_short_name FROM sess) AS circuit_short_name,`
between the `location` and `year` lines. (Additive column only — passes
`querySafety` BANNED_SQL.)

**Step A4.3 — `web/src/lib/mapInsight/detectors/registry.ts` (edit, 2 sub-edits)**.
EDIT 1 — insert `parseCornerFromMessage` IMMEDIATELY BEFORE the anchor line
`const eventTimelineDetector: ChartDetector = {`:
```
// A4: parse an explicit corner reference out of a race-control message.
// Data-gated — returns null unless the text names a corner, so the pin is
// never invented. Handles "TURN 7", "T7", "AT TURN 1", "TURNS 3/4" (first).
function parseCornerFromMessage(
  message: string
): { corner_number: number; corner_label: string } | null {
  if (!message) return null;
  const m = /\bturns?\s*(\d{1,2})|\bt(\d{1,2})\b/i.exec(message);
  const raw = m?.[1] ?? m?.[2];
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 30) return null;
  return { corner_number: n, corner_label: `Turn ${n}` };
}
```
EDIT 2 — replace the `build()` body. OLD (verbatim):
```
  build(rows) {
    return {
      type: "event_timeline",
      events: rows.map((r) => ({
        lap: toNumber(r.lap ?? 0),
        driver: String(r.driver ?? r.driver_name ?? ""),
        kind: String(r.kind ?? "event"),
        team_color: getTeamColor(String(r.driver ?? r.driver_name ?? "")),
        message: String(r.message ?? r.note ?? "")
      }))
    };
  }
};
```
NEW:
```
  build(rows) {
    const circuit =
      typeof rows[0]?.circuit_short_name === "string" && rows[0].circuit_short_name
        ? String(rows[0].circuit_short_name)
        : undefined;
    return {
      type: "event_timeline",
      circuit,
      events: rows.map((r) => {
        const message = String(r.message ?? r.note ?? "");
        const corner = parseCornerFromMessage(message);
        return {
          lap: toNumber(r.lap ?? 0),
          driver: String(r.driver ?? r.driver_name ?? ""),
          kind: String(r.kind ?? "event"),
          team_color: getTeamColor(String(r.driver ?? r.driver_name ?? "")),
          message,
          ...(circuit ? { circuit } : {}),
          ...(corner
            ? { corner_label: corner.corner_label, corner_number: corner.corner_number }
            : {})
        };
      })
    };
  }
};
```
`matches()` is UNCHANGED; no `CHART_DETECTORS` array change (already registered, priority 92).

**Step A4.4 — `web/src/components/f1-chat/charts/timeline-chart.tsx` (FULL OVERWRITE)**.
Current file is ~58 lines; overwrite entirely with the spec's `timeline-chart.tsx`
`detail` block. Rebuilds the timeline as per-driver horizontal lanes over a shared
`L{min}..L{max}` lap ruler with kind-based inline-SVG glyphs, hover popovers, and a
data-gated `EventCornerPin` that reuses the CornerMiniMap pattern:
`useTrackOutline(circuit)` → find corner by number/label in `outline.corners` →
`<TrackMap outline variant="mini" highlights=[{f0,f1,color,label}]
markers=[{f,color,label,r:30}] />`, returning null if outline/corner unresolved.
Imports `{ ChartSpec, TimelineEvent }` from `@/lib/chart-types`, `{ cn }` from
`@/lib/utils`, `{ TrackMap, useTrackOutline }` from `./track-map`. Props
`{ chart, className }` — serves BOTH `index.tsx` cases `"timeline"` (line 52) and
`"event_timeline"` (line 86). Renders lanes alone (no pin) when events carry none
of the new optional fields (mock m15 back-compat). All theme tokens
(`bg-popover`, `text-popover-foreground`, `bg-surface-raised`, `text-red-text`,
`text-section-label`, `bg-chart-axis`, `bg-secondary`, `border-border`,
`ring-background`) confirmed present — no substitution.

**Baked fixes (A4):** none beyond re-anchoring (verifier findings empty). All
theme tokens confirmed to exist; `circuit_short_name` confirmed on `core.sessions`.

**Verification prompt (A4):** Live chat: *"Show the steward penalties and
incidents at the 2025 São Paulo Grand Prix"* → INCIDENT_TRIGGER →
`session_race_control_incidents` → `event_timeline` detector. Expect per-driver
lanes over an L{min}..L{max} ruler with glyphs + hover popovers; if a message
names a corner AND `circuit_short_name` resolves, an on-track pin renders below
(mini TrackMap marker captioned "Lap N · T4 · real {circuit} outline"). Then
`/mock` m15 (`type:"timeline"`, no corner/circuit fields) must still render lanes
with NO pin.
**Gate (A4):** `cd web && npx tsc --noEmit` (apply chart-types before registry),
then the São Paulo live screenshot + the /mock m15 back-compat check.

---

### ITEM 2 — A3-status-grid (24-circuit coverage grid)

Verifier verdict: sound, findings empty (two non-blocking notes only).

**Step A3.1 — `web/src/lib/deterministicSql/telemetryWeatherGap.ts` (edit, 2 sub-edits)**.
EDIT 1 — doc comment (~lines 8–14): replace the existing block with the NEW block
that mentions `circuit_short_name` + derived season round + per-VENUE roll-up (24
mini outlines) — use the spec's exact NEW string.
EDIT 2 — the `const sql =` template (~38–64): replace the two-CTE WITH block with
the NEW three-CTE version that adds
`rounds AS ( SELECT meeting_key, DENSE_RANK() OVER (PARTITION BY year ORDER BY date_start, meeting_key) AS round FROM raw.meetings )`,
adds `s.circuit_short_name,` and `r.round,` to the SELECT (before
`s.session_name AS session_name_raw`), adds `LEFT JOIN rounds r ON r.meeting_key =
s.meeting_key`, and raises `LIMIT 30` → `LIMIT 200`. All existing output columns
preserved so the insight builder + `status_grid.matches()` are unchanged. SQL is
clear of BANNED_SQL (`DENSE_RANK`/`OVER`/`PARTITION`/`analytics` are fine).

**Step A3.2 — `web/src/lib/chart-types.ts` (edit, 2 sub-edits)**.
EDIT 1 — append `VenueCoverage` after the `StatusGridRow` interface. OLD:
```
export interface StatusGridRow {
  session_key?: number;
  label: string;
  [key: string]: string | number | undefined;
}
```
NEW: same block + blank line +
```
export interface VenueCoverage {
  circuit: string;
  location: string;
  round?: number;
  status: "green" | "amber" | "red";
  gaps: number;
  total: number;
}
```
(with the spec's doc comments).
EDIT 2 — after `rows?: StatusGridRow[]; // status_grid` (currently line 122; OLD
string still exact & unique) add:
```
  /** status_grid venue mode: when set, StatusGridChart renders a grid of
   *  mini circuit outlines tinted by coverage status instead of the table. */
  venue_grid?: boolean;
  venues?: VenueCoverage[]; // status_grid venue mode
```

**Step A3.3 — `web/src/lib/mapInsight/detectors/registry.ts` (edit)** — replace the
`statusGridDetector.build()` body (starts ~line 825; `statusGridDetector` at 809).
OLD is the version mapping rows→cells returning `{ type:"status_grid",
rows: rows.map(...), legend }`. NEW body: compute `legacyRows` first (same
mapping); if `cols.includes("circuit_short_name")` roll each row up per circuit
into an `acc` Map (a session is a gap when any coverage col is missing/partial;
venue green=0 gaps, red=gaps>=total, amber otherwise), build a sorted `venues[]`
(by round then location), and when non-empty return `{ type:"status_grid",
venue_grid:true, venues, rows:legacyRows, legend }`; else `{ type:"status_grid",
rows:legacyRows, legend }`. In-scope helpers `findCol`/`isNumericLike`/`toNumber`
already used. `matches()` NOT touched.

**Step A3.4 — `web/src/components/f1-chat/charts/status-grid.tsx` (FULL OVERWRITE — file ALREADY EXISTS)**.
The spec labels this "create" but the file exists — apply as a **Write/overwrite**,
not a create (a create would fail). Replace the whole file with the spec's
contents: imports `useMemo`, `ChartSpec`+`VenueCoverage` from `@/lib/chart-types`,
`cn` from `@/lib/utils`, `{ TrackMap, useTrackOutline }` from `./track-map`;
defines `STATUS_TINT` (green→`hsl(var(--semantic-positive))`,
amber→`hsl(var(--accent-amber))`, red→`hsl(var(--semantic-negative))`),
`STATUS_LABEL`, the legacy `STATUS_COLORS` map. `VenueTile` calls
`useTrackOutline(venue.circuit)` and branches undefined→pulse skeleton, null→dot,
else `<TrackMap outline variant="mini" segments={[{color:tint,label}]} .../>`.
`VenueGrid` renders the CSS grid + all-clear banner + legend. `StatusGridChart`
returns `<VenueGrid>` when `chart.venue_grid && chart.venues?.length`, ELSE the
**ORIGINAL legacy table preserved verbatim** (strict superset — no behavior lost).

**Baked fixes (A3):** (1) `chart-types.ts` rows anchor is at line 122, not the
spec's 118 (the already-applied `empty_axes` shifted it) — OLD string still exact.
(2) `registry.ts` build() body is at ~825–847, not the spec's 829–852 — OLD string
byte-identical. (3) `status-grid.tsx` reclassified create→overwrite. Two
non-blocking notes carried forward: `validateColumnExistence` runs on the new
DENSE_RANK CTE (all catalog columns exist; live gate confirms); single-entry
`segments` painting the whole outline is the intended mini-tile behavior (correct,
not a bug).

**Verification prompt (A3):** Live chat: *"Which 2025 sessions have telemetry but
no matching weather data?"* → `sessions_telemetry_without_weather` → `status_grid`
venue_grid render: a CSS grid of ~24 mini outlines tinted green/amber/red with an
Rn round label + venue name; an "All clear" banner only when every venue is green;
a three-swatch Complete/Partial/Gap legend.
**Gate (A3):** `cd web && npx tsc --noEmit` clean AND
`cd web && npx tsx --test scripts/tests/mapInsight.test.ts` green (plus status_grid + answer-cache
tests), THEN the live venue-grid screenshot (real UI, not /mock).

---

### ITEM 3 — A5-corner-delta (Corner-delta card, all corners, 2 drivers)

Verifier verdict: sound; **one P0 typecheck fix baked in**. 11 edits + 3 new files.
Apply `chart-types.ts` BEFORE `registry.ts` (build() references the new fields).

**P0 FIX (baked into Step A5.9):** the raw spec set `verdict.label` to
`"EVEN"`/`` `${LEADER} EDGE` `` but `InsightFields["verdict"].label` is the
literal union `"YES" | "NO"` (chatTypes.ts:111), so tsc would fail AND VerdictCard
would render a wrong YES/NO badge. FIX: **DROP the `verdict` object entirely** and
route the same summary sentence into `at_a_glance` (free-form string, rendered at
insight-card.tsx:158). Keep all locals; only the `verdict` const is removed and its
text assigned to `at_a_glance`. (The spec's claim that "brakeZonesInsight uses the
same verdict pattern" is FALSE — that file only ever assigns "YES"/"NO".)

**Step A5.1 — `web/src/lib/deterministicSql/cornerDelta.ts` (CREATE)** — full new
file per spec `files[0].detail`: `import type { DeterministicSqlTemplate } from
"./types";`, CORNER_TRIGGER/COMPARE_TRIGGER/TURN_LIST regexes,
`export function buildCornerDeltaTemplate(input): DeterministicSqlTemplate | null`.
Guards: null if either driver undefined or equal; require
`CORNER_TRIGGER||TURN_LIST` and `COMPARE_TRIGGER||TURN_LIST`. SQL: `WITH best`
(GROUP BY corner over `analytics.corner_analysis` WHERE
`session_key=${targetSession} AND driver_number IN (${driverA},${driverB})`,
MAX entry/MIN apex/MAX exit + MIN start_normalized `zone_f0` / MAX end_normalized
`zone_f1`), `a`/`b` split, `sess` CTE; final SELECT emits marker col
`'corner_delta' AS corner_delta_kind` + corner_number/corner_label/zone_f0/zone_f1
+ a_/b_ driver numbers+names+entry/apex/exit kph + signed entry/apex/exit_delta_kph
(a−b) + circuit/country/location/year/session_name; JOIN b on corner_number WHERE
both apex NOT NULL ORDER BY a.corner_number. Return
`{ templateKey: "driver_pair_corner_delta", sql }`.

**Step A5.2 — `web/src/lib/deterministicSql.ts` (edit, 2 sub-edits)**.
EDIT 1 — after the two `brakeZones` import+export lines (40–41) add:
```
import { buildCornerDeltaTemplate } from "./deterministicSql/cornerDelta";
export { buildCornerDeltaTemplate } from "./deterministicSql/cornerDelta";
```
EDIT 2 — **RE-ANCHOR AT APPLY TIME.** The block cites "after `if (brakeZones)
return brakeZones;`". At plan time `buildBrakeZonesTemplate({...})` is called at
line 216; grep for `if (brakeZones) return brakeZones;` and insert immediately
after it (before the `raceControlIncidents` block):
```
  // A5: corner-by-corner entry/apex/exit delta grid (driver pair, all corners).
  const cornerDelta = buildCornerDeltaTemplate({ lower, targetSession, driverA: resolvedDriverPair[0], driverB: resolvedDriverPair[1] });
  if (cornerDelta) return cornerDelta;
```

**Step A5.3 — `web/src/lib/deterministicSql/topicGuards.ts` (edit)** — after
`driver_pair_brake_zones: { owns: ["braking"] },` (line 477) add a comment line +
`  driver_pair_corner_delta:                         { owns: ["corner"] },`.

**Step A5.4 — `web/src/lib/chart-types.ts` (edit, 2 sub-edits)**.
EDIT 1 — between `| "track_corner_delta"` and `| "track_speed_map"` insert
`  | "corner_delta_grid"`.
EDIT 2 — after the `corner_zones?: Array<...>` field add `corner_deltas?:
Array<{ label; f; entry_delta; apex_delta; exit_delta; a_entry; b_entry; a_apex;
b_apex; a_exit; b_exit; leader; color; node_r }>` and `corner_delta_drivers?:
{ a: string; b: string; a_color: string; b_color: string }` (spec's exact NEW +
doc comments).

**Step A5.5 — `web/src/lib/mapInsight/detectors/registry.ts` (edit, 2 sub-edits)**.
EDIT 1 — insert the full `cornerDeltaGridDetector: ChartDetector` IMMEDIATELY
BEFORE `const brakeZoneDeltaDetector: ChartDetector = {` (line 1329) per spec
`files[4].detail`: id `corner_delta_grid`, priority **108**, fixtures/benchmarkQids
`[]`, `matches` keys on `corner_delta_kind`, `build` produces `{ type:
"corner_delta_grid", circuit, corner_deltas, corner_delta_drivers, y_axis, x_label,
y_value_format:"kph", legend:{positive:`${aLast} faster`,negative:`${bLast}
faster`}, diverging_colors:{positive:aColor,negative:bColor}, series:[{name:`${aLast}
− ${bLast}`, values: apex_delta ladder, color:aColor}] }`. **series MUST be a
one-element array** (diverging-bar reads `chart.series[0].values`). Helpers
`lastName`/`getTeamColor`/`getDistinctTeamColors`/`parseFiniteNumber` in scope.
EDIT 2 — in `CHART_DETECTORS`, between `trackSpeedMapDetector,` and
`brakeZoneDeltaDetector,` (lines 1636–1637) insert `  cornerDeltaGridDetector,`.

**Step A5.6 — `web/src/components/f1-chat/charts/corner-delta-grid.tsx` (CREATE)** —
full new file per spec `files[5].detail`: `"use client"`; import `ChartSpec` type,
`DivergingBarChart` from `./diverging-bar-chart`, `{ TrackMap, useTrackOutline }`
from `./track-map`. `export function CornerDeltaGrid({ chart })`: TrackMap with
`markers=deltas.map(d=>({f:d.f,color:d.color,r:d.node_r}))` when
`outline&&deltas.length`; a two-driver legend; the per-corner entry/apex/exit tile
grid (`grid-cols-2 sm:grid-cols-3`) using `hsl(var(--surface-raised))`/
`--section-label`/`--border`; then `<DivergingBarChart chart={chart} />`. Keep the
`fmt(+/-toFixed(1))` helper.

**Step A5.7 — `web/src/components/f1-chat/charts/index.tsx` (edit, 3 sub-edits)**.
EDIT 1 — after `import { TrackCornerDelta } from "./track-corner-delta"` add
`import { CornerDeltaGrid } from "./corner-delta-grid"`.
EDIT 2 — after `case "track_corner_delta": return <TrackCornerDelta chart={chart} />`
add `    case "corner_delta_grid":` / `      return <CornerDeltaGrid chart={chart} />`.
EDIT 3 — after `export { DeltaComparison } from "./delta-comparison"` (line 125) add
`export { CornerDeltaGrid } from "./corner-delta-grid"`. **Note: B19 removes the
DeltaComparison re-export line — apply A5 EDIT 3 relative to it first, then B19
deletes the DeltaComparison line while leaving the CornerDeltaGrid export.**

**Step A5.8 — `web/src/lib/synthesis/cornerDeltaInsight.ts` (CREATE, WITH P0 FIX)** —
`import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";`. Keep
num/str/lastName helpers, `export type CornerDeltaInsightResult = { answer: string;
insight: InsightFields }`, `export function buildCornerDeltaInsight(rows):
CornerDeltaInsightResult | null`. Keep the guard (`corner_delta_kind` &&
`apex_delta_kph` in rows[0]) and all computations
(aWon/bWon/even/meanApex/overallLeader/overallTrailer/leaderWonCount/biggest/
biggestLeader/venue/year/venueYear). **DO NOT create a `verdict` object.** Instead:
```
at_a_glance: `${overallLeader} carried more apex speed at ${leaderWonCount} of ${apexCorners.length} corners (${Math.abs(meanApex).toFixed(1)} km/h average edge over ${overallTrailer}); biggest swing at ${biggest.label} (${biggestLeader} by ${Math.abs(biggest.apex).toFixed(1)} km/h).`
```
Returned `InsightFields = { title, subtitle, at_a_glance, metrics (top-3 by |apex|,
InsightFieldMetric label/value/context/emphasis), key_takeaways:
takeaways.slice(0,6), related_questions }` — **NO verdict key.** Keep the `answer`
string exactly as specced.

**Step A5.9 — `web/src/app/api/chat/orchestration.ts` (edit, 2 sub-edits)**.
EDIT 1 — between the `buildBrakeZonesInsight` import (line 46) and the
`buildSectorDominanceInsight` import add
`import { buildCornerDeltaInsight } from "@/lib/synthesis/cornerDeltaInsight";`.
EDIT 2 — **RE-ANCHOR** (deeply-nested ternary ~1637). After
`? buildBrakeZonesInsight(result.rows)` insert
`: selectedTemplateKey === "driver_pair_corner_delta"` /
`  ? buildCornerDeltaInsight(result.rows)` before the existing
`: selectedTemplateKey === "driver_pair_sector_dominance"` branch. Ragged
indentation is cosmetic; TS ignores it.

**Step A5.10 — `web/scripts/tests/template-router-topic-coverage.test.mjs` (edit)** —
in `SCAN_FILES`, between `"src/lib/deterministicSql/brakeZones.ts",` and
`"src/lib/deterministicSql/sectorDominance.ts",` insert
`  "src/lib/deterministicSql/cornerDelta.ts",`.

**Step A5.11 — `web/src/components/f1-chat/charts/grouped-bar-chart.tsx` (edit)** —
change `const domainMin = isSmallRange ? 'auto' : minVal - range * 0.1` to
`const domainMin = isSmallRange ? 'auto' : 0` (update the two comment lines per spec
`files[8].detail`). Leave `domainMax` unchanged. **GLOBAL side-effect** — every
large-range (range>=10) grouped_bar now baselines at 0; eyeball residual grouped_bar
cards after apply.

**Step A5.12 — `web/scripts/tests/template-router-topic-guards.test.mjs` (edit, BLOCKING — 2ndopinion finding #1)** —
this harness transpiles+imports the REAL `deterministicSql.ts`, which after A5.1/A5.2
imports `cornerDelta`, so `cornerDelta.ts` MUST be registered here or **every** guards
test throws (this cannot wait for B19.8 — it breaks the moment A5 lands).
EDIT 1 — add `    "src/lib/deterministicSql/cornerDelta.ts",` to the transpile `files`
array (next to the other `deterministicSql/*` entries). EDIT 2 — add two rewrite rules
mirroring the existing ones:
```
    rewritten = rewritten.replace(/from\s+["']\.\/cornerDelta["']/g, 'from "./cornerDelta.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/cornerDelta["']/g, 'from "./cornerDelta.mjs"');
```
(`cornerDelta.ts`'s own `from "./types"` import is already covered by the existing types rewrite.)

**Baked fixes (A5):** P0 verdict→at_a_glance (above). Verifier MINOR #2 REJECTED
(the DivergingBar ladder IS team-colored by sign via `diverging_colors`;
`getTeamColorByDriver(label)` at diverging-bar:31 is dead for fill — keep
`diverging_colors` + `legend` as specced). Verifier MINOR #3 ACKNOWLEDGED (the
grouped-bar baseline-at-0 is global — see risk). Routing confirmed: priority 108
makes `cornerDeltaGridDetector` first-evaluated; `matches()` keys on the net-new
`corner_delta_kind` marker column so it cannot shadow/be shadowed.

**Verification prompt (A5):** Live chat: *"Compare Verstappen and Leclerc corner by
corner at Abu Dhabi 2025 — where did each gain on entry, apex and exit through every
turn?"* → templateKey `driver_pair_corner_delta` (topic guard owns:["corner"]) →
`corner_delta_grid` card = mini track map with per-corner nodes sized by |apex
delta| + colored by faster driver + two-driver legend + entry/apex/exit signed-km/h
tiles + a diverging ladder (bars filled by sign, biggest gap first), PLUS a
deterministic insight card titled *"Corner-by-corner — Verstappen vs Leclerc · Abu
Dhabi 2025"* whose `at_a_glance` names the apex winner + biggest swing (NO YES/NO
badge). Fallback (no outline): tiles + ladder only. Also sanity-check a residual
grouped_bar (*"show Max and Charles apex speeds at the three heaviest brake zones"*)
now baselines at 0.
**Gate (A5):** `cd web && npx tsc --noEmit` passes (proves the verdict→at_a_glance
fix + new fields), then **both**
`cd web && node --test scripts/tests/template-router-topic-coverage.test.mjs` **and**
`cd web && node scripts/tests/template-router-topic-guards.test.mjs` pass (the guards test
proves A5.12 registered `cornerDelta` correctly), then the Abu Dhabi live screenshot.

---

### ITEM 4 — B19-dead-renderers (delete delta_comparison + bare timeline; migrate M15; wire donut)

Verifier verdict: 3 findings baked in. Apply AFTER A5 so the union deletions sit on
A5's additive `corner_delta_grid` member.

**Step B19.1 — `web/src/lib/chart-types.ts` (edit, 2 sub-edits)** — remove the two
dead ChartType members. EDIT A (lines ~14–15) OLD:
```
  | "timeline"
  | "event_timeline"
```
NEW:
```
  | "event_timeline"
```
EDIT B (the tail member, ~line 31) OLD:
```
  | "telemetry_overlay"
  | "delta_comparison";
```
NEW:
```
  | "telemetry_overlay";
```
Leave the `events?: TimelineEvent[]; // timeline / event_timeline` comment (line
~121) — non-load-bearing. Do NOT touch `telemetry_overlay?:` (line ~149).

**Step B19.2 — `web/src/__mocks__/insights/_source.ts` (edit)** — migrate M15 off
`timeline`. OLD (~204–206):
```
  chart: {
    type: "timeline",
    events: [
      { lap: 12, driver: "Sainz", kind: "track_limits", team_color: "#64C4FF", message: "5 SECOND TIME PENALTY — TRACK LIMITS" },
```
NEW: same with `type: "event_timeline"`. Behavior-preserving (both render through
the identical TimelineChart; manifest.ts:210 already declares `event_timeline`).

**Step B19.3 — `web/src/components/f1-chat/charts/index.tsx` (edit, 4 sub-edits)**.
EDIT 1 — remove `import { DeltaComparison } from "./delta-comparison"` (line 24),
keeping the `CompositeCard` and `TrackCornerDelta` imports around it.
EDIT 2 — remove the `delta_comparison` case + its two backwards-compat comment
lines (41–44), leaving `grouped_bar` and `line` cases adjacent.
EDIT 3 — remove the bare `timeline` case (51–52), leaving `radar` next.
EDIT 4 — remove `export { DeltaComparison } from "./delta-comparison"` (line 125).
**KEEP** the `case "event_timeline": return <TimelineChart .../>` branch (85–86) —
it serves migrated M15. **KEEP** the A5 `CornerDeltaGrid` import/case/re-export.

**Step B19.4 — `web/src/components/f1-chat/charts/delta-comparison.tsx` (DELETE)** —
`git rm web/src/components/f1-chat/charts/delta-comparison.tsx` (zero importers
after B19.3). If deletion is impossible, replace body with `export {}`.

**Step B19.5 — `web/src/lib/deterministicSql/sessionTypeShare.ts` (CREATE)** — the
season-grain donut template per spec (verified against `types.ts`:
`DeterministicSqlTemplate = { templateKey; sql }`, and `donutDetector.matches` needs
a `label` col + a `/value|count|share|pct|percent/` col + rows 2–6 + no
`driver_name`). Exports
`buildSessionTypeShareTemplate(ctx: { lower: string }): DeterministicSqlTemplate |
null` with a narrow phrasing gate (a session-composition phrase AND a quantity/mix
word), a year parse (default 2025), returning
`{ templateKey: "session_type_share", sql }` where SQL is
`SELECT session_type AS label, COUNT(*) AS session_count FROM core.sessions WHERE
year = ${year} AND session_type IS NOT NULL GROUP BY session_type ORDER BY
session_count DESC, label ASC LIMIT 6`. Use the exact file body from the block.

**Step B19.6 — `web/src/lib/deterministicSql.ts` (edit, 2 sub-edits)**.
EDIT 1 — import the builder. OLD (corrected anchor — telemetry+dataHealth imports,
blank line, then `type DeterministicContext`):
```
import { buildTelemetryTemplate } from "./deterministicSql/telemetry";
import { buildDataHealthTemplate } from "./deterministicSql/dataHealth";

type DeterministicContext = {
```
NEW: same, adding
`import { buildSessionTypeShareTemplate } from "./deterministicSql/sessionTypeShare";`
after the `dataHealth` import (before the blank line).
EDIT 2 — register before the `if (!targetSession)` gate. OLD:
```
  const telemetryWeatherGap = buildTelemetryWeatherGapTemplate({ lower });
  if (telemetryWeatherGap) return telemetryWeatherGap;

  if (!targetSession) {
    return null;
  }
```
NEW: insert between the `telemetryWeatherGap` return and `if (!targetSession)`:
```
  // Session-type composition donut (season-grain; no session pin).
  const sessionTypeShare = buildSessionTypeShareTemplate({ lower });
  if (sessionTypeShare) return sessionTypeShare;
```

**Step B19.7 — `web/src/lib/deterministicSql/topicGuards.ts` (edit)** — populate the
exempt list. OLD:
```
export const TEMPLATE_TOPICS_EXEMPT: ReadonlyArray<string> = [];
```
NEW: the documented single-entry array
`export const TEMPLATE_TOPICS_EXEMPT: ReadonlyArray<string> = ["session_type_share"];`
with the corrected comment (finding #2: `templateAllowsTopic` line 521
`if (!entry) return true;` already passes unknown keys — this edit is coverage-test
tidiness, NOT routing).

**Step B19.8 — `web/scripts/tests/template-router-topic-guards.test.mjs` (edit, 2 sub-edits)** —
**BLOCKING (finding #1):** this harness transpiles+imports the REAL
`deterministicSql.ts`, so the new import must be registered or every test throws
module-not-found (tsc alone won't catch it).
EDIT 1 — add `sessionTypeShare.ts` to the transpile `files` array. OLD:
```
    "src/lib/deterministicSql/dataHealth.ts",
    "src/lib/deterministicSql/telemetry.ts",
    "src/lib/deterministicSql.ts"
```
NEW: insert `    "src/lib/deterministicSql/sessionTypeShare.ts",` before the
`deterministicSql.ts` line.
EDIT 2 — add two import-rewrite rules next to the dataHealth/telemetry rewrites:
```
    rewritten = rewritten.replace(/from\s+["']\.\/sessionTypeShare["']/g, 'from "./sessionTypeShare.mjs"');
    rewritten = rewritten.replace(/from\s+["']\.\/deterministicSql\/sessionTypeShare["']/g, 'from "./sessionTypeShare.mjs"');
```
(sessionTypeShare.ts's own `from "./types"` import is already covered by the
existing `./types` rule.)

**Step B19.9 — `web/scripts/tests/template-router-topic-coverage.test.mjs` (edit, 2ndopinion finding #2)** —
the new `sessionTypeShare.ts` template is invisible to the topic-coverage scan; add it
for tidiness/parity with A5.10. In `SCAN_FILES` insert
`    "src/lib/deterministicSql/sessionTypeShare.ts",` (next to the other
`deterministicSql/*` entries). (Non-blocking, but keeps the coverage assertion honest.)

**Baked fixes (B19):** (1) finding #1 → the blocking test-harness step above. (2)
finding #2 → corrected topicGuards comment (exempt is coverage-test tidiness, not
routing). (3) finding #3 → two `delta_comparison` mentions intentionally LEFT:
`manifest.ts:111` (descriptive string, not the ChartType) and `registry.ts:143`
(a comment) — neither is typechecked; `a_surface_manifest.json` keys also left
(JSON, not typechecked). Anchor correction: `deterministicSql.ts` EDIT 1 widened to
include the telemetry import line (a blank line sits above `type
DeterministicContext`).

**Verification prompt (B19):** (1) Donut: *"How many sessions of each type were
there in 2025?"* → `session_type_share` runs, returns `label`+`session_count` rows,
renders a DonutChart with a "<total>\ntotal" center label. (2)
`cd web && npx tsc --noEmit` → zero errors after the deletions + M15 migration. (3)
`cd web && node scripts/tests/template-router-topic-guards.test.mjs` (and
`template-router-topic-coverage.test.mjs`) → all pass. (4) `/mock` incidentsMock →
penalty timeline renders identically via `event_timeline`.
**Gate (B19):** `cd web && npx tsc --noEmit` zero errors AND
`cd web && node scripts/tests/template-router-topic-guards.test.mjs` passes (the harness that
breaks if the import isn't registered), THEN the live donut screenshot.

---

### ITEM 5 — B17-clarification (sprint-weekend session disambiguation choice card)

Verifier verdict: sound, no findings; two anchor corrections baked in. Apply LAST
(pure frontend/typing; only shared file is `chart-types.ts`, tail insert).

**Step B17.1 — `web/src/lib/chatTypes.ts` (edit)** — declare `sessionCandidates` on
the resolution wire type. OLD (~136–144):
```
    resolution?: {
      status?: string;
      needsClarification?: boolean;
      selectedSession?: {
        sessionKey?: number;
        label?: string;
      };
      selectedDriverNumbers?: number[];
    };
```
NEW: same block, before the closing `};` add:
```
      /** B17: session disambiguation candidates. Present on
       *  runtime_clarification responses so the client can render one-tap
       *  choice buttons. `label` is the buildSessionLabel() string; NEVER
       *  surface sessionKey as the visible option text. */
      sessionCandidates?: Array<{
        sessionKey: number;
        sessionName?: string | null;
        year?: number | null;
        confidence?: number;
        score?: number;
        label?: string;
      }>;
```

**Step B17.2 — `web/src/lib/chart-types.ts` (edit)** — add `clarification?` to
`InsightMock` (propagates to `DraftInsight` via `extends Omit<InsightMock,'title'>`).
OLD (corner_map is the last field, line 227):
```
  corner_map?: { circuit: string; corner_number?: number; corner_label?: string };
}
```
NEW: same line + before `}`:
```
  /** B17: session-disambiguation choice card. Renders one-tap option buttons;
   *  picking one re-sends `resolvedQuery`. `label` is human-readable; sessionKey
   *  builds the re-send query only, never shown as button text. */
  clarification?: {
    prompt: string;
    question: string;
    options: Array<{
      sessionKey: number;
      sessionType: string;
      label: string;
      resolvedQuery: string;
      primary: boolean;
    }>;
  };
```

**Step B17.3 — `web/src/components/f1-chat/charts/clarification-card.tsx` (CREATE)** —
`"use client"` component per spec `detail`. Exports `interface ClarificationOption
{ sessionKey; sessionType; label; resolvedQuery; primary }` and
`function ClarificationCard({ prompt, options, onResolve }: { prompt: string;
options: ClarificationOption[]; onResolve: (resolvedQuery: string) => void })`.
Imports `cn` from `@/lib/utils`. Returns null when options empty. Renders a "Which
session?" section label, the prompt prose, then a vertical list of option buttons
keyed by sessionKey; each calls `onResolve(opt.resolvedQuery)`; the primary option
styled `border-primary`/`bg-primary` + a "Most likely" badge
(`text-red-text`/`bg-primary`), non-primary `border-border`/`bg-surface-raised` +
a → glyph. Theme tokens only (`primary`, `red-text`, `section-label`,
`surface-raised`, `muted-foreground`, `border`, `foreground` — all registered). No
domain hex, no ChartSeries.color. **`ClarificationCard` imports directly from
`./charts/clarification-card`, so `charts/index.tsx` needs NO change.**

**Step B17.4 — `web/src/lib/mapInsight.ts` (edit)** — insert `applyClarification` +
two helpers between `applyResponseSemantics` and the `applyScalarHero` banner. OLD
(~157–162):
```
  return next;
}

// =============================================================================
// applyScalarHero — M01 single-row scalar promotion
// =============================================================================
```
NEW: same, but between the `}` and the banner insert the `applyClarification`
section from the spec verbatim: helpers `sessionTypeLabel(sessionName, fullLabel)`
and `compactCandidateLabel(fullLabel)` (split on '/'), then
`export function applyClarification(insight: DraftInsight, response:
ChatApiResponse, question: string): DraftInsight`. Body: early-return `insight`
unless `generationSource === 'runtime_clarification'`; read
`candidates = response.runtime?.resolution?.sessionCandidates ?? []`; early-return
if `candidates.length < 2`; map up to 4 candidates to options with
`resolvedQuery = `${trimmedQuestion} (session ${c.sessionKey})``, `primary =
i === 0`; set `next.clarification = { prompt: (response.answer ?? '').trim() ||
'Which session did you mean?', question: trimmedQuestion, options }`;
`next.body = ''`; `next.chart = undefined`; `return next`. Use the spec's exact code.

**Step B17.5 — `web/src/components/f1-chat/insight-card.tsx` (edit, 3 sub-edits)**.
EDIT 1 (line 5) — after `import { ChartRenderer, MetricGridRenderer, HeroScalar,
VerdictCard, CompositeCard, NoDataCard } from "./charts"` add
`import { ClarificationCard, type ClarificationOption } from "./charts/clarification-card"`.
EDIT 2 (props, ~23–24) — between `onFollowUp?: (question: string) => void` and
`className?: string` insert:
```
  /** B17: session-disambiguation choice card. */
  clarification?: {
    prompt: string
    options: ClarificationOption[]
  }
  onResolve?: (resolvedQuery: string) => void
```
EDIT 3a (destructure, ~71–73) — between `onFollowUp,` and `className,` add
`clarification,` and `onResolve,`.
EDIT 3b (render, ~151–152) — before the `{/* Hero Scalar (M01) */}` /
`{hero && <HeroScalar hero={hero} />}` block prepend:
```
        {clarification && clarification.options.length > 0 && onResolve && (
          <ClarificationCard prompt={clarification.prompt} options={clarification.options} onResolve={onResolve} />
        )}
```

**Step B17.6 — `web/src/lib/toCardProps.ts` (edit)** — forward clarification. OLD
(~72–73):
```
    cornerMap: m.corner_map,
    takeaways: m.key_takeaways,
```
NEW:
```
    cornerMap: m.corner_map,
    clarification: m.clarification
      ? { prompt: m.clarification.prompt, options: m.clarification.options }
      : undefined,
    takeaways: m.key_takeaways,
```

**Step B17.7 — `web/src/app/page.tsx` (edit, 3 sub-edits)**.
EDIT 1 (import — CORRECTED for the session's `applyCornerMap` insert). OLD (current
lines 16–24, `applyCornerMap` is already the first member):
```
import {
  applyCornerMap,
  applyInsightFields,
  applyQuestionTitle,
  applyResponseSemantics,
  applyScalarHero,
  applyVerdictSemantics,
  foldPartsIntoInsight
} from "@/lib/mapInsight";
```
NEW: same block with `  applyClarification,` inserted as the FIRST member (line
after `import {`, above `applyCornerMap`).
EDIT 2 (fold — anchor VALID; the 3 lines are still consecutive even though
`applyCornerMap` was inserted AFTER `applyScalarHero`, not after
`applyResponseSemantics`). OLD:
```
      folded = applyInsightFields(folded, finalPayload.insight ?? null);
      folded = applyResponseSemantics(folded, finalPayload);
      folded = applyScalarHero(folded);
```
NEW: insert `      folded = applyClarification(folded, finalPayload, text);`
between `applyResponseSemantics` and `applyScalarHero` (`text` is the `handleSend`
param, confirmed in scope).
EDIT 3 (render, line 399). OLD:
```
                    <InsightCard {...toCardProps(message.insight)} onFollowUp={handleFollowUp} />
```
NEW:
```
                    <InsightCard {...toCardProps(message.insight)} onFollowUp={handleFollowUp} onResolve={(q) => void handleSend(q)} />
```

**Baked fixes (B17):** (1) page.tsx import anchor corrected — the session inserted
`applyCornerMap,` as the first member, so the spec's original OLD would not match;
insert `applyClarification,` above it. (2) page.tsx fold anchor confirmed valid
(the 3-line applyInsightFields/applyResponseSemantics/applyScalarHero block is
still consecutive; note `applyCornerMap` now sits AFTER applyScalarHero, which is
fine — applyClarification goes between applyResponseSemantics and applyScalarHero).
All other anchors re-verified. `applyClarification` sets `body=''`/`chart=undefined`
— benign because downstream `applyScalarHero`/`applyVerdictSemantics` early-return
on clarification responses and InsightCard renders the block unconditionally above
the hero.

**Verification prompt (B17):** Live UI (real chat, not /mock): a session-type-
ambiguous sprint-weekend prompt with NO explicit session type or year — e.g. *"Who
was fastest at Imola?"* or *"What was the fastest lap at the Miami sprint
weekend?"*. Expect a ClarificationCard: a "Which session?" label, the prompt prose,
one-tap buttons showing bold session type (e.g. "Sprint Qualifying") + a compact
"venue · year" subline, the top candidate with a "Most likely" badge, and NO raw
session_key visible in any button. Clicking re-sends `<original> (session <key>)`,
which `parseSessionKeyMention` pins deterministically and returns a real answer
card. Cross-check button labels against `runtime.resolution.sessionCandidates` in
the /api/chat network body.
**Gate (B17):** `cd web && npx tsc --noEmit` (additive optional fields; the two
structurally-identical ClarificationOption shapes must be assignable), then the
live sprint-weekend screenshot + successful re-send answer (real UI, not /mock).

---

## 4. Operational notes

- **Typecheck** (run after EACH item): `cd /Users/robertzehnder/Documents/coding/f1/openf1/web && npx tsc --noEmit`
  (equivalently `npm run typecheck`). Must be zero errors before moving to the next item.
- **Second opinion** (foreground, if a step looks ambiguous mid-apply): invoke the
  `/2ndopinion` skill via the Skill tool — it drafts, has the Codex CLI (GPT-5.5,
  read-only) critique, integrates worthwhile feedback, and returns a synthesis.
  Run it in the foreground (blocking) so its output is in-context before you apply.
- **Live preview**: start via `preview_start` with the launch config name **`web`**
  (Next.js dev server on **port 3000**). Use the preview MCP tools
  (`preview_screenshot`, `preview_snapshot`, `preview_fill`, `preview_click`,
  `preview_network`) to fire each item's verification prompt through the REAL chat
  UI and screenshot the result — per project MEMORY (`visual_qa_via_live_ui`),
  verify charts through the live UI, NOT `/mock` (except the explicit m15
  back-compat check in A4/B19). If `.claude/launch.json` lacks a `web` entry with
  `runtimeExecutable: "npm"`, `runtimeArgs: ["run","dev"]`, `port: 3000`, create it.
- **Commits**: commit-only-when-asked. **Nothing is to be committed** during this
  work unless the user explicitly requests it. The branch is
  `ui/v0-frontend-replacement`; leave all changes staged/unstaged as the apply tool
  leaves them.
- **Anchors**: line numbers in this plan are plan-time snapshots and WILL drift as
  items land. Always re-grep the OLD string immediately before each edit. Highest
  collision-risk anchors: the `orchestration.ts` ternary (~1637), the
  `deterministicSql.ts` return-branches, and `chart-types.ts` (all 5 items).

---

## 5. Final acceptance checklist

Run all of these AFTER all 5 items are applied:

1. **Typecheck**: `cd web && npx tsc --noEmit` → zero errors. (Confirms the A5 P0
   verdict→at_a_glance fix, all new optional ChartSpec/InsightMock fields, the B19
   union deletions, and the B17 ClarificationOption assignability.)
2. **Test suite**:
   - `cd web && npx tsx --test scripts/tests/mapInsight.test.ts` (A3 status_grid + builders) → green.
   - `cd web && node --test scripts/tests/template-router-topic-coverage.test.mjs` (A5 cornerDelta.ts scanned) → pass.
   - `cd web && node scripts/tests/template-router-topic-guards.test.mjs` (B19 — the transpile harness that breaks if `sessionTypeShare` import isn't registered) → pass.
   - `cd web && node scripts/tests/answer-cache.test.mjs` → pass (regression guard).
3. **Live-prompt screenshot sweep** (real chat UI on port 3000, NOT /mock):
   - A4: "Show the steward penalties and incidents at the 2025 São Paulo Grand Prix" → per-driver lanes (+ corner pin if a message names a turn). Plus /mock m15 → lanes, no pin.
   - A3: "Which 2025 sessions have telemetry but no matching weather data?" → 24-tile venue coverage grid + legend + all-clear banner logic.
   - A5: "Compare Verstappen and Leclerc corner by corner at Abu Dhabi 2025 …" → corner_delta_grid (nodes + tiles + diverging ladder) + at_a_glance insight, NO YES/NO badge. Plus a residual grouped_bar to confirm y-baseline-at-0.
   - B19: "How many sessions of each type were there in 2025?" → DonutChart with total center label. Plus /mock incidentsMock → migrated event_timeline renders identically.
   - B17: "Who was fastest at Imola?" (or Miami sprint weekend) → ClarificationCard with "Most likely" badge and NO raw session_key; click a button → deterministic re-send answer card.
4. **Two-layer color + honesty preserved**: chrome uses theme tokens only; domain
   colors stay on `ChartSeries.color`/`team_color`; reasoning-trace/SQL/table/no-data
   UI and prose clarifications remain intact (each new applyX early-returns on its
   guard).

All 5 items are additive/localized frontend+template work; no runtime/orchestration
routing changes beyond the A5/B19 template registrations, which are gated by
topic-guard + narrow phrasing + net-new marker columns.
