"use client";

// Last-resort error boundary for failures in the root layout itself (for
// example, the database being unreachable). It replaces the whole document.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "6rem 1rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.75rem" }}>Something went wrong</h1>
        <p style={{ color: "#6b665d" }}>
          GossipRent couldn&apos;t load right now. Please try again in a moment.
          {error.digest && (
            <span style={{ display: "block", fontSize: "0.75rem", marginTop: "0.5rem" }}>
              Error reference: {error.digest}
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "1.5rem",
            padding: "0.6rem 1.25rem",
            borderRadius: "999px",
            border: "none",
            background: "#4338ca",
            color: "white",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
