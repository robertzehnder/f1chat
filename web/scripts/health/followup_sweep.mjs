#!/usr/bin/env node
/**
 * followup_sweep.mjs — multi-turn dynamism sweep (2026-08).
 *
 * The a_gate sweep and randomized sweep are SINGLE-turn probes. This sweep
 * takes their base questions and fires a FOLLOW-UP in the same persisted
 * conversation, each follow-up exercising a distinct multi-turn skill:
 *
 *   runner-up-chain   "who finished right behind him?"   (entity + rank anaphora)
 *   subset            "which of those were on the podium?" (operate on prior result)
 *   entity-anaphora   "what compounds did he run?"        (pronoun + metric shift)
 *   delta-extend      "how much slower was second?"       (extend prior superlative)
 *   superlative       "who gained the most positions?"    (aggregate prior chart)
 *   session-repair    "then show it for the race instead" (repair after hedge)
 *   drill-down        "who led the most laps?"            (zoom into prior chart)
 *   best-of           "which driver managed it best?"     (rank within prior analysis)
 *   driver-swap       "now swap X for Y"                  (partial entity replacement)
 *   venue-override    "and at Spa?"                       (keep driver+metric, new venue)
 *   year-override     "same but for 2026"                 (keep everything, new year)
 *   bare-why          "why?"                              (maximal ambiguity)
 *   refusal-repair    "fine — show 2025 then"             (recover from honest refusal)
 *   session-shift     "did that hold in the race?"        (quali → race scope move)
 *
 * Output: per-case table (follow-up source, resolved session, inherited?,
 * answer head) + JSON at /tmp/followup-sweep.json. Conversations are
 * DELETED at the end so the sweep never litters the sidebar.
 *
 * Usage: node scripts/health/followup_sweep.mjs [--base http://localhost:3000]
 */

const BASE = (process.argv.find((a, i) => process.argv[i - 1] === "--base")) || "http://localhost:3000";
const SET = (process.argv.find((a, i) => process.argv[i - 1] === "--set")) || "2025";

// Same 14 skills rebased on 2026 rounds with ingested data (Melbourne →
// Silverstone). Notable intentional stress points: 2026 has NO
// raw.starting_grid / raw.session_result (superlative case becomes an
// honesty probe), and refusal-repair/year-override flip direction
// (1998 → "show 2026", 2026 → "same but for 2025").
const CASES_2026 = [
  { id: "runner-up-chain", base: "Who won the Monaco 2026 Grand Prix?",
    follow: "And who finished right behind him?" },
  { id: "subset", base: "What was the finishing order of the Miami 2026 race?",
    follow: "Which of those drivers finished on the podium?" },
  { id: "entity-anaphora", base: "How many pit stops did the winner make at the British 2026 Grand Prix?",
    follow: "What tyre compounds did he run in that race?" },
  { id: "delta-extend", base: "What was the fastest lap of the Austrian 2026 Grand Prix?",
    follow: "How much slower was the second-fastest lap?" },
  { id: "superlative", base: "Show the grid vs finish for the Canadian 2026 Grand Prix.",
    follow: "Who gained the most positions?" },
  { id: "session-repair", base: "Show the tyre degradation curves for the Monaco 2026 qualifying session.",
    follow: "OK then show it for the race instead." },
  { id: "refusal-repair", base: "Show the qualifying results for the 1998 Monaco Grand Prix.",
    follow: "Fine — show 2026 then." },
  { id: "drill-down", base: "Show the race trace for Shanghai 2026",
    follow: "Who led the most laps in that race?" },
  { id: "best-of", base: "How big is the tyre cliff at Suzuka 2026 — show the deg curves",
    follow: "Which driver managed the cliff best?" },
  { id: "driver-swap", base: "Show the lap telemetry comparison for Verstappen and Norris at the Melbourne 2026 race",
    follow: "Now swap Norris out for Piastri." },
  { id: "venue-override", base: "Show Leclerc's speed map for the Barcelona 2026 race — where was he fastest?",
    follow: "And at Silverstone?" },
  { id: "year-override", base: "What was Hamilton's first-stop lap number in the Silverstone 2026 race?",
    follow: "Same but for 2025." },
  { id: "bare-why", base: "Show the position changes at the Austrian 2026 Grand Prix",
    follow: "Why?" },
  { id: "session-shift", base: "Show the sector dominance between Russell and Antonelli in qualifying at Suzuka 2026",
    follow: "Did that pattern hold in the race?" }
];

