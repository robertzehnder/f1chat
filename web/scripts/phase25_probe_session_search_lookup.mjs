// Phase 25.1 venue-lookup blocker probe.
//
// Tests whether `core.session_search_lookup` actually has rows for the
// venues that Phase 25.1's escalated questions depend on (Hungary,
// Singapore, Imola, Australia 2025 race sessions). Live observation
// during Phase 25.1 re-validation showed the resolver only ever returns
// {Abu Dhabi, Qatar, Las Vegas, Brazil} 2025 race sessions when asked
// about Hungary/Singapore/Imola — suggesting either no rows exist or
// the alias normalization differs from what the chat resolver derives.
//
// Reads NEON_* env from web/.env.local. Read-only, single SELECT
// queries.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadEnv() {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  const text = await readFile(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main() {
  await loadEnv();
  const host = process.env.NEON_DB_HOST;
  if (!host) {
    console.error("NEON_DB_HOST not set; aborting");
    process.exit(2);
  }
  const pool = new pg.Pool({
    host,
    port: Number(process.env.NEON_DB_PORT ?? 5432),
    database: process.env.NEON_DB_NAME ?? "neondb",
    user: process.env.NEON_DB_USER,
    password: process.env.NEON_DB_PASSWORD,
    ssl: { rejectUnauthorized: true },
    statement_timeout: 15000,
    connectionTimeoutMillis: 10000
  });

  try {
    // 1) Confirm the venues exist in core.sessions for 2025.
    const sessionsRes = await pool.query(
      `SELECT session_key, session_name, country_name, location, circuit_short_name, meeting_name, year
         FROM core.sessions
        WHERE year = 2025
          AND session_name = 'Race'
          AND (
                LOWER(country_name)         LIKE ANY($1::text[])
             OR LOWER(location)             LIKE ANY($1::text[])
             OR LOWER(circuit_short_name)   LIKE ANY($1::text[])
             OR LOWER(meeting_name)         LIKE ANY($1::text[])
          )
        ORDER BY date_start ASC`,
      [["%hungar%", "%singapor%", "%imola%", "%emilia%", "%italy%italy%", "%australia%", "%melbourne%", "%albert park%"]]
    );
    console.log("=".repeat(72));
    console.log("[1] core.sessions 2025 Race rows for Hungary/Singapore/Imola/Australia:");
    console.log("=".repeat(72));
    if (sessionsRes.rowCount === 0) {
      console.log("  (no rows — core.sessions does NOT have 2025 race entries for any of the listed venues)");
    } else {
      for (const r of sessionsRes.rows) {
        console.log(
          `  session_key=${r.session_key}  ${r.session_name}  country=${r.country_name}  loc=${r.location}  circuit=${r.circuit_short_name}  meeting=${r.meeting_name}`
        );
      }
    }

    // 2) Inspect the search_lookup table for the venues.
    const lookupRes = await pool.query(
      `SELECT session_key, normalized_alias, year, session_name
         FROM core.session_search_lookup
        WHERE year = 2025
          AND session_name = 'Race'
          AND (
                normalized_alias LIKE ANY($1::text[])
          )
        ORDER BY normalized_alias ASC, session_key ASC
        LIMIT 200`,
      [["%hungar%", "%singapor%", "%imola%", "%emilia%", "%australia%", "%melbourne%", "%albert park%"]]
    );
    console.log("\n" + "=".repeat(72));
    console.log("[2] core.session_search_lookup 2025 Race aliases matching the venues:");
    console.log("=".repeat(72));
    if (lookupRes.rowCount === 0) {
      console.log("  (no rows — search_lookup has NO aliases for any of these venues' 2025 races)");
    } else {
      for (const r of lookupRes.rows) {
        console.log(`  session_key=${r.session_key}  alias='${r.normalized_alias}'  ${r.session_name}/${r.year}`);
      }
    }

    // 3) For comparison, what aliases DO exist for one of the
    // venues that the live probe DID return (Abu Dhabi 9839)?
    const sample = await pool.query(
      `SELECT normalized_alias
         FROM core.session_search_lookup
        WHERE session_key = 9839
        ORDER BY normalized_alias`
    );
    console.log("\n" + "=".repeat(72));
    console.log(
      `[3] sample working venue: aliases for session_key=9839 (Abu Dhabi 2025 Race)`
    );
    console.log("=".repeat(72));
    console.log(
      "  count=" +
        sample.rowCount +
        " aliases=" +
        sample.rows.map((r) => r.normalized_alias).join(" | ")
    );

    // 4) For the Singapore venue we do think exists (session_key
    // 9896 — surfaced in Phase 19 baseline q2085), what aliases (if any)
    // does it have? Useful to confirm it's a row-existence problem
    // vs. an alias-coverage problem.
    const singapore = await pool.query(
      `SELECT normalized_alias
         FROM core.session_search_lookup
        WHERE session_key = 9896
        ORDER BY normalized_alias`
    );
    console.log("\n" + "=".repeat(72));
    console.log(
      `[4] sample broken venue: aliases for session_key=9896 (Singapore 2025 Race per Phase 19 baseline q2085)`
    );
    console.log("=".repeat(72));
    if (singapore.rowCount === 0) {
      console.log(
        "  (no rows — session 9896 has ZERO entries in core.session_search_lookup; resolver cannot find it via aliases)"
      );
    } else {
      console.log(
        "  count=" +
          singapore.rowCount +
          " aliases=" +
          singapore.rows.map((r) => r.normalized_alias).join(" | ")
      );
    }

    // 5) Total alias-row coverage by year — is 2025 under-populated?
    const coverage = await pool.query(
      `SELECT year, COUNT(DISTINCT session_key) AS sessions_with_aliases, COUNT(*) AS total_aliases
         FROM core.session_search_lookup
        GROUP BY year
        ORDER BY year ASC`
    );
    console.log("\n" + "=".repeat(72));
    console.log("[5] core.session_search_lookup coverage by year:");
    console.log("=".repeat(72));
    for (const r of coverage.rows) {
      console.log(
        `  year=${r.year}  sessions_with_aliases=${r.sessions_with_aliases}  total_aliases=${r.total_aliases}`
      );
    }

    // 5b) Simulate the exact getSessionsFromSearchLookup SQL with
    // the alias list q1941 ("What compound did Verstappen start on
    // at the 2025 Singapore GP?") would derive after stopword
    // filtering. If 9896 (Singapore) doesn't come back at top,
    // the bug is in alias derivation. If it DOES come back at top,
    // the bug is downstream in chatRuntime.ts.
    const q1941Aliases = [
      "compound",
      "verstappen",
      "start",
      "singapore",
      "gp",
      "singapore gp",
      "verstappen start",
      "start singapore"
    ];
    const simRes = await pool.query(
      `WITH matched AS (
         SELECT
           ssl.session_key, ssl.country_name, ssl.location, ssl.meeting_name,
           COUNT(*)::int AS alias_hits
         FROM core.session_search_lookup ssl
         LEFT JOIN core.session_completeness sc ON sc.session_key = ssl.session_key
         WHERE ssl.year = 2025
           AND ssl.session_name = 'Race'
           AND ssl.normalized_alias = ANY($1::text[])
           AND COALESCE(sc.is_future_session, false) = false
           AND COALESCE(sc.is_placeholder, false) = false
         GROUP BY ssl.session_key, ssl.country_name, ssl.location, ssl.meeting_name
       )
       SELECT * FROM matched ORDER BY alias_hits DESC, session_key DESC LIMIT 8`,
      [q1941Aliases]
    );
    console.log("\n" + "=".repeat(72));
    console.log(
      `[5b] simulated getSessionsFromSearchLookup for q1941 alias list:`
    );
    console.log("     " + JSON.stringify(q1941Aliases));
    console.log("=".repeat(72));
    if (simRes.rowCount === 0) {
      console.log("  (no rows — NO aliases matched at all)");
    } else {
      for (const r of simRes.rows) {
        console.log(
          `  session_key=${r.session_key}  alias_hits=${r.alias_hits}  ${r.country_name} / ${r.location} / ${r.meeting_name}`
        );
      }
    }

    // 5c) Same simulation but WITHOUT the session_name='Race'
    // filter, mirroring what chatRuntime sends when extractSessionNameHint
    // returns undefined (q1941 doesn't say "race"). If 9896 still tops
    // the list, the bug is purely in the chat alias derivation.
    const simNoNameRes = await pool.query(
      `WITH matched AS (
         SELECT
           ssl.session_key, ssl.session_name, ssl.country_name, ssl.location, ssl.meeting_name,
           COUNT(*)::int AS alias_hits
         FROM core.session_search_lookup ssl
         LEFT JOIN core.session_completeness sc ON sc.session_key = ssl.session_key
         WHERE ssl.year = 2025
           AND ssl.normalized_alias = ANY($1::text[])
           AND COALESCE(sc.is_future_session, false) = false
           AND COALESCE(sc.is_placeholder, false) = false
         GROUP BY ssl.session_key, ssl.session_name, ssl.country_name, ssl.location, ssl.meeting_name
       )
       SELECT * FROM matched ORDER BY alias_hits DESC, session_key DESC LIMIT 12`,
      [q1941Aliases]
    );
    console.log("\n" + "=".repeat(72));
    console.log("[5c] same simulated query but WITHOUT session_name='Race' filter:");
    console.log("=".repeat(72));
    if (simNoNameRes.rowCount === 0) {
      console.log("  (no rows — NO aliases matched at all)");
    } else {
      for (const r of simNoNameRes.rows) {
        console.log(
          `  session_key=${r.session_key}  alias_hits=${r.alias_hits}  ${r.session_name}  ${r.country_name} / ${r.location}`
        );
      }
    }

    // 5d) Probe: what aliases AT ALL match a more-likely live alias
    // set (just the most-generic tokens) without 'singapore' to see
    // if the chat code is sending an alias list that doesn't include
    // the venue token. This reveals what set produces the live
    // {9839, 9850, 9845, 9858, 9869} candidate top-5.
    const genericAliases = ["compound", "verstappen", "start", "gp"];
    const genericRes = await pool.query(
      `WITH matched AS (
         SELECT
           ssl.session_key, ssl.session_name, ssl.country_name, ssl.location,
           COUNT(*)::int AS alias_hits, MAX(ssl.date_start) AS date_start
         FROM core.session_search_lookup ssl
         LEFT JOIN core.session_completeness sc ON sc.session_key = ssl.session_key
         WHERE ssl.year = 2025
           AND ssl.normalized_alias = ANY($1::text[])
           AND COALESCE(sc.is_future_session, false) = false
           AND COALESCE(sc.is_placeholder, false) = false
         GROUP BY ssl.session_key, ssl.session_name, ssl.country_name, ssl.location
       )
       SELECT * FROM matched ORDER BY alias_hits DESC, date_start DESC NULLS LAST, session_key DESC LIMIT 8`,
      [genericAliases]
    );
    console.log("\n" + "=".repeat(72));
    console.log("[5d] simulated query with WITHOUT 'singapore'/'singapore gp' (only generic chat tokens):");
    console.log("     " + JSON.stringify(genericAliases));
    console.log("=".repeat(72));
    for (const r of genericRes.rows) {
      console.log(
        `  session_key=${r.session_key}  alias_hits=${r.alias_hits}  ${r.session_name}  ${r.country_name} / ${r.location}`
      );
    }

    // 6) Per-2025-race-session alias counts — see which 2025 races
    // are missing alias coverage entirely.
    const perSession = await pool.query(
      `SELECT s.session_key, s.country_name, s.location, s.meeting_name,
              COALESCE(a.alias_count, 0) AS alias_count
         FROM core.sessions s
         LEFT JOIN (
           SELECT session_key, COUNT(*) AS alias_count
             FROM core.session_search_lookup
            WHERE year = 2025 AND session_name = 'Race'
            GROUP BY session_key
         ) a ON a.session_key = s.session_key
        WHERE s.year = 2025 AND s.session_name = 'Race'
        ORDER BY s.date_start ASC`
    );
    console.log("\n" + "=".repeat(72));
    console.log("[6] alias counts per 2025 Race session (sorted by date_start):");
    console.log("=".repeat(72));
    for (const r of perSession.rows) {
      const tag = r.alias_count > 0 ? "OK " : "ZERO";
      console.log(
        `  ${tag}  session_key=${r.session_key}  alias_count=${r.alias_count}  ${r.country_name} / ${r.location} / ${r.meeting_name}`
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
