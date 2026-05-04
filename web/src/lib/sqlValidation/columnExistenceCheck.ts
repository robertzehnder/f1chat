import { parse } from "pgsql-ast-parser";
import { getColumnsForTable, getSchemaCatalog } from "@/lib/schemaCatalog";

// Phase 17-C: pre-execute SQL column-existence validator. Built around
// `pgsql-ast-parser` (regex was rejected — it defeats itself silently on
// aliases, CTEs, quoted identifiers, nested selects). Conservative wrap:
// any unexpected parse/traversal error returns ok:true so the DB still
// catches the issue. Parser bugs must NOT block valid SQL.
//
// Phase 19-A (rev5): the alias-resolution + column-ref-walking layer was
// extracted into the public helper `extractQualifiedColumnRefs` so the
// Phase 19 `expected_columns` matcher (Slice 19-D) and the validator
// share one alias-resolution implementation.

export type ValidationMiss = {
  table: string; // canonical "schema.table"
  column: string;
  sourceRef: string; // original alias-qualified form (e.g. "ss.compound")
};

export type ValidationResult =
  | { ok: true; reason?: "ok" | "parse_failed" | "ambiguous" | "no_alias_resolution" }
  | { ok: false; missing: ValidationMiss[] };

const DEFAULT_SCHEMA = "core";

type AliasEntry =
  | { kind: "table"; schema: string; table: string }
  | { kind: "derived" }; // CTE / subquery — skip column check

type AliasMap = Map<string, AliasEntry>;

// Phase 19-A (rev5): public helper return shape. `refs` carries every
// base-table column reference resolved through the alias map. CTE /
// subquery alias prefixes are reported in `unresolvedAliases` so callers
// can decide whether to fail-open or fail-skip-with-waiver (rev6
// tri-state matcher policy in Slice 19-D).
export type QualifiedColumnRef = {
  schema: string;
  table: string;
  column: string;
  sourceRef: string; // original alias-qualified form (e.g. "ca.entry_speed_kph")
  resolvedFromAlias: boolean; // false when the FROM target was unaliased
};

export type ExtractRefsResult = {
  ok: boolean; // false when the parser rejected the SQL
  refs: QualifiedColumnRef[];
  unresolvedAliases: string[];
};

/**
 * Phase 19-A (rev5): extract every base-table column reference from a SQL
 * string with full alias resolution. Used by both the Phase 17-C
 * validator and the Phase 19 expected-columns matcher.
 *
 * Returns:
 *  - `ok: false` when the parser rejected the SQL (matches the validator's
 *    "parse_failed" branch — callers must decide whether to fail-open).
 *  - `refs`: deduplicated list of `{schema, table, column}` triples for
 *    every column reference whose owning FROM target is a real base
 *    table (resolved through explicit `AS`, implicit alias-equals-table,
 *    or the unaliased single-FROM case).
 *  - `unresolvedAliases`: column-ref prefixes that point at a CTE /
 *    subquery alias (kind: "derived"). The base-table mode of the
 *    matcher cannot resolve these — Slice 19-D returns
 *    `kind: "skipped"` when the relevant ref set is non-empty.
 */
