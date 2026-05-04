// Phase 23 (slice 23-strategy-simulator): interactive "what if X had
// pitted on lap N?" — hits 22-alternative-strategy-sim at runtime.
// Codex audit specifically called out this surface as needing manual
// UX review BEFORE the analyticsv2 flag flips on for production —
// because the ML model is hit at runtime and confidence depends on
// scenario distance from training distribution.

import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/featureFlags";

export default function StrategySimulatorPage() {
  if (!isFeatureEnabled("analyticsv2_strategy_simulator")) notFound();
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto" }}>
      <h1>Strategy Simulator</h1>
      <p style={{ color: "#555" }}>
        PENDING — depends on 22-alternative-strategy-sim (ML model with held-out validation
        gate). 22-A runtime-model plumbing is shipped (this page will dispatch via
        <code> dispatchRuntimeModel(&apos;alternative_strategy_sim&apos;, &#123;...&#125;)</code> once the
        model lands).
      </p>
      <p style={{ color: "#888", fontSize: 12 }}>
        Codex audit note: this is the one Phase 23 surface that needs an explicit operator UX
        pass before flag-on, because the ML model is hit at runtime and confidence depends on
        scenario distance from the training distribution.
      </p>
    </main>
  );
}