// FULL smoke suite on 2026 rounds 1-9 (Melbourne, Shanghai+S, Suzuka,
// Miami+S, Montreal+S, Monte Carlo, Barcelona, Spielberg, Silverstone+S):
// every a_gate honesty case (g-*) + every randomized-sweep chart family
// (c-*), each with one follow-up. Drivers/teams are the REAL 2026 grid
// (Norris #1/Piastri McLaren, Verstappen/Hadjar Red Bull, Russell/
// Antonelli Mercedes, Leclerc/Hamilton Ferrari, Perez/Bottas Cadillac,
// Bortoleto/Hulkenberg Audi). Known 2026 gaps become honesty probes:
// no starting_grid/session_result (g-grid), Austin has no data yet
// (g-ambiguous), crossover probes rain that may not have happened.
const CASES_FULL2026 = [
  // ── a_gate honesty family ──
  { id: "g-won", base: "Who won the Melbourne 2026 Grand Prix?",
    follow: "What was the winning margin?" },
  { id: "g-order", base: "What was the finishing order of the Shanghai 2026 race?",
    follow: "Which of those drivers drove for Mercedes?" },
  { id: "g-pits", base: "How many pit stops did the winner make at the Miami 2026 Grand Prix?",
    follow: "What compounds did he use?" },
  { id: "g-fastlap", base: "What was the fastest lap of the Montreal 2026 Grand Prix?",
    follow: "On which lap of the race was it set?" },
  { id: "g-grid", base: "Show the grid vs finish for the Spielberg 2026 Grand Prix.",
    follow: "Who lost the most positions?" },
  { id: "g-oldyear", base: "Show the qualifying results for the 1995 Monaco Grand Prix.",
    follow: "Alright, 2026 then." },
  { id: "g-trap", base: "Show the tyre degradation curves for the Suzuka 2026 qualifying session.",
    follow: "OK, the race version." },
  { id: "g-nonexistent", base: "Who won the 2026 Kentucky Grand Prix?",
    follow: "I meant the British one." },
  { id: "g-ambiguous", base: "Who won the United States Grand Prix in 2026?",
    follow: "The one in Miami." },
  // ── randomized-sweep chart families ──
  { id: "c-racetrace", base: "Show the race trace for Barcelona 2026",
    follow: "Who was leading at half distance?" },
  { id: "c-overcut", base: "Did Russell successfully execute the over-cut on Antonelli at Montreal 2026?",
    follow: "What were the gaps before and after the stops?" },
  { id: "c-degcliff", base: "How big is the tyre cliff at Silverstone 2026 — show the deg curves",
    follow: "Which compound fell off hardest?" },
  { id: "c-positions", base: "Show the position changes at the Miami 2026 race",
    follow: "Who recovered best after lap 1?" },
  { id: "c-teleover", base: "Show the lap telemetry comparison for Norris and Piastri at the Suzuka 2026 race",
    follow: "Where on the lap was the biggest difference?" },
  { id: "c-stratsplit", base: "Did Ferrari split strategies between Leclerc and Hamilton at Shanghai 2026?",
    follow: "Which side of the split worked out better?" },
  { id: "c-stintdelta", base: "Across stints 1, 2 and 3 at Melbourne 2026, did Verstappen's stint deltas to Hadjar reverse on the final stint?",
    follow: "What tyre was each of them on in that final stint?" },
  { id: "c-brake", base: "Across the three heaviest brake zones at Monaco 2026, did Leclerc's lap-1 brake-zone delta to Hamilton foreshadow a lap-pace deficit?",
    follow: "Which corner showed the biggest delta?" },
  { id: "c-sector", base: "Show the sector dominance between Russell and Antonelli in qualifying at Spielberg 2026",
    follow: "Did that carry into the race?" },
  { id: "c-speedmap", base: "Show Verstappen's speed map for the Silverstone 2026 race — where was he fastest?",
    follow: "How does that compare to Norris?" },
  { id: "c-launch", base: "On the lap-1 launch at Suzuka 2026, did Antonelli or Russell gain more positions?",
    follow: "Did either of them lose those places back later?" },
  { id: "c-crossover", base: "On which lap did Norris and Piastri make the inters-to-slicks crossover at Silverstone 2026?",
    follow: "Who timed it better?" },
  { id: "c-perfaxes", base: "Where does Antonelli's edge over Russell come from in 2026 — qualifying axis or race-pace axis?",
    follow: "And on tyre management?" },
  { id: "c-firststop", base: "What was Perez's first-stop lap number in the Montreal 2026 race?",
    follow: "What compound did Cadillac fit him with at that stop?" }
];