export async function extractQualifiedColumnRefs(sql: string): Promise<ExtractRefsResult> {
  let asts;
  try {
    asts = parse(sql);
  } catch {
    return { ok: false, refs: [], unresolvedAliases: [] };
  }
  if (!Array.isArray(asts) || asts.length === 0) {
    return { ok: false, refs: [], unresolvedAliases: [] };
  }

  const refs: QualifiedColumnRef[] = [];
  const unresolvedAliases = new Set<string>();

  try {
    for (const stmt of asts) {
      walkStatementForRefs(stmt, refs, unresolvedAliases, new Map());
    }
  } catch {
    return { ok: false, refs: [], unresolvedAliases: [] };
  }

  // Dedupe refs on `schema.table.column|sourceRef` so a column referenced
  // both in SELECT and ON predicates isn't double-counted.
  const seen = new Set<string>();
  const uniqueRefs: QualifiedColumnRef[] = [];
  for (const r of refs) {
    const k = `${r.schema}.${r.table}.${r.column}|${r.sourceRef}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueRefs.push(r);
  }

  return {
    ok: true,
    refs: uniqueRefs,
    unresolvedAliases: Array.from(unresolvedAliases)
  };
}

/**
 * Phase 17-C entry point. Returns ok:true on parse failure (conservative —
 * the DB still catches malformed SQL), ok:false with a missing-list when at
 * least one column reference resolves to a real table whose column is not
 * in `information_schema`.
 *
 * Phase 19-A (rev5): re-implemented on top of `extractQualifiedColumnRefs`
 * so the alias-resolution implementation is shared with the Phase 19
 * matcher.
 */
export async function validateColumnExistence(sql: string): Promise<ValidationResult> {
  const extracted = await extractQualifiedColumnRefs(sql);
  if (!extracted.ok) {
    return { ok: true, reason: "parse_failed" };
  }

  // Cache catalog lookups within a single call.
  const lookupCache = new Map<string, string[] | undefined>();
  const lookup = async (schema: string, table: string): Promise<string[] | undefined> => {
    const key = `${schema}.${table}`;
    if (lookupCache.has(key)) return lookupCache.get(key);
    let cols: string[] | undefined;
    try {
      cols = await getColumnsForTable(schema, table);
    } catch {
      cols = undefined;
    }
    lookupCache.set(key, cols);
    return cols;
  };

  try {
    await getSchemaCatalog().catch(() => undefined);
  } catch {
    // ignore — lookup() is conservative on individual misses.
  }

  const missing: ValidationMiss[] = [];

  for (const ref of extracted.refs) {
    const cols = await lookup(ref.schema, ref.table);
    if (!cols) continue; // table not in catalog — conservative skip
    if (!cols.includes(ref.column)) {
      missing.push({
        table: `${ref.schema}.${ref.table}`,
        column: ref.column,
        sourceRef: ref.sourceRef
      });
    }
  }

  if (missing.length === 0) {
    return { ok: true };
  }

  // Dedupe (refs already dedup but missing entries can still collide on
  // `table|column|sourceRef` if the same source ref is emitted twice).
  const seen = new Set<string>();
  const unique: ValidationMiss[] = [];
  for (const m of missing) {
    const k = `${m.table}|${m.column}|${m.sourceRef}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(m);
  }
  return { ok: false, missing: unique };
}

function walkStatementForRefs(
  stmt: unknown,
  refs: QualifiedColumnRef[],
  unresolvedAliases: Set<string>,
  inheritedAliases: AliasMap
): void {
  if (!stmt || typeof stmt !== "object") return;
  const node = stmt as Record<string, unknown>;
  const t = node.type;

  if (t === "with") {
    const bind = (node.bind as Array<Record<string, unknown>>) ?? [];
    const innerAliases: AliasMap = new Map(inheritedAliases);
    for (const cte of bind) {
      const aliasObj = cte.alias as Record<string, unknown> | undefined;
      const aliasName =
        typeof aliasObj?.name === "string" ? (aliasObj.name as string).toLowerCase() : null;
      if (aliasName) {
        innerAliases.set(aliasName, { kind: "derived" });
      }
      walkStatementForRefs(cte.statement, refs, unresolvedAliases, inheritedAliases);
    }
    walkStatementForRefs(node.in, refs, unresolvedAliases, innerAliases);
    return;
  }

  if (t !== "select") {
    return;
  }

  const fromArr = (node.from as Array<Record<string, unknown>>) ?? [];
  const aliases: AliasMap = new Map(inheritedAliases);
  let multiTable = false;
  let onlyTableEntry: { schema: string; table: string } | null = null;
  let realTableCount = 0;

  for (const f of fromArr) {
    const ftype = f.type;
    if (ftype === "table") {
      const nameObj = f.name as Record<string, unknown> | undefined;
      const tableName =
        typeof nameObj?.name === "string" ? (nameObj.name as string).toLowerCase() : null;
      const schemaName =
        typeof nameObj?.schema === "string" ? (nameObj.schema as string).toLowerCase() : null;
      const explicitAlias =
        typeof nameObj?.alias === "string" ? (nameObj.alias as string).toLowerCase() : null;
      if (!tableName) continue;

      const inheritedCte = inheritedAliases.get(tableName);
      if (!schemaName && inheritedCte && inheritedCte.kind === "derived") {
        const aliasKey = explicitAlias ?? tableName;
        aliases.set(aliasKey, { kind: "derived" });
        continue;
      }

      const schema = schemaName ?? DEFAULT_SCHEMA;
      const aliasKey = explicitAlias ?? tableName;
      aliases.set(aliasKey, { kind: "table", schema, table: tableName });
      realTableCount += 1;
      if (realTableCount === 1) {
        onlyTableEntry = { schema, table: tableName };
      } else {
        onlyTableEntry = null;
        multiTable = true;
      }

      const joinSpec = f.join as Record<string, unknown> | undefined;
      if (joinSpec && joinSpec.on) {
        (f as { __pendingOn?: unknown }).__pendingOn = joinSpec.on;
      }
    } else if (ftype === "statement") {
      const aliasName =
        typeof f.alias === "string" ? (f.alias as string).toLowerCase() : null;
      if (aliasName) {
        aliases.set(aliasName, { kind: "derived" });
      }
      walkStatementForRefs(f.statement, refs, unresolvedAliases, inheritedAliases);
      multiTable = realTableCount + 1 > 1;
      realTableCount += 1;
      onlyTableEntry = null;
    }
  }

  const ctx: WalkCtx = {
    aliases,
    refs,
    unresolvedAliases,
    multiTable,
    onlyTable: onlyTableEntry
  };

  const cols = (node.columns as Array<Record<string, unknown>>) ?? [];
  for (const c of cols) {
    walkExprForRefs(c.expr, ctx);
  }

  walkExprForRefs(node.where, ctx);

  const groupBy = node.groupBy as Array<unknown> | undefined;
  if (Array.isArray(groupBy)) {
    for (const g of groupBy) walkExprForRefs(g, ctx);
  }

  walkExprForRefs(node.having, ctx);

  const orderBy = node.orderBy as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(orderBy)) {
    for (const o of orderBy) walkExprForRefs(o.by, ctx);
  }

  for (const f of fromArr) {
    const pending = (f as { __pendingOn?: unknown }).__pendingOn;
    if (pending !== undefined) walkExprForRefs(pending, ctx);
  }
}

