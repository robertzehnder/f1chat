#!/usr/bin/env node
/**
 * verify_draft.mjs — narrow provenance verifier (analyst design U3).
 *
 * Verifies ONLY what a deterministic gate can: every number in the draft
 * body resolves to the packet (provenance), sidecar references exist
 * (packet paths / moment ids), chronology in causal claims is consistent
 * with occurred/issued times, every content-contract beat is resolved, and
 * every sentence with causal language has a sidecar entry. It does NOT
 * judge entailment — that is the causal review gate (human, recorded in the
 * sidecar as accepted / qualified / rejected / unresolved). Publication
 * fails on any rejected or unresolved claim marked material.
 *
 * Usage: node scripts/analyst/verify_draft.mjs --dir ../analyst/2026_1293
 *   expects: packet.json, report.md, sidecar.json
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = process.argv.find((a, i) => process.argv[i - 1] === "--dir");
const packet = JSON.parse(readFileSync(resolve(dir, "packet.json"), "utf8"));
const sidecar = JSON.parse(readFileSync(resolve(dir, "sidecar.json"), "utf8"));
const report = readFileSync(resolve(dir, "report.md"), "utf8");
const body = report.split(/^##\s+(?:Traceability|Appendix|Sidecar)/im)[0];

const fails = [], warns = [];
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { fails.push(m); console.log(`  ❌ ${m}`); };
const warn = (m) => { warns.push(m); console.log(`  ⚠️  ${m}`); };

// ---- 1. every number in the body is in the packet (or whitelisted by the sidecar as arithmetic)
const packetNumbers = new Set();
(function walk(v) { if (v == null) return; if (typeof v === "number") { packetNumbers.add(String(v)); packetNumbers.add(v.toFixed(1)); packetNumbers.add(v.toFixed(3)); packetNumbers.add(String(Math.round(v))); } else if (typeof v === "string") { for (const m of v.matchAll(/\d+(?:\.\d+)?/g)) packetNumbers.add(m[0]); } else if (Array.isArray(v)) v.forEach(walk); else if (typeof v === "object") Object.values(v).forEach(walk); })(packet);
// derived-metric values AND attributed numbers (an attribution claim carries its source) count as provenance
const derived = new Set((sidecar.claims ?? []).flatMap((c) => (["derived_metric", "attribution"].includes(c.type) ? (c.values ?? []).map(String) : [])));
// Verbatim race-control quotes ARE provenance: strip any body substring that
// equals a packet message before scanning numbers (their times/lap refs live in the packet).
let scanBody = body;
const msgs = packet.timeline.events.map((e) => e.message).filter(Boolean);
for (const m of body.matchAll(/"([^"]+?)"/g)) {
  const quoted = m[1];
  if (quoted.length < 25) continue; // short quotes are not treated as record citations
  if (msgs.some((msg) => msg.includes(quoted))) scanBody = scanBody.split(quoted).join(" ");
  else bad(`quoted text is not a verbatim substring of any race-control message: "${quoted.slice(0, 60)}…"`);
}
const bodyNums = [...scanBody.replace(/\d{4}-\d{2}-\d{2}/g, "").matchAll(/\b\d+(?:[.:]\d+)?\b/g)].map((m) => m[0]);
const unresolvedNums = bodyNums.filter((n) => { const plain = n.replace(":", "."); return !packetNumbers.has(n) && !packetNumbers.has(plain) && !derived.has(n) && !derived.has(plain) && !["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "20", "2026"].includes(n); });
unresolvedNums.length ? bad(`numbers not in packet/derived: ${[...new Set(unresolvedNums)].join(", ")}`) : ok(`all ${bodyNums.length} numbers resolve to packet or sidecar derived metrics`);

// ---- 2. sidecar references exist
const momentIds = new Set(packet.candidate_moments.map((m) => m.id));
const getPath = (p) => p.split(".").reduce((o, k) => (o == null ? undefined : o[k.match(/^\d+$/) ? Number(k) : k]), packet);
let refBad = 0;
for (const c of sidecar.claims ?? []) {
  for (const r of c.refs ?? []) {
    if (r.startsWith("moment:")) { if (!momentIds.has(r.slice(7))) { bad(`claim ${c.id}: unknown moment ${r}`); refBad++; } }
    else if (r.startsWith("packet:")) { if (getPath(r.slice(7)) === undefined) { bad(`claim ${c.id}: packet path not found ${r}`); refBad++; } }
    else if (!r.startsWith("attributed:")) { bad(`claim ${c.id}: malformed ref ${r}`); refBad++; }
  }
  if (!(c.refs ?? []).length) { bad(`claim ${c.id}: no refs`); refBad++; }
}
if (!refBad) ok(`all sidecar references resolve (${(sidecar.claims ?? []).length} claims)`);

// ---- 3. causal language without a sidecar entry
const CAUSAL = /\b(because|since|due to|thanks to|handed|gave|allowed|cost (?:him|her|them)|proved decisive|turned the race|undone by|as a result|led to|meant that|so that|which is why|decided (?:the|it))\b/i;
const sentences = body.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) ?? [];
const causalSentences = sentences.filter((s) => CAUSAL.test(s));
const coveredTexts = (sidecar.claims ?? []).map((c) => (c.text ?? "").toLowerCase().slice(0, 40));
const uncovered = causalSentences.filter((s) => !coveredTexts.some((t) => t && s.toLowerCase().includes(t)));
uncovered.length ? bad(`${uncovered.length} causal sentence(s) without a sidecar claim:\n     - ${uncovered.map((s) => s.trim().slice(0, 100)).join("\n     - ")}`) : ok(`all ${causalSentences.length} causal sentences carry sidecar claims`);

// ---- 4. chronology: causal claims must not cite an issued-later event as cause of an earlier effect
const evById = Object.fromEntries(packet.timeline.events.map((e) => [e.id, e]));
for (const c of (sidecar.claims ?? []).filter((c) => c.type === "causal_interpretation" && c.cause_event && c.effect_lap != null)) {
  const ev = evById[c.cause_event];
  if (ev && (ev.occurred_lap ?? ev.issued_lap) != null && (ev.occurred_lap ?? ev.issued_lap) > c.effect_lap) bad(`claim ${c.id}: cause ${c.cause_event} (lap ${(ev.occurred_lap ?? ev.issued_lap)}) is later than its effect (lap ${c.effect_lap})`);
}
ok("chronology checks run on causal claims with cause_event/effect_lap");

// ---- 5. content contract resolution
const beats = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"];
const res = sidecar.contract ?? {};
const missing = beats.filter((b) => !res[b] || !["covered", "not material", "not available"].includes(res[b].status) || !res[b].reason);
missing.length ? bad(`contract beats unresolved or without reason: ${missing.join(", ")}`) : ok("all 10 contract beats resolved with reasons");
const c2 = res.C2; if (c2?.status === "covered" && !(c2.refs ?? []).some((r) => r.startsWith("moment:"))) bad("C2 (mechanism) covered without a moment reference");

// ---- 6. causal review gate outcomes
const causal = (sidecar.claims ?? []).filter((c) => c.type === "causal_interpretation");
const blocking = causal.filter((c) => c.material && ["rejected", "unresolved"].includes(c.review?.outcome));
const unreviewed = causal.filter((c) => !c.review?.outcome);
unreviewed.length ? bad(`${unreviewed.length} causal claim(s) without a review outcome`) : ok(`all ${causal.length} causal claims have review outcomes (${sidecar.review_mode ?? "unlabelled"})`);
blocking.length ? bad(`publication blocked: ${blocking.map((c) => c.id + ":" + c.review.outcome).join(", ")}`) : ok("no material causal claim rejected/unresolved");
for (const c of causal.filter((c) => c.review?.outcome === "qualified")) {
  if (c.review.qualification && !body.toLowerCase().includes(c.review.qualification.toLowerCase().slice(0, 30))) warn(`claim ${c.id} qualified but qualification text not found in draft`);
}

console.log(fails.length ? `\nVERIFY: FAIL (${fails.length})` : `\nVERIFY: PASS${warns.length ? ` (${warns.length} warning(s))` : ""}`);
process.exit(fails.length ? 1 : 0);
