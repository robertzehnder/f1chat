// Randomized chart-card sweep: take every chart-family test prompt we used
// while developing the deterministic cards, randomize the venue / driver /
// teammate slots from pools confirmed populated on Neon (2025 only), fire
// them through the live /api/chat pipeline, run the client chart-detector
// registry over the returned rows, and grade against scripts/health/RUBRIC.md.
//
// Randomization defeats the answer/synthesis caches (fresh prompt text every
// run) and proves the cards generalize beyond the venues they were built on.
//
// Grading has two layers (see RUBRIC.md):
//   mechanical — D1 resolution, D2 data sufficiency, D3 chart shape,
//                D4 insight completeness, D5 honesty (contradiction half)
//   judge      — D5 caveats, D6 factual consistency, D7 communication,
//                via the Anthropic API (--judge; key read from .env.local)
// Final letter = worse of the two.
//
// Usage (dev server must be running on http://localhost:3000):
//   node scripts/health/randomized_sweep.mjs
//   node scripts/health/randomized_sweep.mjs --seed 42          # reproduce a run
//   node scripts/health/randomized_sweep.mjs --rounds 3         # 3 picks per family
//   node scripts/health/randomized_sweep.mjs --only race_trace,telemetry_overlay
//   node scripts/health/randomized_sweep.mjs --judge            # add LLM grading
//   node scripts/health/randomized_sweep.mjs --judge --judge-model claude-sonnet-4-6
//
// Output: /tmp/randomized-sweep.json + a compact table on stdout.

import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");
const API = process.env.SWEEP_API ?? "http://localhost:3000/api/chat";

// ---------------------------------------------------------------------------
// Pools — verified against Neon 2026-06-10.
// ---------------------------------------------------------------------------

// All 24 race venues of 2025, phrased the way the resolver matches them
// (core.sessions location/country names + VENUE_DEMONYM_ALIASES), plus the
// row-level tokens that prove the resolved session is the right one (D1).
const VENUES = [
  { name: "Bahrain", tokens: ["sakhir", "bahrain"] },
  { name: "Jeddah", tokens: ["jeddah", "saudi"] },
  { name: "Melbourne", tokens: ["melbourne", "australia"] },
  { name: "Suzuka", tokens: ["suzuka", "japan"] },
  { name: "Shanghai", tokens: ["shanghai", "china"] },
  // Country names are included as fallbacks: some templates emit only
  // country_name (no location), e.g. pit_stop rows. Shared-country venues
  // (Italy ×2, US ×3) lose some discrimination there — acceptable; rows
  // with a location column still get the strict check.
  { name: "Miami", tokens: ["miami", "united states"] },
  { name: "Imola", tokens: ["imola", "italy"] },
  { name: "Monaco", tokens: ["monaco"] },
  { name: "Montreal", tokens: ["montréal", "montreal", "canada"] },
  { name: "Barcelona", tokens: ["barcelona", "spain"] },
  { name: "Spielberg", tokens: ["spielberg", "austria"] },
  { name: "Silverstone", tokens: ["silverstone", "united kingdom", "great britain"] },
  { name: "Budapest", tokens: ["budapest", "hungary"] },
  { name: "Spa", tokens: ["spa", "belgium"] },
  { name: "Zandvoort", tokens: ["zandvoort", "netherlands"] },
  { name: "Monza", tokens: ["monza", "italy"] },
  { name: "Baku", tokens: ["baku", "azerbaijan"] },
  { name: "Singapore", tokens: ["singapore", "marina bay"] },
  { name: "Austin", tokens: ["austin", "united states"] },
  { name: "Mexico City", tokens: ["mexico"] },
  { name: "São Paulo", tokens: ["são paulo", "sao paulo", "brazil"] },
  { name: "Las Vegas", tokens: ["las vegas", "united states"] },
  { name: "Qatar", tokens: ["lusail", "qatar"] },
  { name: "Abu Dhabi", tokens: ["yas island", "abu dhabi", "united arab emirates"] }
];
const venueByName = new Map(VENUES.map((v) => [v.name, v]));
const ALL_VENUES = VENUES.map((v) => v.name);

// Venues with analytics.corner_analysis rows for 2025 (brake-zone cards).
const CORNER_VENUES = [
  "Bahrain", "Jeddah", "Imola", "Monaco", "Silverstone",
  "Budapest", "Spa", "Monza", "Suzuka", "Abu Dhabi"
];

