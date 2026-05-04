// Phase 23 (slice 23-driver-performance-card): 7-axis radar chart per
// driver per season. Depends on 21-driver-performance-7axis (Tier 4
// aggregator — ships LAST among Phase 21).

import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/featureFlags";

export default function DriverPerformanceCardPage() {
  if (!isFeatureEnabled("analyticsv2_driver_performance_card")) notFound();
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto" }}>
      <h1>Driver Performance Card</h1>
      <p style={{ color: "#555" }}>
        PENDING — depends on 21-driver-performance-7axis (Tier-4 aggregator that ships LAST
        in Phase 21 because it aggregates across 5 upstream slices). UI scaffold only;
        radar-chart wiring comes online once the 7-axis facade view populates.
      </p>
    </main>
  );
}
