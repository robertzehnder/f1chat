import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const root = resolve(web, '..');
const meeting = '.tmp-figures-recipes-test';
const dir = resolve(root, 'analyst', meeting);
const output = resolve(dir, 'figures/probe.json');
const run = (name = meeting, args = []) => spawnSync(process.execPath,
  ['scripts/analyst/figures.mjs', '--meeting', name, '--verify', ...args], { cwd: web, encoding: 'utf8' });
const recipe = (change = '') => `export default (ctx) => ({ probe() {
  const { packet, text, racingState, surname } = ctx;
  const p = '/position_trace/ANT/0';
  const slots = { lap: { packet_path: p + '/lap' } };
  const fig = {
    chart: { type: 'line_with_stint_markers', lap_numbers: [1],
      series: [{ name: 'Antonelli', values: [packet.position_trace.ANT[0].position] }],
      chart_note: 'Lap 1', racing_state: racingState([1, 2]) },
    caption: text('Position on lap {lap}', slots), alt: text('Lap {lap}', slots),
    series_sources: [{ series: 0, packet_path_template: '/position_trace/ANT/{i}/position',
      lap_path_template: '/position_trace/ANT/{i}/lap', index_from: 0, laps: [1] }],
    decoration_sources: { chart_note: { template: 'Lap {lap}', slots }, racing_state_window: [1, 2] }
  };
  ${change}
  return fig;
} });`;
function compile(change = '') {
  writeFileSync(resolve(dir, 'recipes.mjs'), recipe(change));
  return run();
}
function passes(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(readFileSync(output)).verification.ok, true);
}
function fails(change, pattern) {
  const result = compile(change);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const verification = JSON.parse(readFileSync(output)).verification;
  assert.equal(verification.ok, false);
  assert.match(verification.problems.join('\n'), pattern);
}
// Use an existing explicit null, preserving the frozen packet unchanged.
const missingPoint = `
  const i = packet.position_trace.GAS.findIndex(row => row.position === null);
  if (i < 0) throw new Error('fixture needs an explicit null position');
  fig.chart.lap_numbers = [packet.position_trace.GAS[i].lap];
  fig.chart.series[0].values = [NaN];
  Object.assign(fig.series_sources[0], { packet_path_template: '/position_trace/GAS/{i}/position',
    lap_path_template: '/position_trace/GAS/{i}/lap', index_from: i, laps: fig.chart.lap_numbers });
`;
const inputs = `
  fig.chart.series[0].values = [+(packet.position_trace.ANT[0].lap_s - packet.position_trace.RUS[0].lap_s).toFixed(3)];
  fig.series_sources = [{ series: 0, inputs: [['/position_trace/ANT/0/lap_s', '/position_trace/RUS/0/lap_s']],
    lap_paths: [['/position_trace/ANT/0/lap', '/position_trace/RUS/0/lap']] }];
`;
const gantt = `
  fig.chart = { type: 'stint_gantt', total_laps: packet.session.total_laps,
    stints: packet.stints.map(s => ({ driver: surname(s.driver), start: s.laps[0], end: s.laps[1], compound: String(s.compound).toLowerCase() })),
    gantt_stops: packet.stops.map(s => ({ driver: surname(s.acronym), lap: s.lap,
      label: ({ boundary_spanning: 'red', vsc: 'VSC', sc: 'SC' }[s.class] ?? 'green') })) };
  fig.decoration_sources = {}; fig.series_sources = [];
`;
const position = `
  const ri = packet.results.findIndex(r => r.driver === 'ANT');
  fig.chart = { type: 'position_changes', series: [{ values: [packet.results[ri].grid,
    ...packet.position_trace.ANT.map(r => r.position ?? NaN)] }] };
  fig.series_sources = [{ series: 0, packet_path_template: '/position_trace/ANT/{i}/position',
    lap_path_template: '/position_trace/ANT/{i}/lap', index_from: 0,
    laps: packet.position_trace.ANT.map(r => r.lap), lap0_path: '/results/' + ri + '/grid' }];
  fig.decoration_sources = {};
`;

