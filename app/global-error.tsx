"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Last-resort logging — logger may itself be broken at this point.
    try {
      console.error("[GlobalError]", error?.name, error?.message, error?.digest);
    } catch {
      // ignore
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          background: "#0a0612",
          color: "#e5e7eb",
          fontFamily: "system-ui, -apple-system, sans-serif",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          margin: 0,
        }}
      >
        <div style={{ maxWidth: "420px", width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: "48px", opacity: 0.4, marginBottom: "12px" }}>⚠</div>
          <h1
            style={{
              fontSize: "18px",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              margin: "0 0 8px",
              color: "#fff",
            }}
          >
            The Lattice collapsed
          </h1>
          <p style={{ fontSize: "13px", color: "#d1d5db", margin: "0 0 20px", lineHeight: 1.5 }}>
            A fatal error occurred while rendering the app shell. Your funds are safe on-chain.
          </p>
          {error?.digest && (
            <p
              style={{
                fontSize: "10px",
                fontFamily: "ui-monospace, monospace",
                color: "#6b7280",
                margin: "0 0 16px",
              }}
            >
              ref: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              display: "inline-block",
              padding: "10px 16px",
              borderRadius: "6px",
              border: "1px solid rgba(139, 92, 246, 0.4)",
              background: "rgba(139, 92, 246, 0.1)",
              color: "#ddd6fe",
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