// 2025 races with a real wet phase (8+ drivers on inters per stint_summary).
const WET_VENUES = ["Melbourne", "Silverstone", "Spa"];

// Qualifying-based families: Baku 2025 qualifying has zero rows in raw.laps
// AND core.laps_enriched (upstream OpenF1 ingestion gap, verified 2026-06-10)
// — the app's honest refusal there is correct, so don't sample it.
const QUALI_VENUES = ALL_VENUES.filter((v) => v !== "Baku");

// Low-DNF front-runners for templates that need both drivers to finish
// (over-cut verdicts, season radar).
const FRONT_RUNNERS = ["Verstappen", "Norris", "Piastri", "Leclerc", "Hamilton", "Russell"];

// Wider pool for pair/single templates (all full-season 2025 racers).
const ALL_DRIVERS = [
  ...FRONT_RUNNERS,
  "Alonso", "Sainz", "Albon", "Gasly", "Ocon",
  "Hulkenberg", "Stroll", "Tsunoda", "Antonelli", "Bearman"
];

// Teams with a stable 2025 lineup (skip Red Bull/RB/Alpine mid-season swaps).
const TEAMMATES = [
  { team: "McLaren", drivers: ["Norris", "Piastri"] },
  { team: "Ferrari", drivers: ["Leclerc", "Hamilton"] },
  { team: "Mercedes", drivers: ["Russell", "Antonelli"] },
  { team: "Aston Martin", drivers: ["Alonso", "Stroll"] },
  { team: "Williams", drivers: ["Albon", "Sainz"] },
  { team: "Haas", drivers: ["Ocon", "Bearman"] },
  { team: "Sauber", drivers: ["Hulkenberg", "Bortoleto"] }
];

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32) — same seed reproduces the exact prompt set.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const pickPair = (rng, arr) => {
  const a = pick(rng, arr);
  const b = pick(rng, arr.filter((d) => d !== a));
  return [a, b];
};
const shuffled = (rng, arr) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

// ---------------------------------------------------------------------------
// Families — one per chart card, prompt phrasings lifted verbatim from the
// prompts used while developing each card (only venue/driver slots vary).
// Trigger words must stay intact: the deterministic gates are keyword regexes.
// `minRows` per RUBRIC.md D2. `build` returns { prompt, drivers } so D1 can
// assert every named driver actually appears in the returned rows.
// ---------------------------------------------------------------------------