type WalkCtx = {
  aliases: AliasMap;
  refs: QualifiedColumnRef[];
  unresolvedAliases: Set<string>;
  multiTable: boolean;
  onlyTable: { schema: string; table: string } | null;
};

function walkExprForRefs(node: unknown, ctx: WalkCtx): void {
  if (!node || typeof node !== "object") return;
  const e = node as Record<string, unknown>;
  const t = e.type;

  if (t === "ref") {
    const name = typeof e.name === "string" ? (e.name as string) : null;
    if (!name || name === "*") return;
    const tableObj = e.table as Record<string, unknown> | undefined;
    const aliasOrTable =
      typeof tableObj?.name === "string" ? (tableObj.name as string).toLowerCase() : null;

    if (aliasOrTable) {
      const entry = ctx.aliases.get(aliasOrTable);
      if (!entry) {
        // Unknown prefix — could be a CTE inherited from a sibling scope,
        // or a misspelled alias. Track for transparency.
        ctx.unresolvedAliases.add(aliasOrTable);
        return;
      }
      if (entry.kind === "derived") {
        ctx.unresolvedAliases.add(aliasOrTable);
        return;
      }
      ctx.refs.push({
        schema: entry.schema,
        table: entry.table,
        column: name,
        sourceRef: `${aliasOrTable}.${name}`,
        resolvedFromAlias: true
      });
      return;
    }

    if (ctx.multiTable || !ctx.onlyTable) return;
    ctx.refs.push({
      schema: ctx.onlyTable.schema,
      table: ctx.onlyTable.table,
      column: name,
      sourceRef: name,
      resolvedFromAlias: false
    });
    return;
  }

  if (t === "binary" || t === "unary") {
    walkExprForRefs(e.left, ctx);
    walkExprForRefs(e.right, ctx);
    walkExprForRefs(e.operand, ctx);
    return;
  }
  if (t === "call") {
    const args = (e.args as unknown[]) ?? [];
    for (const a of args) walkExprForRefs(a, ctx);
    return;
  }
  if (t === "case") {
    const whens = (e.whens as Array<Record<string, unknown>>) ?? [];
    for (const w of whens) {
      walkExprForRefs(w.when, ctx);
      walkExprForRefs(w.value, ctx);
    }
    walkExprForRefs(e.else, ctx);
    return;
  }
  if (t === "list" || t === "array" || t === "values") {
    const list = (e.expressions as unknown[]) ?? (e.values as unknown[]) ?? [];
    for (const a of list) walkExprForRefs(a, ctx);
    return;
  }
  if (t === "extract") {
    walkExprForRefs(e.from, ctx);
    return;
  }
  if (t === "cast") {
    walkExprForRefs(e.operand, ctx);
    return;
  }
  if (t === "select") {
    // Inline subquery in expression position. Validate independently — it
    // has its own FROM scope.
    walkStatementForRefs(e, ctx.refs, ctx.unresolvedAliases, new Map());
    return;
  }

  for (const v of Object.values(e)) {
    if (v && typeof v === "object") {
      walkExprForRefs(v, ctx);
    }
  }
}

