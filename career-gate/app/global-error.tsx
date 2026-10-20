"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#08090D", color: "#fff", fontFamily: "system-ui, sans-serif", padding: 16 }}>
        <div style={{ maxWidth: 420, width: "100%", textAlign: "center", border: "1px solid rgba(201,162,126,.35)", borderRadius: 24, padding: 32, background: "rgba(255,255,255,.04)" }}>
          <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>Career Gate is temporarily unavailable</h1>
          <p dir="rtl" style={{ fontSize: 14, color: "#cbd5e1", margin: "0 0 16px" }}>النظام غير متاح مؤقتاً. يرجى المحاولة مرة أخرى.</p>
          {error.digest && <p style={{ fontFamily: "monospace", fontSize: 12, color: "#94a3b8" }}>Reference: {error.digest}</p>}
          <button type="button" onClick={reset} style={{ minHeight: 44, padding: "0 20px", borderRadius: 12, border: "1px solid rgba(201,162,126,.5)", background: "transparent", color: "#f3d9c4", fontWeight: 600, cursor: "pointer" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