const FAMILIES = [
  {
    id: "race_trace",
    expect: "race_trace",
    minRows: 100,
    venues: ALL_VENUES,
    build: (rng, venue) => ({ prompt: `Show the race trace for ${venue} 2025`, drivers: [] })
  },
  {
    id: "over_cut",
    expect: "race_trace",
    minRows: 100,
    venues: ALL_VENUES,
    build: (rng, venue) => {
      const [a, b] = pickPair(rng, FRONT_RUNNERS);
      return {
        prompt: `Did ${a} successfully execute the over-cut on ${b} at ${venue} 2025?`,
        drivers: [a, b]
      };
    }
  },
  {
    id: "deg_curve",
    expect: "degradation_curve",
    minRows: 6,
    venues: ALL_VENUES,
    build: (rng, venue) => ({
      prompt: `How big is the tyre cliff at ${venue} 2025 — show the deg curves`,
      drivers: []
    })
  },
  {
    id: "position_changes",
    expect: "position_changes",
    minRows: 15,
    venues: ALL_VENUES,
    build: (rng, venue) => ({
      prompt: `Show the position changes at ${venue} 2025`,
      drivers: []
    })
  },
  {
    id: "telemetry_overlay",
    expect: "telemetry_overlay",
    minRows: 2,
    venues: ALL_VENUES,
    build: (rng, venue) => {
      const [a, b] = pickPair(rng, ALL_DRIVERS);
      return {
        prompt: `Show the lap telemetry comparison for ${a} and ${b} at the ${venue} 2025 race`,
        drivers: [a, b]
      };
    }
  },
  {
    id: "strategy_split",
    expect: "stint_gantt",
    minRows: 3,
    venues: ALL_VENUES,
    build: (rng, venue) => {
      const { team, drivers } = pick(rng, TEAMMATES);
      return {
        prompt: `Did ${team} split strategies between ${drivers[0]} and ${drivers[1]} at ${venue} 2025?`,
        drivers: [...drivers]
      };
    }
  },
  {
    id: "stint_delta",
    expect: "stint_delta_line",
    minRows: 2,
    venues: ALL_VENUES,
    build: (rng, venue) => {
      const [a, b] = pickPair(rng, FRONT_RUNNERS);
      return {
        prompt: `Across stints 1, 2 and 3 at ${venue} 2025, did ${a}'s stint deltas to ${b} reverse on the final stint?`,
        drivers: [a, b]
      };
    }
  },
  {
    id: "brake_zones",
    expect: "brake_zone_delta",
    minRows: 3,
    venues: CORNER_VENUES,
    build: (rng, venue) => {
      const [a, b] = pickPair(rng, FRONT_RUNNERS);
      return {
        prompt: `Across the three heaviest brake zones at ${venue} 2025, did ${a}'s lap-1 brake-zone delta to ${b} foreshadow a lap-pace deficit?`,
        drivers: [a, b]
      };
    }
  },
  {
    id: "sector_dominance",
    expect: "track_heatmap",
    minRows: 3,
    venues: QUALI_VENUES,
    build: (rng, venue) => {
      const [a, b] = pickPair(rng, FRONT_RUNNERS);
      return {
        prompt: `Show the sector dominance between ${a} and ${b} in qualifying at ${venue} 2025`,
        drivers: [a, b]
      };
    }
  },
  {
    id: "speed_map",
    expect: "track_speed_map",
    // The card row only carries map_channel/map_session_key; the dense
    // per-point data is fetched client-side from /api/track-outline.
    minRows: 1,
    venues: ALL_VENUES,
    build: (rng, venue) => {
      const a = pick(rng, ALL_DRIVERS);
      return {
        prompt: `Show ${a}'s speed map for the ${venue} 2025 race — where was he fastest?`,
        drivers: [a]
      };
    }
  },
  {
    id: "lap1_launch",
    expect: "horizontal_bar_diverging",
    minRows: 2,
    venues: ALL_VENUES,
    build: (rng, venue) => {
      const [a, b] = pickPair(rng, ALL_DRIVERS);
      return {
        prompt: `On the lap-1 launch at ${venue} 2025, did ${a} or ${b} gain more positions?`,
        drivers: [a, b]
      };
    }
  },
  {
    id: "wet_crossover",
    expect: "line_dual_axis",
    minRows: 10,
    venues: WET_VENUES,
    build: (rng, venue) => {
      const { drivers } = pick(rng, TEAMMATES);
      return {
        prompt: `On which lap did ${drivers[0]} and ${drivers[1]} make the inters-to-slicks crossover at ${venue} 2025?`,
        drivers: [...drivers]
      };
    }
  },
  {
    id: "radar",
    expect: "radar",
    // One row per driver; the 7 axes live in columns, not rows.
    minRows: 2,
    venues: null, // season-level
    build: (rng) => {
      const [a, b] = pickPair(rng, FRONT_RUNNERS);
      return {
        prompt: `Where does ${a}'s edge over ${b} come from in 2025 — qualifying axis or race-pace axis?`,
        drivers: [a, b]
      };
    }
  },
  {
    id: "pit_stop",
    expect: "pit_event_strip",
    minRows: 1,
    venues: ALL_VENUES,
    build: (rng, venue) => {
      const a = pick(rng, ALL_DRIVERS);
      return {
        prompt: `What was ${a}'s first-stop lap number in the ${venue} 2025 race?`,
        drivers: [a]
      };
    }
  }
];

// ---------------------------------------------------------------------------
// Detector registry loader — same approach as baseline_sweep.mjs.
// ---------------------------------------------------------------------------

