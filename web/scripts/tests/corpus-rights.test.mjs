// Corpus rights-control refusal tests (corpus plan G1 exit).
// Pure logic against an in-memory registry mirroring migration 061's seeded
// rows — every refusal path the plan's G1 gate names must throw, and the
// approved paths must pass. The DB round-trip lives in
// scripts/corpus/corpus_g1_check.mjs (needs Neon).

import test from "node:test";
import assert from "node:assert/strict";
import {
  RightsError,
  assertAcquireAllowed,
  assertUseAllowed,
  loadRegistryFromRows
} from "../corpus/lib/rights.mjs";

const registry = loadRegistryFromRows([
  {
    source_key: "the_race", kind: "rss", enabled: true, rights_state: "approved_private",
    approved_uses: ["style_research", "eval_reference"],
    allowed_methods: ["rss", "md_endpoint", "sitemap"],
    may_store_full_text: true, may_llm_process: true, retention_days: null, deletion_required: false
  },
  {
    source_key: "youtube:formula1", kind: "youtube", enabled: true, rights_state: "approved_private",
    approved_uses: ["style_research", "eval_reference"],
    allowed_methods: ["yt_dlp_captions"],
    may_store_full_text: true, may_llm_process: true, retention_days: 30, deletion_required: false
  },
  {
    source_key: "reddit", kind: "manual", enabled: false, rights_state: "prohibited",
    approved_uses: ["question_mining"], allowed_methods: [],
    may_store_full_text: false, may_llm_process: false, retention_days: null, deletion_required: true
  },
  {
    source_key: "x_exemplars", kind: "manual", enabled: true, rights_state: "approved_private",
    approved_uses: ["format_study"], allowed_methods: ["manual_inbox"],
    may_store_full_text: true, may_llm_process: false, retention_days: null, deletion_required: false
  },
  {
    source_key: "some_pending", kind: "rss", enabled: true, rights_state: "pending",
    approved_uses: ["style_research"], allowed_methods: ["rss"],
    may_store_full_text: true, may_llm_process: true, retention_days: null, deletion_required: false
  }
]);

const refuses = (fn) => assert.throws(fn, RightsError);

test("acquire: prohibited source refused", () => {
  refuses(() => assertAcquireAllowed(registry, "reddit", "manual_inbox"));
});

test("acquire: pending source refused", () => {
  refuses(() => assertAcquireAllowed(registry, "some_pending", "rss"));
});

test("acquire: disallowed method refused, allowed method passes", () => {
  refuses(() => assertAcquireAllowed(registry, "the_race", "html"));
  assert.equal(assertAcquireAllowed(registry, "the_race", "rss"), true);
});

test("acquire: unknown source (inbox sidecar with bogus source_key) refused", () => {
  refuses(() => assertAcquireAllowed(registry, "not_a_source", "manual_inbox"));
});

test("use: llm_process=false blocks a model call", () => {
  refuses(() => assertUseAllowed(registry, "x_exemplars", "llm_process", "format_study"));
});

test("use: store_full_text=false blocks artifact write AND text persistence", () => {
  refuses(() => assertUseAllowed(registry, "reddit", "store_full_text", "question_mining"));
});

test("use: disallowed purpose refused — format-study-only source x style_research", () => {
  refuses(() => assertUseAllowed(registry, "x_exemplars", "store_full_text", "style_research"));
  // its own declared purpose is fine for storage
  assert.equal(assertUseAllowed(registry, "x_exemplars", "store_full_text", "format_study"), true);
});

test("use: unknown use or purpose refused (no inference, fail closed)", () => {
  refuses(() => assertUseAllowed(registry, "the_race", "republish", "style_research"));
  refuses(() => assertUseAllowed(registry, "the_race", "store_full_text", "training"));
});

test("approved source approved purpose passes both uses", () => {
  assert.equal(assertUseAllowed(registry, "the_race", "store_full_text", "style_research"), true);
  assert.equal(assertUseAllowed(registry, "the_race", "llm_process", "eval_reference"), true);
  assert.equal(assertUseAllowed(registry, "youtube:formula1", "llm_process", "style_research"), true);
});
