import test from "node:test";
import assert from "node:assert/strict";
import { sessionWindows, activeWindow, nextWindow, textOfHtml, parseMeeting } from "../reporting/lib/common.mjs";
import { checkAttributions, normalizeUrl } from "../reporting/lib/verify_attribution.mjs";
import { classifyDoc, carsInTitle, parsePublished, parseDocList } from "../reporting/fia_docs.mjs";
import { lastSameNationality, seasonWins, winnersFromLowerGrid, lastOneTwo, ordinal } from "../reporting/context_facts.mjs";

const sessions = [
  { session_key: 1, session_name: "Practice 1", date_start: "2026-09-11T11:30:00Z", date_end: "2026-09-11T12:30:00Z" },
  { session_key: 2, session_name: "Qualifying", date_start: "2026-09-12T14:00:00Z", date_end: "2026-09-12T15:00:00Z" },
  { session_key: 3, session_name: "Race", date_start: "2026-09-13T13:00:00Z", date_end: "2026-09-13T15:00:00Z" }
];

test("session windows: only paid sessions, race gets the longer tail", () => {
  const w = sessionWindows(sessions);
  assert.deepEqual(w.map((x) => x.session_name), ["Qualifying", "Race"]);
  assert.equal(w[0].window_start.toISOString(), "2026-09-12T13:45:00.000Z");
  assert.equal(w[0].window_end.toISOString(), "2026-09-12T16:00:00.000Z");
  assert.equal(w[1].window_start.toISOString(), "2026-09-13T12:30:00.000Z");
  assert.equal(w[1].window_end.toISOString(), "2026-09-13T17:00:00.000Z");
});

test("activeWindow / nextWindow", () => {
  const w = sessionWindows(sessions);
  assert.equal(activeWindow(w, new Date("2026-09-12T12:00:00Z")), null);
  assert.equal(activeWindow(w, new Date("2026-09-12T14:30:00Z")).session_name, "Qualifying");
  assert.equal(nextWindow(w, new Date("2026-09-12T17:00:00Z")).session_name, "Race");
  assert.equal(nextWindow(w, new Date("2026-09-14T00:00:00Z")), null);
});

test("parseMeeting", () => {
  assert.deepEqual(parseMeeting("2026_1293"), { meeting: "2026_1293", year: 2026, meetingKey: 1293 });
  assert.throws(() => parseMeeting("monza"));
});

test("textOfHtml strips tags and entities", () => {
  assert.equal(textOfHtml("<p lang=\"en\">just setting up my&nbsp;twttr &amp; more<br>x</p>"), "just setting up my twttr & more\nx");
});

test("FIA: classify, cars, published date, list parsing", () => {
  assert.equal(classifyDoc("Decision - Car 63 - Alleged failure to slow for yellow flags"), "decision");
  assert.equal(classifyDoc("Infringement - Car 11 - Failure to follow Race Directors Instruction"), "infringement");
  assert.equal(classifyDoc("Summons - Car 22 - Alleged Start Procedure Infringement"), "summons");
  assert.equal(classifyDoc("Final Race Classification"), "classification");
  assert.equal(classifyDoc("Competition Notes - Pirelli Preview"), "notes");
  assert.deepEqual(carsInTitle("Decision - Car 30 - Turn 4 Incident with Car 27"), [30, 27]);
  assert.equal(parsePublished("Published on 06.09.26 20:30 CET"), "2026-09-06T20:30:00+02:00");
  assert.equal(parsePublished("Published on 06.12.26 20:30 CET"), "2026-12-06T20:30:00+01:00");
  const html = '<ul><li class="document-row key-65"><a href="/system/files/decision-document/x.pdf" download><div class="title">Doc 65 - Decision - Car 63 - Alleged failure</div><div class="published">Published on 06.09.26 17:15 CET</div></a></li></ul>';
  const docs = parseDocList(html);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].doc_no, 65);
  assert.equal(docs[0].title, "Decision - Car 63 - Alleged failure");
  assert.equal(docs[0].href, "https://www.fia.com/system/files/decision-document/x.pdf");
  assert.equal(docs[0].published_at, "2026-09-06T17:15:00+02:00");
});

test("attribution check: refs must resolve; body links must be registered", () => {
  const reporting = { entries: [{ id: "article:abc", url: "https://www.formula1.com/en/latest/article/one.X1?utm=1" }] };
  const claims = [{ id: "A1", type: "attribution", refs: ["reporting:article:abc"] }, { id: "A2", type: "attribution", refs: ["attributed:somewhere"] }];
  const body = "see [x](https://www.formula1.com/en/latest/article/one.X1) and [y](https://example.com/z)";
  const r = checkAttributions({ claims, reporting, body });
  assert.deepEqual(r.fails, ["claim A2: attribution without a reporting:<id> or context:<id> ref", "unregistered source link: https://example.com/z"]);
  assert.equal(normalizeUrl("https://X.com/a/b/?q=1#f"), "https://x.com/a/b");
  const none = checkAttributions({ claims, reporting: null, body });
  assert.equal(none.fails.length, 0);
  assert.equal(none.warns.length, 1);
});

test("context facts: nationality, season wins, lower-grid winners, one-two, ordinal", () => {
  const W = [
    { season: 1966, round: 8, familyName: "Scarfiotti", nationality: "Italian", grid: 2, constructorId: "ferrari" },
    { season: 1983, round: 2, familyName: "Watson", nationality: "British", grid: 22, constructorId: "mclaren", raceName: "United States Grand Prix West" },
    { season: 2025, round: 16, familyName: "Verstappen", nationality: "Dutch", grid: 1, constructorId: "red_bull" },
    { season: 2026, round: 13, familyName: "Antonelli", nationality: "Italian", grid: 19, constructorId: "mercedes" }
  ];
  assert.equal(lastSameNationality(W, "Italian", 2026).season, 1966);
  assert.equal(lastSameNationality(W, "Italian", 2026, 13).season, 1966);
  assert.equal(lastSameNationality(W, "Finnish", 2026), null);
  assert.equal(seasonWins([{ code: "ANT", position: 1, round: 2 }, { code: "ANT", position: 1, round: 13 }, { code: "RUS", position: 1, round: 8 }], "ANT", 13), 2);
  assert.deepEqual(winnersFromLowerGrid(W, 19).map((w) => w.familyName), ["Watson"]);
  const top2 = [{ season: 2019, first: "mercedes", second: "mercedes" }, { season: 2024, first: "ferrari", second: "mclaren" }];
  assert.equal(lastOneTwo(top2, "mercedes", 2026).season, 2019);
  assert.equal(ordinal(1), "1st"); assert.equal(ordinal(2), "2nd"); assert.equal(ordinal(3), "3rd"); assert.equal(ordinal(11), "11th"); assert.equal(ordinal(22), "22nd"); assert.equal(ordinal(7), "7th");
});