const CASES_2025 = [
  // ── a_gate sweep bases ──
  { id: "runner-up-chain", base: "Who won the Monaco 2025 Grand Prix?",
    follow: "And who finished right behind him?" },
  { id: "subset", base: "What was the finishing order of the Bahrain 2025 race?",
    follow: "Which of those drivers finished on the podium?" },
  { id: "entity-anaphora", base: "How many pit stops did the winner make at the British 2025 Grand Prix?",
    follow: "What tyre compounds did he run in that race?" },
  { id: "delta-extend", base: "What was the fastest lap of the Belgian 2025 Grand Prix?",
    follow: "How much slower was the second-fastest lap?" },
  { id: "superlative", base: "Show the grid vs finish for the Canadian 2025 Grand Prix.",
    follow: "Who gained the most positions?" },
  { id: "session-repair", base: "Show the tyre degradation curves for the Monaco 2025 qualifying session.",
    follow: "OK then show it for the race instead." },
  { id: "refusal-repair", base: "Show the qualifying results for the 1998 Monaco Grand Prix.",
    follow: "Fine — show 2025 then." },
  // ── randomized sweep bases ──
  { id: "drill-down", base: "Show the race trace for Monza 2025",
    follow: "Who led the most laps in that race?" },
  { id: "best-of", base: "How big is the tyre cliff at Bahrain 2025 — show the deg curves",
    follow: "Which driver managed the cliff best?" },
  { id: "driver-swap", base: "Show the lap telemetry comparison for Verstappen and Norris at the Suzuka 2025 race",
    follow: "Now swap Norris out for Piastri." },
  { id: "venue-override", base: "Show Leclerc's speed map for the Monza 2025 race — where was he fastest?",
    follow: "And at Spa?" },
  { id: "year-override", base: "What was Hamilton's first-stop lap number in the Silverstone 2025 race?",
    follow: "Same but for 2026." },
  { id: "bare-why", base: "Show the position changes at the Austrian 2025 Grand Prix",
    follow: "Why?" },
  { id: "session-shift", base: "Show the sector dominance between Verstappen and Piastri in qualifying at Suzuka 2025",
    follow: "Did that pattern hold in the race?" }
];

const CASES = SET === "full2026" ? CASES_FULL2026 : SET === "2026" ? CASES_2026 : CASES_2025;
console.log(`follow-up sweep — set: ${SET} (${CASES.length} cases)`);

async function ask(message, conversationId) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, persist: true, conversationId: conversationId ?? undefined, context: {} })
  });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  return res.json();
}

function sessionOf(r) {
  const sel = r?.runtime?.resolution?.selectedSession;
  return sel?.sessionKey ? `${sel.sessionKey} ${sel.label ?? ""}`.trim() : null;
}

const results = [];
const convoIds = new Set();

for (const c of CASES) {
  process.stdout.write(`[${c.id}] base... `);
  const r1 = await ask(c.base);
  const convoId = r1?.conversation?.id ?? null;
  if (convoId) convoIds.add(convoId);
  process.stdout.write(`${r1.generationSource ?? r1.error} → follow... `);
  const r2 = await ask(c.follow, convoId);
  if (r2?.conversation?.id) convoIds.add(r2.conversation.id);
  const row = {
    id: c.id,
    base: c.base,
    baseSource: r1.generationSource ?? r1.error ?? null,
    baseSession: sessionOf(r1),
    follow: c.follow,
    followSource: r2.generationSource ?? r2.error ?? null,
    followSession: sessionOf(r2),
    inheritedSession: sessionOf(r2) !== null && sessionOf(r2) === sessionOf(r1),
    followMatchedOn: r2?.runtime?.resolution?.selectedSession?.matchedOn ?? null,
    followRows: r2?.result?.rowCount ?? null,
    followAnswerHead: (r2?.answer ?? "").slice(0, 220)
  };
  results.push(row);
  console.log(`${row.followSource} session=${row.followSession ?? "—"} inherited=${row.inheritedSession}`);
}

// Cleanup: this is harness traffic — never leave it in the sidebar.
for (const id of convoIds) {
  await fetch(`${BASE}/api/conversations/${id}`, { method: "DELETE" }).catch(() => {});
}
console.log(`\ncleaned up ${convoIds.size} conversations`);

const { writeFileSync } = await import("node:fs");
writeFileSync(`/tmp/followup-sweep-${SET}.json`, JSON.stringify(results, null, 2));
console.log(`wrote /tmp/followup-sweep-${SET}.json`);

// Compact table
console.log("\n─── FOLLOW-UP DYNAMISM SWEEP ───");
for (const r of results) {
  const inh = r.inheritedSession ? "INHERIT" : r.followSession ? "RE-RESOLVE" : (r.followSource === "runtime_clarification" ? "CLARIFY" : "—");
  console.log(`${r.id.padEnd(17)} ${String(r.followSource).padEnd(24)} ${inh.padEnd(11)} ${r.followAnswerHead.slice(0, 90)}`);
}
