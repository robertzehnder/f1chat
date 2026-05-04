// Phase 22-G (slice 22-points-as-they-run): an "as-it-stands"
// championship points calculator. Codex audit: ship autonomously
// (FIA points formula is identity-stable — no statistical model).
// 22-A's runtime-model dispatch is the integration point.
//
// Inputs:
//   - finishingOrder: array of { driverNumber, position, fastestLap?,
//     dnf? } for the currently-running race (may be partial — e.g.
//     "if the race ends right now").
//   - sessionType: "race" | "sprint" — drives which points table
//     applies.
//
// Output: array of { driverNumber, points, awardedFastestLap }.
//
// The fastest-lap rule: 2025 regulations award +1 point to the driver
// who set the fastest lap, but only if that driver finished in the top
// 10 (race) / top 8 (sprint).

import type { RuntimeModel, RuntimeModelInput, RuntimeModelOutput } from "./index";

const RACE_POINTS: ReadonlyArray<number> = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const SPRINT_POINTS: ReadonlyArray<number> = [8, 7, 6, 5, 4, 3, 2, 1];

export type FinishingEntry = {
  driverNumber: number;
  position: number; // 1-based
  fastestLap?: boolean;
  dnf?: boolean;
};

export type AwardedPoints = {
  driverNumber: number;
  position: number;
  points: number;
  awardedFastestLap: boolean;
};

export function computePointsAsTheyRun(
  finishingOrder: ReadonlyArray<FinishingEntry>,
  sessionType: "race" | "sprint"
): AwardedPoints[] {
  const table = sessionType === "race" ? RACE_POINTS : SPRINT_POINTS;
  const fastestLapDriverNumber = finishingOrder.find((e) => e.fastestLap === true)?.driverNumber;
  const fastestLapAwardCutoff = sessionType === "race" ? 10 : 8;

  return finishingOrder.map((entry) => {
    if (entry.dnf === true) {
      return {
        driverNumber: entry.driverNumber,
        position: entry.position,
        points: 0,
        awardedFastestLap: false
      };
    }
    const idx = entry.position - 1;
    const positionPoints = idx >= 0 && idx < table.length ? table[idx] : 0;
    const eligibleForFlBonus =
      sessionType === "race"
        ? entry.position <= fastestLapAwardCutoff
        : entry.position <= fastestLapAwardCutoff;
    const isFastestLapDriver =
      fastestLapDriverNumber !== undefined && entry.driverNumber === fastestLapDriverNumber;
    const awardedFastestLap = sessionType === "race" && isFastestLapDriver && eligibleForFlBonus;
    const total = positionPoints + (awardedFastestLap ? 1 : 0);
    return {
      driverNumber: entry.driverNumber,
      position: entry.position,
      points: total,
      awardedFastestLap
    };
  });
}

// Integration as a runtime-model registry entry.
export const POINTS_AS_THEY_RUN_MODEL: RuntimeModel = {
  name: "points_as_they_run",
  description:
    "Phase 22-G: applies the FIA points formula to the supplied finishingOrder. Inputs: finishingOrder (JSON array of {driverNumber, position, fastestLap?, dnf?}), sessionType ('race'|'sprint'). Returns an array of {driverNumber, position, points, awardedFastestLap}.",
  keywords: [
    "points as they run",
    "if the race ended now",
    "championship points if",
    "current points standings",
    "points if the race ended"
  ],
  validateInput(input: RuntimeModelInput): string | null {
    const sessionType = input.sessionType;
    if (sessionType !== "race" && sessionType !== "sprint") {
      return "sessionType must be 'race' or 'sprint'";
    }
    const raw = input.finishingOrder as unknown;
    if (!Array.isArray(raw) || raw.length === 0) {
      return "finishingOrder must be a non-empty array";
    }
    return null;
  },
  async run(input: RuntimeModelInput): Promise<RuntimeModelOutput> {
    const sessionType = input.sessionType as "race" | "sprint";
    const order = input.finishingOrder as unknown as ReadonlyArray<FinishingEntry>;
    const awarded = computePointsAsTheyRun(order, sessionType);
    return {
      modelName: this.name,
      payload: {
        sessionType,
        rows: awarded,
        totalPoints: awarded.reduce((acc, e) => acc + e.points, 0)
      },
      elapsedMs: 0,
      confidence: 1.0,
      notes: "Identity model: applies FIA 2025 points formula directly."
    };
  }
};
