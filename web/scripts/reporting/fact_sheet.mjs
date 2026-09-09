#!/usr/bin/env node
/**
 * fact_sheet.mjs — the list of facts a writer may cite, machine-built from the
 * packet, the context facts and the reporting file (automation plan W4).
 *
 *   node scripts/reporting/fact_sheet.mjs --meeting 2026_1292 [--pair NOR,ANT] [--out file.md]
 *
 * Every numeric line carries an id, the rendered value the prose must use,
 * the packet path the verifier binds it to, and its meaning. Reporting and
 * context lines carry the id the writer must cite (`reporting:<id>` /
 * `context:<id>`). Tier-3 posts are listed with text (from the raw store) as
 * SENTIMENT — paraphrase only, attribute by name, link the post.
 *
 * Output is markdown (stdout or --out) plus a JSON index next to it when
 * --out is given (<out>.json) for bind_claims.mjs.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT, parseMeeting, argOpt, readJson, readJsonl } from "./lib/common.mjs";

const { meeting } = parseMeeting(argOpt("meeting"));
const dir = join(ROOT, "analyst", meeting);
const packet = readJson(join(dir, "packet.json"), null);
if (!packet) { console.error(`no packet at ${dir}`); process.exit(1); }
const context = readJson(join(dir, "context.json"), null);
const reporting = readJson(join(dir, "reporting.json"), null);
const pairArg = argOpt("pair");

const surname = (acr) => { const d = packet.drivers.find((x) => x.acronym === acr); return d ? d.name.split(" ").slice(1).join(" ").replace(/\b([A-Z])([A-Z]+)/g, (_, a, b) => a + b.toLowerCase()) : acr; };
const ordinal = (n) => { const m = n % 100; const suf = m >= 11 && m <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] ?? "th"; return `${n}${suf}`; };
const fmt1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const lines = []; const index = [];
let n = 0;
const num = (value, path, meaning, render = null) => { n++; const id = `N${n}`; const r = render ?? String(value); lines.push(`${id.padEnd(5)} ${r.padEnd(10)} ${path.padEnd(44)} ${meaning}`); index.push({ id, value, render: r, path, meaning }); return id; };

lines.push(`# Fact sheet — ${packet.session.meeting_name} ${packet.session.year} (session ${packet.session.session_key}, ${packet.session.total_laps} laps)`);
lines.push("", "Every number the article uses MUST be one of the values below, rendered as shown, and cited by id. Numbers not on this sheet are refused by the binder.", "");

// ---- results
lines.push("## Results and grid (packet:results)");
for (const r of packet.results.filter((r) => r.position != null && r.position <= 10)) {
  const i = packet.results.indexOf(r);
  num(r.position, `results.${i}.position`, `${surname(r.driver)} finished ${ordinal(r.position)}`, ordinal(r.position));
  num(r.grid, `results.${i}.grid`, `${surname(r.driver)} started ${ordinal(r.grid)}`, ordinal(r.grid));
}
for (const r of packet.results.filter((r) => r.status === "DNF")) num(r.last_completed_lap, `results.${packet.results.indexOf(r)}.last_completed_lap`, `${surname(r.driver)} retired after lap ${r.last_completed_lap} (DNF)`);
num(packet.session.total_laps, "session.total_laps", "race distance in laps");
const winner = packet.results.find((r) => r.position === 1)?.driver;
const runnerUp = packet.results.find((r) => r.position === 2)?.driver;
const gapRow = packet.position_trace[runnerUp]?.at(-1);
if (gapRow?.gap != null) num(gapRow.gap, `position_trace.${runnerUp}.${packet.position_trace[runnerUp].length - 1}.gap`, `official margin: ${surname(runnerUp)} behind ${surname(winner)} at the flag (s)`, gapRow.gap.toFixed(3));
for (const f of packet.fastest_laps.slice(0, 1)) num(f.time_s, "fastest_laps.0.time_s", `fastest lap of the race: ${surname(f.driver)} on lap ${f.lap}`, `1m${(f.time_s - 60).toFixed(3)}s`), num(f.lap, "fastest_laps.0.lap", `lap of the fastest lap (${surname(f.driver)})`);
lines.push("");

// ---- cautions and lead changes
lines.push("## Racing state (packet:timeline.intervals) and lead changes (packet:lead_changes)");
packet.timeline.intervals.forEach((iv, i) => { num(iv.start_lap, `timeline.intervals.${i}.start_lap`, `${iv.kind.toUpperCase()} began lap`); num(iv.end_lap, `timeline.intervals.${i}.end_lap`, `${iv.kind.toUpperCase()} ended lap${iv.endpoint_inferred ? ` (end INFERRED: ${iv.endpoint_inferred})` : ""}`); });
packet.lead_changes.forEach((lc, i) => num(lc.lap, `lead_changes.${i}.lap`, `${surname(lc.driver)} led at the end of lap ${lc.lap}${lc.from ? ` (from ${surname(lc.from)})` : ""}; lead changes are end-of-lap order`));
lines.push("");

// ---- stops and stints for the top six
lines.push("## Stops (packet:stops; lane_time_s = pit-lane time, NOT net loss) and stints (packet:stints)");
const top6 = packet.results.filter((r) => r.position != null && r.position <= 6).map((r) => r.driver);
packet.stops.forEach((s, i) => { if (top6.includes(s.acronym)) { num(s.lap, `stops.${i}.lap`, `${surname(s.acronym)} stopped on lap ${s.lap} (${s.compound_before}→${s.compound_after}, ${s.class})`); if (s.class !== "boundary_spanning") num(s.lane_time_s, `stops.${i}.lane_time_s`, `${surname(s.acronym)} lap-${s.lap} pit-lane time (s)`, fmt1(s.lane_time_s)); } });
packet.stints.forEach((st, i) => { if (top6.includes(st.driver)) lines.push(`      ${surname(st.driver).padEnd(10)} stint ${st.stint}: ${st.compound.toLowerCase()} laps ${st.laps[0]}–${st.laps[1]}   (stints.${i})`); });
lines.push("");

// ---- pair gaps
const pairs = pairArg ? [pairArg.split(",")] : [[winner, runnerUp]];
for (const [a, b] of pairs) {
  const pi = packet.pair_gaps.findIndex((g) => g.a === a && g.b === b);
  if (pi < 0) continue;
  const pg = packet.pair_gaps[pi];
  lines.push(`## Gap ${surname(b)} behind ${surname(a)} at the END of each lap (packet:pair_gaps.${pi}; line-crossing definition; negative = ${surname(b)} ahead)`);
  const keyLaps = new Set([...packet.lead_changes.map((l) => l.lap), ...packet.lead_changes.map((l) => l.lap - 1), ...packet.stops.filter((s) => [a, b].includes(s.acronym)).flatMap((s) => [s.lap - 1, s.lap, s.lap + 1]), ...packet.timeline.intervals.flatMap((iv) => [iv.start_lap - 1, iv.end_lap]), packet.session.total_laps]);
  pg.laps.forEach((l, i) => { if (l.gap != null && (keyLaps.has(l.lap) || l.lap % 5 === 0)) num(l.gap, `pair_gaps.${pi}.laps.${i}.gap`, `gap at end of lap ${l.lap} (${l.quality})`, Math.abs(l.gap) < 1 ? l.gap.toFixed(3) : fmt1(l.gap)); });
  lines.push("");
}

// ---- standings
lines.push("## Championship (packet:standings_after)");
packet.standings_after.slice(0, 5).forEach((s, i) => { num(s.after, `standings_after.${i}.after`, `${surname(s.driver)} points after the race`); });
if (packet.standings_after.length >= 2) num(packet.standings_after[0].after - packet.standings_after[1].after, "standings_after.0.after − standings_after.1.after", `leader's margin over second (derived)`);
lines.push("");

// ---- penalties and stewards' notes
lines.push("## Race control (packet:timeline.events) — describe in ordinary language, never quote the log");
packet.timeline.events.forEach((e, i) => { if (["penalty", "decision", "investigation", "red", "sc", "vsc"].includes(e.type)) lines.push(`      lap ${String(e.issued_lap).padStart(2)}  events.${i}  ${e.message.slice(0, 110)}`); });
lines.push("");

// ---- context facts
if (context) {
  lines.push("## Computed context facts (cite as context:<id>; numbers inside are allowed)");
  for (const f of context.facts) lines.push(`      context:${f.id.padEnd(22)} ${f.statement}`);
  lines.push("");
}

// ---- reporting
if (reporting) {
  const t1 = reporting.entries.filter((e) => e.tier === 1 && ["decision", "infringement", "summons"].includes(e.doc_type));
  const t2 = reporting.entries.filter((e) => e.tier === 2);
  const t3 = reporting.entries.filter((e) => e.tier === 3);
  lines.push("## Official documents (tier 1; cite as reporting:<id>; facts, not quotes)");
  for (const e of t1) lines.push(`      reporting:${e.id.padEnd(20)} ${e.title.slice(0, 80)} — ${e.excerpt.slice(0, 160)}`);
  lines.push("", "## Registered reporting (tier 2; cite as reporting:<id>; attribute; quotes ≤ 4 words)");
  for (const e of t2) {
    const txt = existsSync(resolve(ROOT, e.raw_ref)) ? readFileSync(resolve(ROOT, e.raw_ref), "utf8") : "";
    lines.push(`      reporting:${e.id.padEnd(20)} ${e.title} (${e.source_key}, ${String(e.published_at).slice(0, 16)}) ${e.url}`);
    if (txt) lines.push("      > " + txt.replace(/\s+/g, " ").slice(0, 1800));
  }
  lines.push("", "## Sentiment and live moments (tier 3; paraphrase only, attribute by name, cite as reporting:<id>; numbers in posts are NOT citable)");
  const seenText = new Set();
  for (const e of t3.sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)))) {
    const raw = readJsonl(resolve(ROOT, e.raw_ref)).find((p) => String(p.id).split("/").pop() === e.id.split(":").pop());
    const text = (raw?.text ?? "").replace(/\s+/g, " ").trim();
    const key = text.slice(0, 60);
    if (!text || seenText.has(key)) continue;
    seenText.add(key);
    lines.push(`      reporting:${e.id.padEnd(22)} ${String(e.published_at).slice(11, 16)} ${e.author ?? e.handle}: ${text.slice(0, 220)}`);
  }
}

const out = lines.join("\n") + "\n";
const outPath = argOpt("out");
if (outPath) { writeFileSync(outPath, out); writeFileSync(outPath + ".json", JSON.stringify({ meeting, numbers: index }, null, 1)); console.log(`✅ ${outPath} (${index.length} numeric lines, ${out.split("\n").length} lines)`); }
else process.stdout.write(out);
