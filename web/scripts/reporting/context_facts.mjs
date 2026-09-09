#!/usr/bin/env node
/**
 * context_facts.mjs — the historical-context agent's deterministic half.
 *
 *   node scripts/reporting/context_facts.mjs --meeting 2026_1293
 *
 * Reads the race packet (winner, grid, podium, standings) and COMPUTES the
 * context facts a recap reaches for — "first Italian winner at Monza since
 * Scarfiotti in 1966", "seventh win of the season", "only one driver has won
 * from lower on the grid" — from the Jolpica results database (1950–today).
 * Every fact carries its values, the rows it rests on and the query URLs, so
 * the verifier can bind the numbers and the writer can cite `context:<id>`.
 * Nothing here is recalled by a model. Output: analyst/<meeting>/context.json
 *
 * Jolpica responses are cached under corpus-artifacts/jolpica/ (history for
 * 30 days, current season for 1 day) and fetched politely (300 ms apart).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { corpusClient } from "../corpus/lib/db.mjs";
import { loadRegistry, assertAcquireAllowed, assertUseAllowed } from "../corpus/lib/rights.mjs";
import { ROOT, RAW_ROOT, parseMeeting, argOpt, readJson, writeJson, sleep } from "./lib/common.mjs";

const SOURCE = "jolpica";
const BASE = "https://api.jolpi.ca/ergast/f1";
const CACHE = join(RAW_ROOT, "jolpica", "cache");

// ---------------------------------------------------------------- pure helpers (tested)
export const ordinal = (n) => { const m = n % 100; const suf = m >= 11 && m <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] ?? "th"; return `${n}${suf}`; };
export const ORDINAL_WORDS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];

/** winners: [{season, round, raceName, driverId, familyName, givenName, nationality, grid}] sorted by season,round */
export function lastSameNationality(winners, nationality, beforeSeason, beforeRound = -Infinity, excludeDriverId = null) {
  const prior = winners.filter((w) => w.nationality === nationality && w.driverId !== excludeDriverId && (w.season < beforeSeason || (w.season === beforeSeason && w.round < beforeRound)));
  return prior.length ? prior[prior.length - 1] : null;
}
export function seasonWins(results, code, uptoRound) {
  return results.filter((r) => r.code === code && r.position === 1 && r.round <= uptoRound).length;
}
/** Winners from a lower grid slot than `grid` (pit-lane starts count as grid 0 in Ergast → excluded). */
export function winnersFromLowerGrid(winners, grid) {
  return winners.filter((w) => w.grid > grid).sort((a, b) => b.grid - a.grid);
}
export function lastOneTwo(top2ByRace, constructorId, beforeSeason) {
  const prior = top2ByRace.filter((r) => r.season < beforeSeason && r.first === constructorId && r.second === constructorId);
  return prior.length ? prior[prior.length - 1] : null;
}

// ---------------------------------------------------------------- jolpica client
async function jget(path, { ttlDays }) {
  mkdirSync(CACHE, { recursive: true });
  const url = `${BASE}${path}`;
  const f = join(CACHE, createHash("sha256").update(url).digest("hex").slice(0, 16) + ".json");
  if (existsSync(f) && (Date.now() - statSync(f).mtimeMs) < ttlDays * 86_400_000) return { data: JSON.parse(readFileSync(f, "utf8")), url, cached: true };
  await sleep(300);
  const res = await fetch(url, { headers: { "user-agent": "f1chat-reporting/0.1 (personal research)" } });
  if (!res.ok) throw new Error(`jolpica ${res.status} ${path}`);
  const data = (await res.json()).MRData;
  writeFileSync(f, JSON.stringify(data));
  return { data, url, cached: false };
}
async function jall(path, { ttlDays }, pick) {
  const out = [], urls = [];
  for (let offset = 0; ; offset += 100) {
    const sep = path.includes("?") ? "&" : "?";
    const { data, url } = await jget(`${path}${sep}limit=100&offset=${offset}`, { ttlDays });
    urls.push(url);
    const rows = pick(data);
    out.push(...rows);
    if (offset + 100 >= Number(data.total) || !rows.length) break;
  }
  return { rows: out, urls };
}
const winnerRow = (race) => {
  const r = race.Results[0];
  return { season: Number(race.season), round: Number(race.round), raceName: race.raceName, circuitId: race.Circuit.circuitId, driverId: r.Driver.driverId, code: r.Driver.code ?? null, givenName: r.Driver.givenName, familyName: r.Driver.familyName, nationality: r.Driver.nationality, constructorId: r.Constructor.constructorId, constructorName: r.Constructor.name, grid: Number(r.grid) };
};

