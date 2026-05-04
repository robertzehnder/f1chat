// Phase 19-A (rev3): deterministic pre-SQL keyword guard for the
// proactive `no_data_refusal` route. Phrase-level (not bare-token) so
// legitimate analytics phrasings like "how late does Norris brake at
// Turn 1", "fuel-corrected pace", "slipstream on the main straight" do
// NOT trip the guard. Whole-phrase, case-insensitive, with arbitrary
// whitespace between words.
//
// Co-located in its own module so unit tests can import the detector
// without dragging in the full chatRuntime DB dependency graph.

export const PROPRIETARY_NO_DATA_TOPICS: ReadonlyArray<string> = [
  "brake temperature",
  "brake temperatures",
  "brake temp",
  "brake temps",
  "tyre temperature",
  "tyre temperatures",
  "tire temperature",
  "tire temperatures",
  "battery state",
  "battery states",
  "battery soc",
  "battery charge",
  "battery charges",
  "ers deployment",
  "ers deployments",
  "ers harvest",
  "ers harvests",
  "fuel mass",
  "fuel burn",
  "fuel load",
  "fuel loads",
  "steering angle",
  "steering angles",
  "slip angle",
  "slip angles",
  "slip ratio",
  "slip ratios",
  "damage state",
  "damage states",
  "front-wing damage",
  "front wing damage",
  "engine rpm",
  "engine rpms",
  "shift map",
  "shift maps",
  "differential setting",
  "differential settings",
  "diff setting",
  "diff settings"
];

// Reasons map. Plural variants alias their singular reason.
const _BRAKE_TEMP = "Brake temperatures are team-internal telemetry not published in the public timing feed.";
const _TYRE_TEMP = "Tyre surface/carcass temperatures are team-internal telemetry, not in the public feed.";
const _BATTERY_SOC = "Battery state-of-charge is team-internal data not published publicly.";
const _BATTERY_CHARGE = "Battery charge level is team-internal data not published publicly.";
const _ERS_DEPLOY = "Per-lap ERS deployment is team-internal strategy data not in the public feed.";
const _ERS_HARVEST = "ERS harvest is team-internal strategy data not in the public feed.";
const _FUEL_LOAD = "Fuel load is team-internal data not published publicly.";
const _STEERING = "Steering-angle telemetry is team-internal, not exposed in the public timing feed.";
const _SLIP_ANGLE = "Slip-angle telemetry is team-internal physics data, not in the public feed.";
const _SLIP_RATIO = "Slip-ratio telemetry is team-internal physics data, not in the public feed.";
const _DAMAGE = "Damage state is team-internal data not published publicly.";
const _WING_DAMAGE = "Wing-damage detail is team-internal data not published publicly.";
const _ENGINE_RPM = "Engine RPM telemetry is team-internal, not in the public feed.";
const _SHIFT_MAP = "Shift-map / gear-strategy detail is team-internal, not in the public feed.";
const _DIFF = "Differential settings are team-internal setup data, not in the public feed.";

export const PROPRIETARY_NO_DATA_REASONS: Record<string, string> = {
  "brake temperature": _BRAKE_TEMP,
  "brake temperatures": _BRAKE_TEMP,
  "brake temp": _BRAKE_TEMP,
  "brake temps": _BRAKE_TEMP,
  "tyre temperature": _TYRE_TEMP,
  "tyre temperatures": _TYRE_TEMP,
  "tire temperature": _TYRE_TEMP,
  "tire temperatures": _TYRE_TEMP,
  "battery state": _BATTERY_SOC,
  "battery states": _BATTERY_SOC,
  "battery soc": _BATTERY_SOC,
  "battery charge": _BATTERY_CHARGE,
  "battery charges": _BATTERY_CHARGE,
  "ers deployment": _ERS_DEPLOY,
  "ers deployments": _ERS_DEPLOY,
  "ers harvest": _ERS_HARVEST,
  "ers harvests": _ERS_HARVEST,
  "fuel mass": "Fuel mass on board is team-internal data not published publicly.",
  "fuel burn": "Per-lap fuel burn is team-internal data not published publicly.",
  "fuel load": _FUEL_LOAD,
  "fuel loads": _FUEL_LOAD,
  "steering angle": _STEERING,
  "steering angles": _STEERING,
  "slip angle": _SLIP_ANGLE,
  "slip angles": _SLIP_ANGLE,
  "slip ratio": _SLIP_RATIO,
  "slip ratios": _SLIP_RATIO,
  "damage state": _DAMAGE,
  "damage states": _DAMAGE,
  "front-wing damage": _WING_DAMAGE,
  "front wing damage": _WING_DAMAGE,
  "engine rpm": _ENGINE_RPM,
  "engine rpms": _ENGINE_RPM,
  "shift map": _SHIFT_MAP,
  "shift maps": _SHIFT_MAP,
  "differential setting": _DIFF,
  "differential settings": _DIFF,
  "diff setting": _DIFF,
  "diff settings": _DIFF
};

