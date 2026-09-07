/**
 * rights.mjs — the corpus plan's fail-closed rights control
 * (diagnostic/analyst-corpus-ingestion-plan-2026-09-06.md, principle 4).
 *
 * Every ingestion path calls assertAcquireAllowed BEFORE any request, and
 * assertUseAllowed BEFORE writing any artifact, persisting normalized full
 * text, or making any model call — each caller passing its ACTUAL purpose.
 * Missing registry row, wrong state, disallowed method/use/purpose = throw.
 * There is deliberately no bypass and no purpose inference.
 *
 * The registry is loaded once from raw.analyst_sources; pure logic is
 * factored so the refusal tests can run without a DB (loadRegistryFromRows).
 */

export const USES = ["store_full_text", "llm_process"];
export const PURPOSES = ["style_research", "eval_reference", "question_mining", "format_study"];

export class RightsError extends Error {
  constructor(message) {
    super(message);
    this.name = "RightsError";
  }
}

export function loadRegistryFromRows(rows) {
  const reg = new Map();
  for (const r of rows) reg.set(r.source_key, r);
  return reg;
}

export async function loadRegistry(client) {
  const { rows } = await client.query(
    `SELECT source_key, kind, enabled, rights_state, approved_uses, allowed_methods,
            may_store_full_text, may_llm_process, retention_days, deletion_required
     FROM raw.analyst_sources`
  );
  return loadRegistryFromRows(rows);
}

function sourceRow(registry, sourceKey) {
  const row = registry.get(sourceKey);
  if (!row) throw new RightsError(`REFUSED: unknown source '${sourceKey}' (no registry row — fail closed)`);
  return row;
}

function assertState(row) {
  if (!row.enabled) throw new RightsError(`REFUSED: source '${row.source_key}' is disabled`);
  if (row.rights_state === "prohibited") {
    throw new RightsError(`REFUSED: source '${row.source_key}' is prohibited`);
  }
  if (row.rights_state === "pending") {
    throw new RightsError(`REFUSED: source '${row.source_key}' is pending rights review`);
  }
}

/** Gate on ACQUISITION: called before any request / inbox intake. */
export function assertAcquireAllowed(registry, sourceKey, method) {
  const row = sourceRow(registry, sourceKey);
  assertState(row);
  if (!Array.isArray(row.allowed_methods) || !row.allowed_methods.includes(method)) {
    throw new RightsError(
      `REFUSED: method '${method}' not allowed for source '${sourceKey}' (allowed: ${row.allowed_methods?.join(",") || "none"})`
    );
  }
  return true;
}

/**
 * Gate on USE: called before writing ANY artifact (raw bytes included —
 * acquisition permission does not imply storage permission), before
 * persisting normalized full text, and before EVERY model call.
 */
export function assertUseAllowed(registry, sourceKey, use, purpose) {
  if (!USES.includes(use)) throw new RightsError(`REFUSED: unknown use '${use}'`);
  if (!PURPOSES.includes(purpose)) throw new RightsError(`REFUSED: unknown purpose '${purpose}'`);
  const row = sourceRow(registry, sourceKey);
  assertState(row);
  const flag = use === "store_full_text" ? row.may_store_full_text : row.may_llm_process;
  if (flag !== true) {
    throw new RightsError(`REFUSED: use '${use}' not permitted for source '${sourceKey}'`);
  }
  if (!Array.isArray(row.approved_uses) || !row.approved_uses.includes(purpose)) {
    throw new RightsError(
      `REFUSED: purpose '${purpose}' not in approved_uses for source '${sourceKey}' (approved: ${row.approved_uses?.join(",") || "none"})`
    );
  }
  return true;
}
