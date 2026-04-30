import type { FactContract, FactContractRow } from "@/lib/contracts/factContract";

export type GridFinishValidationResult = {
  ok: boolean;
  reasons: string[];
};

const DRIVER_NAME_KEYS = ["full_name", "driver_name", "name"] as const;
const GRID_KEYS = ["grid_position", "grid", "start_position"] as const;
const FINISH_KEYS = ["finish_position", "finish", "end_position"] as const;
const SIGNED_DELTA_KEYS = [
  "positions_gained",
  "position_change",
  "position_delta",
  "net_position_change"
] as const;

// Case-sensitive driver name capture: must start with an uppercase letter,
// followed by at least one lowercase letter, then any of the allowed letter /
// hyphen / apostrophe characters. We deliberately do NOT use the regex `i`
// flag anywhere in this file because it would relax `[A-Z]` and allow common
// English words ("and", "from", "to") to be parsed as driver tokens.
const NAME = "([A-Z][a-z][A-Za-z'\\-]*)";
const POS = "(\\d+)";
// Case-insensitive single-character classes for ASCII keyword fragments.
const P = "[Pp]";
const GRID = "[Gg]rid";

type ExplicitPositionClaim = {
  kind: "explicit_position";
  driverToken: string;
  field: "grid" | "finish";
  position: number;
};

type DeltaClaim = {
  kind: "delta";
  driverToken: string;
  // Positive = gained positions (improved), negative = lost positions.
  signedDelta: number;
  // Wording captured for reason text.
  wording: string;
};

type ComparativeClaim = {
  kind: "comparative";
  driverTokenA: string;
  driverTokenB: string;
  // Expected ordering of (deltaA, deltaB) according to the claim.
  // - "A_gt_B": deltaA > deltaB (e.g. "A gained more than B", "A lost fewer than B").
  // - "A_lt_B": deltaA < deltaB (e.g. "A gained fewer than B", "A lost more than B").
  expected: "A_gt_B" | "A_lt_B";
  wording: string;
};

type GridFinishClaim = ExplicitPositionClaim | DeltaClaim | ComparativeClaim;

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

function getString(row: FactContractRow, keys: ReadonlyArray<string>): string | null {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const raw = (row as Record<string, unknown>)[key];
      if (typeof raw === "string" && raw.length > 0) return raw;
    }
  }
  return null;
}

function getNumberFromKeys(
  row: FactContractRow,
  keys: ReadonlyArray<string>
): number | null {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const raw = (row as Record<string, unknown>)[key];
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    }
  }
  return null;
}

