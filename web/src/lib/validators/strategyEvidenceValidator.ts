import type { FactContract, FactContractRow } from "@/lib/contracts/factContract";

export type StrategyEvidenceValidationResult = {
  ok: boolean;
  reasons: string[];
};

const DRIVER_NAME_KEYS = ["full_name", "driver_name", "name"] as const;

const PIT_LAPS_KEY = "pit_laps";
const PIT_STOP_COUNT_KEY = "pit_stop_count";
const STRATEGY_TYPE_KEY = "strategy_type";
const COMPOUNDS_USED_KEY = "compounds_used";
const TOTAL_PIT_DURATION_KEY = "total_pit_duration_seconds";
const PIT_LAP_KEY = "pit_lap";
const LAP_NUMBER_KEY = "lap_number";
const EVENT_TYPE_KEY = "event_type";
const DECISION_KIND_KEY = "decision_kind";

const RECOGNIZED_COLUMNS = [
  PIT_LAPS_KEY,
  PIT_STOP_COUNT_KEY,
  STRATEGY_TYPE_KEY,
  COMPOUNDS_USED_KEY,
  TOTAL_PIT_DURATION_KEY,
  LAP_NUMBER_KEY,
  EVENT_TYPE_KEY,
  DECISION_KIND_KEY,
  PIT_LAP_KEY
] as const;

type PitLapClaim = {
  kind: "pit_lap";
  driverToken: string;
  lap: number;
};

type StopCountClaim = {
  kind: "stop_count";
  driverToken: string;
  count: number;
};

type StrategyNameClaim = {
  kind: "strategy_name";
  driverToken: string;
  name: string;
  expectedStopCount: number;
  expectedStrategyType: string;
};

type StrategyClaim = PitLapClaim | StopCountClaim | StrategyNameClaim;

function getString(row: FactContractRow, keys: ReadonlyArray<string>): string | null {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const raw = (row as Record<string, unknown>)[key];
      if (typeof raw === "string" && raw.length > 0) return raw;
    }
  }
  return null;
}

