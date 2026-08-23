"use client";

/** Last resort: a crash in the root layout itself, where there is no shell. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          background: "#f6f6f7",
          color: "#1a1a1e",
        }}
      >
        <div style={{ maxWidth: 420, padding: 28, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>DocMaker Calendar stopped</h1>
          <p style={{ color: "#6b6b76", fontSize: 14, lineHeight: 1.6 }}>{error.message}</p>
          <button
            onClick={reset}
            style={{
              marginTop: 18,
              background: "#dc6b15",
              color: "#fff",
              border: 0,
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
