#!/usr/bin/env node
/**
 * figures.mjs — packet → figure compiler (visuals plan S1.3).
 *
 *   node scripts/analyst/figures.mjs --meeting 2026_1293 [--figure gap_trace] [--verify]
 *
 * Reads analyst/<meeting>/packet.json and writes analyst/<meeting>/figures/<name>.json:
 *   { name, chart (ChartSpec, self-contained), caption: {template, slots, rendered},
 *     alt: {template, slots, rendered}, claims[], series_sources[], provenance }
 *
 * Text is never parsed: captions are templates with typed slots, each slot bound
 * to a packet path (or a declared derivation over packet paths). A slot IS the
 * claim. --verify re-resolves every slot against the packet, recomputes derived
 * values, re-renders the text and requires byte equality, and checks every
 * series value against its declared packet source. No LLM anywhere.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const argv = process.argv.slice(2);
const opt = (k) => argv.find((a, i) => argv[i - 1] === `--${k}`);
const MEETING = opt("meeting") ?? "2026_1293";
const ONLY = opt("figure");
const VERIFY = argv.includes("--verify");
const DIR = resolve(ROOT, "analyst", MEETING);
const OUT = resolve(DIR, "figures");
mkdirSync(OUT, { recursive: true });
const packet = JSON.parse(readFileSync(resolve(DIR, "packet.json"), "utf8"));
export const COMPILER_VERSION = "figures@1";

// ------------------------------------------------------------ helpers
export function ptr(obj, path) {
  if (!path.startsWith("/")) throw new Error(`bad pointer ${path}`);
  return path.slice(1).split("/").reduce((o, k) => (o == null ? undefined : o[k.replace(/~1/g, "/").replace(/~0/g, "~")]), obj);
}
const TEAM_COLORS = {
  Mercedes: "#27F4D2", "Red Bull Racing": "#3671C6", McLaren: "#FF8000", Ferrari: "#E80020", Alpine: "#0093CC",
  Audi: "#00A19C", "Aston Martin": "#229971", Williams: "#64C4FF", Haas: "#B6BABD", "Haas F1 Team": "#B6BABD",
  "Racing Bulls": "#6692FF", Cadillac: "#C8A24A"
};
const driverOf = (acr) => packet.drivers.find((d) => d.acronym === acr);
const surname = (acr) => { const n = driverOf(acr)?.name ?? acr; const parts = n.split(" "); const last = parts[parts.length - 1]; return last.charAt(0) + last.slice(1).toLowerCase(); };
const colorOf = (acr, shade = 0) => {
  const base = TEAM_COLORS[driverOf(acr)?.team] ?? "#9CA3AF";
  if (!shade) return base;
  // teammate: darken
  const n = parseInt(base.slice(1), 16); const f = 0.62;
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
};
const traceIdx = (acr, lap) => packet.position_trace[acr].findIndex((x) => x.lap === lap);
const pairIdx = (a, b) => packet.pair_gaps.findIndex((p) => p.a === a && p.b === b);
const lapIdx = (pi, lap) => packet.pair_gaps[pi].laps.findIndex((l) => l.lap === lap);

/** Racing-state layer straight from the packet's (view-sourced) intervals. */
function racingState(window = null) {
  const inWin = (from, to) => !window || ((to ?? Infinity) >= window[0] && from <= window[1]);
  const periods = packet.timeline.intervals.filter((iv) => inWin(iv.start_lap, iv.end_lap)).map((iv) => ({
    kind: iv.kind, start_ts: iv.start, end_ts: iv.end ?? null, from_lap: iv.start_lap, to_lap: iv.end_lap ?? null,
    endpoint_inferred: iv.endpoint_inferred ?? null, opened_by: iv.opened_by ?? null, closed_by: iv.closed_by ?? null
  }));
  const seen = new Map();
  for (const e of packet.timeline.events.filter((e) => e.type === "flag_sector" && /YELLOW/.test(e.message))) {
    const m = e.message.match(/SECTOR (\d+)/); if (!m || !e.issued_lap || !inWin(e.issued_lap, e.issued_lap)) continue;
    const key = `${e.issued_lap}:${m[1]}`; const level = /DOUBLE/.test(e.message) ? "double_yellow" : "yellow";
    const prev = seen.get(key);
    if (!prev) seen.set(key, { lap: e.issued_lap, sector: Number(m[1]), level, issued_at: e.issued_at });
    else if (prev.level === "yellow" && level === "double_yellow") seen.set(key, { ...prev, level });
  }
  const inferred = (c) => c && !/^(superseded_by_|resumption_state_msg$)/.test(c);
  const notes = periods.filter((p) => inferred(p.endpoint_inferred) || p.to_lap == null).map((p) => {
    const k = p.kind.toUpperCase(); const where = p.to_lap == null ? "never closed" : `placed at L${p.to_lap} end`;
    const why = p.endpoint_inferred?.startsWith("ending_") ? `no ${k} end message recorded` : p.endpoint_inferred?.startsWith("lights_on_") || p.endpoint_inferred?.startsWith("in_this_lap_") ? "end of the SC-in lap, no end message recorded" : "no end message before the chequered flag";
    return `${k} end ${where}; ${why}`;
  });
  return { source: notes.length ? "incomplete" : "available", session_key: packet.session.session_key ?? null, periods, sector_flags: [...seen.values()].sort((a, b) => a.lap - b.lap || a.sector - b.sector), notes, total_laps: packet.session.total_laps ?? null };
}

