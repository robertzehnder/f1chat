// Phase 5 of the v0 visualization match plan: replace the growing
// `detectChart()` if/else chain with a typed registry of detectors.
// Each detector is a single file under web/src/lib/mapInsight/detectors/
// exporting an object that conforms to ChartDetector.
//
// The registry runs detectors in priority order (highest first) and
// returns the first matching ChartSpec. Adapter tests assert by
// detector `id` so ambiguous shapes can be tested without coupling
// to specific column patterns.

import type { ChartSpec } from "@/lib/chart-types";

/**
 * Optional context the page handler can pass to detectors. Today only
 * questionType + generationSource are surfaced; future fields can be
 * added without breaking detectors that ignore them.
 */
export interface AdapterContext {
  questionType?: string;
  generationSource?: string;
  /** The user's question text — useful for shapes that need topic
   *  disambiguation (radar vs grouped_bar both have multi-numeric
   *  per-driver rows; question topic breaks the tie). */
  question?: string;
}

export interface ChartDetector {
  /** Unique id; used by adapter tests + the coverage report. */
  id: string;
  /** Higher priority wins when multiple detectors match. */
  priority: number;
  /** Returns true if the detector should fire on these rows. */
  matches(rows: Record<string, unknown>[], ctx: AdapterContext): boolean;
  /** Builds the ChartSpec from rows. Only called after matches() = true. */
  build(rows: Record<string, unknown>[], ctx: AdapterContext): ChartSpec;
  /** Fixture ids in the manifest this detector should resolve to.
   *  Used by the coverage-report tool. */
  fixtures: string[];
  /** Benchmark qids this detector handles. Pulled from the visualization
   *  brief's qid → mock-id lookup table (Phase 1 manifest). */
  benchmarkQids: number[];
}
