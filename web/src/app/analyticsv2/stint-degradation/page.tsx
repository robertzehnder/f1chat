// Phase 23 (slice 23-stint-degradation-chart): per-session per-driver
// lap-by-lap degradation curve overlay. Depends on 21-stint-
// degradation-curve and 22-tyre-deg-bayesian (the Bayesian curve
// adds the credible-interval band).

import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/featureFlags";

export default function StintDegradationChartPage() {
  if (!isFeatureEnabled("analyticsv2_stint_degradation_chart")) notFound();
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto" }}>
      <h1>Stint Degradation Chart</h1>
      <p style={{ color: "#555" }}>
        PENDING — depends on 21-stint-degradation-curve facade and (for the credible-interval
        band) 22-tyre-deg-bayesian model. The Bayesian model needs operator review before
        shipping; the empirical curve from 21-stint-degradation-curve is sufficient for an
        initial flag-on.
      </p>
    </main>
  );
}
