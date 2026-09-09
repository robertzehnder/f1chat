// Figure recipes for the 2026 Dutch Grand Prix (Zandvoort, session 11353).
// Every number on every figure binds to a packet path; the compiler's strict
// verifier re-renders captions and recomputes series from these bindings.
export default (ctx) => {
  const { packet, text, racingState, pairIdx, lapIdx, traceIdx, surname, colorOf } = ctx;
  const total = packet.session.total_laps;
  const slot = (packet_path, format) => ({ packet_path, ...(format ? { format } : {}) });
  const ri = (acr) => packet.results.findIndex((r) => r.driver === acr);
  const si = (acr, lap) => packet.stops.findIndex((s) => s.acronym === acr && s.lap === lap);
  const lci = (lap, driver) => packet.lead_changes.findIndex((c) => c.lap === lap && c.driver === driver);
  const ivi = (kind, lap) => packet.timeline.intervals.findIndex((iv) => iv.kind === kind && iv.start_lap === lap);

  return {
    // 1. Position by lap: winner, runner-up, third, and Hamilton (led twice by staying out)
    charge: () => {
      const drivers = ["NOR", "ANT", "RUS", "HAM"];
      const laps = Array.from({ length: total }, (_, i) => i + 1);
      const series = drivers.map((acr) => ({
        name: surname(acr), color: colorOf(acr, acr === "RUS" ? 1 : 0), emphasis: acr === "NOR" || acr === "ANT",
        values: [packet.results[ri(acr)].grid, ...laps.map((L) => packet.position_trace[acr][traceIdx(acr, L)]?.position ?? NaN)]
      }));
      const note = text("Classified order at the end of each lap; the feed logs changes only, so a position is carried forward until the next logged change. Lap zero = grid.", {});
      const slots = {
        nor: slot(`/results/${ri("NOR")}/driver`, "surname"), ant: slot(`/results/${ri("ANT")}/driver`, "surname"), ham: slot(`/results/${ri("HAM")}/driver`, "surname"),
        ant_lead: slot(`/lead_changes/${lci(5, "ANT")}/lap`), nor_lead: slot(`/lead_changes/${lci(40, "NOR")}/lap`),
        ham_lead: slot(`/lead_changes/${lci(48, "HAM")}/lap`), nor_final: slot(`/lead_changes/${lci(54, "NOR")}/lap`),
        red_lap: slot(`/timeline/intervals/${ivi("red", 2)}/start_lap`)
      };
      return {
        chart: { type: "position_changes", series, racing_state: racingState(), chart_note: note.rendered },
        caption: text("{nor} started from pole but {ant} led from the lap-{red_lap} red-flag restart until lap {nor_lead}, when {nor} stayed out to build an offset; {ham} ran longest of all and led from lap {ham_lead} until {nor} took the lead for good on lap {nor_final}.", slots),
        alt: text("Step chart of race position by lap for Norris, Antonelli, Russell and Hamilton with the red flag, safety car and VSC periods shaded; Antonelli leads from lap {ant_lead}, Norris from lap {nor_final}.", slots),
        series_sources: drivers.map((acr, i) => ({ series: i, packet_path_template: `/position_trace/${acr}/{i}/position`, lap_path_template: `/position_trace/${acr}/{i}/lap`, index_from: 0, laps, lap0_path: `/results/${ri(acr)}/grid` })),
        decoration_sources: { racing_state_window: null, chart_note: note }
      };
    },

    // 2. Tyre strategies of the top eight
    strategy_split: () => {
      const order = packet.results.filter((r) => r.position != null).sort((a, b) => a.position - b.position).slice(0, 8).map((r) => r.driver);
      const stints = packet.stints.filter((s) => order.includes(s.driver)).map((s) => ({ driver: surname(s.driver), start: s.laps[0], end: s.laps[1], compound: String(s.compound).toLowerCase() }));
      const stops = packet.stops.filter((s) => order.includes(s.acronym)).map((s) => ({ driver: surname(s.acronym), lap: s.lap, label: s.class === "boundary_spanning" ? "red" : s.class === "vsc" ? "VSC" : s.class === "sc" ? "SC" : "green" }));
      const note = text("Top eight finishers. Stops during the lap-{red_lap} red flag were tyre changes while the race was suspended; the stops on laps {vsc_a} and {vsc_b} came under the virtual safety car.", { red_lap: slot(`/timeline/intervals/${ivi("red", 2)}/start_lap`), vsc_a: slot(`/stops/${si("HAM", 55)}/lap`), vsc_b: slot(`/stops/${si("ANT", 56)}/lap`) });
      const sti = (acr, n) => packet.stints.findIndex((s) => s.driver === acr && s.stint === n);
      const slots = {
        nor: slot(`/stints/${sti("NOR", 2)}/driver`, "surname"), ant: slot(`/stints/${sti("ANT", 2)}/driver`, "surname"),
        nor_c2: slot(`/stints/${sti("NOR", 2)}/compound`, "lower"), ant_c2: slot(`/stints/${sti("ANT", 2)}/compound`, "lower"),
        pia: slot(`/stints/${sti("PIA", 2)}/driver`, "surname"), pia_c2: slot(`/stints/${sti("PIA", 2)}/compound`, "lower"),
        nor_stop2: slot(`/stops/${si("NOR", 47)}/lap`), ant_stop2: slot(`/stops/${si("ANT", 40)}/lap`),
        n_vsc: { derive: { op: "count", inputs: packet.stops.map((s, i) => (s.class === "vsc" ? `/stops/${i}/lap` : null)).filter(Boolean) } },
        red_lap: slot(`/timeline/intervals/${ivi("red", 2)}/start_lap`)
      };
      return {
        chart: { type: "stint_gantt", y_axis: order.map(surname), total_laps: total, stints, compound_legend: { hard: "#E5E7EB", medium: "#FCD34D", soft: "#EF4444" }, gantt_stops: stops, racing_state: racingState(), chart_note: note.rendered },
        caption: text("Tyre strategies of the top eight. At the lap-{red_lap} red flag {nor} took {nor_c2}s and {pia} took {pia_c2}s while {ant} stayed on {ant_c2}s; {ant} made his second stop on lap {ant_stop2} and {nor} ran seven laps longer to lap {nor_stop2}. {n_vsc} stops were made under the late virtual safety car.", slots),
        alt: text("Gantt chart of tyre stints for the top eight finishers with the red flag, safety car and VSC periods shaded and pit stops marked; {nor} on {nor_c2}s then hards, {ant} on {ant_c2}s then hards then softs.", slots),
        series_sources: [{ series: "stints", packet_path: "/stints", filter: "driver in top 8" }],
        decoration_sources: { racing_state_window: null, chart_note: note }
      };
    },

    // 3. Antonelli's gap to Norris at the end of each lap, whole race (hero)
    gap_trace: () => {
      const pi = pairIdx("NOR", "ANT"); const pg = packet.pair_gaps[pi];
      const from = 3, to = total;
      const rows = pg.laps.filter((l) => l.lap >= from && l.lap <= to);
      const laps = rows.map((l) => l.lap);
      const L = (lap, field = "gap") => `/pair_gaps/${pi}/laps/${lapIdx(pi, lap)}/${field}`;
      const series = [{ name: "Antonelli behind Norris", color: colorOf("ANT"), values: rows.map((l) => (l.gap == null ? NaN : l.gap)), point_quality: rows.map((l) => l.quality) }];
      const note = text("Gap = difference of the two cars' line-crossing times at the end of each lap; positive = Antonelli behind Norris, below the zero line = ahead. Final lap from lap start + lap time.", {});
      const zero = text("level", {});
      const dots = [21, 40, 56].map((lap) => ({ x: lap, y: rows.find((l) => l.lap === lap).gap, color: colorOf("ANT"), driver: "Antonelli", label: lap === 56 ? "stop · VSC" : "stop" }));
      const dotBindings = [21, 40, 56].map((lap) => ({ x: slot(`/stops/${si("ANT", lap)}/lap`), y: slot(L(lap)), label: text(lap === 56 ? "stop · VSC" : "stop", {}) }));
      const ann = [{ lap: 47, text: "Norris stops L47", kind: "note" }, { lap: 54, text: "Norris leads", kind: "pass" }];
      const annBindings = [{ lap: slot(`/stops/${si("NOR", 47)}/lap`), text: text("Norris stops L{lap}", { lap: slot(`/stops/${si("NOR", 47)}/lap`) }) }, { lap: slot(`/lead_changes/${lci(54, "NOR")}/lap`), text: text("Norris leads", {}) }];
      const slots = {
        from: slot(L(from, "lap")), to: slot(L(to, "lap")),
        l39: slot(L(39, "lap")), g39: { derive: { op: "sub", inputs: [0, L(39)] }, format: "0.0" },
        nor_stop: slot(`/stops/${si("NOR", 47)}/lap`), l48: slot(L(48, "lap")), g48: { derive: { op: "sub", inputs: [0, L(48)] }, format: "0.0" },
        l53: slot(L(53, "lap")), g53: { derive: { op: "sub", inputs: [0, L(53)] }, format: "0.000" }, pass_lap: slot(`/lead_changes/${lci(54, "NOR")}/lap`),
        vsc_lap: slot(`/timeline/intervals/${ivi("vsc", 55)}/start_lap`), l57: slot(L(57, "lap")), g57: slot(L(57), "0.0"), gfin: slot(L(to), "0.0")
      };
      return {
        chart: {
          type: "race_trace", x_label: "Lap", y_label: "Antonelli's gap to Norris (s)", y_value_format: "decimal_seconds",
          series, lap_numbers: laps, y_domain: [-8, 20], trace_pit_dots: dots, annotations: ann,
          racing_state: racingState([from, to]), chart_note: note.rendered, horizontal_marker: { value: 0, label: zero.rendered }
        },
        caption: text("Antonelli's gap to Norris at the end of each lap, laps {from}–{to}. Antonelli led by {g39} s at lap {l39}; Norris stayed out until lap {nor_stop} and rejoined {g48} s behind at lap {l48}; by lap {l53} he was {g53} s behind, and he led from lap {pass_lap}. After the lap-{vsc_lap} VSC stops he was {g57} s clear by lap {l57}; the reconstructed final margin is {gfin} s.", slots),
        alt: text("Line chart of Antonelli's gap to Norris by lap from {from} to {to}: below zero while Antonelli leads, a jump after Norris's lap-{nor_stop} stop, a steady close to {g53} s by lap {l53}, then Norris ahead from lap {pass_lap} and clear after the lap-{vsc_lap} VSC.", slots),
        series_sources: [{ series: 0, packet_path_template: `/pair_gaps/${pi}/laps/{i}/gap`, lap_path_template: `/pair_gaps/${pi}/laps/{i}/lap`, index_from: lapIdx(pi, from), laps }],
        decoration_sources: { racing_state_window: [from, to], chart_note: note, trace_pit_dots: dotBindings, annotations: annBindings, horizontal_marker: { value: 0, label: zero } }
      };
    },

    // 4. The chase after Norris's second stop: lap time difference, laps 49–53 (clean laps only)
    closing_rate: () => {
      const from = 49, to = 53;
      const laps = Array.from({ length: to - from + 1 }, (_, i) => from + i);
      const pathOf = (acr, L, f) => `/position_trace/${acr}/${traceIdx(acr, L)}/${f}`;
      const delta = laps.map((L) => { const n = packet.position_trace.NOR[traceIdx("NOR", L)].lap_s, a = packet.position_trace.ANT[traceIdx("ANT", L)].lap_s; return n != null && a != null ? +(n - a).toFixed(3) : NaN; });
      const inputsN = laps.map((L) => pathOf("NOR", L, "lap_s")), inputsA = laps.map((L) => pathOf("ANT", L, "lap_s"));
      const note = text("Negative = Norris faster. Laps {from}–{to} are the clean laps between Norris's out-lap and his pass; neither car pitted in this window.", { from: slot(pathOf("NOR", from, "lap")), to: slot(pathOf("NOR", to, "lap")) });
      const zero = text("equal pace", {});
      const slots = {
        from: slot(pathOf("NOR", from, "lap")), to: slot(pathOf("NOR", to, "lap")),
        mean_nor: { derive: { op: "mean", inputs: inputsN }, format: "0.000" }, mean_ant: { derive: { op: "mean", inputs: inputsA }, format: "0.000" },
        n: { derive: { op: "count", inputs: inputsN } }
      };
      return {
        chart: { type: "line_with_stint_markers", x_label: "Lap", y_label: "Norris − Antonelli (s)", y_value_format: "decimal_seconds", series: [{ name: "Norris − Antonelli", color: colorOf("NOR"), values: delta }], lap_numbers: laps, horizontal_marker: { value: 0, label: zero.rendered }, chart_note: note.rendered },
        caption: text("Norris's lap time minus Antonelli's, laps {from}–{to}. Over those {n} laps Norris averaged {mean_nor} s a lap against Antonelli's {mean_ant} s.", slots),
        alt: text("Line chart of the per-lap time difference between Norris and Antonelli for laps {from} to {to}; every point is below zero, Norris faster.", slots),
        series_sources: [{ series: 0, derived: "lap_s(NOR, L) − lap_s(ANT, L)", inputs: laps.map((L, i) => [inputsN[i], inputsA[i]]), lap_paths: laps.map((L) => [pathOf("NOR", L, "lap"), pathOf("ANT", L, "lap")]) }],
        decoration_sources: { chart_note: note, horizontal_marker: { value: 0, label: zero } }
      };
    }
  };
};
