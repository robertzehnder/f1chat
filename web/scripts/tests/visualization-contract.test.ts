// Phase 9 + 16 of the v0 visualization match plan: validates
// `diagnostic/v0_visualization_expectations.json` against the
// fixture manifest and the chart-detector registry. Every qid
// expectation must:
//   - have an `expected_visual` that's a real chart shape, hero,
//     verdict, refusal, or composite
//   - point to a fixture_id that exists in the manifest
//   - target an implemented (not follow-up) fixture, OR be marked
//     `allowed_fallback: true`
//
// This is the merge gate for "no implemented v0 chart type silently
// falls back to body/table" — the exact text from §4 of the merged
// plan.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { INSIGHT_FIXTURES, findFixtureById } from "../../src/__mocks__/insights/manifest";
import { CHART_DETECTORS } from "../../src/lib/mapInsight/detectors/registry";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const expectationsPath = path.resolve(__dirname, "../../../diagnostic/v0_visualization_expectations.json");

interface Expectation {
  qid: number;
  expected_visual: string;
  fixture_id: string;
  required_fields: string[];
  allowed_fallback: boolean;
}

function loadExpectations(): Expectation[] {
  const raw = JSON.parse(readFileSync(expectationsPath, "utf8")) as { expectations: Expectation[] };
  return raw.expectations;
}

const VALID_VISUALS = new Set([
  "hero",
  "verdict",
  "refusal",
  "composite",
  "metric-grid",
  // Plus every chart type from CHART_DETECTORS:
  ...CHART_DETECTORS.map((d) => d.id)
]);

test("expectations: every entry has a real expected_visual", () => {
  for (const e of loadExpectations()) {
    assert.ok(
      VALID_VISUALS.has(e.expected_visual),
      `qid ${e.qid}: expected_visual "${e.expected_visual}" not in {${[...VALID_VISUALS].join(", ")}}`
    );
  }
});

test("expectations: every fixture_id exists in the manifest", () => {
  for (const e of loadExpectations()) {
    const entry = findFixtureById(e.fixture_id);
    assert.ok(entry, `qid ${e.qid}: fixture_id "${e.fixture_id}" not in manifest`);
  }
});

test("expectations: follow-up fixtures must have allowed_fallback=true", () => {
  for (const e of loadExpectations()) {
    const entry = findFixtureById(e.fixture_id);
    if (!entry) continue;
    if (entry.status === "follow_up") {
      assert.ok(
        e.allowed_fallback,
        `qid ${e.qid} maps to follow-up fixture ${e.fixture_id}; must set allowed_fallback=true`
      );
    }
  }
});

test("expectations: chart-shape expectations have a matching detector", () => {
  // hero / verdict / refusal / metric-grid / composite are
  // shape-driven (Phase 3), not detector-driven, so they're exempt.
  const detectorOnlyShapes = ["hero", "verdict", "refusal", "composite", "metric-grid"];
  const detectorIds = new Set(CHART_DETECTORS.map((d) => d.id));
  for (const e of loadExpectations()) {
    if (detectorOnlyShapes.includes(e.expected_visual)) continue;
    if (e.allowed_fallback) continue;
    assert.ok(
      detectorIds.has(e.expected_visual),
      `qid ${e.qid}: chart-shape expectation "${e.expected_visual}" has no matching detector`
    );
  }
});

test("manifest: every implemented fixture has a renderer entry", () => {
  for (const entry of INSIGHT_FIXTURES) {
    if (entry.status === "follow_up") continue;
    assert.ok(entry.renderer, `${entry.id}: implemented fixtures must declare a renderer`);
  }
});

test("registry coverage: every chart-type detector lists at least one fixture", () => {
  for (const detector of CHART_DETECTORS) {
    if (detector.id === "composite") continue; // composite is shape-driven, fixtures attach via shape
    assert.ok(
      detector.fixtures.length > 0,
      `detector "${detector.id}" has no fixtures — orphan detector`
    );
  }
});
