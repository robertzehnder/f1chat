// Phase 23 (slice 23-track-dominance-map): track-dominance map per
// session per pair-of-drivers. Depends on 21-minisector-dominance and
// 21-track-dominance-gps; until those ship, the page renders the
// "PENDING" placeholder so an analyticsv2 flag-flip doesn't expose
// a broken surface.

import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/featureFlags";

export default function TrackDominanceMapPage() {
  if (!isFeatureEnabled("analyticsv2_track_dominance_map")) notFound();
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto" }}>
      <h1>Track Dominance Map</h1>
      <p style={{ color: "#555" }}>
        PENDING — depends on slice 21-minisector-dominance and 21-track-dominance-gps merging
        and analytics.minisector_dominance + analytics.track_dominance_gps refreshing on Neon.
        UI scaffold only; chart wiring comes online once the contracts are populated.
      </p>
      <p style={{ color: "#888", fontSize: 12 }}>
        Wiring path: server component fetches <code>analytics.minisector_dominance</code> for
        (sessionKey, driverNumberA, driverNumberB), maps minisector_index -&gt; dominant driver,
        renders the SVG track outline with per-minisector fill.
      </p>
    </main>
  );
}