// Phrase match: all phrase tokens must appear in the message within a
// small window (5 tokens of slack beyond the phrase length) and IN
// ORDER. This catches "How much fuel did Verstappen burn" → "fuel
// burn" while still rejecting bare-token false-triggers ("brake" in
// "How late does Norris brake at Turn 1?" doesn't match because no
// proximity partner like "temperature"/"temp" appears).
//
// We also pre-build a contiguous-phrase fast path so the common case
// ("brake temperature at Turn 8") matches in one regex test.
const TOKEN_RE = /[a-z0-9]+/g;

type CompiledPattern = {
  keyword: string;
  tokens: string[];
  contiguous: RegExp;
};

const PROPRIETARY_PATTERNS: ReadonlyArray<CompiledPattern> = PROPRIETARY_NO_DATA_TOPICS.map(
  (keyword) => {
    const tokens = keyword.toLowerCase().match(TOKEN_RE) ?? [];
    const escaped = keyword
      .toLowerCase()
      .replace(/[\\.*+?^${}()|[\]]/g, "\\$&")
      .replace(/[\s-]+/g, "[\\s-]+");
    const contiguous = new RegExp(`(^|\\b)${escaped}(\\b|$)`, "i");
    return { keyword, tokens, contiguous };
  }
);

const PROXIMITY_SLACK = 5;

function tokensMatchInWindow(messageTokens: string[], phraseTokens: string[]): boolean {
  if (phraseTokens.length === 0) return false;
  const windowSize = phraseTokens.length + PROXIMITY_SLACK;
  for (let start = 0; start <= messageTokens.length - phraseTokens.length; start += 1) {
    let cursor = 0;
    const limit = Math.min(messageTokens.length, start + windowSize);
    for (let i = start; i < limit && cursor < phraseTokens.length; i += 1) {
      if (messageTokens[i] === phraseTokens[cursor]) {
        cursor += 1;
      }
    }
    if (cursor === phraseTokens.length) return true;
  }
  return false;
}

export function detectProprietaryNoDataMatch(message: string): {
  matchedKeyword: string;
  refusalReason: string;
} | null {
  const lower = message.toLowerCase();
  const messageTokens = lower.match(TOKEN_RE) ?? [];

  // Pass 1 — contiguous phrase match. Most proprietary asks read
  // contiguously ("brake temperature", "battery state") and we want a
  // deterministic, longest-phrase-wins ordering so we evaluate
  // PROPRIETARY_NO_DATA_TOPICS in declared order.
  for (const { keyword, contiguous } of PROPRIETARY_PATTERNS) {
    if (contiguous.test(lower)) {
      return {
        matchedKeyword: keyword,
        refusalReason: PROPRIETARY_NO_DATA_REASONS[keyword] ?? "No public data available."
      };
    }
  }

  // Pass 2 — windowed proximity match. Catches "How much fuel did
  // Verstappen burn" → "fuel burn" (tokens separated by 3 other
  // words). The window is tight enough that adjacency-negative
  // phrasings ("How late does Norris brake at Turn 1") don't trip
  // because their proximity partner (temperature/temp) is absent.
  for (const { keyword, tokens } of PROPRIETARY_PATTERNS) {
    if (tokens.length <= 1) continue;
    if (tokensMatchInWindow(messageTokens, tokens)) {
      return {
        matchedKeyword: keyword,
        refusalReason: PROPRIETARY_NO_DATA_REASONS[keyword] ?? "No public data available."
      };
    }
  }
  return null;
}
