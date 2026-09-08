// Evidence-packet transform fixtures (analyst design U1). Synthetic rows
// covering the reviewer's cases: delayed/missing endpoints, duplicate state
// messages, VSC ENDING vs ENDED, announcement-before-restart, boundary-
// spanning stops, multiple observations per lap, penalty citing an earlier
// lap (typed link) and an ambiguous one (unresolved).
import test from "node:test";
import assert from "node:assert/strict";
import { parseEvent, linkEvents, racingIntervals, classifyStop, mapObservationsToLaps, asOf } from "../analyst/lib/packet.mjs";

const ts = (s) => new Date(`2026-09-06T${s}Z`);
const ev = (i, time, lap, message) => parseEvent({ date: ts(time), lap_number: lap, message }, i);

test("intervals: announcement never closes a red; SC LIGHTS ON resumption closes it (inferred) and opens a lap-end SC", () => {
  const events = [
    ev(0, "13:07:43", 3, "RED FLAG - RACE SUSPENDED"),
    ev(1, "13:27:50", 4, "RACE WILL RESUME AT 15:39"),
    ev(2, "13:34:00", 4, "SAFETY CAR LIGHTS ON"),
    ev(3, "14:54:46", 53, "CHEQUERED FLAG")
  ];
  const lapEnds = new Map([[4, ts("13:36:30").getTime()]]);
  const { intervals, announcements } = racingIntervals(events, lapEnds);
  assert.equal(announcements.length, 1);
  const red = intervals.find((i) => i.kind === "red");
  assert.equal(red.end, ts("13:34:00").toISOString(), "red closes at the SC resumption message, not the announcement");
  assert.equal(red.endpoint_inferred, "resumption_state_msg");
  const sc = intervals.find((i) => i.kind === "sc");
  assert.equal(sc.end, ts("13:36:30").toISOString());
  assert.equal(sc.endpoint_inferred, "lights_on_lap_end");
});

test("intervals: PIT EXIT green / pre-announcement green during a red never closes it", () => {
  const events = [
    ev(0, "13:07:43", 3, "RED FLAG - RACE SUSPENDED"),
    ev(1, "13:09:25", 3, "GREEN LIGHT - PIT EXIT OPEN"),
    ev(2, "13:10:00", 3, "TRACK CLEAR"),
    ev(3, "13:27:50", 4, "RACE WILL RESUME AT 15:39"),
    ev(4, "13:34:00", 4, "SAFETY CAR LIGHTS ON"),
    ev(5, "14:54:46", 53, "CHEQUERED FLAG")
  ];
  const { intervals } = racingIntervals(events, new Map());
  const red = intervals.find((i) => i.kind === "red");
  assert.equal(red.end, ts("13:34:00").toISOString());
  assert.equal(red.closed_by, "rc4");
});

test("stops: exit-timestamp semantics — a red-flag tyre change spanning the suspension is not green", () => {
  const intervals = [{ kind: "red", start: ts("13:07:43").toISOString(), end: ts("13:34:00").toISOString(), opened_by: "rc0" }];
  const exit = ts("13:39:08"), dur = 1846;
  const r = classifyStop({ entry: exit.getTime() - dur * 1000, pit_duration: dur }, intervals);
  assert.notEqual(r.class, "green");
  assert.ok(r.overlaps.some((o) => o.kind === "red" && o.fraction > 0.8));
});

test("intervals: VSC ENDING is a warning; without ENDED the close is inferred at the ENDING lap end; duplicate DEPLOYED idempotent", () => {
  const events = [
    ev(0, "14:17:45", 28, "VSC DEPLOYED"),
    ev(1, "14:17:50", 28, "VSC DEPLOYED"),
    ev(2, "14:19:31", 29, "VSC ENDING"),
    ev(3, "14:54:46", 53, "CHEQUERED FLAG")
  ];
  const lapEnds = new Map([[29, ts("14:20:40").getTime()]]);
  const { intervals } = racingIntervals(events, lapEnds);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].kind, "vsc");
  assert.equal(intervals[0].end, ts("14:20:40").toISOString());
  assert.equal(intervals[0].endpoint_inferred, "ending_lap_end");
});

test("intervals: a real VSC ENDED closes exactly, no inference flag", () => {
  const events = [ev(0, "14:17:45", 28, "VSC DEPLOYED"), ev(1, "14:19:31", 29, "VSC ENDING"), ev(2, "14:20:10", 29, "VSC ENDED")];
  const { intervals } = racingIntervals(events, new Map());
  assert.equal(intervals[0].end, ts("14:20:10").toISOString());
  assert.equal(intervals[0].endpoint_inferred, undefined);
});

test("stops: overlap classification — inside VSC, green, boundary-spanning", () => {
  const intervals = [{ kind: "vsc", start: ts("14:17:45").toISOString(), end: ts("14:20:40").toISOString(), opened_by: "rc0" }];
  assert.equal(classifyStop({ entry: ts("14:18:00"), pit_duration: 25 }, intervals).class, "vsc");
  assert.equal(classifyStop({ entry: ts("14:10:00"), pit_duration: 25 }, intervals).class, "green");
  const span = classifyStop({ entry: ts("14:20:30"), pit_duration: 30 }, intervals);
  assert.equal(span.class, "boundary_spanning");
  assert.ok(span.overlaps[0].fraction > 0.3 && span.overlaps[0].fraction < 0.4);
});

test("links: penalty citing an earlier lap links to the investigation on car+lap; ambiguous stays unresolved", () => {
  const events = [
    ev(0, "13:20:01", 1, "FIA STEWARDS: INCIDENT INVOLVING CAR 11 (PER) WILL BE INVESTIGATED AFTER THE RACE"),
    ev(1, "14:09:43", 25, "TURN 1 INCIDENT INVOLVING CAR 11 (PER) NOTED - FAILING TO FOLLOW RACE DIRECTOR'S INSTRUCTIONS LAP 25"),
    ev(2, "14:14:00", 30, "FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 11 (PER) - TURN 1 INCIDENT LAP 25"),
    ev(3, "14:30:00", 40, "FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 44 (HAM)")
  ];
  const { links, unresolved } = linkEvents(events);
  assert.equal(links.length, 1);
  assert.equal(links[0].to, "rc1", "links to the lap-25 note, not the lap-1 note");
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].event, "rc3");
});

test("traces: several observations in a lap keep the LAST as lap-end state; as-of takes last strictly-before", () => {
  const laps = new Map([[12, [{ lap: 1, start: ts("13:00:00").getTime() }, { lap: 2, start: ts("13:01:30").getTime() }]]]);
  const obs = [
    { driver_number: 12, date: ts("13:00:10"), value: { position: 14 } },
    { driver_number: 12, date: ts("13:01:00"), value: { position: 13 } },
    { driver_number: 12, date: ts("13:01:45"), value: { position: 12 } }
  ];
  const m = mapObservationsToLaps(obs, laps);
  assert.equal(m.get("12:1").last.position, 13);
  assert.equal(m.get("12:1").observations.length, 2);
  assert.equal(m.get("12:2").last.position, 12);
  const snap = asOf(obs, ts("13:01:45"), (o) => ({ position: o.value.position }));
  assert.equal(snap[0].position, 13, "strictly before excludes the observation AT the timestamp");
});
