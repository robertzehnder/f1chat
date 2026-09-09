// Curves are line-crossing gaps, never sampled gaps to a changing leader.
export default (ctx) => {
  const { packet, text, racingState, pairIdx, lapIdx, surname, colorOf } = ctx;
  const path = (pi, lap, field) => `/pair_gaps/${pi}/laps/${lapIdx(pi, lap)}/${field}`;
  const slot = (packet_path, format) => ({ packet_path, ...(format ? { format } : {}) });
  function gapFigure(pairs, from, to, captionTemplate, altTemplate, extraSlots = {}) {
    const window = [from, to];
    const first = pairIdx(...pairs[0]);
    const laps = packet.pair_gaps[first].laps.filter(r => r.lap >= from && r.lap <= to).map(r => r.lap);
    const slots = { from: slot(path(first, from, 'lap')), to: slot(path(first, to, 'lap')), ...extraSlots };
    const note = text('Positive gaps place the named pursuer behind the reference driver; negative gaps place the pursuer ahead. Gaps use lap-ending line crossings. The final lap, where shown, is reconstructed from lap start plus duration.', {});
    const zero = text('Level at the line', {});
    return {
      chart: {
        type: 'race_trace', x_label: 'Lap', y_label: `Gap to ${surname(pairs[0][0])} (s)`, y_value_format: 'decimal_seconds',
        lap_numbers: laps,
        series: pairs.map(([a, b]) => {
          const pg = packet.pair_gaps[pairIdx(a, b)];
          const rows = pg.laps.filter(r => r.lap >= from && r.lap <= to);
          return { name: `${surname(b)} behind ${surname(a)}`, color: colorOf(b), values: rows.map(r => r.gap === null ? NaN : r.gap), point_quality: rows.map(r => r.quality) };
        }),
        racing_state: racingState(window), chart_note: note.rendered,
        horizontal_marker: { value: 0, label: zero.rendered }
      },
      caption: text(captionTemplate, slots), alt: text(altTemplate, slots),
      series_sources: pairs.map(([a, b], series) => {
        const pi = pairIdx(a, b);
        return { series, packet_path_template: `/pair_gaps/${pi}/laps/{i}/gap`, index_from: lapIdx(pi, from), laps,
          lap_path_template: `/pair_gaps/${pi}/laps/{i}/lap` };
      }),
      decoration_sources: { racing_state_window: window, chart_note: note, horizontal_marker: { value: 0, label: zero } }
    };
  }
  const ra = pairIdx('RUS', 'ANT'), rv = pairIdx('RUS', 'VER'), np = pairIdx('NOR', 'PIA');
  return {
    early_lead_exchange: () => gapFigure([['RUS', 'ANT'], ['RUS', 'VER']], 11, 24,
      'The lead was contested before the VSC: gaps to Russell over laps {from}–{to}. Antonelli led from lap {ant_lead} before Russell returned ahead on lap {rus_lead}.',
      'Gap curves cross the level line as Verstappen and then Antonelli run ahead of Russell during laps {from}–{to}. Antonelli is back behind Russell at lap {rus_lead}.',
      { ant_lead: slot('/lead_changes/3/lap'), rus_lead: slot('/lead_changes/4/lap') }),
    unequal_recoveries: () => gapFigure([['RUS', 'ANT'], ['RUS', 'VER']], 27, packet.session.total_laps,
      'Shared VSC stop, different recoveries: laps {from}–{to}. At lap {late}, Antonelli was {ant} s behind Russell and Verstappen was {ver} s behind. Final points use lap start plus duration.',
      'Antonelli and Verstappen fall behind Russell around the VSC stop, then their curves diverge. At lap {late}, Antonelli is {ant} s behind, while Verstappen is {ver} s behind; Antonelli crosses into the lead before the finish.',
      { late: slot(path(ra, 48, 'lap')), ant: slot(path(ra, 48, 'gap'), '0.000'), ver: slot(path(rv, 48, 'gap'), '0.000') }),
    mclaren_finish: () => gapFigure([['NOR', 'PIA']], 43, packet.session.total_laps,
      'McLaren’s order remained unsettled over laps {from}–{to}. Piastri finished {gap} s behind Norris in the reconstructed final line-crossing comparison.',
      'Piastri’s gap to Norris crosses the level line late in the race. The final reconstructed point places Piastri {gap} s behind Norris.',
      { gap: slot(path(np, packet.session.total_laps, 'gap'), '0.000') })
  };
};
