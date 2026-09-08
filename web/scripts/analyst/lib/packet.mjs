/**
 * packet.mjs — canonical evidence-packet transforms (analyst design U1).
 * Pure functions over raw/core rows; fixture-tested. Temporal contract:
 *  - observation → lap: t ∈ [lap.date_start, next lap.date_start) for that driver;
 *    several per lap → keep LAST as lap-end state, all kept in observations[]
 *  - before X = last observation strictly before X.ts; after X = first after X.end
 *  - racing-state intervals: SC opens at "SAFETY CAR DEPLOYED", VSC at "VSC DEPLOYED",
 *    RED at "RED FLAG"; a VSC "ENDING" message NEVER closes (warning only);
 *    "RACE WILL RESUME AT" is an ANNOUNCEMENT (announcements[]), never a close.
 *    Explicit closes: "VSC ENDED", "SAFETY CAR IN THIS LAP" (closes at that lap's
 *    end), "GREEN LIGHT"/"TRACK CLEAR" after a red. Missing endpoints are
 *    INFERRED and flagged: VSC → end of the ENDING-message lap
 *    (endpoint_inferred:'ending_lap_end'); RED → the first non-announcement
 *    state message after the announcement (endpoint_inferred:'resumption_state_msg');
 *    SC "LIGHTS ON" → SC ends at that lap's end (endpoint_inferred:'lights_on_lap_end').
 *  - stop class by OVERLAP of [entry, entry+duration] with intervals:
 *    inside → class; spanning → 'boundary_spanning' with fractions; none → 'green'
 *  - links between race-control rows only on car AND occurred-lap match, else unresolved.
 */

const T = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

// ---------------------------------------------------------------- timeline
export function typeMessage(msg) {
  const m = (msg ?? "").toUpperCase();
  if (/^RED FLAG/.test(m)) return "red";
  if (/VIRTUAL SAFETY CAR|VSC/.test(m)) return "vsc";
  if (/SAFETY CAR/.test(m)) return "sc";
  if (/CHEQUERED/.test(m)) return "chequered";
  if (/RACE WILL RESUME|WILL RESTART/.test(m)) return "announcement";
  if (/GREEN LIGHT|TRACK CLEAR/.test(m)) return "green";
  if (/TIME PENALTY|GRID PENALTY|DRIVE THROUGH|STOP.?GO|REPRIMAND/.test(m)) return "penalty";
  if (/UNDER INVESTIGATION|WILL BE INVESTIGATED|NOTED/.test(m)) return "investigation";
  if (/NO FURTHER (ACTION|INVESTIGATION)|NO INVESTIGATION/.test(m)) return "decision";
  if (/LAP DELETED|TIME .* DELETED/.test(m)) return "deleted_lap";
  if (/BLACK AND WHITE/.test(m)) return "black_white";
  if (/BLUE FLAG/.test(m)) return "blue_flag";
  if (/YELLOW|DOUBLE YELLOW|CLEAR IN TRACK SECTOR/.test(m)) return "flag_sector";
  return "other";
}

export function parseEvent(row, i) {
  const msg = row.message ?? "";
  const cars = [...msg.matchAll(/CAR[S]? (\d{1,2})/gi)].map((m) => Number(m[1]));
  if (!cars.length && row.driver_number) cars.push(Number(row.driver_number));
  const occ = msg.match(/\bLAP (\d{1,3})\b/i);
  const turn = msg.match(/\bTURN (\d{1,2})\b/i);
  return {
    id: `rc${i}`,
    type: typeMessage(msg),
    issued_at: new Date(row.date).toISOString(),
    issued_lap: row.lap_number == null ? null : Number(row.lap_number),
    occurred_lap: occ ? Number(occ[1]) : null,
    corner: turn ? Number(turn[1]) : null,
    cars,
    category: row.category ?? null,
    flag: row.flag ?? null,
    message: msg
  };
}

