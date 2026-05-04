// Phase 23 feature-flag gate. Codex audit said Phase 23 ships as
// (b) one-command runner with feature-flag gate — production blast
// radius = 0 until the flag flips. Slices land their UI under
// `analyticsv2` and the operator's only touchpoint is the FIRST
// flag flip on the first surface (to validate end-to-end UX);
// subsequent surfaces are autonomous within the flagged scope.

export type FeatureFlag =
  | "analyticsv2"             // Phase 23 surfaces (track-dominance map, corner-analysis page, etc.)
  | "analyticsv2_track_dominance_map"
  | "analyticsv2_corner_analysis_page"
  | "analyticsv2_stint_degradation_chart"
  | "analyticsv2_driver_performance_card"
  | "analyticsv2_battle_replay"
  | "analyticsv2_strategy_simulator";

const ENV_PREFIX = "OPENF1_FEATURE_";

/**
 * Read a feature flag from the runtime environment. Server-side only —
 * client components must read from a server boundary (page.tsx /
 * route.ts) and pass the value down as a prop.
 *
 * Flag conventions:
 *   - The umbrella `analyticsv2` flag turns ON every Phase 23 surface
 *     when set to `1` / `true`.
 *   - Per-surface flags override the umbrella when set, so partial
 *     rollouts (e.g. ship the corner-analysis-page first, gate the
 *     strategy-simulator behind operator review) are first-class.
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  // Per-surface flag, when explicitly set, wins over the umbrella.
  const perSurface = process.env[`${ENV_PREFIX}${flag.toUpperCase()}`];
  if (perSurface !== undefined && perSurface !== "") {
    return /^(1|true|yes|on)$/i.test(perSurface);
  }
  if (flag === "analyticsv2") {
    const umbrella = process.env[`${ENV_PREFIX}ANALYTICSV2`];
    return /^(1|true|yes|on)$/i.test(String(umbrella ?? ""));
  }
  // For per-surface flags that didn't override, fall through to the
  // umbrella.
  const umbrella = process.env[`${ENV_PREFIX}ANALYTICSV2`];
  return /^(1|true|yes|on)$/i.test(String(umbrella ?? ""));
}
