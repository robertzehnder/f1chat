#!/usr/bin/env node
/**
 * race_packet.mjs — build the CANONICAL evidence packet for a race session
 * (analyst design U1). Raw/core tables only, via lib/packet.mjs transforms.
 * Independent of the chat product; the platform-observed packet comes from
 * probe_platform.mjs and is reconciled separately.
 *
 * Usage: node scripts/analyst/race_packet.mjs --session 11361 [--out dir]
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
import { resolve } from "node:path";
import { corpusClient } from "../corpus/lib/db.mjs";
import { parseEvent, linkEvents, racingIntervals, classifyStop, mapObservationsToLaps, asOf, candidateMoments, anomalyWindow } from "./lib/packet.mjs";

const sessionKey = Number(process.argv.find((a, i) => process.argv[i - 1] === "--session"));
const outDir = process.argv.find((a, i) => process.argv[i - 1] === "--out") ?? null;
if (!sessionKey) { console.error("--session required"); process.exit(2); }
const PACKET_VERSION = "race_packet@1";
const T = (d) => new Date(d).getTime();
const num = (v) => (v == null || v === "" ? null : Number(v));
const gapNum = (s) => { const n = Number(s); return Number.isFinite(n) ? n : null; }; // "+1 LAP" → null

const c = await corpusClient();
const manifest = { packet_version: PACKET_VERSION, session_key: sessionKey, built_at: new Date().toISOString(), sources: {}, flags: [], not_available: [] };
const q = async (label, sql, params = []) => { const r = await c.query(sql, params); manifest.sources[label] = { rows: r.rowCount }; return r.rows; };

// ---- session, meeting, drivers
const [sess] = await q("sessions", `SELECT s.session_key, s.meeting_key, s.session_name, s.year, s.circuit_short_name, s.date_start, m.meeting_name
  FROM core.sessions s LEFT JOIN raw.meetings m ON m.meeting_key = s.meeting_key WHERE s.session_key = $1`, [sessionKey]);
const drivers = await q("drivers", `SELECT DISTINCT driver_number, name_acronym, full_name, team_name FROM raw.drivers WHERE session_key = $1`, [sessionKey]);
const D = Object.fromEntries(drivers.map((d) => [d.driver_number, d]));
const acr = (n) => D[n]?.name_acronym ?? String(n);

// ---- laps (per driver), leader lap ends
const laps = await q("laps", `SELECT driver_number, lap_number, date_start, lap_duration, duration_sector_1 s1, duration_sector_2 s2, duration_sector_3 s3, is_pit_out_lap
  FROM raw.laps WHERE session_key = $1 ORDER BY driver_number, lap_number`, [sessionKey]);
const lapsByDriver = new Map();
for (const l of laps) { if (!lapsByDriver.has(l.driver_number)) lapsByDriver.set(l.driver_number, []); lapsByDriver.get(l.driver_number).push({ lap: l.lap_number, start: T(l.date_start), duration: num(l.lap_duration) }); }
const totalLaps = Math.max(...laps.map((l) => l.lap_number));
// leader lap-end time = earliest next-lap start across drivers (first car to complete the lap)
const lapEnds = new Map();
for (let L = 1; L <= totalLaps; L++) {
  const starts = laps.filter((l) => l.lap_number === L + 1).map((l) => T(l.date_start));
  if (starts.length) lapEnds.set(L, Math.min(...starts));
}
if (!lapEnds.has(totalLaps)) manifest.flags.push("final lap end unknown (no lap N+1 start)");

// ---- race control → typed events, links, intervals
const rcRows = await q("race_control", `SELECT date, lap_number, category, flag, scope, sector, driver_number, message FROM raw.race_control WHERE session_key = $1 ORDER BY date, id`, [sessionKey]);
const events = rcRows.map((r, i) => parseEvent(r, i));
const { links, unresolved } = linkEvents(events);
const { intervals: jsIntervals, announcements } = racingIntervals(events, lapEnds);
// Racing-state periods come from analytics.racing_state_intervals (migration
// 062) — the same record the product's chart layer and the interruptions card
// read — so the article and the platform cannot disagree about a caution.
// The JS builder (which 062 was derived from) is kept as a PARITY CHECK: any
// divergence on (kind, start_lap, end_lap, endpoint_inferred) fails the packet
// unless --allow-parity-mismatch is passed (and is recorded in the manifest).
const viewRows = await q("racing_state_intervals", `SELECT interval_no, kind, start_ts, end_ts, start_lap, end_lap, endpoint_inferred, opened_by_message, closed_by_message FROM analytics.racing_state_intervals WHERE session_key = $1 ORDER BY start_ts, interval_no`, [sessionKey]);
const eventAt = (ts, message) => events.find((e) => T(e.issued_at) === T(ts) && e.message === message) ?? events.find((e) => T(e.issued_at) === T(ts));
const intervals = viewRows.map((r) => {
  const opened = eventAt(r.start_ts, r.opened_by_message);
  const closed = r.closed_by_message ? eventAt(r.end_ts, r.closed_by_message) : null;
  return { kind: r.kind, start: new Date(r.start_ts).toISOString(), start_lap: r.start_lap, opened_by: opened?.id ?? null,
    end: r.end_ts ? new Date(r.end_ts).toISOString() : null, end_lap: r.end_lap, closed_by: closed?.id ?? null, closed_by_message: r.closed_by_message ?? null,
    endpoint_inferred: r.endpoint_inferred ?? null, source: "analytics.racing_state_intervals" };
});
const sig = (list) => list.map((iv) => `${iv.kind}:${iv.start_lap}-${iv.end_lap ?? "open"}:${iv.endpoint_inferred ?? "exact"}`).join(" | ");
if (sig(intervals) !== sig(jsIntervals)) {
  const msg = `racing-state PARITY MISMATCH — view: [${sig(intervals)}] vs js: [${sig(jsIntervals)}]`;
  manifest.flags.push(msg);
  if (!process.argv.includes("--allow-parity-mismatch")) { console.error(msg); process.exit(3); }
} else manifest.flags.push(`racing-state parity OK (${intervals.length} periods; view == js builder)`);
for (const iv of intervals) if (iv.endpoint_inferred) manifest.flags.push(`${iv.kind} interval from L${iv.start_lap}: endpoint_inferred=${iv.endpoint_inferred}`);

// ---- stints & stops
const stints = await q("stints", `SELECT driver_number, stint_number, compound, lap_start, lap_end, tyre_age_at_start FROM raw.stints WHERE session_key = $1 ORDER BY driver_number, stint_number`, [sessionKey]);
const compoundAt = (d, lap) => { const s = stints.find((x) => x.driver_number === d && lap >= x.lap_start && lap <= x.lap_end); return s ? { compound: s.compound, age: (s.tyre_age_at_start ?? 0) + (lap - s.lap_start) } : { compound: null, age: null }; };
const pitRows = await q("pit", `SELECT driver_number, lap_number, date, pit_duration FROM raw.pit WHERE session_key = $1 ORDER BY date`, [sessionKey]);
// raw.pit.date is the pit-lane EXIT timestamp (red-flag stops carry date = resumption
// and pit_duration = the whole suspension); entry = date - pit_duration.
manifest.flags.push("raw.pit.date treated as pit-lane EXIT; entry = date - pit_duration (evidence: red-flag stops' date equals the resumption time)");
const stops = pitRows.map((p) => { const exitTs = T(p.date); const entryTs = exitTs - Number(p.pit_duration ?? 0) * 1000; return { driver: p.driver_number, acronym: acr(p.driver_number), lap: p.lap_number, entry: new Date(entryTs).toISOString(), exit: new Date(exitTs).toISOString(), lane_time_s: num(p.pit_duration),
  ...classifyStop({ entry: entryTs, pit_duration: p.pit_duration }, intervals),
  compound_before: compoundAt(p.driver_number, p.lap_number).compound, compound_after: compoundAt(p.driver_number, p.lap_number + 1).compound }; });
// pit clusters: ≥3 stops within a 2-lap window
const clusters = [];
for (let L = 1; L <= totalLaps; L++) { const inWin = stops.filter((s) => s.lap >= L && s.lap <= L + 1); if (inWin.length >= 3 && !clusters.some((cl) => cl.laps[1] >= L)) clusters.push({ laps: [L, L + 1], drivers: inWin.map((s) => s.acronym), classes: [...new Set(inWin.map((s) => s.class))] }); }

// ---- traces: positions + gaps per lap (lap-end state), lead changes
const posRows = await q("position_history", `SELECT driver_number, date, position FROM raw.position_history WHERE session_key = $1 ORDER BY date`, [sessionKey]);
const gapRows = await q("intervals", `SELECT driver_number, date, gap_to_leader, interval FROM raw.intervals WHERE session_key = $1 ORDER BY date`, [sessionKey]);
const posByDL = mapObservationsToLaps(posRows.map((r) => ({ driver_number: r.driver_number, date: r.date, value: { position: r.position } })), lapsByDriver);
const gapByDL = mapObservationsToLaps(gapRows.map((r) => ({ driver_number: r.driver_number, date: r.date, value: { gap: gapNum(r.gap_to_leader), interval: gapNum(r.interval), raw_gap: r.gap_to_leader } })), lapsByDriver);
const positionTrace = {}; const gapTrace = [];
const humanAdded = (() => { const f = process.argv.find((a, i) => process.argv[i - 1] === "--human-candidates"); return f ? JSON.parse(require("node:fs").readFileSync(f, "utf8")) : []; })();
for (const d of drivers.map((x) => x.driver_number)) {
  positionTrace[acr(d)] = [];
  let prevGap = null, carried = null;
  for (let L = 1; L <= totalLaps; L++) {
    // position_history logs CHANGES only: carry the last known position forward (flagged)
    const obsPos = posByDL.get(`${d}:${L}`)?.last?.position ?? null;
    const p = obsPos ?? carried; if (obsPos != null) carried = obsPos;
    const g = gapByDL.get(`${d}:${L}`)?.last ?? null;
    positionTrace[acr(d)].push({ lap: L, position: p, position_carried: obsPos == null && p != null, gap: g?.gap ?? null, interval: g?.interval ?? null, ...compoundAt(d, L) });
    if (g) { gapTrace.push({ driver: acr(d), lap: L, gap: g.gap, prev_gap: prevGap }); prevGap = g.gap; }
  }
}
const leadChanges = []; let prevLeader = null;
for (let L = 1; L <= totalLaps; L++) { const leader = drivers.map((x) => x.driver_number).find((d) => posByDL.get(`${d}:${L}`)?.last?.position === 1); if (leader && leader !== prevLeader) { leadChanges.push({ lap: L, driver: acr(leader), from: prevLeader ? acr(prevLeader) : null }); prevLeader = leader; } }

// ---- restart snapshots (as-of strictly before the restart timestamp)
const restarts = intervals.filter((iv) => iv.end).map((iv) => {
  const snapPos = asOf(posRows, iv.end, (o) => ({ position: o.position }));
  const snapGap = asOf(gapRows, iv.end, (o) => ({ gap: gapNum(o.gap_to_leader) }));
  const order = snapPos.sort((a, b) => a.position - b.position).map((s) => ({ driver: acr(s.driver), position: s.position, gap: snapGap.find((g) => g.driver === s.driver)?.gap ?? null, ...compoundAt(s.driver, iv.end_lap ?? 1), as_of: s.ts }));
  const hasTsInside = posRows.some((o) => T(o.date) >= T(iv.start) && T(o.date) < T(iv.end));
  return { after: iv.kind, interval: iv.opened_by, restart_ts: iv.end, restart_lap: iv.end_lap, endpoint_inferred: iv.endpoint_inferred ?? null, label: hasTsInside ? "as_of_timestamp" : "approximation:lap_end", order };
});

// ---- results & standings
const results = await q("session_result", `SELECT driver_number, position, points, status FROM raw.session_result WHERE session_key = $1 ORDER BY position NULLS LAST`, [sessionKey]);
const grid = await q("starting_grid", `SELECT g.driver_number, g.grid_position FROM raw.starting_grid g JOIN raw.sessions s ON s.session_key = g.session_key WHERE s.meeting_key = $1 AND s.session_name = 'Qualifying'`, [sess.meeting_key]);
const lastLap = Object.fromEntries([...lapsByDriver].map(([d, ls]) => [d, Math.max(...ls.map((l) => l.lap))]));
const standings = await q("standings", `SELECT r.driver_number, SUM(r.points) FILTER (WHERE s.date_start < $2) AS before, SUM(r.points) AS after
  FROM raw.session_result r JOIN raw.sessions s USING (session_key) WHERE s.year = $1 AND s.session_name IN ('Race','Sprint') AND s.date_start <= $2 GROUP BY 1 ORDER BY after DESC`, [sess.year, sess.date_start]);
const pole = grid.find((g) => Number(g.grid_position) === 1);
// Grid penalties: qualifying classification vs grid slot (cause is source-only).
const qualiResult = await q("qualifying_result", `SELECT r.driver_number, r.position FROM raw.session_result r JOIN raw.sessions s USING (session_key)
  WHERE s.meeting_key = $1 AND s.session_name = 'Qualifying'`, [sess.meeting_key]);
const gridPenalties = grid.map((g) => {
  const qp = num(qualiResult.find((r) => r.driver_number === g.driver_number)?.position);
  const gp = num(g.grid_position);
  return qp != null && gp != null && gp > qp ? { driver: acr(g.driver_number), qualified: qp, grid: gp, places_lost: gp - qp, cause: "not in timing data (source-only)" } : null;
}).filter(Boolean).sort((a, b) => b.places_lost - a.places_lost);
const fastest = laps.filter((l) => l.lap_duration && !l.is_pit_out_lap).sort((a, b) => a.lap_duration - b.lap_duration).slice(0, 3).map((l) => ({ driver: acr(l.driver_number), lap: l.lap_number, time_s: num(l.lap_duration) }));

// ---- caution event-window records
const greenLaneTimes = stops.filter((s) => s.class === "green" && s.lane_time_s && s.lane_time_s < 300).map((s) => s.lane_time_s).sort((a, b) => a - b);
const medianGreenLane = greenLaneTimes.length ? greenLaneTimes[Math.floor(greenLaneTimes.length / 2)] : null;
const cautionWindows = intervals.map((iv) => {
  const before = asOf(posRows, iv.start, (o) => ({ position: o.position })).sort((a, b) => a.position - b.position).slice(0, 10)
    .map((s) => ({ driver: acr(s.driver), position: s.position, gap: asOf(gapRows, iv.start, (o) => ({ gap: gapNum(o.gap_to_leader) })).find((g) => g.driver === s.driver)?.gap ?? null, ...compoundAt(s.driver, iv.start_lap) }));
  const inside = stops.filter((s) => s.class === iv.kind || (s.class === "boundary_spanning" && s.overlaps.some((o) => o.interval === iv.opened_by)));
  const after = iv.end ? asOf(posRows, T(iv.end) + 120e3, (o) => ({ position: o.position })).sort((a, b) => a.position - b.position).slice(0, 10)
    .map((s) => ({ driver: acr(s.driver), position: s.position, gap: asOf(gapRows, T(iv.end) + 120e3, (o) => ({ gap: gapNum(o.gap_to_leader) })).find((g) => g.driver === s.driver)?.gap ?? null, ...compoundAt(s.driver, (iv.end_lap ?? 0) + 1) })) : null;
  const beforeAll = asOf(posRows, iv.start, (o) => ({ position: o.position })).map((x) => ({ driver: acr(x.driver), position: x.position, gap: asOf(gapRows, iv.start, (o) => ({ gap: gapNum(o.gap_to_leader) })).find((g) => g.driver === x.driver)?.gap ?? null }));
  const afterAll = iv.end ? asOf(posRows, T(iv.end) + 120e3, (o) => ({ position: o.position })).map((x) => ({ driver: acr(x.driver), position: x.position, gap: asOf(gapRows, T(iv.end) + 120e3, (o) => ({ gap: gapNum(o.gap_to_leader) })).find((g) => g.driver === x.driver)?.gap ?? null })) : [];
  const observed = inside.map((s) => { const b = beforeAll.find((x) => x.driver === s.acronym); const a = afterAll.find((x) => x.driver === s.acronym); return { driver: s.acronym, position_before: b?.position ?? null, position_after: a?.position ?? null, gap_before: b?.gap ?? null, gap_after: a?.gap ?? null, compound: `${s.compound_before}→${s.compound_after}`, note: "observed gap/position change across the stop — NOT a controlled pit-loss figure (field compression and simultaneous moves not netted out)" }; });
  return { interval: iv.opened_by, kind: iv.kind, start_lap: iv.start_lap, end_lap: iv.end_lap, endpoint_inferred: iv.endpoint_inferred ?? null,
    before_top10: before, stops_inside: inside.map((s) => ({ driver: s.acronym, lap: s.lap, class: s.class, lane_time_s: s.lane_time_s, compound: `${s.compound_before}→${s.compound_after}` })),
    after_top10_plus2min: after, observed_change: observed,
    estimate_green_flag_loss_s: medianGreenLane == null ? null : { value: medianGreenLane, label: "ESTIMATE", assumption: "a green-flag stop costs roughly the median green pit-lane time of this race relative to cars staying out; under SC/VSC the field is slowed so the same lane time costs far less track position" } };
});

// ---- candidates + anomaly windows
const lapRows = laps.map((l) => ({ driver: acr(l.driver_number), lap: l.lap_number, lap_s: num(l.lap_duration), s1: num(l.s1), s2: num(l.s2), s3: num(l.s3), pit_out: l.is_pit_out_lap }));
const top6 = results.filter((r) => r.position && r.position <= 6).map((r) => acr(r.driver_number));
const candidates = candidateMoments({ intervals, stops, leadChanges, gapTrace, events, lapRows, focusDrivers: top6, humanAdded });
const obsByDLAcr = new Map(); for (const [k, v] of posByDL) { const [d, L] = k.split(":"); obsByDLAcr.set(`${acr(Number(d))}:${L}`, { ...v, driver: acr(Number(d)), gap: gapByDL.get(k)?.last ?? null }); }
const windows = candidates.filter((c) => c.salience >= 0.45 || c.id.startsWith("h_")).slice(0, 40).map((cand) => anomalyWindow(cand, { events, stops, lapRows, obsByDriverLap: obsByDLAcr }, [...new Set([...top6, ...(cand.evidence?.driver ? [cand.evidence.driver] : [])])]));

manifest.not_available = ["team/driver radio", "stewards' reasoning documents", "corner of overtakes (overtake_events corner is NULL; location-based detection deferred)", "controlled pit-loss (caution-adjusted) — only observed changes + a labelled estimate"];
const packet = {
  packet_version: PACKET_VERSION, session: { ...sess, total_laps: totalLaps }, drivers: drivers.map((d) => ({ number: d.driver_number, acronym: d.name_acronym, name: d.full_name, team: d.team_name })),
  results: results.map((r) => ({ driver: acr(r.driver_number), position: r.position, points: num(r.points), status: r.status, last_completed_lap: lastLap[r.driver_number] ?? null, grid: num(grid.find((g) => g.driver_number === r.driver_number)?.grid_position) })),
  pole_sitter: pole ? { driver: acr(pole.driver_number), finished: results.find((r) => r.driver_number === pole.driver_number)?.position ?? null } : null,
  grid_penalties: gridPenalties,
  standings_after: standings.slice(0, 8).map((s) => ({ driver: acr(s.driver_number), before: num(s.before) ?? 0, after: num(s.after) })),
  fastest_laps: fastest,
  timeline: { events, links, unresolved_links: unresolved, intervals, announcements },
  stops, pit_clusters: clusters, stints: stints.map((s) => ({ driver: acr(s.driver_number), stint: s.stint_number, compound: s.compound, laps: [s.lap_start, s.lap_end], age_at_start: s.tyre_age_at_start })),
  position_trace: positionTrace, lead_changes: leadChanges, restart_snapshots: restarts, caution_windows: cautionWindows,
  candidate_moments: candidates, anomaly_windows: windows, manifest
};
const dir = outDir ?? resolve(process.cwd(), "..", "analyst", `${sess.year}_${sess.meeting_key}`);
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "packet.json"), JSON.stringify(packet, null, 2) + "\n");
console.log(`packet: ${dir}/packet.json — ${events.length} events, ${intervals.length} intervals, ${stops.length} stops (${clusters.length} clusters), ${leadChanges.length} lead changes, ${candidates.length} candidates`);
for (const f of manifest.flags) console.log("  flag:", f);
await c.end();