function findRowByDriverToken(
  rows: ReadonlyArray<FactContractRow>,
  token: string
): FactContractRow | null {
  const lower = token.toLowerCase();
  for (const row of rows) {
    const name = getString(row, DRIVER_NAME_KEYS);
    if (!name) continue;
    const lowerName = name.toLowerCase();
    if (lowerName === lower) return row;
    const pieces = lowerName.split(/[\s\-']+/).filter((p) => p.length > 0);
    if (pieces.some((p) => p === lower)) return row;
  }
  return null;
}

function getSignedDelta(row: FactContractRow): number | null {
  const explicit = getNumberFromKeys(row, SIGNED_DELTA_KEYS);
  if (explicit !== null) return explicit;
  const grid = getNumberFromKeys(row, GRID_KEYS);
  const finish = getNumberFromKeys(row, FINISH_KEYS);
  if (grid !== null && finish !== null) return grid - finish;
  return null;
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

// Find the nearest capitalized driver-name token appearing before `position`
// in the same sentence. Returns null if no candidate exists.
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

function parseClaims(text: string): GridFinishClaim[] {
  const claims: GridFinishClaim[] = [];
  if (typeof text !== "string" || text.length === 0) return claims;

  // ---- Comparative claims (parsed first so they don't get mis-bucketed) ----
  const compGainedMore = new RegExp(
    `\\b${NAME}\\s+(?:gained|climbed|advanced|moved\\s+up)\\s+more\\s+(?:places?|positions?|spots?)\\s+than\\s+${NAME}\\b`,
    "g"
  );
  const compGainedFewer = new RegExp(
    `\\b${NAME}\\s+(?:gained|climbed|advanced|moved\\s+up)\\s+fewer\\s+(?:places?|positions?|spots?)\\s+than\\s+${NAME}\\b`,
    "g"
  );
  const compLostMore = new RegExp(
    `\\b${NAME}\\s+(?:lost|dropped|fell|slipped|moved\\s+down)\\s+more\\s+(?:places?|positions?|spots?)\\s+than\\s+${NAME}\\b`,
    "g"
  );
  const compLostFewer = new RegExp(
    `\\b${NAME}\\s+(?:lost|dropped|fell|slipped|moved\\s+down)\\s+fewer\\s+(?:places?|positions?|spots?)\\s+than\\s+${NAME}\\b`,
    "g"
  );

  for (const m of execAll(compGainedMore, text)) {
    claims.push({
      kind: "comparative",
      driverTokenA: m[1],
      driverTokenB: m[2],
      expected: "A_gt_B",
      wording: m[0]
    });
  }
  for (const m of execAll(compGainedFewer, text)) {
    claims.push({
      kind: "comparative",
      driverTokenA: m[1],
      driverTokenB: m[2],
      expected: "A_lt_B",
      wording: m[0]
    });
  }
  for (const m of execAll(compLostMore, text)) {
    claims.push({
      kind: "comparative",
      driverTokenA: m[1],
      driverTokenB: m[2],
      expected: "A_lt_B",
      wording: m[0]
    });
  }
  for (const m of execAll(compLostFewer, text)) {
    claims.push({
      kind: "comparative",
      driverTokenA: m[1],
      driverTokenB: m[2],
      expected: "A_gt_B",
      wording: m[0]
    });
  }

  // ---- Delta claims ("gained 4 places", "lost 2 positions", etc.) ----
  // The phrase patterns omit the driver token; the driver is resolved by
  // looking back in the same sentence to the nearest capitalized name. This
  // lets a single subject attach to multiple verbs in a sentence like
  // "Verstappen started P5 and finished P3".
  const gainedPhrase = new RegExp(
    `\\b(?:gained|climbed|advanced)\\s+${POS}\\s+(?:places?|positions?|spots?)\\b`,
    "g"
  );
  const movedUpPhrase = new RegExp(
    `\\bmoved\\s+up\\s+${POS}\\s+(?:places?|positions?|spots?)\\b`,
    "g"
  );
  const lostPhrase = new RegExp(
    `\\b(?:lost|dropped|fell|slipped)\\s+${POS}\\s+(?:places?|positions?|spots?)\\b`,
    "g"
  );
  const movedDownPhrase = new RegExp(
    `\\bmoved\\s+down\\s+${POS}\\s+(?:places?|positions?|spots?)\\b`,
    "g"
  );

  const pushDelta = (m: RegExpExecArray, sign: 1 | -1) => {
    const driverToken = nearestPriorDriverToken(text, m.index);
    if (!driverToken) return;
    claims.push({
      kind: "delta",
      driverToken,
      signedDelta: sign * Number(m[1]),
      wording: m[0]
    });
  };

  for (const m of execAll(gainedPhrase, text)) pushDelta(m, 1);
  for (const m of execAll(movedUpPhrase, text)) pushDelta(m, 1);
  for (const m of execAll(lostPhrase, text)) pushDelta(m, -1);
  for (const m of execAll(movedDownPhrase, text)) pushDelta(m, -1);

  // ---- Explicit position claims ----
  // Same lookback strategy as deltas: phrase patterns first, then resolve the
  // driver from the most recent capitalized name in the current sentence.
  const startedPhrase = new RegExp(
    `\\b(?:started|qualified)(?:\\s+from)?(?:\\s+in)?(?:\\s+on\\s+the\\s+grid(?:\\s+in)?)?\\s+(?:${P}|${GRID})\\s*${POS}\\b`,
    "g"
  );
  const finishedPPhrase = new RegExp(
    `\\bfinished\\s+(?:in\\s+)?${P}\\s*${POS}\\b`,
    "g"
  );
  const finishedOrdinalPhrase = new RegExp(
    `\\bfinished\\s+(?:in\\s+)?${POS}(?:st|nd|rd|th)\\b`,
    "g"
  );
  // "X moved/went/climbed/dropped from grid 7 to P2" — captures both grid + finish.
  const fromGridToPhrase = new RegExp(
    `\\b(?:moved|went|climbed|dropped|came|advanced)?\\s*from\\s+(?:${P}|${GRID})\\s*${POS}\\s+to\\s+(?:${P}|finish\\s+)?${POS}\\b`,
    "g"
  );

  const pushExplicit = (m: RegExpExecArray, field: "grid" | "finish") => {
    const driverToken = nearestPriorDriverToken(text, m.index);
    if (!driverToken) return;
    claims.push({
      kind: "explicit_position",
      driverToken,
      field,
      position: Number(m[1])
    });
  };

  for (const m of execAll(startedPhrase, text)) pushExplicit(m, "grid");
  for (const m of execAll(finishedPPhrase, text)) pushExplicit(m, "finish");
  for (const m of execAll(finishedOrdinalPhrase, text)) pushExplicit(m, "finish");
  for (const m of execAll(fromGridToPhrase, text)) {
    const driverToken = nearestPriorDriverToken(text, m.index);
    if (!driverToken) continue;
    claims.push({
      kind: "explicit_position",
      driverToken,
      field: "grid",
      position: Number(m[1])
    });
    claims.push({
      kind: "explicit_position",
      driverToken,
      field: "finish",
      position: Number(m[2])
    });
  }

  return claims;
}

export function validateGridFinish(
  answerText: string,
  contract: FactContract
): GridFinishValidationResult {
  const reasons: string[] = [];
  const rows = contract.rows ?? [];
  const claims = parseClaims(answerText);

  if (claims.length === 0) {
    return { ok: true, reasons: [] };
  }

  const hasAnyGridFinishColumn =
    rowsHaveAnyKey(rows, GRID_KEYS) ||
    rowsHaveAnyKey(rows, FINISH_KEYS) ||
    rowsHaveAnyKey(rows, SIGNED_DELTA_KEYS);

  if (!hasAnyGridFinishColumn) {
    reasons.push("no grid_position/finish_position/positions_gained column to derive from");
    return { ok: false, reasons };
  }

  for (const claim of claims) {
    if (claim.kind === "explicit_position") {
      const row = findRowByDriverToken(rows, claim.driverToken);
      if (!row) {
        reasons.push(
          `kind=explicit_position, driver=${claim.driverToken}: no contract row matches this driver`
        );
        continue;
      }
      const actual =
        claim.field === "grid"
          ? getNumberFromKeys(row, GRID_KEYS)
          : getNumberFromKeys(row, FINISH_KEYS);
      if (actual === null) {
        reasons.push(
          `kind=explicit_position, driver=${claim.driverToken}, field=${claim.field}: contract row has no ${claim.field}_position column`
        );
        continue;
      }
      if (actual !== claim.position) {
        reasons.push(
          `kind=explicit_position, driver=${claim.driverToken}, field=${claim.field} claim P${claim.position} does not match contract value P${actual}`
        );
      }
    } else if (claim.kind === "delta") {
      const row = findRowByDriverToken(rows, claim.driverToken);
      if (!row) {
        reasons.push(
          `kind=delta, driver=${claim.driverToken}: no contract row matches this driver`
        );
        continue;
      }
      const actualDelta = getSignedDelta(row);
      if (actualDelta === null) {
        reasons.push(
          `kind=delta, driver=${claim.driverToken}: contract row has no signed delta (positions_gained / grid+finish) to derive from`
        );
        continue;
      }
      if (actualDelta !== claim.signedDelta) {
        reasons.push(
          `kind=delta, driver=${claim.driverToken} claim signed_delta=${claim.signedDelta} (from "${claim.wording}") does not match contract signed_delta=${actualDelta}`
        );
      }
    } else if (claim.kind === "comparative") {
      const rowA = findRowByDriverToken(rows, claim.driverTokenA);
      const rowB = findRowByDriverToken(rows, claim.driverTokenB);
      if (!rowA || !rowB) {
        const missing = [
          rowA ? null : claim.driverTokenA,
          rowB ? null : claim.driverTokenB
        ].filter((v): v is string => v !== null);
        reasons.push(
          `kind=comparative, drivers=${claim.driverTokenA} vs ${claim.driverTokenB}: no contract row matches ${missing.join(" and ")}`
        );
        continue;
      }
      const deltaA = getSignedDelta(rowA);
      const deltaB = getSignedDelta(rowB);
      if (deltaA === null || deltaB === null) {
        reasons.push(
          `kind=comparative, drivers=${claim.driverTokenA} vs ${claim.driverTokenB}: contract rows lack signed delta to derive from`
        );
        continue;
      }
      const ordering: "A_gt_B" | "A_lt_B" | "A_eq_B" =
        deltaA > deltaB ? "A_gt_B" : deltaA < deltaB ? "A_lt_B" : "A_eq_B";
      if (ordering !== claim.expected) {
        reasons.push(
          `kind=comparative, drivers=${claim.driverTokenA} vs ${claim.driverTokenB} claim "${claim.wording}" expects ${claim.expected} but contract deltas are A=${deltaA}, B=${deltaB}`
        );
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}
