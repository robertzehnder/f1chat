"use client";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="stack" style={{ padding: "4rem 2rem", textAlign: "center" }}>
      <h2>Something went wrong</h2>
      <p className="muted">{error.message ?? "An unexpected error occurred."}</p>
      <button className="btn-primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