test('external recipes CLI binding verification and deterministic writes', async t => {
  mkdirSync(dir, { recursive: true });
  copyFileSync(resolve(root, 'analyst/2026_1293/packet.json'), resolve(dir, 'packet.json'));
  try {
    await t.test('happy path replaces built-ins and supports --figure', () => {
      passes(compile());
      assert.deepEqual(readdirSync(resolve(dir, 'figures')), ['probe.json']);
      passes(run(meeting, ['--figure', 'probe']));
    });
    await t.test('explicit null survives deterministic recompilation; changed caption writes', () => {
      passes(compile(missingPoint));
      const first = readFileSync(output, 'utf8');
      assert.equal(JSON.parse(first).chart.series[0].values[0], null);
      passes(run());
      assert.equal(readFileSync(output, 'utf8'), first);
      passes(compile(missingPoint + "fig.caption = text('Changed caption at lap {lap}', slots);"));
      assert.notEqual(readFileSync(output, 'utf8'), first);
    });
    await t.test('series tampering and NaN against finite data fail', () => {
      fails('fig.chart.series[0].values[0] += 1;', /series 0/);
      fails('fig.chart.series[0].values[0] = NaN;', /series 0/);
    });
    await t.test('exact coverage rejects shortened laps and extra values', () => {
      fails('fig.series_sources[0].laps = [];', /series 0.*length/);
      fails('fig.chart.series[0].values.push(14);', /series 0.*length/);
    });
    await t.test('unknown, uncovered and duplicate sources fail', () => {
      fails('fig.series_sources = [{ series: 0, packet_path: p }];', /series 0.*unsupported/);
      fails('fig.chart.series.push({ values: [14] });', /series 1/);
      fails('fig.series_sources.push(fig.series_sources[0]);', /series 0.*exactly one/);
    });
    await t.test('coherently shifted laps cannot relabel packet rows', () => {
      fails(`fig.series_sources[0].index_from = 39;
        fig.series_sources[0].laps = [41]; fig.chart.lap_numbers = [41];
        fig.chart.series[0].values = [packet.position_trace.ANT[39].position];`, /lap binding/);
      fails('delete fig.series_sources[0].lap_path_template;', /lap_path_template/);
    });
    await t.test('derived inputs bind both operand laps and reject NaN and short coverage', () => {
      passes(compile(inputs));
      fails(inputs + `fig.series_sources[0].inputs[0][1] = '/position_trace/RUS/1/lap_s';
        fig.series_sources[0].lap_paths[0][1] = '/position_trace/RUS/1/lap';
        fig.chart.series[0].values[0] = +(packet.position_trace.ANT[0].lap_s - packet.position_trace.RUS[1].lap_s).toFixed(3);`, /lap binding/);
      fails(inputs + 'fig.chart.series[0].values[0] = NaN;', /series 0/);
      fails(inputs + 'fig.series_sources[0].inputs = [];', /coverage length/);
      fails(inputs + 'delete fig.series_sources[0].lap_paths;', /coverage length/);
    });
    await t.test('missing paths fail even when plotted as NaN; explicit null passes', () => {
      fails(missingPoint + "fig.series_sources[0].packet_path_template = '/position_trace/GAS/{i}/positoin';", /does not resolve/);
      passes(compile(missingPoint));
      fails("fig.caption.slots.lap.packet_path = '/missing';", /caption.*does not resolve/);
      fails("fig.caption.slots.lap = { derive: { op: 'count', inputs: ['/missing'] } };", /caption.*does not resolve/);
      fails("fig.series_sources[0].lap_path_template = '/position_trace/ANT/{i}/lpa';", /lap binding.*does not resolve/);
    });
    await t.test('chart note text and annotation lap require matching bindings', () => {
      fails("fig.chart.chart_note = 'Lap 999'; fig.decoration_sources.chart_note.template = 'Lap 999';", /chart_note.*unbound number 999/);
      fails('delete fig.decoration_sources.chart_note;', /chart_note.*missing/);
      fails("fig.chart.chart_note = 'Changed';", /chart_note.*differs/);
      fails(`fig.chart.annotations = [{ lap: 2, text: 'Lap 1' }];
        fig.decoration_sources.annotations = [{ lap: slots.lap, text: { template: 'Lap {lap}', slots } }];`, /annotations 0 lap.*mismatch/);
      passes(compile(`fig.chart.annotations = [{ lap: 1, text: 'Lap 1' }];
        fig.decoration_sources.annotations = [{ lap: slots.lap, text: { template: 'Lap {lap}', slots } }];`));
    });
    await t.test('pit dots and horizontal markers bind coordinates and text', () => {
      const decorations = `fig.chart.trace_pit_dots = [{ x: 1, y: 14, label: 'Lap 1' }];
        fig.decoration_sources.trace_pit_dots = [{ x: slots.lap, y: { packet_path: p + '/position' }, label: { template: 'Lap {lap}', slots } }];
        fig.chart.horizontal_marker = { value: 0, label: 'equal pace' };
        fig.decoration_sources.horizontal_marker = { value: 0, label: { template: 'equal pace', slots: {} } };`;
      passes(compile(decorations));
      fails(decorations + 'fig.chart.trace_pit_dots[0].y = 15;', /trace_pit_dots 0 y.*mismatch/);
      fails(decorations + 'fig.chart.horizontal_marker.value = 1;', /horizontal_marker value/);
      fails(decorations + 'delete fig.decoration_sources.horizontal_marker;', /horizontal_marker/);
      passes(compile(decorations + "fig.chart.horizontal_marker.value = 14; fig.decoration_sources.horizontal_marker.value = { packet_path: p + '/position' };"));
    });
    await t.test('racing state is recomputed from declared window', () => {
      fails('fig.chart.racing_state.total_laps += 1;', /racing_state.*recomputation/);
      fails('delete fig.decoration_sources.racing_state_window;', /racing_state.*window/);
      fails('fig.chart.racing_state = racingState(null); fig.decoration_sources.racing_state_window = null; fig.chart.racing_state.periods[0].from_lap += 1;', /racing_state.*recomputation/);
      passes(compile('fig.chart.racing_state = racingState(null); fig.decoration_sources.racing_state_window = null;'));
    });
    await t.test('gantt stints, stop labels and total laps match packet', () => {
      passes(compile(gantt));
      fails(gantt + "fig.chart.gantt_stops[0].label = 'green';", /gantt_stops 0/);
      fails(gantt + 'fig.chart.stints[0].end += 1;', /stints 0/);
      fails(gantt + 'fig.chart.total_laps += 1;', /total_laps/);
    });
    await t.test('position_changes requires full grid-prefixed implicit lap series', () => {
      passes(compile(position));
      fails(position + 'fig.chart.series[0].values.shift(); delete fig.series_sources[0].lap0_path;', /position_changes/);
      fails(position + 'fig.series_sources[0].laps[0] = 2;', /lap binding/);
      fails(position + 'fig.chart.series[0].values.pop(); fig.series_sources[0].laps.pop();', /position_changes/);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('protected Monza figures verify without any tracked changes, including charge nulls', () => {
  const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const status = () => git(['status', '--porcelain', '--', 'analyst/2026_1293']);
  assert.equal(status().stdout, '', 'protected fixture must start clean');
  const figures = resolve(root, 'analyst/2026_1293/figures');
  const original = new Map(readdirSync(figures).map(name => [name, readFileSync(resolve(figures, name))]));
  try {
    const charge = JSON.parse(readFileSync(resolve(root, 'analyst/2026_1293/figures/charge.json')));
    assert.ok(charge.chart.series.some(s => s.values.includes(null)));
    const result = run('2026_1293');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const name of ['gap_trace', 'closing_rate', 'strategy_split', 'charge']) assert.ok(result.stdout.includes('✅ ' + name + ':'));
    assert.equal(status().stdout, '');
  } finally {
    // The initial clean assertion ensures this cannot discard user edits.
    const restored = git(['checkout', '--', 'analyst/2026_1293/figures']);
    if (restored.status !== 0) {
      // Sandboxed worktrees may not permit writing the shared git index.
      for (const [name, bytes] of original) writeFileSync(resolve(figures, name), bytes);
    }
    assert.equal(status().stdout, '');
  }
});