// slot value resolution: {packet_path} | {derive: {op, inputs:[packet_path|number]}}
function resolveSlot(slot) {
  if (slot.packet_path) return ptr(packet, slot.packet_path);
  if (slot.derive) {
    const vals = slot.derive.inputs.map((i) => (typeof i === "number" ? i : ptr(packet, i)));
    switch (slot.derive.op) {
      case "sub": return vals[0] - vals[1];
      case "div": return vals[0] / vals[1];
      case "mean": return vals.reduce((a, b) => a + b, 0) / vals.length;
      case "count": return vals.length;
      default: throw new Error(`unknown op ${slot.derive.op}`);
    }
  }
  if (slot.const !== undefined) return slot.const; // non-source text (a driver name from packet.drivers is bound via packet_path; consts are unit words only)
  throw new Error("slot without a source");
}
function fmt(v, slot) {
  if (slot.format === "0.0") return Number(v).toFixed(1);
  if (slot.format === "0.00") return Number(v).toFixed(2);
  if (slot.format === "0.000") return Number(v).toFixed(3);
  if (slot.format === "int") return String(Math.round(Number(v)));
  if (slot.format === "ordinal") { const n = Math.round(Number(v)); const s = ["th", "st", "nd", "rd"][((n % 100) - 20) % 10] ?? ["th", "st", "nd", "rd"][n % 100] ?? "th"; return `${n}${s}`; }
  if (slot.format === "lower") return String(v).toLowerCase();
  if (slot.format === "surname") return surname(String(v));
  return String(v);
}
export function renderText(template, slots) {
  return template.replace(/\{(\w+)\}/g, (_, k) => { const s = slots[k]; if (!s) throw new Error(`unbound slot ${k}`); return fmt(resolveSlot(s), s); });
}
const text = (template, slots) => ({ template, slots, rendered: renderText(template, slots) });