/** Typed links: investigates/decides/penalizes ONLY on car + occurred-lap match. */
export function linkEvents(events) {
  const links = [];
  const unresolved = [];
  for (const e of events) {
    if (!["penalty", "decision"].includes(e.type)) continue;
    const kind = e.type === "penalty" ? "penalizes" : "decides";
    const cands = events.filter((x) => x.type === "investigation" && x.cars.some((c) => e.cars.includes(c)));
    const exact = cands.filter((x) => e.occurred_lap != null && (x.occurred_lap ?? x.issued_lap) === e.occurred_lap);
    if (exact.length === 1) { links.push({ from: e.id, to: exact[0].id, kind, basis: "car+occurred_lap" }); continue; }
    // Second basis: identical infringement subtype clause ("– ESCAPE ROAD INSTRUCTIONS") — text identity, not theme.
    const dashClauses = [...e.message.matchAll(/[–-]\s*([A-Z][A-Z ]{6,}?)\s*(?=\(|$|[–-])/g)].map((m) => m[1].trim());
    const subtype = dashClauses.length ? dashClauses[dashClauses.length - 1] : null; // LAST clause = most specific
    const bySub = subtype ? cands.filter((x) => x.message.toUpperCase().includes(subtype)) : [];
    // Several stage messages (NOTED → UNDER INVESTIGATION) can describe ONE incident: link to each.
    if (bySub.length >= 1) { for (const x of bySub) links.push({ from: e.id, to: x.id, kind, basis: `car+subtype:${subtype}` }); continue; }
    unresolved.push({ event: e.id, kind, candidates: cands.map((x) => x.id), reason: exact.length ? "multiple exact matches" : "no car+lap or subtype match" });
  }
  return { links, unresolved };
}

/** Racing-state intervals with exact/inferred endpoints + announcements. */
export function racingIntervals(events, lapEnds /* Map<lap, ms> leader lap end times */) {
  const intervals = [];
  const announcements = [];
  let open = null;
  let lastAnnouncementTs = null;
  const lapEnd = (lap) => (lapEnds?.get(lap) ?? null);
  const close = (ev, ts, inferred) => {
    if (!open) return;
    open.end = new Date(ts).toISOString();
    open.end_lap = ev.issued_lap;
    if (inferred) open.endpoint_inferred = inferred;
    open.closed_by = ev.id;
    open.closed_by_message = ev.message;
    intervals.push(open); open = null;
  };
  for (const e of events) {
    const m = e.message.toUpperCase();
    if (e.type === "announcement") { announcements.push({ event: e.id, issued_at: e.issued_at, message: e.message }); lastAnnouncementTs = T(e.issued_at); continue; }
    if (e.type === "red" && /RED FLAG/.test(m)) {
      if (open) close(e, T(e.issued_at), "superseded_by_red");
      open = { kind: "red", start: e.issued_at, start_lap: e.issued_lap, opened_by: e.id }; continue;
    }
    if (e.type === "vsc" && /DEPLOYED/.test(m)) {
      if (open && open.kind !== "vsc") close(e, T(e.issued_at), "superseded_by_vsc");
      if (!open) open = { kind: "vsc", start: e.issued_at, start_lap: e.issued_lap, opened_by: e.id };
      continue; // duplicate DEPLOYED is idempotent
    }
    if (e.type === "vsc" && /ENDED/.test(m) && open?.kind === "vsc") { close(e, T(e.issued_at), null); continue; }
    if (e.type === "vsc" && /ENDING/.test(m) && open?.kind === "vsc") {
      // warning only — never closes. Inferred close at end of this lap, unless a real ENDED follows.
      open.ending_warning = e.id;
      const le = lapEnd(e.issued_lap);
      open.inferred_close = { ts: le ?? T(e.issued_at), lap: e.issued_lap, ev: e.id, how: le ? "ending_lap_end" : "ending_msg_ts" };
      continue;
    }
    if (e.type === "sc" && /DEPLOYED/.test(m)) {
      if (open && open.kind !== "sc") { if (open.kind === "red") { /* SC restart after red: closes the red */ close(e, T(e.issued_at), "resumption_state_msg"); } else close(e, T(e.issued_at), "superseded_by_sc"); }
      if (!open) open = { kind: "sc", start: e.issued_at, start_lap: e.issued_lap, opened_by: e.id };
      continue;
    }
    if (e.type === "sc" && /LIGHTS ON|IN THIS LAP/.test(m)) {
      if (open?.kind === "red") { // restart behind the safety car: red ends here, SC period runs to lap end
        close(e, T(e.issued_at), "resumption_state_msg");
        const le = lapEnd(e.issued_lap);
        intervals.push({ kind: "sc", start: e.issued_at, start_lap: e.issued_lap, opened_by: e.id,
          end: new Date(le ?? T(e.issued_at)).toISOString(), end_lap: e.issued_lap, closed_by: e.id,
          endpoint_inferred: le ? "lights_on_lap_end" : "lights_on_msg_ts" });
        continue;
      }
      if (open?.kind === "sc") { const le = lapEnd(e.issued_lap); close(e, le ?? T(e.issued_at), le ? "in_this_lap_lap_end" : "in_this_lap_msg_ts"); continue; }
    }
    if (e.type === "green" && open) {
      // During a suspension, "GREEN LIGHT - PIT EXIT OPEN"/"TRACK CLEAR" messages
      // precede the resumption; a red closes on a green ONLY after the resumption
      // announcement (or via an SC-restart state message above).
      if (open.kind === "red") {
        if (/PIT EXIT/.test(m)) continue;
        if (lastAnnouncementTs == null || T(e.issued_at) < lastAnnouncementTs) continue;
      }
      close(e, T(e.issued_at), null); continue;
    }
    if (e.type === "chequered" && open) {
      if (open.inferred_close) { const ic = open.inferred_close; open.end = new Date(ic.ts).toISOString(); open.end_lap = ic.lap; open.endpoint_inferred = ic.how; open.closed_by = ic.ev; intervals.push(open); open = null; }
      else close(e, T(e.issued_at), "unclosed_at_chequered");
    }
  }
  // VSC with an ENDING warning but no ENDED before any other state change
  if (open?.inferred_close) { const ic = open.inferred_close; open.end = new Date(ic.ts).toISOString(); open.end_lap = ic.lap; open.endpoint_inferred = ic.how; open.closed_by = ic.ev; intervals.push(open); open = null; }
  if (open) { open.end = null; open.endpoint_inferred = "never_closed"; intervals.push(open); }
  return { intervals, announcements };
}

// ---------------------------------------------------------------- stops
export function classifyStop(stop, intervals) {
  const a = T(stop.entry), b = a + Number(stop.pit_duration ?? 0) * 1000;
  const overlaps = [];
  for (const iv of intervals) {
    const s = T(iv.start), e = iv.end ? T(iv.end) : Infinity;
    const lo = Math.max(a, s), hi = Math.min(b, e);
    if (hi > lo) overlaps.push({ kind: iv.kind, fraction: +((hi - lo) / Math.max(1, b - a)).toFixed(3), interval: iv.opened_by });
  }
  if (!overlaps.length) return { class: "green", overlaps };
  const full = overlaps.find((o) => o.fraction >= 0.999);
  if (full && overlaps.length === 1) return { class: full.kind, overlaps };
  return { class: "boundary_spanning", overlaps };
}

// ---------------------------------------------------------------- traces
/** lapWindows: per driver sorted laps [{lap, start}] → observation lap. */
export function mapObservationsToLaps(obs, lapsByDriver) {
  const byDriverLap = new Map(); // key `${d}:${lap}` → { last, observations[] }
  for (const o of obs) {
    const laps = lapsByDriver.get(Number(o.driver_number));
    if (!laps?.length) continue;
    const t = T(o.date);
    let lap = null;
    for (let i = 0; i < laps.length; i++) {
      const next = laps[i + 1]?.start ?? Infinity;
      if (t >= laps[i].start && t < next) { lap = laps[i].lap; break; }
    }
    if (lap == null) continue;
    const key = `${o.driver_number}:${lap}`;
    if (!byDriverLap.has(key)) byDriverLap.set(key, { driver: Number(o.driver_number), lap, observations: [] });
    byDriverLap.get(key).observations.push({ ts: new Date(o.date).toISOString(), ...o.value });
  }
  for (const v of byDriverLap.values()) { v.observations.sort((x, y) => T(x.ts) - T(y.ts)); v.last = v.observations[v.observations.length - 1]; }
  return byDriverLap;
}

/** as-of snapshot: for each driver, last observation strictly before ts. */
export function asOf(obs, ts, pick) {
  const t = T(ts);
  const best = new Map();
  for (const o of obs) {
    const ot = T(o.date);
    if (ot >= t) continue;
    const d = Number(o.driver_number);
    if (!best.has(d) || ot > T(best.get(d).date)) best.set(d, o);
  }
  return [...best.entries()].map(([driver, o]) => ({ driver, ts: new Date(o.date).toISOString(), ...pick(o) }));
}

/** Candidate moments from discontinuities — salience-scored, never "decisive". */
export function candidateMoments({ intervals, stops, leadChanges, gapTrace, events, lapRows = [], focusDrivers = [], humanAdded = [] }) {
  const cands = [];
  // lap-time spikes for focus drivers: non-pit lap > (driver median + 3s) and no caution covering it
  const cautionLaps = new Set(); for (const iv of intervals) for (let L = iv.start_lap ?? 0; L <= (iv.end_lap ?? iv.start_lap ?? 0); L++) cautionLaps.add(L);
  for (const d of focusDrivers) {
    const rows = lapRows.filter((l) => l.driver === d && l.lap_s && !l.pit_out).sort((a, b) => a.lap - b.lap);
    const sorted = rows.map((l) => l.lap_s).sort((a, b) => a - b); const med = sorted[Math.floor(sorted.length / 2)];
    for (const l of rows) if (med && l.lap_s > med + 3 && !cautionLaps.has(l.lap) && !cautionLaps.has(l.lap - 1) && !lapRows.some((x) => x.driver === d && x.lap === l.lap + 1 && x.pit_out)) {
      cands.push({ id: `m_lapspike_${d}_${l.lap}`, type: "lap_time_spike", lap: l.lap, salience: 0.45, signal: `${d} lap ${l.lap}: ${l.lap_s}s vs median ${med}s`, evidence: { driver: d, lap: l.lap, lap_s: l.lap_s, median_s: med, s1: l.s1, s2: l.s2, s3: l.s3 } });
    }
  }
  // drop field-wide slow laps (restart/formation): a lap where ≥4 focus drivers spike is procedural, not a driver anomaly
  const spikeLaps = new Map(); for (const c of cands.filter((c) => c.type === "lap_time_spike")) spikeLaps.set(c.lap, (spikeLaps.get(c.lap) ?? 0) + 1);
  for (let i = cands.length - 1; i >= 0; i--) if (cands[i].type === "lap_time_spike" && spikeLaps.get(cands[i].lap) >= 4) cands.splice(i, 1);
  for (const h of humanAdded) cands.push({ id: `h_${h.id}`, type: h.type ?? "human_added", lap: h.lap, salience: h.salience ?? 0.5, signal: h.signal ?? "human-added", human_reason: h.reason, evidence: h.evidence ?? {} });
  for (const iv of intervals) {
    const inside = stops.filter((s) => s.class === iv.kind || (s.class === "boundary_spanning" && s.overlaps.some((o) => o.interval === iv.opened_by)));
    cands.push({ id: `m_${iv.kind}_${iv.start_lap}`, type: `caution:${iv.kind}`, lap: iv.start_lap, salience: 0.6 + Math.min(0.4, inside.length * 0.06),
      signal: inside.length >= 3 ? "caution×pit-cluster" : "caution", evidence: { interval: iv.opened_by, stops_inside: inside.map((s) => s.driver) } });
  }
  for (const lc of leadChanges) cands.push({ id: `m_lead_${lc.lap}`, type: "lead_change", lap: lc.lap, salience: 0.5, signal: "order change at P1", evidence: lc });
  for (const g of gapTrace) { // g: {driver, lap, gap, prev_gap}
    if (g.prev_gap != null && g.gap != null && Math.abs(g.gap - g.prev_gap) >= 2.5) {
      cands.push({ id: `m_gap_${g.driver}_${g.lap}`, type: "gap_discontinuity", lap: g.lap, salience: 0.4, signal: `gap ${g.prev_gap}→${g.gap}`, evidence: g });
    }
  }
  for (const e of events.filter((x) => x.type === "penalty")) cands.push({ id: `m_pen_${e.id}`, type: "penalty", lap: e.occurred_lap ?? e.issued_lap, salience: 0.3, signal: e.message.slice(0, 80), evidence: { event: e.id } });
  return cands.sort((a, b) => b.salience - a.salience);
}

/** Anomaly window: local evidence around a candidate. */
export function anomalyWindow(cand, { events, stops, lapRows, obsByDriverLap }, drivers) {
  const lo = (cand.lap ?? 0) - 2, hi = (cand.lap ?? 0) + 2;
  return {
    candidate: cand.id, lap_range: [lo, hi],
    race_control: events.filter((e) => (e.issued_lap != null && e.issued_lap >= lo && e.issued_lap <= hi) || (e.occurred_lap != null && e.occurred_lap >= lo && e.occurred_lap <= hi)).map((e) => ({ id: e.id, lap: e.issued_lap, occurred_lap: e.occurred_lap, type: e.type, message: e.message })),
    stops: stops.filter((s) => s.lap >= lo && s.lap <= hi),
    laps: lapRows.filter((l) => drivers.includes(l.driver) && l.lap >= lo && l.lap <= hi),
    observations: drivers.flatMap((d) => [lo, lo + 1, cand.lap, hi - 1, hi].filter((l, i, a) => a.indexOf(l) === i).map((l) => obsByDriverLap.get(`${d}:${l}`)).filter(Boolean))
  };
}
