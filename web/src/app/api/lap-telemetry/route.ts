import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db/driver";

/**
 * Distance-aligned fastest-lap telemetry for one or two drivers — feeds
 * the stacked speed/gear/throttle/brake overlay card. For each driver:
 * fastest valid green lap → location samples give the distance fraction
 * axis (cumulative arc length), car_data channels join timestamp-nearest.
 * Corner labels come from f1.track_segments so the x-axis can tick at
 * named corners.
 */

type DriverTrace = {
  driverNumber: number;
  driverName: string | null;
  lapNumber: number | null;
  lapDuration: number | null;
  f: number[];
  speed: Array<number | null>;
  throttle: Array<number | null>;
  brake: Array<number | null>;
  gear: Array<number | null>;
};
type Payload = {
  sessionKey: number;
  circuit: string | null;
  corners: Array<{ label: string; f: number }>;
  drivers: DriverTrace[];
};

const cache = new Map<string, Payload | null>();

async function traceFor(sessionKey: number, driverNumber: number): Promise<DriverTrace | null> {
  const refLap = await sql<{
    driver_name: string | null;
    lap_number: number | string;
    lap_duration: number | string;
    lap_start_ts: string;
    lap_end_ts: string;
  }>(
    `SELECT MAX(driver_name) AS driver_name, lap_number, lap_duration, lap_start_ts, lap_end_ts
     FROM core.laps_enriched
     WHERE session_key = $1 AND driver_number = $2
       AND lap_duration IS NOT NULL
       AND COALESCE(is_valid, TRUE) = TRUE
       AND COALESCE(is_pit_lap, FALSE) = FALSE
       AND COALESCE(is_pit_out_lap, FALSE) = FALSE
       AND lap_start_ts IS NOT NULL AND lap_end_ts IS NOT NULL
     GROUP BY lap_number, lap_duration, lap_start_ts, lap_end_ts
     ORDER BY lap_duration ASC
     LIMIT 1`,
    [sessionKey, driverNumber]
  );
  if (refLap.length === 0) return null;
  const lap = refLap[0];

  const loc = await sql<{ x: number | string; y: number | string; date: string }>(
    `SELECT x, y, date FROM raw.location
     WHERE session_key = $1 AND driver_number = $2 AND date BETWEEN $3 AND $4
       AND x IS NOT NULL AND y IS NOT NULL
     ORDER BY date`,
    [sessionKey, driverNumber, lap.lap_start_ts, lap.lap_end_ts]
  );
  if (loc.length < 80) return null;

  const tele = await sql<{
    date: string;
    speed: number | string | null;
    throttle: number | string | null;
    brake: number | string | null;
    n_gear: number | string | null;
  }>(
    `SELECT date, speed, throttle, brake, n_gear FROM raw.car_data
     WHERE session_key = $1 AND driver_number = $2 AND date BETWEEN $3 AND $4
     ORDER BY date`,
    [sessionKey, driverNumber, lap.lap_start_ts, lap.lap_end_ts]
  );
  if (tele.length < 10) return null;

  // Distance fraction per location sample.
  const xs = loc.map((s) => Number(s.x));
  const ys = loc.map((s) => Number(s.y));
  const cumulative: number[] = [0];
  for (let i = 1; i < xs.length; i += 1) {
    cumulative.push(cumulative[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  }
  const total = cumulative[cumulative.length - 1] || 1;
  const locTimes = loc.map((s) => Date.parse(s.date));
  const teleTimes = tele.map((t) => Date.parse(t.date));

  // Timestamp-nearest channel per location sample (both monotonic).
  let j = 0;
  const trace: DriverTrace = {
    driverNumber,
    driverName: lap.driver_name,
    lapNumber: Number(lap.lap_number),
    lapDuration: Number(lap.lap_duration),
    f: [],
    speed: [],
    throttle: [],
    brake: [],
    gear: []
  };
  locTimes.forEach((ts, i) => {
    while (j + 1 < teleTimes.length && Math.abs(teleTimes[j + 1] - ts) <= Math.abs(teleTimes[j] - ts)) j += 1;
    const t = tele[j];
    trace.f.push(Number((cumulative[i] / total).toFixed(4)));
    trace.speed.push(t.speed === null ? null : Math.round(Number(t.speed)));
    trace.throttle.push(t.throttle === null ? null : Math.round(Number(t.throttle)));
    trace.brake.push(t.brake === null ? null : Math.round(Number(t.brake)));
    trace.gear.push(t.n_gear === null ? null : Math.round(Number(t.n_gear)));
  });
  return trace;
}

export async function GET(req: NextRequest) {
  const sessionKey = Number(req.nextUrl.searchParams.get("sessionKey"));
  const drivers = (req.nextUrl.searchParams.get("drivers") ?? "")
    .split(",")
    .map((d) => Number(d.trim()))
    .filter((d) => Number.isFinite(d) && d > 0)
    .slice(0, 2);
  if (!Number.isFinite(sessionKey) || sessionKey <= 0 || drivers.length === 0) {
    return NextResponse.json({ error: "sessionKey and drivers required" }, { status: 400 });
  }

  const cacheKey = `${sessionKey}|${drivers.join(",")}`;
  if (!cache.has(cacheKey)) {
    try {
      const sess = await sql<{ circuit_short_name: string | null }>(
        `SELECT circuit_short_name FROM core.sessions WHERE session_key = $1 LIMIT 1`,
        [sessionKey]
      );
      const circuit = sess[0]?.circuit_short_name ?? null;
      const corners = circuit
        ? (
            await sql<{ segment_label: string; start_normalized: number | string }>(
              `SELECT segment_label, start_normalized FROM f1.track_segments
               WHERE circuit_short_name = $1 AND segment_kind = 'corner'
               ORDER BY start_normalized`,
              [circuit]
            )
          )
            .map((r) => ({ label: String(r.segment_label ?? ""), f: Number(r.start_normalized) }))
            .filter((c) => c.label && Number.isFinite(c.f))
        : [];
      const traces = (await Promise.all(drivers.map((d) => traceFor(Math.trunc(sessionKey), d)))).filter(
        (t): t is DriverTrace => t !== null
      );
      cache.set(cacheKey, traces.length ? { sessionKey: Math.trunc(sessionKey), circuit, corners, drivers: traces } : null);
    } catch {
      return NextResponse.json({ error: "telemetry computation failed" }, { status: 503 });
    }
  }

  const payload = cache.get(cacheKey);
  if (!payload) {
    return NextResponse.json({ error: "no telemetry for the requested laps" }, { status: 404 });
  }
  return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=86400" } });
}
