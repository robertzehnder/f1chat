import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db/driver";

/**
 * Track outline for the map cards (dominance ribbon, corner highlights,
 * speed/traction gradient). No per-circuit assets: the shape is DERIVED
 * from one reference lap's raw.location x/y samples.
 *
 * Query params:
 *   circuit     — required, core.sessions.circuit_short_name
 *   sessionKey  — optional: pin the session (default: newest race with data)
 *   driver      — optional: pin the reference car (default: session's
 *                 fastest valid green lap). Use for driver-specific
 *                 speed/traction maps.
 *   channels=1  — include per-point speed/throttle/brake from raw.car_data
 *                 (timestamp-nearest join on the same lap window)
 *
 * Response: points normalized into a 0-1000 square (y flipped for SVG),
 * each with lap-distance fraction f ∈ [0,1]; corner labels and official
 * sector boundary fractions; DRS zones as fraction ranges (derived from
 * the reference lap's drs flags — FastF1 convention: 10/12/14 = open).
 */

type OutlinePoint = {
  x: number;
  y: number;
  f: number;
  speed?: number;
  throttle?: number;
  brake?: number;
};
type OutlinePayload = {
  circuit: string;
  sessionKey: number;
  driverNumber: number;
  driverName: string | null;
  lapDuration: number | null;
  points: OutlinePoint[];
  corners: Array<{ label: string; f: number }>;
  sectors: number[];
  /** DRS activation zones as [start_f, end_f] ranges along the lap. */
  drsZones: Array<[number, number]>;
};

const outlineCache = new Map<string, OutlinePayload | null>();

function smooth(values: number[], window = 3): number[] {
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = -window; k <= window; k += 1) {
      const v = values[i + k];
      if (v !== undefined) {
        sum += v;
        n += 1;
      }
    }
    return sum / Math.max(n, 1);
  });
}

