import { DataTable } from "@/components/DataTable";
import {
  getSessionByKey,
  getSessionCompleteness,
  getSessionDrivers,
  getSessionLaps,
  getSessionRaceControl,
  getSessionWeather
} from "@/lib/queries";
import { getSessionDriverPace } from "@/lib/queries/sessions";
import PaceTable from "./PaceTable";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params
}: {
  params: Promise<{ sessionKey: string }>;
}) {
  const { sessionKey } = await params;
  const key = Number(sessionKey);
  if (!Number.isFinite(key)) {
    return (
      <section className="card">
        <h2>Invalid session key</h2>
      </section>
    );
  }

  const [session, completeness, drivers, laps, weather, raceControl, pace] = await Promise.all([
    getSessionByKey(key),
    getSessionCompleteness(key),
    getSessionDrivers(key),
    getSessionLaps({ sessionKey: key, limit: 300 }),
    getSessionWeather(key, 200),
    getSessionRaceControl(key, 200),
    getSessionDriverPace(key)
  ]);

  if (!session) {
    return (
      <section className="card">
        <h2>Session not found</h2>
        <p className="muted">No row exists for session_key={key}.</p>
      </section>
    );
  }

  const completenessRows = completeness ? [completeness as unknown as Record<string, unknown>] : [];

  return (
    <div className="stack">
      <section className="hero">
        <h1>
          Session {String(session.session_key)} · {String(session.meeting_name ?? "Unknown")}
        </h1>
        <p>
          {String(session.session_name ?? "Unknown session")} · {String(session.date_start ?? "")} ·{" "}
          {String(session.country_name ?? "")}
        </p>
      </section>

      <div className="two-col">
        <DataTable title="Completeness Signals" rows={completenessRows} maxHeight="220px" />
        <DataTable title="Drivers" rows={drivers} maxHeight="320px" />
      </div>

      <DataTable title="Lap Preview" rows={laps} maxHeight="380px" />
      <PaceTable rows={pace} />
      <div className="two-col">
        <DataTable title="Weather Preview" rows={weather} maxHeight="300px" />
        <DataTable title="Race Control Preview" rows={raceControl} maxHeight="300px" />
      </div>
    </div>
  );
}
