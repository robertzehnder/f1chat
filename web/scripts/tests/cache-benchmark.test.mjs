import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const repoRoot = path.resolve(webRoot, "..");
const anthropicSourcePath = path.resolve(webRoot, "src/lib/anthropic.ts");

const ANTHROPIC_VERSION = "2023-06-01";

const MIN_CACHE_TOKENS_BY_MODEL = {
  "claude-sonnet-4-6": 1024,
  "claude-opus-4-7": 1024,
  "claude-haiku-4-5-20251001": 2048
};

// Deterministic, byte-identical padding committed to git. Sized to comfortably
// exceed the largest minimum in MIN_CACHE_TOKENS_BY_MODEL (2048 tokens) on its
// own. ~12 KB of fixed English prose; no UUIDs, timestamps, or run-varying tokens.
const PADDING_TEXT = `The OpenF1 analytics warehouse aggregates telemetry, timing, and timing-derived semantic contracts from Formula One race weekends across multiple seasons. Each session is uniquely identified by a session_key, and within a session each driver is identified by driver_number. Lap-level data lives in raw.laps and is enriched into core.laps_enriched, which adds clean-lap classification, sector durations, and stint membership. The semantic bridge core.lap_semantic_bridge maps raw lap rows to canonical event types such as race start, restart, virtual safety car deployment, and chequered flag arrival. Downstream summary contracts roll lap-level data into per-driver session summaries, stint summaries, strategy summaries, and grid-versus-finish tables that analysts query for race narratives and weekend reviews.

Lap timing semantics are deceptively subtle. A reported lap_duration value can include or exclude pit lane traversal, can be invalidated by track limits enforcement, and can be marked as influenced by yellow flags or virtual safety car periods. The clean-lap classifier in core.laps_enriched filters laps that are within a configurable percentage of the driver's session best, exclude pit-in or pit-out laps, exclude laps with race-control sector incidents, and exclude in-laps where the tire stint ended. Analysts consuming clean-lap data should always join against core.driver_session_summary to retrieve the canonical clean-lap count per driver per session before computing pace statistics, because raw lap counts include outliers that skew average and median pace.

Sector analysis decomposes a lap into three timed segments separated by inductive sector loops embedded in the circuit. Sector boundaries differ by circuit and across the season as Formula One sometimes resurfaces or alters sector loop placement during a venue's regulatory updates. Sector durations are reported per lap in raw.laps as duration_sector_1, duration_sector_2, and duration_sector_3, and core.laps_enriched joins these against the driver's stint to produce sector pace trends. A best-theoretical lap is the sum of a driver's three best individual sector times across a session and is often faster than any actual recorded lap, because no single lap typically combines the driver's best output in all three sectors simultaneously.

Stint and tire strategy semantics live in core.stint_summary and core.strategy_summary. A stint begins when a driver leaves the pit lane on a fresh set of tires and ends either at the next pit entry or at the chequered flag. Each stint records the starting lap, ending lap, tire compound, and the number of laps actually run on the compound, which is sometimes shorter than the planned stint length when a driver pits early due to a flat-spotted tire, a graining issue, or a strategic undercut by a competitor. Tire compound nomenclature follows the Pirelli C0 through C5 internal compounds mapped to soft, medium, and hard color brands per race weekend; the warehouse stores both the brand color and the underlying compound where Pirelli has disclosed the mapping.

Race control flags are recorded in raw.race_control with a per-event row keyed by session_key, lap number where applicable, message, category, and scope (track-wide, sector-specific, or driver-specific). Categories include flag (yellow, double yellow, blue, red, chequered), safety car deployment and withdrawal, virtual safety car deployment and withdrawal, drive-through and stop-go penalties, pit lane closure, and incident under investigation. The timestamp on each event is the FIA-official notification time, which precedes the on-track effect by a small fixed delay; analysts reconstructing safety car effects on lap time should treat the on-track effective time as approximately the lap immediately following the FIA notification when the notification occurs after lap completion.

Pit stop dynamics are captured in raw.pit, which records the pit stop number per driver per session, the lap number on which the stop occurred, the stationary duration measured by the FIA timing transponder, and the total pit lane traversal duration including the entry and exit limited-speed segments. The stationary duration is the part visible on television broadcasts and used in pit crew rankings, but the total pit lane traversal duration is what actually costs the driver track position relative to a non-stopping competitor and is therefore the right figure for strategy analysis. Some sessions, particularly wet races with shifting conditions, record several pit stops per driver, and the warehouse retains the full ordered sequence rather than collapsing to a summary count.

Driver lap consistency is a derived metric computed from clean-lap pace standard deviation across a stint. A driver who delivers low standard deviation is described as consistent, while a driver who oscillates between very fast and very slow laps is described as variable. Consistency interacts with tire degradation: a driver with low consistency on a freshly fitted tire may simply be exploring grip levels, but the same low consistency on a half-spent tire usually indicates either a setup imbalance or a confidence issue. The warehouse exposes consistency at session, stint, and lap-window granularities so that analysts can isolate whether a driver's variability is structural or transient.

Qualifying simulation is the practice of running a single timed lap in low fuel, fresh tires, and maximum engine modes during free practice sessions. Such laps are flagged in core.laps_enriched as qualifying_sim_lap when the inferred fuel load, tire age, and engine mode together exceed a confidence threshold derived from telemetry brake-temperature ramps, throttle traces, and DRS activation patterns. Qualifying simulations are the closest free practice analog to actual qualifying pace and are used by teams to estimate competitor potential before the qualifying session begins. The warehouse includes a qualifying_sim_pace summary that ranks drivers by their best qualifying-simulation lap.

Safety car effects propagate non-linearly through a race. A safety car deployed during the final third of a race typically compresses the field into a single train and erases tire-strategy differences that built up over the preceding stints. A safety car deployed during the first ten laps tends to favor drivers who started on the harder tire compound, because they can bank a long opening stint without the time penalty their competitors paid by stopping during normal racing. The warehouse decomposes finishing position into a base order and a safety-car adjustment so that analysts can separate the strategic outcome from the lottery component introduced by a late-race incident.

Tire degradation curves are fit per stint using a robust regression that downweights pit-in and pit-out laps. The fit produces an intercept (theoretical fresh-tire pace), a linear slope (per-lap degradation rate), and a curvature term (acceleration of degradation as the tire ages). Soft compounds typically show high intercept (fast initial pace) and high slope (rapid degradation), hards show moderate intercept and low slope, and mediums sit between the two with a balance that depends on the circuit, ambient temperature, and track surface. The warehouse stores the per-stint regression coefficients so that downstream consumers can evaluate strategy alternatives without rerunning the fits.

Fuel load and weight effects subtract approximately three hundredths of a second per lap per ten kilograms of fuel burned, with the exact factor depending on the circuit's mix of acceleration zones, braking zones, and steady-state high-speed sections. The warehouse approximates fuel-corrected pace by adding a per-lap correction term derived from the published race fuel allowance and the driver's running-lap count. Fuel-corrected pace is the right figure when comparing drivers who are at different lap counts, but raw pace is the right figure when comparing the actual on-track time gap between two competitors at a specific moment. Both metrics are exposed in core.laps_enriched.

Aerodynamic setup choices trade qualifying lap time for race-day stability. A low-downforce wing setup wins straight-line speed and is faster in qualifying when DRS is available across most of the lap, while a high-downforce setup is harder to overtake on the straights but is faster in race trim because it preserves tire life through the high-speed corners. The warehouse does not directly observe wing settings, but it infers a downforce index per session from telemetry traces of corner-entry, mid-corner, and corner-exit speeds normalized against the driver's reference benchmark for the circuit. The downforce index is exposed in core.driver_session_summary.

Telemetry sampling rate varies by signal. Speed, throttle, brake, gear, RPM, and DRS state are sampled at a hardware rate that the FIA standardizes across teams; positional latitude and longitude come from a separate satellite-augmented system at a lower rate. The warehouse standardizes sampling to a fixed cadence per signal during ingest and stores both the original timestamps and the resampled snapshots so that downstream consumers can choose between high-fidelity reproductions and low-overhead aggregates. Resampling uses linear interpolation between adjacent observations and is documented in the metric registry.

Position history is reconstructed from the FIA's official intervals stream and is stored in raw.position_history at lap granularity. Each row records the driver's position at the chequered flag of the corresponding lap, which is the canonical record for race position used in stewards' decisions and championship point allocation. The warehouse cross-checks position history against raw.intervals to detect inconsistencies caused by transponder mis-reads, lap-down complications, and provisional position adjustments due to incidents under investigation. When a discrepancy is detected, the warehouse retains both the raw and corrected positions and exposes the divergence as a data-quality flag.

Race progression summary aggregates per-lap field statistics: leader pace, mid-field pace, back-of-grid pace, gap to leader, gap to next car ahead, and gap to next car behind for each driver. These statistics enable narratives such as the leader pulling away in the opening stint, the field compressing under a virtual safety car, or a charging driver reeling in a slower car after an undercut. The summary is computed once at ingest time and cached so that interactive question-and-answer loops do not have to recompute aggregations from raw lap data on every request.

Championship context lives in raw.championship_drivers and raw.championship_teams, which record per-event championship standings before and after each session. The warehouse joins championship context to session results so that a winning drive can be characterized as either a points-leader extension, a points-leader recovery, or an underdog upset depending on the entrant's position in the standings entering the weekend. This context is essential for race narratives that go beyond the single-session result and is one of the main consumers of the historical session_key archive.

Driver substitution events arise when a primary entrant cannot participate in a session due to medical, contractual, or technical reasons. The warehouse maintains a session-by-session driver_dim that maps each session_key plus driver_number to the actual person who drove the car, which can differ from the season-level entrant. Analysts who join sessions to drivers without going through driver_dim risk attributing a substitute driver's performance to the primary entrant. The substitution flag is exposed prominently in core.driver_session_summary so that downstream consumers receive a clear signal whenever the entrant for a session deviates from the championship entry list.

The OpenF1 warehouse is designed for ad hoc analyst questions answered by composing semantic contracts rather than by querying raw timing data directly. The semantic contracts encode race-day knowledge such as clean-lap classification, qualifying simulation detection, safety-car adjustment, tire degradation modeling, fuel correction, downforce index inference, and driver substitution disambiguation. Analysts who consistently route questions through the semantic contracts get answers that are stable, defensible, and consistent with FIA-official records, while analysts who bypass the semantic layer routinely produce results that drift away from broadcast statistics and require manual reconciliation. The static prefix of the answer-synthesis prompt encodes this preference so that the language model defaults to the semantic layer when generating an answer.`;

