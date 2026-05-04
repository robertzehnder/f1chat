// Phase 23 (slice 23-corner-analysis-page): picker for session +
// corner + drivers, comparing entry / turn-in / mid / exit phases.
// Depends on 21-corner-analysis, 21-braking-performance,
// 21-traction-analysis.

import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/featureFlags";

export default function CornerAnalysisPage() {
  if (!isFeatureEnabled("analyticsv2_corner_analysis_page")) notFound();
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto" }}>
      <h1>Corner Analysis</h1>
      <p style={{ color: "#555" }}>
        PENDING — depends on 21-corner-analysis, 21-braking-performance, and
        21-traction-analysis facade views being live on Neon.
      </p>
      <p style={{ color: "#888", fontSize: 12 }}>
        Wiring path: pickers (session, corner from f1.track_segments WHERE segment_kind=&apos;corner&apos;,
        2 drivers) -&gt; server fetch from analytics.corner_analysis JOIN braking + traction
        on (session_key, driver_number, corner_id). Render entry / apex / exit speeds in a
        small-multiples chart.
      </p>
    </main>
  );
}
