"use client";

import type { CSSProperties } from "react";

const muted: CSSProperties = { color: "#6b665d" };

const button: CSSProperties = {
  marginTop: "1rem",
  padding: "0.6rem 1.25rem",
  borderRadius: "999px",
  border: "none",
  background: "#4338ca",
  color: "white",
  fontWeight: 600,
  cursor: "pointer",
};

// Last-resort error boundary for failures in the root layout itself (for
// example, the database being unreachable). It replaces the whole document,
// so there's no language cookie lookup or dictionary: it's static, in
// Icelandic first and then English.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="is">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "6rem 1rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.75rem" }}>Eitthvað fór úrskeiðis</h1>
        <p style={muted}>Ekki tókst að hlaða GossipRent. Reyndu aftur eftir smástund.</p>
        <button type="button" onClick={() => retry()} style={button}>
          Reyna aftur
        </button>
        <div lang="en" style={{ marginTop: "3rem" }}>
          <p style={{ fontSize: "1.25rem", fontWeight: 600 }}>Something went wrong</p>
          <p style={muted}>GossipRent couldn&apos;t load right now. Please try again in a moment.</p>
          <button type="button" onClick={() => retry()} style={button}>
            Try again
          </button>
        </div>
        {error.digest && (
          <p style={{ ...muted, fontSize: "0.75rem", marginTop: "2rem" }}>
            Tilvísun villu / <span lang="en">Error reference</span>: {error.digest}
          </p>
        )}
      </body>
    </html>
  );
}
