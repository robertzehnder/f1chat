// Phase 23 entry page — landing for the analyticsv2 surfaces.
// Hidden behind the `analyticsv2` feature flag (see lib/featureFlags.ts).
// When the flag is OFF, the route returns 404; when ON, it renders the
// surface index linking to each of the 6 Phase 23 surfaces.

import { notFound } from "next/navigation";
import Link from "next/link";
import { isFeatureEnabled } from "@/lib/featureFlags";

const SURFACES: ReadonlyArray<{
  href: string;
  flag: Parameters<typeof isFeatureEnabled>[0];
  title: string;
  description: string;
  depends_on: string;
}> = [
  {
    href: "/analyticsv2/track-dominance-map",
    flag: "analyticsv2_track_dominance_map",
    title: "Track Dominance Map",
    description: "Per-session, per-pair-of-drivers track map colored by minisector dominance.",
    depends_on: "21-minisector-dominance, 21-track-dominance-gps"
  },
  {
    href: "/analyticsv2/corner-analysis",
    flag: "analyticsv2_corner_analysis_page",
    title: "Corner Analysis",
    description: "Picker: session + corner + drivers → entry / turn-in / mid / exit comparison.",
    depends_on: "21-corner-analysis, 21-braking-performance, 21-traction-analysis"
  },
  {
    href: "/analyticsv2/stint-degradation",
    flag: "analyticsv2_stint_degradation_chart",
    title: "Stint Degradation Chart",
    description: "Per-session, per-driver, lap-by-lap degradation curve overlay.",
    depends_on: "21-stint-degradation-curve, 22-tyre-deg-bayesian"
  },
  {
    href: "/analyticsv2/driver-performance-card",
    flag: "analyticsv2_driver_performance_card",
    title: "Driver Performance Card",
    description: "7-axis radar chart per driver per season.",
    depends_on: "21-driver-performance-7axis"
  },
  {
    href: "/analyticsv2/battle-replay",
    flag: "analyticsv2_battle_replay",
    title: "Battle Replay",
    description: "Time-series scrubber over a battle stretch with both drivers' telemetry.",
    depends_on: "21-battle-segments, 21-overtake-events"
  },
  {
    href: "/analyticsv2/strategy-simulator",
    flag: "analyticsv2_strategy_simulator",
    title: "Strategy Simulator",
    description: "Interactive 'what if X had pitted on lap N?' hitting 22-alternative-strategy-sim.",
    depends_on: "22-alternative-strategy-sim, 22-A-runtime-model-tool-plumbing"
  }
];

export default function AnalyticsV2IndexPage() {
  if (!isFeatureEnabled("analyticsv2")) {
    notFound();
  }

  return (
    <main style={{ padding: "24px", fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 8 }}>OpenF1 Analytics v2</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        Phase 23 broadcast-style analytics surfaces. Each surface is gated by its own
        per-surface feature flag (<code>OPENF1_FEATURE_ANALYTICSV2_&lt;NAME&gt;</code>) so partial
        rollouts are first-class. Surfaces marked &ldquo;PENDING&rdquo; depend on a Phase 21 or 22 slice
        that hasn&apos;t merged yet.
      </p>
      <div style={{ display: "grid", gap: 12 }}>
        {SURFACES.map((s) => {
          const enabled = isFeatureEnabled(s.flag);
          return (
            <article
              key={s.href}
              style={{
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: 16,
                opacity: enabled ? 1 : 0.5
              }}
            >
              <h2 style={{ marginBottom: 4 }}>
                {enabled ? <Link href={s.href}>{s.title}</Link> : s.title}{" "}
                {!enabled && <span style={{ fontSize: 12, color: "#888" }}>(flag off)</span>}
              </h2>
              <p style={{ color: "#444", marginBottom: 4 }}>{s.description}</p>
              <p style={{ fontSize: 12, color: "#888", marginBottom: 0 }}>
                depends on: <code>{s.depends_on}</code>
              </p>
            </article>
          );
        })}
      </div>
    </main>
  );
}