async function computeDrsZones(circuit: string): Promise<Array<[number, number]>> {
  try {
    const sessions = await sql<{ session_key: number }>(
      `SELECT session_key
       FROM core.sessions
       WHERE circuit_short_name = $1 AND session_name = 'Qualifying'
       ORDER BY date_start DESC
       LIMIT 3`,
      [circuit]
    );
    for (const session of sessions) {
      const refLap = await sql<{ driver_number: number; lap_start_ts: string; lap_end_ts: string }>(
        `SELECT driver_number, lap_start_ts, lap_end_ts
         FROM core.laps_enriched
         WHERE session_key = $1
           AND lap_duration IS NOT NULL
           AND COALESCE(is_valid, TRUE) = TRUE
           AND lap_start_ts IS NOT NULL AND lap_end_ts IS NOT NULL
         ORDER BY lap_duration ASC
         LIMIT 1`,
        [session.session_key]
      );
      if (refLap.length === 0) continue;
      const lap = refLap[0];
      const loc = await sql<{ x: number | string; y: number | string; date: string }>(
        `SELECT x, y, date FROM raw.location
         WHERE session_key = $1 AND driver_number = $2 AND date BETWEEN $3 AND $4
           AND x IS NOT NULL AND y IS NOT NULL
         ORDER BY date`,
        [session.session_key, lap.driver_number, lap.lap_start_ts, lap.lap_end_ts]
      );
      if (loc.length < 100) continue;
      const tele = await sql<{ date: string; drs: number | string | null }>(
        `SELECT date, drs FROM raw.car_data
         WHERE session_key = $1 AND driver_number = $2 AND date BETWEEN $3 AND $4
         ORDER BY date`,
        [session.session_key, lap.driver_number, lap.lap_start_ts, lap.lap_end_ts]
      );
      if (tele.length < 10) continue;

      // Fractions along the quali lap by cumulative arc length.
      const xs = loc.map((s) => Number(s.x));
      const ys = loc.map((s) => Number(s.y));
      const cumulative: number[] = [0];
      for (let i = 1; i < xs.length; i += 1) {
        cumulative.push(cumulative[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
      }
      const total = cumulative[cumulative.length - 1] || 1;
      const locTimes = loc.map((s) => Date.parse(s.date));
      const fractionAt = (ms: number): number => {
        let idx = locTimes.findIndex((t) => t >= ms);
        if (idx < 0) idx = locTimes.length - 1;
        return cumulative[idx] / total;
      };

      const DRS_OPEN = new Set([10, 12, 14]);
      const zones: Array<[number, number]> = [];
      let zoneStart: number | null = null;
      for (const t of tele) {
        const open = t.drs !== null && DRS_OPEN.has(Number(t.drs));
        const f = fractionAt(Date.parse(t.date));
        if (open && zoneStart === null) zoneStart = f;
        if (!open && zoneStart !== null) {
          if (f - zoneStart > 0.01) zones.push([Number(zoneStart.toFixed(4)), Number(f.toFixed(4))]);
          zoneStart = null;
        }
      }
      if (zoneStart !== null && 1 - zoneStart > 0.01) {
        zones.push([Number(zoneStart.toFixed(4)), 1]);
      }
      if (zones.length > 0) return zones;
    }
  } catch {
    // DRS shading is decorative — never fail the outline over it.
  }
  return [];
}

async function computeOutline(
  circuit: string,
  opts: { sessionKey?: number; driverNumber?: number; channels: boolean }
): Promise<OutlinePayload | null> {
  const sessions = opts.sessionKey
    ? [{ session_key: opts.sessionKey }]
    : await sql<{ session_key: number }>(
        `SELECT session_key
         FROM core.sessions
         WHERE circuit_short_name = $1 AND session_name = 'Race'
         ORDER BY date_start DESC
         LIMIT 4`,
        [circuit]
      );

  for (const session of sessions) {
    const refLap = await sql<{
      driver_number: number;
      driver_name: string | null;
      lap_duration: number | string | null;
      lap_start_ts: string;
      lap_end_ts: string;
      duration_sector_1: number | string | null;
      duration_sector_2: number | string | null;
    }>(
      `SELECT driver_number, MAX(driver_name) AS driver_name, lap_duration,
              lap_start_ts, lap_end_ts, duration_sector_1, duration_sector_2
       FROM core.laps_enriched
       WHERE session_key = $1
         AND ($2::int IS NULL OR driver_number = $2)
         AND lap_duration IS NOT NULL
         AND COALESCE(is_valid, TRUE) = TRUE
         AND COALESCE(is_pit_lap, FALSE) = FALSE
         AND COALESCE(is_pit_out_lap, FALSE) = FALSE
         AND lap_start_ts IS NOT NULL
         AND lap_end_ts IS NOT NULL
       GROUP BY driver_number, lap_duration, lap_start_ts, lap_end_ts,
                duration_sector_1, duration_sector_2
       ORDER BY lap_duration ASC
       LIMIT 1`,
      [session.session_key, opts.driverNumber ?? null]
    );
    if (refLap.length === 0) continue;
    const lap = refLap[0];

    const samples = await sql<{ x: number | string; y: number | string; date: string }>(
      `SELECT x, y, date
       FROM raw.location
       WHERE session_key = $1
         AND driver_number = $2
         AND date BETWEEN $3 AND $4
         AND x IS NOT NULL AND y IS NOT NULL
       ORDER BY date`,
      [session.session_key, lap.driver_number, lap.lap_start_ts, lap.lap_end_ts]
    );
    if (samples.length < 120) continue;

    let xs = samples.map((s) => Number(s.x));
    let ys = samples.map((s) => Number(s.y));
    xs = smooth(xs);
    ys = smooth(ys);
    xs.push(xs[0]);
    ys.push(ys[0]);

    const cumulative: number[] = [0];
    for (let i = 1; i < xs.length; i += 1) {
      cumulative.push(cumulative[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
    }
    const total = cumulative[cumulative.length - 1] || 1;

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 70;
    const scale = (1000 - 2 * pad) / Math.max(maxX - minX, maxY - minY, 1);
    const offsetX = (1000 - (maxX - minX) * scale) / 2;
    const offsetY = (1000 - (maxY - minY) * scale) / 2;
    const points: OutlinePoint[] = xs.map((x, i) => ({
      x: Number((offsetX + (x - minX) * scale).toFixed(1)),
      y: Number((1000 - (offsetY + (ys[i] - minY) * scale)).toFixed(1)),
      f: Number((cumulative[i] / total).toFixed(4))
    }));

    const sampleTimes = samples.map((s) => Date.parse(s.date));

    // Per-point telemetry channels (timestamp-nearest join on the same lap).
    if (opts.channels) {
      const tele = await sql<{
        date: string;
        speed: number | string | null;
        throttle: number | string | null;
        brake: number | string | null;
      }>(
        `SELECT date, speed, throttle, brake
         FROM raw.car_data
         WHERE session_key = $1
           AND driver_number = $2
           AND date BETWEEN $3 AND $4
         ORDER BY date`,
        [session.session_key, lap.driver_number, lap.lap_start_ts, lap.lap_end_ts]
      );
      if (tele.length > 10) {
        const teleTimes = tele.map((t) => Date.parse(t.date));
        let j = 0;
        sampleTimes.forEach((ts, i) => {
          while (j + 1 < teleTimes.length && Math.abs(teleTimes[j + 1] - ts) <= Math.abs(teleTimes[j] - ts)) j += 1;
          const t = tele[j];
          if (i >= points.length) return;
          if (t.speed !== null) points[i].speed = Math.round(Number(t.speed));
          if (t.throttle !== null) points[i].throttle = Math.round(Number(t.throttle));
          if (t.brake !== null) points[i].brake = Math.round(Number(t.brake));
        });
        const last = points[points.length - 1];
        const first = points[0];
        last.speed = first.speed;
        last.throttle = first.throttle;
        last.brake = first.brake;
      }
    }

    // DRS zones from a QUALIFYING lap, not the race reference: DRS in the
    // race requires a car ahead within 1s, so the leader's fastest lap
    // (often the session best) shows ZERO activations. In qualifying DRS
    // use is free — every zone lights up on a push lap. Fractions from
    // the quali lap's own arc length map onto this outline because both
    // normalize from the same start/finish line.
    const drsZones = await computeDrsZones(circuit);

    const cornerRows = await sql<{ segment_label: string; start_normalized: number | string }>(
      `SELECT segment_label, start_normalized
       FROM f1.track_segments
       WHERE circuit_short_name = $1 AND segment_kind = 'corner'
       ORDER BY start_normalized`,
      [circuit]
    );
    const corners = cornerRows
      .map((r) => ({ label: String(r.segment_label ?? ""), f: Number(r.start_normalized) }))
      .filter((c) => c.label && Number.isFinite(c.f));

    const sectors: number[] = [];
    const s1 = Number(lap.duration_sector_1);
    const s2 = Number(lap.duration_sector_2);
    if (Number.isFinite(s1) && s1 > 0 && Number.isFinite(s2) && s2 > 0) {
      const startMs = Date.parse(lap.lap_start_ts);
      const fractionAtTime = (targetMs: number): number | null => {
        const idx = sampleTimes.findIndex((t) => t >= targetMs);
        if (idx <= 0) return null;
        return points[Math.min(idx, points.length - 1)].f;
      };
      const f1 = fractionAtTime(startMs + s1 * 1000);
      const f2 = fractionAtTime(startMs + (s1 + s2) * 1000);
      if (f1 !== null && f2 !== null && f1 > 0.05 && f2 > f1 && f2 < 0.98) {
        sectors.push(Number(f1.toFixed(4)), Number(f2.toFixed(4)));
      }
    }

    return {
      circuit,
      sessionKey: session.session_key,
      driverNumber: lap.driver_number,
      driverName: lap.driver_name,
      lapDuration: lap.lap_duration === null ? null : Number(lap.lap_duration),
      points,
      corners,
      sectors,
      drsZones
    };
  }

  return null;
}

export async function GET(req: NextRequest) {
  const circuit = req.nextUrl.searchParams.get("circuit")?.trim();
  if (!circuit) {
    return NextResponse.json({ error: "circuit query param required" }, { status: 400 });
  }
  const sessionKeyRaw = Number(req.nextUrl.searchParams.get("sessionKey"));
  const driverRaw = Number(req.nextUrl.searchParams.get("driver"));
  const channels = req.nextUrl.searchParams.get("channels") === "1";
  const sessionKey = Number.isFinite(sessionKeyRaw) && sessionKeyRaw > 0 ? Math.trunc(sessionKeyRaw) : undefined;
  const driverNumber = Number.isFinite(driverRaw) && driverRaw > 0 ? Math.trunc(driverRaw) : undefined;

  const cacheKey = `${circuit}|${sessionKey ?? ""}|${driverNumber ?? ""}|${channels ? 1 : 0}`;
  if (!outlineCache.has(cacheKey)) {
    try {
      outlineCache.set(cacheKey, await computeOutline(circuit, { sessionKey, driverNumber, channels }));
    } catch {
      return NextResponse.json({ error: "outline computation failed" }, { status: 503 });
    }
  }

  const outline = outlineCache.get(cacheKey);
  if (!outline) {
    return NextResponse.json({ error: `no location data for ${circuit}` }, { status: 404 });
  }
  return NextResponse.json(outline, {
    headers: { "Cache-Control": "public, max-age=86400" }
  });
}