async function loadRegistry() {
  const dir = await mkdtemp(path.join(webRoot, "scripts", ".tmp-rsweep-"));
  for (const [rel, out] of [
    ["src/lib/f1-team-colors.ts", "colors.mjs"],
    ["src/lib/mapInsight/detectors/types.ts", "types.mjs"],
    ["src/lib/mapInsight/detectors/registry.ts", "registry.mjs"]
  ]) {
    let js = ts.transpileModule(await readFile(path.resolve(webRoot, rel), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    js = js
      .replace(/@\/lib\/f1-team-colors/g, "./colors.mjs")
      .replace(/@\/lib\/chart-types/g, "./types.mjs")
      .replace(/\.\/types"/g, './types.mjs"');
    await writeFile(path.join(dir, out), js, "utf8");
  }
  const mod = await import(path.join(dir, "registry.mjs"));
  return { runDetectorRegistry: mod.runDetectorRegistry, dir };
}

// ---------------------------------------------------------------------------
// Mechanical grading (RUBRIC.md D1–D5). Problems carry a severity:
// "fail" or "warn". A = clean, B = warns only, C = one fail, F = 2+ fails.
// ---------------------------------------------------------------------------

const fail = (msg) => ({ severity: "fail", msg });
const warn = (msg) => ({ severity: "warn", msg });

// Spec types whose dense data is fetched client-side (track outline /
// lap telemetry routes) — their specs legitimately carry no arrays.
const CLIENT_FETCH_TYPES = new Set(["track_speed_map", "telemetry_overlay"]);

function specLooksDrawable(spec) {
  if (!spec || typeof spec !== "object") return false;
  if (CLIENT_FETCH_TYPES.has(spec.type)) return true;
  // Every other chart spec carries at least one non-empty array of
  // drawable things (series, segments, bars, events, axes...).
  return Object.values(spec).some(
    (v) => Array.isArray(v) && v.length > 0
  );
}

function gradeMechanical(item, r, det) {
  const problems = [];
  const answer = r.answer ?? "";
  if (r.error) return [fail(`request error: ${r.error}`)];

  // D2 — data sufficiency.
  const rowCount = r.result?.rowCount ?? 0;
  if (!answer || /^No rows matched/i.test(answer)) problems.push(fail("empty/no-rows answer"));
  if (/INSUFFICIENT_DATA/.test(answer)) problems.push(fail("refused (insufficient data)"));
  if (rowCount === 0) problems.push(fail("0 rows"));
  else if (rowCount < item.minRows) {
    problems.push(warn(`thin data: ${rowCount} rows < ${item.minRows} min`));
  }

  // D1 — resolution: year, venue tokens, named drivers present in rows.
  const rows = r.result?.rows ?? [];
  if (rows.length > 0) {
    const first = rows[0];
    if (first.year !== undefined && Number(first.year) !== 2025) {
      problems.push(fail(`resolved wrong year: ${first.year}`));
    }
    const venue = item.venue ? venueByName.get(item.venue) : null;
    if (venue) {
      const venueText = `${first.location ?? ""} ${first.country_name ?? ""}`.toLowerCase();
      if (venueText.trim()) {
        if (!venue.tokens.some((t) => venueText.includes(t))) {
          problems.push(fail(`resolved wrong venue: rows say "${venueText.trim()}", asked ${item.venue}`));
        }
      } else {
        problems.push(warn("venue unverifiable from rows (no location/country columns)"));
      }
    }
    const haystack = JSON.stringify(rows).toLowerCase();
    for (const d of item.drivers ?? []) {
      if (!haystack.includes(d.toLowerCase())) {
        problems.push(fail(`driver ${d} missing from rows`));
      }
    }
  }

  // D3 — chart shape.
  if (item.expect) {
    const accepted = Array.isArray(item.expect) ? item.expect : [item.expect];
    const got = det?.spec ? det.detectorId : undefined;
    if (!accepted.includes(got)) {
      problems.push(fail(`chart: got ${got ?? "none"}, want ${accepted.join("|")}`));
    } else if (!specLooksDrawable(det.spec)) {
      problems.push(fail(`chart spec for ${got} has no drawable series/segments`));
    }
  }

  // D4 — insight completeness.
  if (/^(Did|Was|Were|Is|Are|Do|Does)\b/.test(item.prompt) && !r.insight?.verdict) {
    problems.push(fail("yes/no question without verdict"));
  }
  const metricsCount = r.insight?.metrics?.length ?? 0;
  const takeawaysCount = r.insight?.key_takeaways?.length ?? 0;
  if (rowCount > 0 && metricsCount === 0 && takeawaysCount === 0) {
    problems.push(warn("no metrics or takeaways on the card"));
  }

  // D5 (mechanical half) — verdict over a hedged answer (M10 incident class).
  if (r.insight?.verdict && /cannot (be )?(confirm|determin)|insufficient|only covers/i.test(answer)) {
    problems.push(fail("verdict over hedged answer"));
  }

  return problems;
}

// Latency is recorded and reported but NEVER affects the letter
// (RUBRIC.md) — cold dev-server compiles and cold Neon pools dominate
// first-hit timings and say nothing about response quality.
function latencyNote(item, r) {
  const slowLimit = r.generationSource === "deterministic_template" ? 20000 : 90000;
  return item.elapsedMs > slowLimit
    ? `slow: ${(item.elapsedMs / 1000).toFixed(1)}s (${r.generationSource ?? "unknown path"})`
    : null;
}

function letterFromProblems(problems) {
  const fails = problems.filter((p) => p.severity === "fail").length;
  if (fails >= 2) return "F";
  if (fails === 1) return "C";
  return problems.length > 0 ? "B" : "A";
}

const LETTER_ORDER = { A: 0, B: 1, C: 2, F: 3 };
const worseLetter = (a, b) => (LETTER_ORDER[a] >= LETTER_ORDER[b] ? a : b);

// ---------------------------------------------------------------------------
// LLM judge (RUBRIC.md D5 caveats, D6 factual consistency, D7 communication).
// ---------------------------------------------------------------------------

async function loadApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const env = await readFile(path.join(webRoot, ".env.local"), "utf8");
    const m = env.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

const JUDGE_SYSTEM = `You grade one response from an F1 data-analysis chat app against a rubric.
You are given the user's question, the app's answer text, its insight card
(verdict/metrics/takeaways), a summary of the chart it will render, and a
sample of the SQL result rows the answer was synthesized from.

Score three dimensions, each 0-2 (2 = fully sound, 1 = minor issue, 0 = wrong or misleading):
- "factual": Do the specific numbers, names and claims in the answer text and
  verdict follow from the sample rows? Internal consistency only — do not
  judge against your own knowledge of real-world F1 results, the rows are
  the ground truth here. The sample is an evenly-strided SUBSET of the full
  result: do not penalize a claim merely because its exact row fell between
  samples — penalize only claims the sampled rows CONTRADICT.
- "honesty": Are caveats present where the data demands them (sparse data,
  best-lap comparisons not being simultaneous, change-feed semantics,
  inferred values)? Is any verdict appropriately confident vs hedged?
- "communication": Does the answer actually answer the question asked, clearly
  and completely? Does the chart choice fit the question (right drivers
  focused, right framing), beyond merely being the expected type?

Notes on the chart context:
- track_speed_map, telemetry_overlay and track_heatmap charts fetch dense
  per-point data client-side and visually answer spatial "where on track"
  aspects of the question — do not penalize the prose for not enumerating
  locations those charts display.
- Lap durations in rows are SECONDS; answers display them as M:SS.mmm.
  A correct conversion (95.069 → 1:35.069) is not an error — don't spend
  a deduction (or your notes) re-deriving it.

Score coherently: if, after working through the numbers, your conclusion is
that everything checks out, the dimension score must be 2 — do not deduct a
point for arithmetic you yourself verified as correct, or for claims that
are merely BETWEEN your sample rows. Deduct only for issues you can state.
Before submitting, re-read your own notes: if they end in "checks out",
"consistent", or "no contradictions found", every dimension you verified
that way must score 2 — a deduction without a stated issue is a misgrade.

Submit your scores via the grade tool.`;

const GRADE_TOOL = {
  name: "grade",
  description: "Submit the rubric scores for this response.",
  input_schema: {
    type: "object",
    properties: {
      factual: { type: "integer", minimum: 0, maximum: 2 },
      honesty: { type: "integer", minimum: 0, maximum: 2 },
      communication: { type: "integer", minimum: 0, maximum: 2 },
      notes: {
        type: "string",
        description: "One short sentence on the biggest issue, or 'clean'."
      }
    },
    required: ["factual", "honesty", "communication", "notes"]
  }
};

function summarizeSpec(spec) {
  if (!spec) return "none";
  const parts = [`type=${spec.type}`];
  for (const [k, v] of Object.entries(spec)) {
    if (Array.isArray(v)) {
      const inner = v[0]?.values?.length ?? v[0]?.points?.length;
      parts.push(`${k}[${v.length}]${inner ? `×${inner}` : ""}`);
    }
  }
  return parts.join(" ");
}

// Evidence rows for the judge: an even stride across the whole rowset.
// The first N rows of a race trace are all lap 1 — claims about the
// finish, mid-race stops, or specific drivers would be "unverifiable".
function strideSample(rows, n) {
  if (rows.length <= n) return rows;
  const step = (rows.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => rows[Math.round(i * step)]);
}

// Stride + final-lap rows: answers routinely cite the finish ("won by
// 10.2s over X"), and the stride usually misses the last lap of every
// driver but one — judges then mark correct finish claims unverifiable.
function judgeSample(rows, n) {
  if (rows.length <= n) return rows;
  const lastLap = rows.reduce((m, r) => Math.max(m, Number(r.lap_number ?? 0)), 0);
  const finals = lastLap > 0 ? rows.filter((r) => Number(r.lap_number ?? -1) === lastLap).slice(0, 4) : [];
  const stride = strideSample(rows, Math.max(n - finals.length, 4));
  const seen = new Set(stride);
  return [...stride, ...finals.filter((r) => !seen.has(r))];
}

async function judgeItem(apiKey, model, item, r, det) {
  const rows = r.result?.rows ?? [];
  const userContent = [
    `QUESTION: ${item.prompt}`,
    `EXPECTED VENUE/SCOPE: ${item.venue ?? "season 2025"}; named drivers: ${(item.drivers ?? []).join(", ") || "none"}`,
    `GENERATION PATH: ${r.generationSource ?? "unknown"}`,
    `ANSWER TEXT: ${(r.answer ?? "").slice(0, 1500)}`,
    `INSIGHT CARD: ${JSON.stringify({
      title: r.insight?.title,
      verdict: r.insight?.verdict,
      metrics: r.insight?.metrics,
      key_takeaways: r.insight?.key_takeaways
    }).slice(0, 2000)}`,
    `CHART: ${summarizeSpec(det?.spec)} (detector: ${det?.detectorId ?? "none"})`,
    // Small rowsets (deg curves ~50-150 rows) get denser sampling — a
    // 16-row stride misses the specific points claims rest on (dip ages,
    // endpoint deltas) and true claims then read as contradicted.
    `ROW COUNT: ${r.result?.rowCount ?? 0}; SAMPLE ROWS (evenly strided across the set plus final-lap rows — answers may cite rows between samples): ${JSON.stringify(judgeSample(rows, rows.length <= 160 ? 32 : 16)).slice(0, 9000)}`
  ].join("\n\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      temperature: 0,
      system: JUDGE_SYSTEM,
      // Forced tool use guarantees schema-valid JSON — free-text JSON asks
      // got prose preambles that overran max_tokens (seed-7 brake_zones
      // incident), and this model rejects assistant prefill.
      tools: [GRADE_TOOL],
      tool_choice: { type: "tool", name: "grade" },
      messages: [{ role: "user", content: userContent }]
    }),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) throw new Error(`judge API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const toolUse = body.content?.find((c) => c.type === "tool_use");
  if (!toolUse?.input) throw new Error(`judge returned no tool call: ${JSON.stringify(body.content).slice(0, 120)}`);
  const scores = toolUse.input;
  const dims = [scores.factual, scores.honesty, scores.communication].map(Number);
  const total = dims.reduce((a, b) => a + b, 0);
  const hasZero = dims.some((d) => d === 0);
  const letter =
    total === 6 && !hasZero ? "A" : total >= 4 && !hasZero ? "B" : total >= 2 ? "C" : "F";
  return { ...scores, total, letter };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seed = argValue("--seed") !== undefined
  ? Number(argValue("--seed"))
  : Math.floor(Math.random() * 2 ** 31);
const rounds = Number(argValue("--rounds") ?? 1);
const only = argValue("--only") ? new Set(argValue("--only").split(",")) : null;
const useJudge = process.argv.includes("--judge");
const judgeModel = argValue("--judge-model") ?? process.env.SWEEP_JUDGE_MODEL ?? "claude-sonnet-4-6";

const rng = mulberry32(seed);
console.log(`Seed: ${seed}  (pass --seed ${seed} to reproduce this exact prompt set)`);
console.log(
  `Rounds: ${rounds}  Families: ${only ? [...only].join(",") : "all " + FAMILIES.length}` +
    (useJudge ? `  Judge: ${judgeModel}` : "  Judge: off (--judge to enable)") +
    "\n"
);

let apiKey = null;
if (useJudge) {
  apiKey = await loadApiKey();
  if (!apiKey) {
    console.error("--judge requested but no ANTHROPIC_API_KEY in env or web/.env.local");
    process.exit(1);
  }
}

// Pre-shuffle each family's venue pool once so multi-round runs walk through
// distinct venues instead of re-rolling (no repeats until the pool exhausts).
const venueWalk = new Map(
  FAMILIES.map((f) => [f.id, f.venues ? shuffled(rng, f.venues) : null])
);

const plan = [];
for (let round = 0; round < rounds; round += 1) {
  for (const family of FAMILIES) {
    if (only && !only.has(family.id)) continue;
    const walk = venueWalk.get(family.id);
    const venue = walk ? walk[round % walk.length] : null;
    const { prompt, drivers } = family.build(rng, venue);
    plan.push({
      id: `${family.id}#${round + 1}`,
      family: family.id,
      expect: family.expect,
      minRows: family.minRows,
      venue,
      drivers,
      prompt
    });
  }
}

