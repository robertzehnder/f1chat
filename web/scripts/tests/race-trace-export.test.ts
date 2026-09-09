import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import { isValidElement, type ReactNode } from 'react'
import { Line, LineChart, ReferenceLine } from 'recharts'
import { RaceTraceChart } from '../../src/components/f1-chat/charts/race-trace-chart'
import type { ChartSpec } from '../../src/lib/chart-types'

// tsx runs the project's JSX-preserving files with the classic JSX runtime.
// Next supplies its own runtime in production. Keep this test shim local.
// Recharts defaults to static lines during SSR. Emulate its browser default
// so a Node test cannot pass just because it ran outside the browser.
const previousAnimationDefault = Line.defaultProps.isAnimationActive
Line.defaultProps.isAnimationActive = true
after(() => { Line.defaultProps.isAnimationActive = previousAnimationDefault })

const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React')
Object.defineProperty(globalThis, 'React', { value: React, configurable: true })
after(() => {
  if (previousReact) Object.defineProperty(globalThis, 'React', previousReact)
  else Reflect.deleteProperty(globalThis, 'React')
})

// Inspect the actual renderer's element tree without requiring a browser.
// This catches a client-side animated reveal even though SSR defaults can
// make the same chart look complete in a server-rendered snapshot.
function elements(node: ReactNode): Array<{ type: unknown; props: Record<string, any> }> {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement(node)) return []
  const element = node as { type: unknown; props: Record<string, any> }
  return [element, ...elements(element.props.children)]
}

const terminalValues: Record<string, number[]> = {
  early_lead_exchange: [0.678, 1.477],
  unequal_recoveries: [-3.942, 10.77],
  mclaren_finish: [0.238],
}

for (const [name, expected] of Object.entries(terminalValues)) {
  test(`${name}: every trace renders immediately through its packet-bound endpoint`, () => {
    const figure = JSON.parse(readFileSync(new URL(
      `../../../analyst/2026_1293_gpt6/figures/${name}.json`, import.meta.url), 'utf8'))
    const chart = figure.chart as ChartSpec
    const tree = elements(RaceTraceChart({ chart }))
    const markers = tree.filter(element => element.type === ReferenceLine)
    assert.ok(chart.horizontal_marker)
    assert.equal(chart.horizontal_marker.value, 0)
    assert.equal(chart.horizontal_marker.label, 'Level at the line')
    assert.equal(markers.length, 1)
    assert.equal(markers[0].props.y, chart.horizontal_marker.value)
    assert.equal(markers[0].props.label.value, chart.horizontal_marker.label)
    const lines = tree.filter(element => element.type === Line)
    const plot = tree.find(element => element.type === LineChart)
    assert.ok(plot)
    assert.equal(lines.length, expected.length)
    const terminal = plot.props.data.at(-1)
    assert.equal(terminal.lap, name === 'early_lead_exchange' ? 24 : 53)
    lines.forEach((line, index) => {
      assert.equal(line.props.isAnimationActive, false,
        'JS line reveal must be explicitly disabled; screenshot CSS animation controls cannot finish it')
      assert.equal(terminal[line.props.dataKey], expected[index])
      assert.equal(plot.props.data.length, chart.series![index].values.length)
    })
  })
}

test('gap_trace: no reference line renders when horizontal_marker is absent', () => {
  const figure = JSON.parse(readFileSync(new URL(
    '../../../analyst/2026_1293/figures/gap_trace.json', import.meta.url), 'utf8'))
  const chart = figure.chart as ChartSpec
  assert.equal(chart.horizontal_marker, undefined)
  const tree = elements(RaceTraceChart({ chart }))
  assert.equal(tree.filter(element => element.type === ReferenceLine).length, 0)
})