// =============================================================================
// Phase 19 outcome-fix Fix 3 (codex audit pass 4 + 5): exported helper that
// returns every JOIN-on predicate from every SELECT scope (top-level + CTEs +
// inline subqueries), each pre-resolved against its own scope's alias map. No
// global alias-map lookup needed; each predicate carries `leftRef` /
// `rightRef` already resolved to canonical (schema, table) pairs (or tagged
// as cte/subquery).
//
// The Phase 19 outcome-fix plan originally claimed `extractQualifiedColumnRefs`
// was the reuse vehicle for JOIN-pattern validation. Codex pass 4 noted that
// helper only returns column refs — the alias map and JOIN-on predicate AST
// are needed too. Codex pass 5 noted the return shape needs scope-awareness
// because outer/inner aliases can shadow each other in CTE/subquery scopes.
// =============================================================================

export type ResolvedTableRef =
  | { kind: "base"; schema: string; table: string }
  | { kind: "cte" | "subquery" | "unknown"; aliasName: string };

export type ResolvedJoinOnPredicate = {
  leftRef: ResolvedTableRef;
  rightRef: ResolvedTableRef;
  on: unknown; // parsed ON-predicate AST root for the consumer to walk
};

export type ExtractFromAliasMapResult = {
  ok: boolean; // false on parse failure
  joinOnPredicates: ResolvedJoinOnPredicate[];
};

export async function extractFromAliasMap(sql: string): Promise<ExtractFromAliasMapResult> {
  let asts;
  try {
    asts = parse(sql);
  } catch {
    return { ok: false, joinOnPredicates: [] };
  }
  if (!Array.isArray(asts) || asts.length === 0) {
    return { ok: false, joinOnPredicates: [] };
  }
  const out: ResolvedJoinOnPredicate[] = [];
  try {
    for (const stmt of asts) {
      walkStatementForJoinPredicates(stmt, out, new Map());
    }
  } catch {
    return { ok: false, joinOnPredicates: [] };
  }
  return { ok: true, joinOnPredicates: out };
}

function aliasEntryToRef(entry: AliasEntry, aliasName: string): ResolvedTableRef {
  if (entry.kind === "table") {
    return { kind: "base", schema: entry.schema, table: entry.table };
  }
  // entry.kind === "derived" → could be CTE or subquery. We don't track which
  // here; tag as unknown for the consumer (the JOIN-pattern validator only
  // cares about base-table refs).
  return { kind: "unknown", aliasName };
}

