import { getSessionRaceProgression, getSessionReplayFrames } from "@/lib/queries/sessions";
import ReplayViewer from "./ReplayViewer";

export const dynamic = "force-dynamic";

export default async function ReplayPage({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const key = Number(sessionId);
  if (!Number.isFinite(key)) {
    return (
      <section className="card">
        <h2>Invalid session id</h2>
      </section>
    );
  }

  const [progression, frames] = await Promise.all([
    getSessionRaceProgression(key),
    getSessionReplayFrames(key)
  ]);

  return (
    <div className="stack">
      <section className="hero">
        <h1>Replay · Session {String(key)}</h1>
      </section>
      <ReplayViewer progression={progression} frames={frames} />
    </div>
  );
}