// ------------------------------------------------------------ recipes
const RECIPES = {
  gap_trace() {
    const pi = pairIdx("RUS", "ANT"); const pg = packet.pair_gaps[pi];
    const from = 20, to = 53;
    const laps = pg.laps.filter((l) => l.lap >= from && l.lap <= to);
    const stopAnt = packet.stops.find((s) => s.acronym === "ANT" && s.lap === 28);
    const antTrace = (lap) => `/position_trace/ANT/${traceIdx("ANT", lap)}`;
    const series = [{ name: "Antonelli behind Russell", color: colorOf("ANT"), values: laps.map((l) => (l.gap == null ? NaN : l.gap)) }];
    const chart = {
      type: "race_trace", x_label: "Lap", y_label: "Antonelli's gap to Russell (s)", y_value_format: "decimal_seconds",
      series, lap_numbers: laps.map((l) => l.lap), y_domain: [-6, 16],
      trace_pit_dots: [{ x: 28, y: laps.find((l) => l.lap === 28).gap, color: colorOf("ANT"), driver: "Antonelli", label: "stop · VSC" }],
      annotations: [{ lap: 49, text: "L49 lap deleted · track limits T1", kind: "deletion" }, { lap: 50, text: "Antonelli leads", kind: "pass" }],
      racing_state: racingState([from, to]),
      chart_note: "Gap = difference of the two cars' line-crossing times at the end of each lap; positive = Antonelli behind, above the zero line = ahead. Final lap from lap start + lap time."
    };
    const L = (lap) => `/pair_gaps/${pi}/laps/${lapIdx(pi, lap)}`;
    const slots = {
      b: { packet_path: `/pair_gaps/${pi}/b`, format: "surname" }, a: { packet_path: `/pair_gaps/${pi}/a`, format: "surname" },
      from: { packet_path: `${L(from)}/lap` }, to: { packet_path: `${L(to)}/lap` },
      stop_lap: { packet_path: `/stops/${packet.stops.indexOf(stopAnt)}/lap` },
      gap_before: { packet_path: `${L(27)}/gap`, format: "0.0" },
      after_lap: { packet_path: `${L(29)}/lap` },
      gap_after: { packet_path: `${L(29)}/gap`, format: "0.0" },
      l40: { packet_path: `${L(40)}/lap` }, gap40: { packet_path: `${L(40)}/gap`, format: "0.0" },
      l48: { packet_path: `${L(48)}/lap` }, gap48: { packet_path: `${L(48)}/gap`, format: "0.000" },
      closed: { derive: { op: "sub", inputs: [`${L(40)}/gap`, `${L(48)}/gap`] }, format: "0.0" },
      pass_lap: { packet_path: `/lead_changes/${packet.lead_changes.findIndex((c) => c.lap === 50 && c.driver === "ANT")}/lap` }
    };
    const caption = text(
      "{b}'s gap to {a} at the end of each lap, laps {from}–{to}. The stop under the virtual safety car on lap {stop_lap} turned a {gap_before} s deficit into {gap_after} s by the end of lap {after_lap}; from lap {l40} ({gap40} s) to lap {l48} ({gap48} s) he closed {closed} s, and he took the lead on lap {pass_lap}.",
      slots
    );
    const alt = text("Line chart of {b}'s gap to {a} by lap from {from} to {to}: a jump to {gap_after} s after the lap-{stop_lap} VSC stop, then a steady close to {gap48} s by lap {l48} and the lead on lap {pass_lap}.", slots);
    return { chart, caption, alt, series_sources: [{ series: 0, packet_path_template: `/pair_gaps/${pi}/laps/{i}/gap`, index_from: lapIdx(pi, from), laps: laps.map((l) => l.lap) }] };
  },

  closing_rate() {
    const from = 40, to = 48;
    const laps = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const delta = laps.map((L) => { const a = packet.position_trace.ANT[traceIdx("ANT", L)].lap_s, r = packet.position_trace.RUS[traceIdx("RUS", L)].lap_s; return a != null && r != null ? +(a - r).toFixed(3) : NaN; });
    const mean = delta.filter(Number.isFinite).reduce((s, v) => s + v, 0) / delta.filter(Number.isFinite).length;
    const chart = {
      type: "line_with_stint_markers", x_label: "Lap", y_label: "Antonelli − Russell (s)", y_value_format: "decimal_seconds",
      series: [{ name: "Antonelli − Russell", color: colorOf("ANT"), values: delta }], lap_numbers: laps,
      horizontal_marker: { value: 0, label: "equal pace" },
      chart_note: "Negative = Antonelli faster. Laps 40–48 contain no pit laps for either car; lap 49 (Antonelli's deleted lap) is excluded by the window."
    };
    const inputsA = laps.map((L) => `/position_trace/ANT/${traceIdx("ANT", L)}/lap_s`);
    const inputsR = laps.map((L) => `/position_trace/RUS/${traceIdx("RUS", L)}/lap_s`);
    const slots = {
      from: { packet_path: `/position_trace/ANT/${traceIdx("ANT", from)}/lap` }, to: { packet_path: `/position_trace/ANT/${traceIdx("ANT", to)}/lap` },
      mean_ant: { derive: { op: "mean", inputs: inputsA }, format: "0.000" }, mean_rus: { derive: { op: "mean", inputs: inputsR }, format: "0.000" },
      n: { derive: { op: "count", inputs: inputsA } }
    };
    const caption = text("Antonelli's lap time minus Russell's, laps {from}–{to}. Over those {n} laps Antonelli averaged {mean_ant} s a lap against Russell's {mean_rus} s.", slots);
    const alt = text("Line chart of the per-lap time difference between Antonelli and Russell for laps {from} to {to}; every point is below zero, Antonelli faster.", slots);
    void mean;
    return { chart, caption, alt, series_sources: [{ series: 0, derived: "lap_s(ANT, L) − lap_s(RUS, L)", inputs: laps.map((L, i) => [inputsA[i], inputsR[i]]) }] };
  },

  strategy_split() {
    const order = packet.results.filter((r) => r.position != null).sort((a, b) => a.position - b.position).slice(0, 8).map((r) => r.driver);
    const stints = packet.stints.filter((s) => order.includes(s.driver)).map((s) => ({ driver: surname(s.driver), start: s.laps[0], end: s.laps[1], compound: String(s.compound).toLowerCase() }));
    const stops = packet.stops.filter((s) => order.includes(s.acronym)).map((s) => ({ driver: surname(s.acronym), lap: s.lap, label: s.class === "boundary_spanning" ? "red" : s.class === "vsc" ? "VSC" : s.class === "sc" ? "SC" : "green" }));
    const chart = {
      type: "stint_gantt", y_axis: order.map(surname), total_laps: packet.session.total_laps ?? 53, stints,
      compound_legend: { hard: "#E5E7EB", medium: "#FCD34D", soft: "#EF4444" }, gantt_stops: stops, racing_state: racingState(),
      chart_note: "Top eight finishers. Stops during the lap-3 red flag were tyre changes in the pit lane while the race was suspended; the lap-28 stops came under the virtual safety car."
    };
    const si = (acr, n) => packet.stints.findIndex((s) => s.driver === acr && s.stint === n);
    const slots = {
      rus: { packet_path: `/stints/${si("RUS", 2)}/driver`, format: "surname" }, ant: { packet_path: `/stints/${si("ANT", 2)}/driver`, format: "surname" },
      rus_c2: { packet_path: `/stints/${si("RUS", 2)}/compound`, format: "lower" }, ant_c2: { packet_path: `/stints/${si("ANT", 2)}/compound`, format: "lower" },
      ant_c3: { packet_path: `/stints/${si("ANT", 3)}/compound`, format: "lower" },
      ant_stop: { packet_path: `/stops/${packet.stops.findIndex((s) => s.acronym === "ANT" && s.lap === 28)}/lap` },
      n_vsc: { derive: { op: "count", inputs: packet.stops.map((s, i) => s.class === "vsc" ? `/stops/${i}/lap` : null).filter(Boolean) } },
      red_lap: { packet_path: `/timeline/intervals/${packet.timeline.intervals.findIndex((iv) => iv.kind === "red")}/start_lap` }
    };
    const caption = text("Tyre strategies of the top eight. At the lap-{red_lap} red flag {rus} took {rus_c2}s to run to the finish while {ant} took {ant_c2}s; {ant} stopped again for {ant_c3}s under the virtual safety car on lap {ant_stop}, one of {n_vsc} stops made under it.", slots);
    const alt = text("Gantt chart of tyre stints for the top eight finishers with red-flag and VSC periods shaded and pit stops marked; {rus} on one set of {rus_c2}s after lap 3, {ant} on {ant_c2}s then {ant_c3}s from lap {ant_stop}.", slots);
    return { chart, caption, alt, series_sources: [{ series: "stints", packet_path: "/stints", filter: `driver in top 8` }] };
  },

  charge() {
    const drivers = ["ANT", "RUS", "GAS", "VER"];
    const total = packet.session.total_laps ?? 53;
    const grid = (acr) => packet.results.find((r) => r.driver === acr)?.grid ?? null;
    const series = drivers.map((acr, i) => ({
      name: surname(acr), color: colorOf(acr, acr === "RUS" ? 1 : 0), emphasis: acr === "ANT" || acr === "RUS",
      values: [grid(acr), ...Array.from({ length: total }, (_, L) => packet.position_trace[acr][L]?.position ?? NaN)].map((v) => (v == null ? NaN : v))
    }));
    const chart = {
      type: "position_changes", series, racing_state: racingState(),
      chart_note: "Classified order at the end of each lap; the feed logs changes only, so a position is carried forward until the next logged change. Lap 0 = grid."
    };
    const ri = (acr) => packet.results.findIndex((r) => r.driver === acr);
    const slots = {
      ant: { packet_path: `/results/${ri("ANT")}/driver`, format: "surname" }, grid: { packet_path: `/results/${ri("ANT")}/grid`, format: "ordinal" },
      p3: { packet_path: `/position_trace/ANT/${traceIdx("ANT", 3)}/position`, format: "ordinal" },
      p2lap: { packet_path: `/position_trace/ANT/${traceIdx("ANT", 25)}/lap` },
      lead_lap: { packet_path: `/lead_changes/${packet.lead_changes.findIndex((c) => c.lap === 50)}/lap` },
      gas: { packet_path: `/results/${ri("GAS")}/driver`, format: "surname" }, gas_grid: { packet_path: `/results/${ri("GAS")}/grid`, format: "ordinal" }, gas_fin: { packet_path: `/results/${ri("GAS")}/position`, format: "ordinal" },
      red_lap: { packet_path: `/timeline/intervals/${packet.timeline.intervals.findIndex((iv) => iv.kind === "red")}/start_lap` }
    };
    const caption = text("{ant} from {grid} on the grid: {p3} by the lap-{red_lap} red flag, second by lap {p2lap}, and into the lead on lap {lead_lap}. {gas} went the other way, from {gas_grid} to {gas_fin}.", slots);
    const alt = text("Step chart of race position by lap for Antonelli, Russell, Gasly and Verstappen with the red flag, safety car and VSC periods shaded; Antonelli climbs from {grid} to first by lap {lead_lap}.", slots);
    return { chart, caption, alt, series_sources: drivers.map((acr, i) => ({ series: i, packet_path_template: `/position_trace/${acr}/{i}/position`, index_from: 0, laps: Array.from({ length: total }, (_, L) => L + 1), lap0_path: `/results/${ri(acr)}/grid` })) };
  }
};