function walkStatementForJoinPredicates(
  stmt: unknown,
  out: ResolvedJoinOnPredicate[],
  inheritedAliases: AliasMap
): void {
  if (!stmt || typeof stmt !== "object") return;
  const node = stmt as Record<string, unknown>;
  const t = node.type;

  if (t === "with") {
    const bind = (node.bind as Array<Record<string, unknown>>) ?? [];
    const innerAliases: AliasMap = new Map(inheritedAliases);
    for (const cte of bind) {
      const aliasObj = cte.alias as Record<string, unknown> | undefined;
      const aliasName =
        typeof aliasObj?.name === "string" ? (aliasObj.name as string).toLowerCase() : null;
      if (aliasName) {
        innerAliases.set(aliasName, { kind: "derived" });
      }
      // Recurse into the CTE body with the CURRENT (outer) alias scope, not
      // the inner one — the CTE body shouldn't see its own alias name.
      walkStatementForJoinPredicates(cte.statement, out, inheritedAliases);
    }
    walkStatementForJoinPredicates(node.in, out, innerAliases);
    return;
  }

  if (t !== "select") return;

  // Build the alias map for this scope.
  const fromArr = (node.from as Array<Record<string, unknown>>) ?? [];
  const aliases: AliasMap = new Map(inheritedAliases);
  type FromEntry = { aliasKey: string; ref: ResolvedTableRef; pendingOn?: unknown };
  const fromEntries: FromEntry[] = [];

  for (const f of fromArr) {
    const ftype = f.type;
    if (ftype === "table") {
      const nameObj = f.name as Record<string, unknown> | undefined;
      const tableName =
        typeof nameObj?.name === "string" ? (nameObj.name as string).toLowerCase() : null;
      const schemaName =
        typeof nameObj?.schema === "string" ? (nameObj.schema as string).toLowerCase() : null;
      const explicitAlias =
        typeof nameObj?.alias === "string" ? (nameObj.alias as string).toLowerCase() : null;
      if (!tableName) continue;

      const inheritedCte = inheritedAliases.get(tableName);
      if (!schemaName && inheritedCte && inheritedCte.kind === "derived") {
        const aliasKey = explicitAlias ?? tableName;
        aliases.set(aliasKey, { kind: "derived" });
        fromEntries.push({ aliasKey, ref: { kind: "cte", aliasName: aliasKey } });
        const joinSpec = f.join as Record<string, unknown> | undefined;
        if (joinSpec?.on) fromEntries[fromEntries.length - 1].pendingOn = joinSpec.on;
        continue;
      }

      const schema = schemaName ?? DEFAULT_SCHEMA;
      const aliasKey = explicitAlias ?? tableName;
      aliases.set(aliasKey, { kind: "table", schema, table: tableName });
      fromEntries.push({
        aliasKey,
        ref: { kind: "base", schema, table: tableName }
      });
      const joinSpec = f.join as Record<string, unknown> | undefined;
      if (joinSpec?.on) fromEntries[fromEntries.length - 1].pendingOn = joinSpec.on;
    } else if (ftype === "statement") {
      const aliasName =
        typeof f.alias === "string" ? (f.alias as string).toLowerCase() : null;
      if (aliasName) {
        aliases.set(aliasName, { kind: "derived" });
        fromEntries.push({
          aliasKey: aliasName,
          ref: { kind: "subquery", aliasName }
        });
      }
      walkStatementForJoinPredicates(f.statement, out, inheritedAliases);
    }
  }

  // Each JOIN's `pendingOn` predicate is associated with the JOIN target's
  // FROM entry (the one that introduces the table on the right of the JOIN).
  // We pair it with the most recent prior FROM entry as the left side. This
  // is the simplest pgsql-ast-parser interpretation; the parser's `join`
  // descriptor lives on the JOINed entry.
  for (let i = 0; i < fromEntries.length; i += 1) {
    const entry = fromEntries[i];
    if (entry.pendingOn === undefined) continue;
    // Find a left-side base/cte/subquery counterpart by walking back to
    // the previous FROM entry (skipping nothing — the parser flattens
    // consecutive JOIN clauses into the FROM array).
    if (i === 0) continue; // ON predicate without a counterpart — unusual; skip.
    const left = fromEntries[i - 1];
    out.push({ leftRef: left.ref, rightRef: entry.ref, on: entry.pendingOn });
  }

  // Recurse into expression-position subqueries.
  const cols = (node.columns as Array<Record<string, unknown>>) ?? [];
  for (const c of cols) walkExprForJoinPredicatesSubquery(c.expr, out);
  walkExprForJoinPredicatesSubquery(node.where, out);
  // Reference the alias map to keep linter happy + signal scope-awareness.
  void aliases;
}

function walkExprForJoinPredicatesSubquery(node: unknown, out: ResolvedJoinOnPredicate[]): void {
  if (!node || typeof node !== "object") return;
  const e = node as Record<string, unknown>;
  if (e.type === "select") {
    walkStatementForJoinPredicates(e, out, new Map());
    return;
  }
  for (const v of Object.values(e)) {
    if (v && typeof v === "object") walkExprForJoinPredicatesSubquery(v, out);
  }
}

// Helper used by aliasEntryToRef in tests; exported only for fixture access.
export function _aliasEntryToRefForTests(entry: AliasEntry, aliasName: string): ResolvedTableRef {
  return aliasEntryToRef(entry, aliasName);
}
