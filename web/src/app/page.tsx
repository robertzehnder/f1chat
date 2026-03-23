import Link from "next/link";
import { getOverviewStats } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const stats = await getOverviewStats();

  const cards = [
    { label: "Sessions", value: stats.sessions },
    { label: "Drivers", value: stats.drivers },
    { label: "Laps", value: stats.laps },
    { label: "Intervals", value: stats.intervals },
    { label: "Car Data", value: stats.car_data },
    { label: "Location", value: stats.location }
  ];

  return (
    <div className="stack">
      <section className="hero">
        <h1>OpenF1 Data Explorer</h1>
        <p>
          Read-only app scaffold for browsing sessions, checking data completeness, querying
          telemetry, and using an analyst-style chat interface over your local Postgres warehouse.
        </p>
      </section>

      <section className="card-grid">
        {cards.map((card) => (
          <article className="card" key={card.label}>
            <p className="muted">{card.label}</p>
            <p className="metric">{String(card.value ?? 0)}</p>
          </article>
        ))}
      </section>

      <section className="card">
        <h3 className="panel-title">Start Here</h3>
        <div className="stack">
          <Link href="/sessions" className="muted">
            Browse sessions and completeness
          </Link>
          <Link href="/telemetry" className="muted">
            Query telemetry tables with safe filters
          </Link>
          <Link href="/chat" className="muted">
            Use analyst chat (heuristic mode for now)
          </Link>
          <Link href="/catalog" className="muted">
            Inspect raw/core schema catalog
          </Link>
        </div>
      </section>
    </div>
  );
}
