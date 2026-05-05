import { sql } from "@/lib/db";

// Phase 17-F: schema introspection. The system prompt at anthropic.ts:51-72
// historically hand-documented columns for only 4 tables; the LLM hallucinated
// columns for everything else (the 2026-05-02 incident hit
// `core.stint_summary.compound` / `stint_start_lap`, neither of which exist).
// This module pulls the column list straight from `information_schema` at
// process boot and caches the formatted prompt fragment for the process
// lifetime.

/**
 * The contracts the LLM is asked to query, copied from the table list in
 * `buildSystemPrompt()`. Anything in this list gets full column docs in the
 * generated prompt fragment; raw.* tables stay hand-documented because the
 * curated reminder list is shorter and hot-path queries should prefer
 * core.*.
 */
const CORE_CONTRACTS: ReadonlyArray<{ schema: string; table: string }> = [
  { schema: "core", table: "sessions" },
  { schema: "core", table: "session_drivers" },
  { schema: "core", table: "meetings" },
  { schema: "core", table: "driver_dim" },
  { schema: "core", table: "lap_semantic_bridge" },
  { schema: "core", table: "laps_enriched" },
  { schema: "core", table: "driver_session_summary" },
  { schema: "core", table: "stint_summary" },
  { schema: "core", table: "strategy_summary" },
  { schema: "core", table: "grid_vs_finish" },
  { schema: "core", table: "race_progression_summary" },
  { schema: "core", table: "lap_phase_summary" },
  { schema: "core", table: "telemetry_lap_bridge" },
  { schema: "core", table: "lap_context_summary" },
  { schema: "core", table: "replay_lap_frames" },
  { schema: "core", table: "metric_registry" },
  // Phase 20-A/B (track_segments) and Phase 21 facades. The CORE_CONTRACTS
  // list points at the LLM-stable contract names — NOT the underlying
  // storage matviews (`analytics.<name>_data`). The facade view is what
  // generated SQL targets; the storage matview is implementation.
  { schema: "f1", table: "track_segments" },
  { schema: "analytics", table: "sector_dominance" },
  // Phase 25.2 slice 21-stint-degradation-curve.
  { schema: "analytics", table: "stint_degradation_curve" },
  // Phase 25.2 slice 21-race-control-incident-index.
  { schema: "analytics", table: "race_control_incidents" },
  // Phase 25.2 slice 21-fuel-corrected-pace.
  { schema: "analytics", table: "fuel_corrected_pace" },
  // Phase 25.2 slice 21-weather-impact.
  { schema: "analytics", table: "weather_impact" },
  // Phase 25.2 slice 21-pit-loss-per-circuit.
  { schema: "analytics", table: "pit_loss_per_circuit" },
  // Phase 25.2 slice 21-tyre-warmup-curves (facade name = analytics.tyre_warmup).
  { schema: "analytics", table: "tyre_warmup" },
  // Phase 25.2 slice 21-traffic-adjusted-pace.
  { schema: "analytics", table: "traffic_adjusted_pace" },
  // Phase 25.2 slice 21-restart-performance.
  { schema: "analytics", table: "restart_performance" },
  // Phase 25.2 slice 21-drs-effectiveness.
  { schema: "analytics", table: "drs_effectiveness" },
  // Phase 25.2 slice 21-overtake-events.
  { schema: "analytics", table: "overtake_events" },
  // Phase 25.2 slice 21-undercut-overcut-history.
  { schema: "analytics", table: "undercut_overcut_history" },
  // Phase 25.2 slice 21-straight-line-dominance.
  { schema: "analytics", table: "straight_line_dominance" },
  // Phase 25.2 slice 21-driver-performance-7axis (Tier 4 aggregator).
  { schema: "analytics", table: "driver_performance_score" },
  // Phase 25 follow-up: per-driver telemetry coverage (q2182 lift).
  { schema: "analytics", table: "telemetry_coverage_per_driver" }
];

type CatalogRow = {
  table_schema: string;
  table_name: string;
  column_name: string;
  ordinal_position: number;
};

export type SchemaCatalog = Map<string, string[]>; // "schema.table" -> [col, ...]

let cachedCatalog: Promise<SchemaCatalog> | undefined;
let cachedDocs: Promise<string> | undefined;

export function _resetSchemaCatalogForTests(): void {
  cachedCatalog = undefined;
  cachedDocs = undefined;
}

async function loadCatalogFromInformationSchema(): Promise<SchemaCatalog> {
  const map: SchemaCatalog = new Map();
  const placeholders: string[] = [];
  const params: string[] = [];
  CORE_CONTRACTS.forEach(({ schema, table }, idx) => {
    placeholders.push(`($${idx * 2 + 1}, $${idx * 2 + 2})`);
    params.push(schema, table);
  });

  const rows = await sql<CatalogRow>(
    `
      SELECT table_schema, table_name, column_name, ordinal_position
      FROM information_schema.columns
      WHERE (table_schema, table_name) IN (${placeholders.join(", ")})
      ORDER BY table_schema, table_name, ordinal_position
    `,
    params
  );

  for (const row of rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    const list = map.get(key) ?? [];
    list.push(row.column_name);
    map.set(key, list);
  }
  return map;
}

export function getSchemaCatalog(): Promise<SchemaCatalog> {
  if (!cachedCatalog) {
    cachedCatalog = loadCatalogFromInformationSchema().catch((err) => {
      cachedCatalog = undefined;
      throw err;
    });
  }
  return cachedCatalog;
}

function formatCatalogAsPromptDocs(catalog: SchemaCatalog): string {
  const lines: string[] = [];
  for (const { schema, table } of CORE_CONTRACTS) {
    const key = `${schema}.${table}`;
    const cols = catalog.get(key);
    if (!cols || cols.length === 0) {
      continue; // table doesn't exist on this DB — skip rather than emit empty bullet
    }
    lines.push(`- ${key} has: ${cols.join(", ")}.`);
  }
  return lines.join("\n");
}

/**
 * Phase 17-F: returns the formatted "Important column reminders" section
 * built from `information_schema`. Cached at module scope so the
 * information_schema query runs at most once per process.
 */
export function getSchemaDocs(): Promise<string> {
  if (!cachedDocs) {
    cachedDocs = getSchemaCatalog()
      .then(formatCatalogAsPromptDocs)
      .catch((err) => {
        cachedDocs = undefined;
        throw err;
      });
  }
  return cachedDocs;
}

/**
 * Used by Phase 17-C's column-existence validator: returns the columns of
 * a fully-qualified `schema.table` from the cached catalog. Falls back to a
 * live `information_schema` query for tables outside the curated contract
 * list (raw.*, ad-hoc joins) so the validator still works against them.
 */
export async function getColumnsForTable(
  schema: string,
  table: string
): Promise<string[] | undefined> {
  const catalog = await getSchemaCatalog();
  const key = `${schema}.${table}`;
  const cached = catalog.get(key);
  if (cached) return cached;
  // Live lookup for tables not in the curated list (raw.*, etc).
  const rows = await sql<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `,
    [schema, table]
  );
  if (rows.length === 0) return undefined;
  const cols = rows.map((r) => r.column_name);
  catalog.set(key, cols);
  return cols;
}

export const CORE_CONTRACT_LIST = CORE_CONTRACTS;
