import type { FactContract, FactContractRow } from "@/lib/contracts/factContract";

export type SectorConsistencyValidationResult = {
  ok: boolean;
  reasons: string[];
};

type SectorIndex = 1 | 2 | 3;
type ClaimKind = "best" | "avg" | "per_lap" | "fastest";

type SectorClaim = {
  kind: ClaimKind;
  sector: SectorIndex;
  value: number;
  lapNumber?: number;
};

const TOLERANCE_S = 0.05;

function parseClaims(text: string): SectorClaim[] {
  const claims: SectorClaim[] = [];
  if (typeof text !== "string" || text.length === 0) return claims;

  const NUM = "(\\d+(?:\\.\\d+)?)";
  // best S{i} ... X(s)? OR S{i} best ... X(s)?
  const bestPatterns: RegExp[] = [
    new RegExp(`\\bbest\\s+s(?:ector)?\\s*([123])\\b[^\\d]*${NUM}\\s*s?\\b`, "gi"),
    new RegExp(`\\bs(?:ector)?\\s*([123])\\s+best\\b[^\\d]*${NUM}\\s*s?\\b`, "gi"),
  ];
  const fastestPatterns: RegExp[] = [
    new RegExp(`\\bfastest\\s+s(?:ector)?\\s*([123])\\b[^\\d]*${NUM}\\s*s?\\b`, "gi"),
  ];
  const avgPatterns: RegExp[] = [
    new RegExp(`\\b(?:average|avg|mean)\\s+s(?:ector)?\\s*([123])\\b[^\\d]*${NUM}\\s*s?\\b`, "gi"),
  ];
  // S{i} (was|on) lap N ... X(s)?  -- not a per_lap claim's exact shape; the
  // canonical per_lap shapes are:
  //   "lap N S{i} ... X"          -> capture order: N, sector, value
  //   "S{i} on lap N ... X"        -> capture order: sector, N, value
  //   "S{i} was X on lap N"        -> capture order: sector, value, N
  const perLapNFirstPatterns: RegExp[] = [
    new RegExp(`\\blap\\s+(\\d+)\\s+s(?:ector)?\\s*([123])\\b[^\\d]*${NUM}\\s*s?\\b`, "gi"),
  ];
  const perLapSectorOnLapPatterns: RegExp[] = [
    new RegExp(`\\bs(?:ector)?\\s*([123])\\s+on\\s+lap\\s+(\\d+)\\b[^\\d]*${NUM}\\s*s?\\b`, "gi"),
  ];
  const perLapSectorWasOnLapPatterns: RegExp[] = [
    new RegExp(`\\bs(?:ector)?\\s*([123])\\s+was\\s+${NUM}\\s*s?\\s+on\\s+lap\\s+(\\d+)\\b`, "gi"),
  ];

  const pushNumeric = (kind: ClaimKind, sectorRaw: string, valueRaw: string, lapRaw?: string) => {
    const sector = Number(sectorRaw);
    const value = Number(valueRaw);
    if (!Number.isFinite(value)) return;
    if (sector !== 1 && sector !== 2 && sector !== 3) return;
    const claim: SectorClaim = { kind, sector: sector as SectorIndex, value };
    if (lapRaw !== undefined) {
      const lap = Number(lapRaw);
      if (!Number.isFinite(lap)) return;
      claim.lapNumber = lap;
    }
    claims.push(claim);
  };

  for (const re of bestPatterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      pushNumeric("best", m[1], m[2]);
    }
  }
  for (const re of fastestPatterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      pushNumeric("fastest", m[1], m[2]);
    }
  }
  for (const re of avgPatterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      pushNumeric("avg", m[1], m[2]);
    }
  }
  for (const re of perLapNFirstPatterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // groups: lapN, sector, value
      pushNumeric("per_lap", m[2], m[3], m[1]);
    }
  }
  for (const re of perLapSectorOnLapPatterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // groups: sector, lapN, value
      pushNumeric("per_lap", m[1], m[3], m[2]);
    }
  }
  for (const re of perLapSectorWasOnLapPatterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // groups: sector, value, lapN
      pushNumeric("per_lap", m[1], m[2], m[3]);
    }
  }

  return claims;
}