// ---------------------------------------------------------------- main
if (process.argv[1]?.endsWith("context_facts.mjs")) {
  const { meeting, year } = parseMeeting(argOpt("meeting"));
  const dir = join(ROOT, "analyst", meeting);
  const packet = readJson(join(dir, "packet.json"), null);
  if (!packet) { console.error(`no packet at ${dir}`); process.exit(1); }
  const client = await corpusClient();
  const registry = await loadRegistry(client);
  assertAcquireAllowed(registry, SOURCE, "api");
  assertUseAllowed(registry, SOURCE, "llm_process", "reporting");
  await client.end();

  const winnerAcr = packet.results.find((r) => r.position === 1)?.driver;
  const meetingName = packet.session.meeting_name;
  const facts = [];
  const fact = (id, kind, statement, values, evidence, sources) => facts.push({ id, kind, statement, values, evidence, sources: [...new Set(sources)], computed_at: new Date().toISOString() });

  // this race on jolpica
  const season = await jall(`/${year}/results/1.json`, { ttlDays: 1 }, (d) => d.RaceTable.Races.map(winnerRow));
  const thisRace = season.rows.find((r) => r.raceName === meetingName) ?? season.rows.find((r) => r.code === winnerAcr && r.raceName.toLowerCase().includes(meetingName.toLowerCase().split(" ")[0]));
  if (!thisRace) { console.error(`race "${meetingName}" ${year} not on jolpica yet (${season.rows.length} rounds listed)`); process.exit(2); }
  if (thisRace.code && winnerAcr && thisRace.code !== winnerAcr) { console.error(`winner mismatch: packet ${winnerAcr} vs jolpica ${thisRace.code}`); process.exit(2); }
  const { circuitId, round, driverId, nationality, constructorId, constructorName, grid } = thisRace;
  const name = `${thisRace.givenName} ${thisRace.familyName}`;
  console.log(`${meetingName} ${year}: round ${round}, ${circuitId}, winner ${name} (${nationality}, ${constructorName}) from grid ${grid}`);

  // 1. same nationality at this circuit
  const circuitWinners = await jall(`/circuits/${circuitId}/results/1.json`, { ttlDays: 30 }, (d) => d.RaceTable.Races.map(winnerRow));
  const circuitName = meetingName.replace(/ Grand Prix$/, "");
  const prevNat = lastSameNationality(circuitWinners.rows, nationality, year, -Infinity, driverId);
  fact("nationality_circuit", "history",
    prevNat ? `${name} is the first ${nationality} driver to win the ${meetingName} since ${prevNat.givenName} ${prevNat.familyName} in ${prevNat.season}.` : `${name} is the first ${nationality} driver to win the ${meetingName}.`,
    { nationality, previous_season: prevNat?.season ?? null, previous_winner: prevNat ? `${prevNat.givenName} ${prevNat.familyName}` : null, circuit: circuitName },
    circuitWinners.rows.filter((w) => w.nationality === nationality).map((w) => ({ season: w.season, winner: w.familyName })), circuitWinners.urls);

  // 2. same nationality anywhere
  const allWinners = await jall(`/results/1.json`, { ttlDays: 30 }, (d) => d.RaceTable.Races.map(winnerRow));
  const prevAny = lastSameNationality(allWinners.rows, nationality, year, round, driverId);
  if (prevAny) fact("nationality_any", "history",
    `Before ${name}, the last ${nationality} driver to win a grand prix was ${prevAny.givenName} ${prevAny.familyName} at the ${prevAny.season} ${prevAny.raceName}.`,
    { previous_season: prevAny.season, previous_winner: `${prevAny.givenName} ${prevAny.familyName}`, previous_race: prevAny.raceName }, [prevAny], allWinners.urls.slice(0, 1));

  // 3. season wins + career wins
  const wins = seasonWins(season.rows.map((r) => ({ code: r.code, position: 1, round: r.round })), winnerAcr, round);
  fact("season_wins", "season", `The ${meetingName} was ${name}'s ${ORDINAL_WORDS[wins] ?? ordinal(wins)} win of the ${year} season.`, { season_wins: wins, year },
    season.rows.filter((r) => r.code === winnerAcr && r.round <= round).map((r) => ({ round: r.round, race: r.raceName })), season.urls);
  const career = await jall(`/drivers/${driverId}/results/1.json`, { ttlDays: 1 }, (d) => d.RaceTable.Races.map(winnerRow));
  const careerUpto = career.rows.filter((r) => r.season < year || (r.season === year && r.round <= round)).length;
  fact("career_wins", "career", `It was the ${ordinal(careerUpto)} grand prix win of ${name}'s career.`, { career_wins: careerUpto }, [], career.urls);

  // 4. grid position context (only interesting from outside the top three); pole facts otherwise
  if (grid === 1) {
    const poleWinsHere = circuitWinners.rows.filter((w) => w.grid === 1 && w.season < year);
    const recent = circuitWinners.rows.filter((w) => w.season < year).slice(-10);
    fact("pole_to_win", "history",
      `${name} won from pole; ${poleWinsHere.length} of the ${circuitWinners.rows.filter((w) => w.season < year).length} previous ${meetingName} winners on record started from pole, ${recent.filter((w) => w.grid === 1).length} of the last ${recent.length}.`,
      { pole_wins_at_circuit: poleWinsHere.length, previous_races: circuitWinners.rows.filter((w) => w.season < year).length, pole_wins_last_ten: recent.filter((w) => w.grid === 1).length, last_ten: recent.length },
      recent.map((w) => ({ season: w.season, winner: w.familyName, grid: w.grid })), circuitWinners.urls);
  }
  const lowerAll = grid > 3 ? winnersFromLowerGrid(allWinners.rows.filter((w) => w.grid > 0), grid) : [];
  const lowerHere = winnersFromLowerGrid(circuitWinners.rows.filter((w) => w.grid > 0 && w.season < year), grid);
  if (grid > 3) fact("grid_win_history", "history",
    lowerAll.length === 0 ? `No driver has won a grand prix from lower on the grid than ${ordinal(grid)}.`
      : `${lowerAll.length === 1 ? "Only one driver has" : `${lowerAll.length} drivers have`} won a grand prix from lower on the grid than ${ordinal(grid)}: ${lowerAll.slice(0, 3).map((w) => `${w.familyName} from ${ordinal(w.grid)} at the ${w.season} ${w.raceName}`).join("; ")}.`,
    { grid, lower_all_time: lowerAll.length, lower_at_circuit: lowerHere.length, lowest_grid_winner: lowerAll[0] ? { name: `${lowerAll[0].givenName} ${lowerAll[0].familyName}`, grid: lowerAll[0].grid, season: lowerAll[0].season, race: lowerAll[0].raceName } : null },
    lowerAll.slice(0, 5), allWinners.urls.slice(0, 1));
  const bestHere = circuitWinners.rows.filter((w) => w.grid > 0 && w.season < year).sort((a, b) => b.grid - a.grid)[0];
  if (bestHere && grid > 3) fact("grid_win_circuit", "history",
    lowerHere.length ? `${lowerHere.length} previous ${meetingName} winner(s) started lower than ${ordinal(grid)}.` : `No previous ${meetingName} winner had started lower than ${ordinal(bestHere.grid)} (${bestHere.familyName}, ${bestHere.season}); ${name} won from ${ordinal(grid)}.`,
    { grid, previous_lowest_grid: bestHere.grid, previous_lowest_winner: `${bestHere.givenName} ${bestHere.familyName}`, previous_lowest_season: bestHere.season }, [bestHere], circuitWinners.urls);

  // 5. team one-two at this circuit
  const seconds = await jall(`/circuits/${circuitId}/results/2.json`, { ttlDays: 30 }, (d) => d.RaceTable.Races.map((race) => ({ season: Number(race.season), second: race.Results[0].Constructor.constructorId })));
  const top2 = circuitWinners.rows.map((w) => ({ season: w.season, first: w.constructorId, second: seconds.rows.find((s) => s.season === w.season)?.second ?? null }));
  const thisTop2 = top2.find((t) => t.season === year);
  if (thisTop2?.second === constructorId) {
    const prev = lastOneTwo(top2, constructorId, year);
    fact("team_one_two_circuit", "history",
      prev ? `${constructorName}'s one-two was its first at the ${meetingName} since ${prev.season}.` : `${constructorName}'s one-two was its first at the ${meetingName}.`,
      { constructor: constructorName, previous_one_two_season: prev?.season ?? null }, prev ? [prev] : [], [...circuitWinners.urls, ...seconds.urls]);
  }

  // 5b. season shape: back-to-back wins, drivers with multiple wins, the winner's own standing
  const prevRound = season.rows.find((r) => r.round === round - 1);
  if (prevRound && prevRound.code === winnerAcr) fact("back_to_back", "season", `${name} won the previous round too, the ${prevRound.raceName}, making it back-to-back wins.`, { previous_round: round - 1, previous_race: prevRound.raceName }, [prevRound], season.urls);
  const winCounts = {};
  for (const r of season.rows.filter((r) => r.round <= round)) winCounts[r.code ?? r.driverId] = (winCounts[r.code ?? r.driverId] ?? 0) + 1;
  const multi = Object.entries(winCounts).filter(([, n]) => n >= 2).map(([code, n]) => ({ code, wins: n }));
  fact("season_winners", "season", `After round ${round}, ${Object.keys(winCounts).length} different drivers have won in ${year}; with multiple wins: ${multi.map((m) => `${m.code} (${m.wins})`).join(", ")}.`, { distinct_winners: Object.keys(winCounts).length, multiple_winners: multi }, multi, season.urls);

  // 6. standings after this round (cross-check against the packet)
  const st = await jget(`/${year}/${round}/driverStandings.json`, { ttlDays: 1 });
  const list = st.data.StandingsTable.StandingsLists[0]?.DriverStandings ?? [];
  if (list.length >= 2) {
    const lead = list[0], second = list[1];
    const gap = Number(lead.points) - Number(second.points);
    const packetLead = packet.standings_after?.[0];
    const mine = list.find((s) => s.Driver.code === winnerAcr);
    fact("standings_after", "season",
      `After round ${round} ${lead.Driver.givenName} ${lead.Driver.familyName} leads the championship on ${lead.points} points, ${gap} clear of ${second.Driver.givenName} ${second.Driver.familyName}${mine && mine.Driver.code !== lead.Driver.code ? `; ${name} is ${ordinal(Number(mine.position))} on ${mine.points}, ${Number(lead.points) - Number(mine.points)} behind` : ""}.`,
      { leader: lead.Driver.code, points: Number(lead.points), gap_to_second: gap, second: second.Driver.code, winner_position: mine ? Number(mine.position) : null, winner_points: mine ? Number(mine.points) : null, winner_gap_to_leader: mine ? Number(lead.points) - Number(mine.points) : null, packet_agrees: packetLead ? Number(packetLead.after) === Number(lead.points) : null },
      list.slice(0, 3).map((s) => ({ code: s.Driver.code, points: Number(s.points), wins: Number(s.wins) })), [st.url]);
  }

  const out = { meeting, year, round, circuit_id: circuitId, winner: { code: winnerAcr, driverId, name, nationality, constructor: constructorName, grid }, source: SOURCE, facts };
  writeJson(join(dir, "context.json"), out);
  console.log(`✅ analyst/${meeting}/context.json: ${facts.length} facts`);
  for (const f of facts) console.log(`  • [${f.id}] ${f.statement}`);
}
