import {
  extractFromAliasMap,
  type ResolvedJoinOnPredicate,
  type ResolvedTableRef
} from "./columnExistenceCheck";

// Phase 19 outcome-fix Fix 3 (codex audit pass 4 + 5): parse-time SQL
// validator that rejects timestamp-proximity JOINs between
// raw.car_data and raw.location BEFORE SQL hits Postgres. The 15s
// timeout path is structurally bypassed.
//
// Layered design:
//   - Layer 1 (HARD GATE) — AST walk via extractFromAliasMap, then
//     pattern-detect timestamp-proximity ON predicates between the two
//     tables (in either alias order, scope-aware).
//   - Layer 1b (regex pre-screen) — fail-closed on parser failure.
//     If both telemetry tables are mentioned in the SQL AND a
//     timestamp-extraction shape is present AND the parser couldn't
//     produce an AST, return a synthetic violation so the orchestration
//     repair path fires instead of letting the malformed-but-possibly-
//     dangerous SQL run.
//
// Returns the same ValidationResult shape as validateColumnExistence
// so the orchestration layer treats violations identically.

export type JoinPatternViolation = {
  // Mirrors ValidationMiss shape so the orchestration layer treats us
  // the same way. `joinPatternViolation` field flag distinguishes us
  // from real column misses if a downstream consumer cares.
  table: string;
  column: string;
  sourceRef: string;
  joinPatternViolation: true;
  reason: string;
};

export type JoinPatternsValidationResult =
  | { ok: true; reason?: "ok" | "no_telemetry_tables_referenced" }
  | { ok: false; missing: JoinPatternViolation[] };

// Tables to flag. Cross-telemetry timestamp-proximity is the
// production incident from the 2026-05-03 baseline; this list can
// extend later (e.g. raw.intervals × raw.position_history) but stays
// conservative for v1.
const FLAGGED_TABLE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["raw.car_data", "raw.location"]
];

function isFlaggedPair(left: ResolvedTableRef, right: ResolvedTableRef): boolean {
  if (left.kind !== "base" || right.kind !== "base") return false;
  const leftKey = `${left.schema}.${left.table}`;
  const rightKey = `${right.schema}.${right.table}`;
  for (const [a, b] of FLAGGED_TABLE_PAIRS) {
    if ((leftKey === a && rightKey === b) || (leftKey === b && rightKey === a)) return true;
  }
  return false;
}

// Walk the ON-predicate AST and look for the timestamp-proximity
// shape: a non-equi comparison whose terms include EXTRACT(EPOCH FROM
// ...) / ABS(...) / a similar wrapper around `date` columns from each
// side.
//
// We're permissive — any of these signals is enough:
//   - `binary` op type < / <= / > / >=
//   - At least one side wraps a `call` named `extract` or `abs`, or a
//     `call` whose args include `binary` op `-` over two `ref`s with
//     `name: "date"`.
function predicateLooksLikeTimestampProximity(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const e = node as Record<string, unknown>;
  const t = e.type;

  if (t === "binary") {
    const op = (e.op as string | undefined) ?? "";
    if (op === "<" || op === "<=" || op === ">" || op === ">=") {
      // Either side wraps a date-extracting / abs-wrapped expression?
      if (sideWrapsDateExtraction(e.left) || sideWrapsDateExtraction(e.right)) return true;
    }
    // Compound predicates (AND/OR) — recurse into both sides.
    if (predicateLooksLikeTimestampProximity(e.left)) return true;
    if (predicateLooksLikeTimestampProximity(e.right)) return true;
    return false;
  }

  // Non-binary predicate roots: recurse into all object children to
  // catch wrapping shapes (NOT, parens, etc.).
  for (const v of Object.values(e)) {
    if (v && typeof v === "object" && predicateLooksLikeTimestampProximity(v)) return true;
  }
  return false;
}

function sideWrapsDateExtraction(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const e = node as Record<string, unknown>;
  if (e.type === "call") {
    const fnObj = e.function as Record<string, unknown> | string | undefined;
    const fnName =
      typeof fnObj === "string"
        ? fnObj.toLowerCase()
        : typeof fnObj?.name === "string"
          ? (fnObj.name as string).toLowerCase()
          : null;
    if (fnName === "abs" || fnName === "extract") {
      return true;
    }
    // Recurse into args — `EXTRACT(EPOCH FROM (a.date - b.date))` may
    // appear inside an outer call.
    const args = (e.args as unknown[]) ?? [];
    for (const a of args) if (sideWrapsDateExtraction(a)) return true;
  }
  if (e.type === "extract") {
    return true;
  }
  // Recurse generally.
  for (const v of Object.values(e)) {
    if (v && typeof v === "object" && sideWrapsDateExtraction(v)) return true;
  }
  return false;
}

// Codex audit pass 5 / Layer 1b: regex pre-screen for parser-failure cases.
const TIMESTAMP_EXTRACT_RE = /(extract\s*\(|\babs\s*\([^)]*epoch\s+from)/i;

export async function validateJoinPatterns(sql: string): Promise<JoinPatternsValidationResult> {
  const lower = sql.toLowerCase();
  // Quick-skip: if the SQL doesn't mention both telemetry tables, can't be
  // the anti-pattern. Cheaper than a parse pass.
  let mentionsBothPair: readonly [string, string] | null = null;
  for (const [a, b] of FLAGGED_TABLE_PAIRS) {
    if (lower.includes(a) && lower.includes(b)) {
      mentionsBothPair = [a, b];
      break;
    }
  }
  if (!mentionsBothPair) {
    return { ok: true, reason: "no_telemetry_tables_referenced" };
  }

  const { ok, joinOnPredicates } = await extractFromAliasMap(sql);
  if (!ok) {
    // Layer 1b: parse failure with both telemetry tables present and a
    // timestamp-extraction signature in the raw SQL. Treat as a
    // synthetic violation so the orchestration repair path fires.
    if (TIMESTAMP_EXTRACT_RE.test(sql)) {
      return {
        ok: false,
        missing: [
          {
            table: mentionsBothPair.join(" × "),
            column: "<parser-failed>",
            sourceRef: "regex-prescreen",
            joinPatternViolation: true,
            reason:
              "SQL references raw.car_data and raw.location with a timestamp-extraction shape; parser failed to validate the JOIN. Routing to repair to avoid the 15s timeout."
          }
        ]
      };
    }
    return { ok: true, reason: "ok" };
  }

  const violations: JoinPatternViolation[] = [];
  for (const pred of joinOnPredicates) {
    if (!isFlaggedPair(pred.leftRef, pred.rightRef)) continue;
    if (!predicateLooksLikeTimestampProximity(pred.on)) continue;
    const leftKey =
      pred.leftRef.kind === "base" ? `${pred.leftRef.schema}.${pred.leftRef.table}` : "<derived>";
    const rightKey =
      pred.rightRef.kind === "base" ? `${pred.rightRef.schema}.${pred.rightRef.table}` : "<derived>";
    violations.push({
      table: `${leftKey} × ${rightKey}`,
      column: "<timestamp-proximity-join>",
      sourceRef: "join-on-predicate",
      joinPatternViolation: true,
      reason:
        "Timestamp-proximity JOIN between raw.car_data and raw.location is forbidden — it cross-joins to ~15s on Neon. Use core.telemetry_lap_bridge or aggregate per (session_key, driver_number, lap_number)."
    });
  }

  if (violations.length === 0) {
    return { ok: true, reason: "ok" };
  }
  return { ok: false, missing: violations };
}