async function transpileAndImportAnthropic() {
  const sourceText = await readFile(anthropicSourcePath, "utf8");
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  const dir = await mkdtemp(path.join(tmpdir(), "openf1-anthropic-"));
  const outFile = path.join(dir, "anthropic.mjs");
  await writeFile(outFile, transpiled.outputText, "utf8");
  const mod = await import(outFile);
  return { mod, dir };
}

async function postAnthropic(url, apiKey, body) {
  const response = await globalThis.fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status} from ${url}: ${text}`);
  }
  return response.json();
}

test("cache-hit benchmark records a warm cache_read on the Anthropic Messages API", async (t) => {
  if (process.env.OPENF1_RUN_CACHE_BENCHMARK !== "1") {
    t.skip("OPENF1_RUN_CACHE_BENCHMARK not set");
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY must be set when OPENF1_RUN_CACHE_BENCHMARK=1; refusing to silently skip."
    );
  }

  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
  const minCacheTokens = MIN_CACHE_TOKENS_BY_MODEL[model];
  if (minCacheTokens === undefined) {
    throw new Error(
      `add prompt-cache minimum for ${model} to MIN_CACHE_TOKENS_BY_MODEL`
    );
  }

  const importResult = await transpileAndImportAnthropic();
  try {
    const { buildSynthesisRequestParams } = importResult.mod;
    assert.equal(
      typeof buildSynthesisRequestParams,
      "function",
      "buildSynthesisRequestParams must be exported from web/src/lib/anthropic.ts"
    );

    const input = {
      question: "Who won the 2024 Monaco Grand Prix?",
      sql: "SELECT driver_number FROM core.sessions WHERE session_key = 1",
      rows: [{ driver_number: 16 }],
      rowCount: 1,
      runtime: { questionType: "race-winner", grain: "session" }
    };
    const productionParams = buildSynthesisRequestParams(input);
    const productionSystem = productionParams.system;
    const messages = productionParams.messages;

    assert.ok(
      Array.isArray(productionSystem) && productionSystem.length === 1,
      "buildSynthesisRequestParams must return a single-element system array"
    );

    // Send-order: synthetic padding block first (index 0), production prefix
    // block second (index 1). The cached_blocks array in the artifact mirrors
    // this same order so a downstream reader can reconstruct which block is
    // which.
    const paddedSystem = [
      { type: "text", text: PADDING_TEXT, cache_control: { type: "ephemeral" } },
      productionSystem[0]
    ];

    // Preflight count_tokens with real messages, per slice step 3a.
    const totalCountResp = await postAnthropic(
      "https://api.anthropic.com/v1/messages/count_tokens",
      apiKey,
      { model, system: paddedSystem, messages }
    );
    if (typeof totalCountResp.input_tokens !== "number") {
      throw new Error(
        `count_tokens(total) response missing input_tokens: ${JSON.stringify(totalCountResp)}`
      );
    }

    // Approximate the cached portion by replacing messages with a near-empty
    // user message ("." — a single token) so the count is dominated by the
    // system blocks. The Anthropic API rejects truly empty user content with
    // HTTP 400, so a single-character placeholder is the smallest legal stand-in.
    const cachedOnlyResp = await postAnthropic(
      "https://api.anthropic.com/v1/messages/count_tokens",
      apiKey,
      { model, system: paddedSystem, messages: [{ role: "user", content: "." }] }
    );
    const cachedSystemTokens = cachedOnlyResp.input_tokens;
    if (typeof cachedSystemTokens !== "number") {
      throw new Error(
        `count_tokens(cached-only) response missing input_tokens: ${JSON.stringify(cachedOnlyResp)}`
      );
    }
    if (cachedSystemTokens < minCacheTokens) {
      throw new Error(
        `cached system content is ${cachedSystemTokens} tokens, below model minimum ${minCacheTokens} for ${model}; increase PADDING_TEXT or update MIN_CACHE_TOKENS_BY_MODEL`
      );
    }

    const callMessages = async () =>
      postAnthropic("https://api.anthropic.com/v1/messages", apiKey, {
        model,
        max_tokens: 1024,
        temperature: 0,
        system: paddedSystem,
        messages
      });

    const cold = await callMessages();
    const warm = await callMessages();

    if (!cold?.usage || typeof cold.usage.input_tokens !== "number") {
      throw new Error(`cold response missing usage: ${JSON.stringify(cold)}`);
    }
    if (!warm?.usage || typeof warm.usage.input_tokens !== "number") {
      throw new Error(`warm response missing usage: ${JSON.stringify(warm)}`);
    }

    const coldRead = cold.usage.cache_read_input_tokens ?? 0;
    const warmRead = warm.usage.cache_read_input_tokens ?? 0;

    assert.equal(
      coldRead,
      0,
      `cold call cache_read_input_tokens must be 0 (got ${coldRead}); a non-zero cold read indicates a stale cache entry from a prior run within the 5-minute TTL window — re-run after the TTL expires`
    );
    assert.ok(
      warmRead > 0,
      `warm call cache_read_input_tokens must be > 0 (got ${warmRead}); cold input_tokens=${cold.usage.input_tokens}, warm input_tokens=${warm.usage.input_tokens}, cachedSystemTokens=${cachedSystemTokens}, model=${model}`
    );

    const productionPrefixText = productionSystem[0].text;
    const staticPrefixBytes = Buffer.byteLength(productionPrefixText, "utf8");
    const paddingBytes = Buffer.byteLength(PADDING_TEXT, "utf8");

    const artifact = {
      slice_id: "02-cache-hit-assertion",
      captured_at: new Date().toISOString(),
      model: cold.model ?? model,
      anthropic_version: ANTHROPIC_VERSION,
      model_minimum_cache_tokens: minCacheTokens,
      static_prefix_bytes: staticPrefixBytes,
      padding_bytes: paddingBytes,
      cached_blocks: [
        { role: "padding", bytes: paddingBytes },
        { role: "production_prefix", bytes: staticPrefixBytes }
      ],
      cached_system_tokens: cachedSystemTokens,
      cold: {
        response_id: cold.id,
        usage: {
          input_tokens: cold.usage.input_tokens,
          output_tokens: cold.usage.output_tokens,
          cache_creation_input_tokens: cold.usage.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: cold.usage.cache_read_input_tokens ?? 0
        }
      },
      warm: {
        response_id: warm.id,
        usage: {
          input_tokens: warm.usage.input_tokens,
          output_tokens: warm.usage.output_tokens,
          cache_creation_input_tokens: warm.usage.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: warm.usage.cache_read_input_tokens ?? 0
        }
      },
      delta: {
        input_tokens_saved: cold.usage.input_tokens - warm.usage.input_tokens,
        cache_read_input_tokens_warm: warm.usage.cache_read_input_tokens ?? 0
      }
    };

    const dateStr = new Date().toISOString().slice(0, 10);
    const defaultArtifactPath = path.resolve(
      repoRoot,
      "diagnostic/artifacts/perf",
      `02-cache-hit_${dateStr}.json`
    );
    const artifactPath = process.env.OPENF1_CACHE_BENCHMARK_OUT ?? defaultArtifactPath;
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  } finally {
    if (importResult?.dir) {
      await rm(importResult.dir, { recursive: true, force: true });
    }
  }
});