function getNumber(row: FactContractRow, key: string): number | null {
  if (!Object.prototype.hasOwnProperty.call(row, key)) return null;
  const raw = (row as Record<string, unknown>)[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function findRowsByDriverToken(
  rows: ReadonlyArray<FactContractRow>,
  token: string
): FactContractRow[] {
  const lower = token.toLowerCase();
  const out: FactContractRow[] = [];
  for (const row of rows) {
    const name = getString(row, DRIVER_NAME_KEYS);
    if (!name) continue;
    const lowerName = name.toLowerCase();
    if (lowerName === lower) {
      out.push(row);
      continue;
    }
    const pieces = lowerName.split(/[\s\-']+/).filter((p) => p.length > 0);
    if (pieces.some((p) => p === lower)) {
      out.push(row);
    }
  }
  return out;
}

function rowsHaveAnyKey(
  rows: ReadonlyArray<FactContractRow>,
  keys: ReadonlyArray<string>
): boolean {
  for (const row of rows) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(row, key)) return true;
    }
  }
  return false;
}

function execAll(re: RegExp, text: string): RegExpExecArray[] {
  const results: RegExpExecArray[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    results.push(m);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return results;
}

function nearestPriorDriverToken(text: string, position: number): string | null {
  let start = position;
  while (start > 0 && !/[.!?\n]/.test(text[start - 1])) start--;
  const window = text.slice(start, position);
  const re = /\b([A-Z][a-z][A-Za-z'\-]*)\b/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(window)) !== null) {
    last = m[1];
  }
  return last;
}

const STRATEGY_NAME_MAP: Record<string, { count: number; canonical: string }> = {
  "no-stop": { count: 0, canonical: "No-stop strategy" },
  "one-stop": { count: 1, canonical: "One-stop strategy" },
  "two-stop": { count: 2, canonical: "Two-stop strategy" },
  "three-stop": { count: 3, canonical: "Three-stop strategy" },
  "four-stop": { count: 4, canonical: "Four-stop strategy" }
};

function parseClaims(text: string): StrategyClaim[] {
  const claims: StrategyClaim[] = [];
  if (typeof text !== "string" || text.length === 0) return claims;

  const strategyNameRe = new RegExp(
    `\\b(?:ran|used|employed|chose|went|executed)\\s+(?:a|an|the)?\\s*(no[\\s-]stop|one[\\s-]stop|two[\\s-]stop|three[\\s-]stop|four[\\s-]stop)\\s+strategy\\b`,
    "gi"
  );
  for (const m of execAll(strategyNameRe, text)) {
    const driverToken = nearestPriorDriverToken(text, m.index);
    if (!driverToken) continue;
    const normalized = m[1].toLowerCase().replace(/\s+/g, "-");
    const info = STRATEGY_NAME_MAP[normalized];
    if (!info) continue;
    claims.push({
      kind: "strategy_name",
      driverToken,
      name: normalized,
      expectedStopCount: info.count,
      expectedStrategyType: info.canonical
    });
  }

  const pitVerbsLapsRe = new RegExp(
    `\\b(?:pitted|pitting|stopped|stopping|stops|pits)\\s+(?:on|at|in)\\s+laps?\\s+(\\d+(?:\\s*(?:,|and)\\s*\\d+)*)\\b`,
    "gi"
  );
  for (const m of execAll(pitVerbsLapsRe, text)) {
    const driverToken = nearestPriorDriverToken(text, m.index);
    if (!driverToken) continue;
    const lapNumbers = m[1].match(/\d+/g) ?? [];
    for (const ln of lapNumbers) {
      const lap = Number(ln);
      if (!Number.isFinite(lap)) continue;
      claims.push({ kind: "pit_lap", driverToken, lap });
    }
  }

  const stopCountRe = new RegExp(
    `\\b(?:made|did|had|completed|took)\\s+(\\d+)\\s+pit\\s+stops?\\b`,
    "gi"
  );
  for (const m of execAll(stopCountRe, text)) {
    const driverToken = nearestPriorDriverToken(text, m.index);
    if (!driverToken) continue;
    const count = Number(m[1]);
    if (!Number.isFinite(count)) continue;
    claims.push({ kind: "stop_count", driverToken, count });
  }

  return claims;
}

function isPitEventRow(row: FactContractRow): boolean {
  return (
    Object.prototype.hasOwnProperty.call(row, EVENT_TYPE_KEY) ||
    Object.prototype.hasOwnProperty.call(row, DECISION_KIND_KEY) ||
    Object.prototype.hasOwnProperty.call(row, PIT_LAP_KEY)
  );
}

export function validateStrategyEvidence(
  answerText: string,
  contract: FactContract
): StrategyEvidenceValidationResult {
  const reasons: string[] = [];
  const rows = contract.rows ?? [];
  const claims = parseClaims(answerText);

  if (claims.length === 0) {
    return { ok: true, reasons: [] };
  }

  const hasAnyRecognized = rowsHaveAnyKey(rows, RECOGNIZED_COLUMNS);
  if (!hasAnyRecognized) {
    for (const claim of claims) {
      reasons.push(
        `kind=${claim.kind}, driver=${claim.driverToken}: contract rows expose no recognized strategy-evidence columns (pit_laps/pit_stop_count/strategy_type/compounds_used/total_pit_duration_seconds/lap_number/event_type/decision_kind/pit_lap)`
      );
    }
    return { ok: false, reasons };
  }

  for (const claim of claims) {
    const driverRows = findRowsByDriverToken(rows, claim.driverToken);
    if (driverRows.length === 0) {
      reasons.push(
        `kind=${claim.kind}, driver=${claim.driverToken}: no contract row matches this driver`
      );
      continue;
    }

    if (claim.kind === "pit_lap") {
      let supported = false;
      for (const row of driverRows) {
        const pitLapsRaw = (row as Record<string, unknown>)[PIT_LAPS_KEY];
        if (Array.isArray(pitLapsRaw)) {
          for (const entry of pitLapsRaw) {
            if (typeof entry === "number" && Number.isFinite(entry) && entry === claim.lap) {
              supported = true;
              break;
            }
          }
          if (supported) break;
        }
        if (isPitEventRow(row)) {
          const pitLap = getNumber(row, PIT_LAP_KEY);
          if (pitLap !== null && pitLap === claim.lap) {
            supported = true;
            break;
          }
          const lapNumber = getNumber(row, LAP_NUMBER_KEY);
          if (lapNumber !== null && lapNumber === claim.lap) {
            supported = true;
            break;
          }
        }
      }
      if (!supported) {
        reasons.push(
          `kind=pit_lap, driver=${claim.driverToken}: claim of pit on lap ${claim.lap} not backed by any matching driver row (no pit_laps entry, pit_lap match, or pit-event lap_number match)`
        );
      }
    } else if (claim.kind === "stop_count") {
      let supported = false;
      const observedCounts: number[] = [];
      for (const row of driverRows) {
        const psc = getNumber(row, PIT_STOP_COUNT_KEY);
        if (psc !== null) {
          observedCounts.push(psc);
          if (psc === claim.count) {
            supported = true;
            break;
          }
        }
      }
      if (!supported) {
        if (observedCounts.length === 0) {
          reasons.push(
            `kind=stop_count, driver=${claim.driverToken}: claim of ${claim.count} pit stops cannot be verified — driver row has no pit_stop_count column`
          );
        } else {
          reasons.push(
            `kind=stop_count, driver=${claim.driverToken}: claim of ${claim.count} pit stops contradicts contract pit_stop_count=[${observedCounts.join(",")}]`
          );
        }
      }
    } else if (claim.kind === "strategy_name") {
      let supported = false;
      const evidence: string[] = [];
      for (const row of driverRows) {
        const stratType = getString(row, [STRATEGY_TYPE_KEY]);
        if (stratType !== null) {
          evidence.push(`strategy_type=${stratType}`);
          if (stratType.toLowerCase() === claim.expectedStrategyType.toLowerCase()) {
            supported = true;
            break;
          }
        }
        const psc = getNumber(row, PIT_STOP_COUNT_KEY);
        if (psc !== null) {
          evidence.push(`pit_stop_count=${psc}`);
          if (psc === claim.expectedStopCount) {
            supported = true;
            break;
          }
        }
      }
      if (!supported) {
        if (evidence.length === 0) {
          reasons.push(
            `kind=strategy_name, driver=${claim.driverToken}: claim of ${claim.name} strategy cannot be verified — driver row has no strategy_type or pit_stop_count column`
          );
        } else {
          reasons.push(
            `kind=strategy_name, driver=${claim.driverToken}: claim of ${claim.name} strategy (expected strategy_type='${claim.expectedStrategyType}' or pit_stop_count=${claim.expectedStopCount}) contradicts contract row evidence [${evidence.join("; ")}]`
          );
        }
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}
