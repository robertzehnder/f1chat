import type { FactContract } from "@/lib/contracts/factContract";

export type ValidationResult = {
  ok: boolean;
  reasons: string[];
};

const PIT_STOP_COUNT_RE = /\b(\d+)\s+pit\s+stops?\b/i;
const STINT_COUNT_RE = /\b(\d+)\s+stints?\b/i;
const UNDERCUT_OVERCUT_RE = /\b(?:undercut|overcut)\b/i;

const PIT_STOP_ROW_KEYS = ["pit_stops", "pit_count", "n_pit_stops", "num_pit_stops"];
const STINT_ROW_KEYS = ["stints", "stint_count", "n_stints", "num_stints"];
const POSITION_CHANGE_ROW_KEYS = [
  "position_change",
  "position_delta",
  "positions_gained",
  "positions_lost",
  "net_position_change"
];
const POSITION_PAIR_KEY_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["grid", "finish"],
  ["grid_position", "finish_position"],
  ["start_position", "finish_position"]
];

function rowsHaveAnyKey(
  rows: FactContract["rows"],
  keys: ReadonlyArray<string>
): boolean {
  for (const row of rows) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(row, key)) {
        return true;
      }
    }
  }
  return false;
}

function rowsHavePositionPair(rows: FactContract["rows"]): boolean {
  for (const row of rows) {
    for (const [a, b] of POSITION_PAIR_KEY_PAIRS) {
      if (
        Object.prototype.hasOwnProperty.call(row, a) &&
        Object.prototype.hasOwnProperty.call(row, b)
      ) {
        return true;
      }
    }
  }
  return false;
}

export function validatePitStints(
  answerText: string,
  contract: FactContract
): ValidationResult {
  const reasons: string[] = [];
  const text = typeof answerText === "string" ? answerText : "";
  const rows = contract.rows ?? [];

  const pitStopMatch = text.match(PIT_STOP_COUNT_RE);
  const stintMatch = text.match(STINT_COUNT_RE);
  const claimsUndercut = UNDERCUT_OVERCUT_RE.test(text);

  const claimedPitStops = pitStopMatch ? Number(pitStopMatch[1]) : null;
  const claimedStints = stintMatch ? Number(stintMatch[1]) : null;

  if (
    claimedPitStops !== null &&
    claimedStints !== null &&
    Number.isFinite(claimedPitStops) &&
    Number.isFinite(claimedStints) &&
    claimedPitStops !== claimedStints - 1
  ) {
    reasons.push(
      `pit-stop count (${claimedPitStops}) inconsistent with stint count (${claimedStints}); expected pit_stops = stints - 1`
    );
  }

  if (claimsUndercut) {
    const hasPositionEvidence =
      rowsHaveAnyKey(rows, POSITION_CHANGE_ROW_KEYS) || rowsHavePositionPair(rows);
    if (!hasPositionEvidence) {
      reasons.push(
        "answer claims undercut/overcut but contract rows expose no position-change evidence (no position_change/position_delta/positions_gained or grid/finish columns)"
      );
    }
  }

  if (claimedPitStops !== null && Number.isFinite(claimedPitStops)) {
    const hasPitStopEvidence =
      rowsHaveAnyKey(rows, PIT_STOP_ROW_KEYS) ||
      rowsHaveAnyKey(rows, STINT_ROW_KEYS);
    if (!hasPitStopEvidence) {
      reasons.push(
        `answer asserts ${claimedPitStops} pit stops but contract rows expose no pit_stops/stints column to derive the count`
      );
    }
  }

  return { ok: reasons.length === 0, reasons };
}