function getNumber(row: FactContractRow, key: string): number | null {
  if (!Object.prototype.hasOwnProperty.call(row, key)) return null;
  const raw = (row as Record<string, unknown>)[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
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

function collectColumn(
  rows: ReadonlyArray<FactContractRow>,
  key: string
): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const v = getNumber(row, key);
    if (v !== null) out.push(v);
  }
  return out;
}

function withinTolerance(value: number, candidates: ReadonlyArray<number>): boolean {
  for (const c of candidates) {
    if (Math.abs(value - c) <= TOLERANCE_S) return true;
  }
  return false;
}

function formatCandidates(candidates: ReadonlyArray<number>): string {
  return candidates.map((c) => c.toFixed(3)).join(", ");
}

export function validateSectorConsistency(
  answerText: string,
  contract: FactContract
): SectorConsistencyValidationResult {
  const reasons: string[] = [];
  const rows = contract.rows ?? [];
  const claims = parseClaims(answerText);

  if (claims.length === 0) {
    return { ok: true, reasons: [] };
  }

  const hasAnySectorColumn =
    rowsHaveAnyKey(rows, ["best_s1", "best_s2", "best_s3"]) ||
    rowsHaveAnyKey(rows, ["avg_s1", "avg_s2", "avg_s3"]) ||
    rowsHaveAnyKey(rows, ["duration_sector_1", "duration_sector_2", "duration_sector_3"]);

  if (!hasAnySectorColumn) {
    reasons.push("no sector column to derive from");
    return { ok: false, reasons };
  }

  for (const claim of claims) {
    const i = claim.sector;
    const bestKey = `best_s${i}`;
    const avgKey = `avg_s${i}`;
    const lapKey = `duration_sector_${i}`;

    if (claim.kind === "best" || claim.kind === "fastest") {
      const bestValues = collectColumn(rows, bestKey);
      const lapValues = collectColumn(rows, lapKey);
      const candidates: number[] = [];
      if (bestValues.length > 0) {
        candidates.push(...bestValues);
      } else if (lapValues.length > 0) {
        candidates.push(Math.min(...lapValues));
      } else {
        reasons.push(
          `no best_s${i} or duration_sector_${i} column to derive best from`
        );
        continue;
      }
      if (!withinTolerance(claim.value, candidates)) {
        reasons.push(
          `kind=${claim.kind}, sector=${i} claim ${claim.value.toFixed(3)}s does not match derived best [${formatCandidates(candidates)}]`
        );
      }
    } else if (claim.kind === "avg") {
      const avgValues = collectColumn(rows, avgKey);
      const lapValues = collectColumn(rows, lapKey);
      const candidates: number[] = [];
      if (avgValues.length > 0) {
        candidates.push(...avgValues);
      } else if (lapValues.length > 0) {
        const sum = lapValues.reduce((acc, v) => acc + v, 0);
        candidates.push(sum / lapValues.length);
      } else {
        reasons.push(
          `no avg_s${i} or duration_sector_${i} column to derive average from`
        );
        continue;
      }
      if (!withinTolerance(claim.value, candidates)) {
        reasons.push(
          `kind=avg, sector=${i} claim ${claim.value.toFixed(3)}s does not match derived average [${formatCandidates(candidates)}]`
        );
      }
    } else if (claim.kind === "per_lap") {
      const lapNumber = claim.lapNumber;
      if (lapNumber === undefined || !Number.isFinite(lapNumber)) {
        reasons.push(
          `kind=per_lap, sector=${i} claim missing lap number`
        );
        continue;
      }
      const anyRowHasLapNumber = rows.some((row) =>
        Object.prototype.hasOwnProperty.call(row, "lap_number")
      );
      if (!anyRowHasLapNumber) {
        reasons.push(
          `contract rows lack lap_number; cannot validate per-lap claim for S${i}`
        );
        continue;
      }
      const matched = rows.find((row) => getNumber(row, "lap_number") === lapNumber);
      if (!matched) {
        reasons.push(
          `no lap ${lapNumber} row to derive per-lap S${i} from`
        );
        continue;
      }
      const lapValue = getNumber(matched, lapKey);
      if (lapValue === null) {
        reasons.push(
          `lap ${lapNumber} row has no duration_sector_${i} column`
        );
        continue;
      }
      if (!withinTolerance(claim.value, [lapValue])) {
        reasons.push(
          `kind=per_lap, sector=${i}, lap=${lapNumber} claim ${claim.value.toFixed(3)}s does not match lap row's duration_sector_${i}=${lapValue.toFixed(3)}`
        );
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}
