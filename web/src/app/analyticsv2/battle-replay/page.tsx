// Phase 23 (slice 23-battle-replay): time-series scrubber over a
// battle stretch with both drivers' telemetry. Depends on
// 21-battle-segments and 21-overtake-events.

import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/featureFlags";

export default function BattleReplayPage() {
  if (!isFeatureEnabled("analyticsv2_battle_replay")) notFound();
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto" }}>
      <h1>Battle Replay</h1>
      <p style={{ color: "#555" }}>
        PENDING — depends on 21-battle-segments + 21-overtake-events. The replay scrubber
        will pull battle windows from analytics.battle_segments and overlay both drivers&apos;
        speed traces from raw.car_data via the existing replay viewer wiring.
      </p>
    </main>
  );
}