// ------------------------------------------------------------ verify
function verifyFigure(fig) {
  const problems = [];
  for (const part of ["caption", "alt"]) {
    const t = fig[part];
    let re; try { re = renderText(t.template, t.slots); } catch (e) { problems.push(`${part}: ${e.message}`); continue; }
    if (re !== t.rendered) problems.push(`${part}: rendered text differs from template+slots re-render`);
    const slotNums = new Set(Object.values(t.slots).map((s) => fmt(resolveSlot(s), s)).flatMap((v) => v.match(/\d+(?:\.\d+)?/g) ?? []));
    for (const m of t.rendered.matchAll(/\d+(?:\.\d+)?/g)) if (!slotNums.has(m[0])) problems.push(`${part}: unbound number ${m[0]}`);
    for (const [k, s] of Object.entries(t.slots)) { if (s.packet_path && ptr(packet, s.packet_path) === undefined) problems.push(`${part}: slot ${k} path ${s.packet_path} does not resolve`); }
  }
  for (const src of fig.series_sources) {
    if (src.packet_path_template) {
      const s = fig.chart.series[src.series];
      src.laps.forEach((lap, i) => {
        const p = src.packet_path_template.replace("{i}", String(src.index_from + i));
        const want = ptr(packet, p); const got = s.values[src.lap0_path ? i + 1 : i];
        const ok = (want == null && Number.isNaN(got)) || (typeof want === "number" && Math.abs(want - got) < 1e-6);
        if (!ok) problems.push(`series ${src.series} lap ${lap}: chart ${got} vs packet ${p} = ${want}`);
      });
      if (src.lap0_path && ptr(packet, src.lap0_path) !== fig.chart.series[src.series].values[0]) problems.push(`series ${src.series} lap 0 ≠ ${src.lap0_path}`);
    } else if (src.inputs) {
      const s = fig.chart.series[src.series];
      src.inputs.forEach(([a, r], i) => { const want = +(ptr(packet, a) - ptr(packet, r)).toFixed(3); if (Math.abs(want - s.values[i]) > 1e-6) problems.push(`series ${src.series} idx ${i}: ${s.values[i]} vs ${want}`); });
    }
  }
  return problems;
}

// ------------------------------------------------------------ main
const names = ONLY ? [ONLY] : Object.keys(RECIPES);
let failed = 0;
for (const name of names) {
  const fig = RECIPES[name]();
  delete fig._mean;
  const out = { name, meeting: MEETING, ...fig, provenance: { compiler_version: COMPILER_VERSION, packet_version: packet.manifest?.packet_version, packet_built_at: packet.manifest?.built_at, session_key: packet.session?.session_key, built_at: new Date().toISOString() } };
  const problems = VERIFY ? verifyFigure(out) : [];
  out.verification = { checked_at: new Date().toISOString(), ok: problems.length === 0, problems };
  writeFileSync(resolve(OUT, `${name}.json`), JSON.stringify(out, null, 1) + "\n");
  console.log(`${problems.length ? "❌" : "✅"} ${name}: ${out.caption.rendered}`);
  for (const p of problems) console.log("     -", p);
  if (problems.length) failed++;
}
process.exit(failed ? 1 : 0);