// --plan-only: print the generated prompt plan as JSON and exit without
// firing any requests (used by orchestration harnesses to enumerate the
// golden set reproducibly).
if (process.argv.includes("--plan-only")) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

const { runDetectorRegistry, dir } = await loadRegistry();
const results = [];
try {
  for (const item of plan) {
    const started = Date.now();
    let r;
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: item.prompt }),
        signal: AbortSignal.timeout(150000)
      });
      r = await res.json();
    } catch (err) {
      r = { error: String(err) };
    }
    item.elapsedMs = Date.now() - started;
    const rows = r.result?.rows;
    const det = rows?.length ? runDetectorRegistry(rows, { question: item.prompt }) : undefined;
    const problems = gradeMechanical(item, r, det);
    const mechGrade = letterFromProblems(problems);
    const slowNote = latencyNote(item, r);

    let judge = null;
    if (useJudge && !r.error) {
      try {
        judge = await judgeItem(apiKey, judgeModel, item, r, det);
      } catch (err) {
        judge = { error: String(err).slice(0, 200) };
      }
    }
    const grade = judge?.letter ? worseLetter(mechGrade, judge.letter) : mechGrade;

    results.push({
      id: item.id,
      family: item.family,
      venue: item.venue,
      drivers: item.drivers,
      prompt: item.prompt,
      expect: item.expect,
      elapsedMs: item.elapsedMs,
      source: r.generationSource ?? null,
      notes: r.generationNotes ?? null,
      rowCount: r.result?.rowCount ?? null,
      columns: rows?.length ? Object.keys(rows[0]) : [],
      detector: det?.detectorId ?? null,
      chartSummary: summarizeSpec(det?.spec),
      verdict: r.insight?.verdict ?? null,
      title: r.insight?.title ?? null,
      metrics: r.insight?.metrics ?? [],
      takeaways: r.insight?.key_takeaways ?? [],
      answer: r.answer ?? null,
      sampleRows: strideSample(rows ?? [], 8),
      error: r.error ?? null,
      problems: problems.map((p) => `${p.severity}: ${p.msg}`),
      latency: slowNote,
      mechGrade,
      judge,
      grade
    });
    const last = results[results.length - 1];
    const judgeNote = judge
      ? judge.error
        ? " judge=ERR"
        : ` judge=${judge.letter}(${judge.total}/6)`
      : "";
    console.log(
      `${item.id.padEnd(20)} [${last.grade}] mech=${mechGrade}${judgeNote} ${String(item.venue ?? "season").padEnd(12)} ` +
        `src=${last.source} rows=${last.rowCount} chart=${last.detector ?? "-"} ` +
        `${last.verdict ? "verdict=" + last.verdict.label + " " : ""}` +
        `${problems.length ? "⚠ " + problems.map((p) => p.msg).join(" | ") : "✓"}` +
        `${slowNote ? " ⏱ " + slowNote : ""}` +
        `${judge?.notes && judge.notes !== "clean" ? " 🧑‍⚖️ " + judge.notes : ""}`
    );
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

const grades = { A: 0, B: 0, C: 0, F: 0 };
for (const r of results) grades[r.grade] += 1;
console.log(`\nA: ${grades.A}  B: ${grades.B}  C: ${grades.C}  F: ${grades.F}  (seed ${seed})`);
await writeFile(
  "/tmp/randomized-sweep.json",
  JSON.stringify({ seed, rounds, judgeModel: useJudge ? judgeModel : null, results }, null, 2),
  "utf8"
);
console.log(`Wrote /tmp/randomized-sweep.json (${results.length} items)`);
