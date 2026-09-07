/**
 * meetings.mjs — race-meeting candidates + GP-name alias evidence for the
 * corpus linker (linker@1). Mirrors the 049 circuit-alias approach: the
 * warehouse's circuit_short_name differs from how the press names a GP, so
 * each RACE meeting (test meetings excluded — no 'Race' session) carries
 * token-sequence aliases matched against slugs/titles/tags on token
 * boundaries ('spa' never matches inside 'spanish').
 */

const CIRCUIT_GP_ALIASES = {
  "Melbourne": [["australian"], ["australia"], ["melbourne"]],
  "Shanghai": [["chinese"], ["china"], ["shanghai"]],
  "Suzuka": [["japanese"], ["japan"], ["suzuka"]],
  "Sakhir": [["bahrain"], ["sakhir"]],
  "Jeddah": [["saudi"], ["jeddah"]],
  "Miami": [["miami"]],
  "Montreal": [["canadian"], ["canada"], ["montreal"]],
  "Monte Carlo": [["monaco"], ["monte", "carlo"]],
  "Catalunya": [["spanish"], ["spain"], ["barcelona"], ["catalunya"]],
  "Spielberg": [["austrian"], ["austria"], ["spielberg"]],
  "Silverstone": [["british"], ["britain"], ["silverstone"]],
  "Spa-Francorchamps": [["belgian"], ["belgium"], ["spa"]],
  "Hungaroring": [["hungarian"], ["hungary"], ["hungaroring"], ["budapest"]],
  "Zandvoort": [["dutch"], ["netherlands"], ["holland"], ["zandvoort"]],
  "Monza": [["italian"], ["italy"], ["monza"]],
  "Madring": [["madrid"], ["madring"]],
  "Baku": [["azerbaijan"], ["baku"]],
  "Singapore": [["singapore"]],
  "Austin": [["united", "states"], ["austin"], ["cota"]],
  "Mexico City": [["mexican"], ["mexico"]],
  "Interlagos": [["brazilian"], ["brazil"], ["sao", "paulo"], ["interlagos"]],
  "Las Vegas": [["las", "vegas"], ["vegas"]],
  "Lusail": [["qatar"], ["lusail"]],
  "Yas Marina Circuit": [["abu", "dhabi"], ["yas", "marina"]],
  "Kuala Lumpur": [["malaysian"], ["malaysia"], ["sepang"], ["kuala", "lumpur"]]
};

export function tokenize(text) {
  return String(text ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function hasTokenSeq(tokens, seq) {
  outer: for (let i = 0; i + seq.length <= tokens.length; i++) {
    for (let j = 0; j < seq.length; j++) if (tokens[i + j] !== seq[j]) continue outer;
    return true;
  }
  return false;
}

/** Race meetings for a season, with per-session keys and alias sets. */
export async function loadRaceMeetings(client, year) {
  const { rows } = await client.query(
    `SELECT s.meeting_key, s.session_key, s.session_name, s.date_start,
            MAX(s.circuit_short_name) OVER (PARTITION BY s.meeting_key) AS circuit
     FROM core.sessions s
     WHERE s.year = $1
     ORDER BY s.meeting_key, s.date_start`,
    [year]
  );
  const byMeeting = new Map();
  for (const r of rows) {
    if (!byMeeting.has(r.meeting_key)) {
      byMeeting.set(r.meeting_key, { meetingKey: Number(r.meeting_key), circuit: r.circuit, sessions: [] });
    }
    byMeeting.get(r.meeting_key).sessions.push({
      sessionKey: Number(r.session_key),
      name: r.session_name,
      dateStart: new Date(r.date_start)
    });
  }
  const meetings = [];
  for (const m of byMeeting.values()) {
    const race = m.sessions.find((s) => s.name === "Race");
    if (!race) continue; // test meeting
    meetings.push({
      ...m,
      raceStart: race.dateStart,
      aliases: CIRCUIT_GP_ALIASES[m.circuit] ?? [tokenize(m.circuit)],
      sessionByScope: {
        race: race.sessionKey,
        qualifying: m.sessions.find((s) => s.name === "Qualifying")?.sessionKey ?? null,
        sprint: m.sessions.find((s) => s.name === "Sprint")?.sessionKey ?? null
      }
    });
  }
  return meetings.sort((a, b) => a.raceStart - b.raceStart);
}

/** Which meetings does this text mention (by alias token sequence)? */
export function meetingsMentioned(meetings, text) {
  const tokens = tokenize(text);
  return meetings.filter((m) => m.aliases.some((seq) => hasTokenSeq(tokens, seq)));
}
