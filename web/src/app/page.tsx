"use client";
import { useState, useRef, useCallback } from "react";

type TableInfo = { name: string; rows: number; status: string; error?: string };
type Result = { jobId: string; database: string; tables: TableInfo[]; totalTables: number; exported: number; totalRows: number };

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith(".bak") || f.name.endsWith(".Bak"))) setFile(f);
  }, []);

  const handleSubmit = async () => {
    if (!file) return;
    setStatus("uploading");
    setProgress("Uploading backup file...");
    setError("");

    const formData = new FormData();
    formData.append("bakfile", file);

    try {
      setProgress("Restoring database & exporting tables... (this may take 30-60 seconds)");
      const res = await fetch("/api/process", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) { setError(data.error || "Processing failed"); setStatus("error"); return; }

      setResult(data);
      setStatus("done");
    } catch (e: any) {
      setError(e.message);
      setStatus("error");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e17", color: "#e2e8f0", fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 20px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 40 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #06b6d4, #6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚡</div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, fontFamily: "system-ui" }}>LUMINA POS</h1>
            <p style={{ fontSize: 11, color: "#64748b", margin: 0, letterSpacing: "0.1em" }}>BAK TO CSV EXTRACTION SERVICE</p>
          </div>
        </div>

        {/* Upload Zone */}
        {status === "idle" && (
          <div onDrop={handleDrop} onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            style={{ border: "2px dashed #1e293b", borderRadius: 12, padding: "50px 30px", textAlign: "center", cursor: "pointer", background: "#0d1117", transition: "all 0.2s" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
            <p style={{ fontSize: 15, fontWeight: 600, fontFamily: "system-ui" }}>Drop .bak file here or click to browse</p>
            <p style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>SQL Server backup files up to 500 MB</p>
            <input ref={fileRef} type="file" accept=".bak,.Bak" onChange={e => setFile(e.target.files?.[0] || null)} style={{ display: "none" }} />
          </div>
        )}

        {/* File selected */}
        {file && status === "idle" && (
          <div style={{ marginTop: 16, background: "#0d1117", border: "1px solid #1e293b", borderRadius: 8, padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600 }}>{file.name}</p>
              <p style={{ fontSize: 11, color: "#64748b" }}>{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
            <button onClick={handleSubmit}
              style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #06b6d4, #6366f1)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "system-ui" }}>
              Extract All Tables →
            </button>
          </div>
        )}

        {/* Processing */}
        {status === "uploading" && (
          <div style={{ marginTop: 24, textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 16, animation: "spin 1s linear infinite" }}>⚙️</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <p style={{ fontSize: 14, fontFamily: "system-ui" }}>{progress}</p>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div style={{ marginTop: 24, background: "#1a0d0d", border: "1px solid #7f1d1d", borderRadius: 8, padding: 16 }}>
            <p style={{ color: "#ef4444", fontSize: 13 }}>Error: {error}</p>
            <button onClick={() => { setStatus("idle"); setFile(null); setError(""); }}
              style={{ marginTop: 12, padding: "6px 16px", borderRadius: 6, border: "1px solid #1e293b", background: "#131825", color: "#94a3b8", fontSize: 12, cursor: "pointer" }}>
              Try Again
            </button>
          </div>
        )}

        {/* Results */}
        {status === "done" && result && (
          <div style={{ marginTop: 24 }}>
            {/* Summary */}
            <div style={{ background: "#0d1117", border: "1px solid #1e293b", borderRadius: 12, padding: 20, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: "system-ui" }}>✅ Extraction Complete</h2>
                  <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Database: {result.database}</p>
                </div>
                <a href={`/api/download?jobId=${result.jobId}`}
                  style={{ padding: "10px 24px", borderRadius: 8, background: "linear-gradient(135deg, #06b6d4, #6366f1)", color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none", fontFamily: "system-ui" }}>
                  ⬇ Download ZIP
                </a>
              </div>
              <div style={{ display: "flex", gap: 20 }}>
                <div style={{ background: "#131825", borderRadius: 8, padding: "10px 16px", flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#22d3ee" }}>{result.exported}</div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>TABLES</div>
                </div>
                <div style={{ background: "#131825", borderRadius: 8, padding: "10px 16px", flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#22d3ee" }}>{result.totalRows.toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>ROWS</div>
                </div>
                <div style={{ background: "#131825", borderRadius: 8, padding: "10px 16px", flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#22d3ee" }}>{result.totalTables}</div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>TOTAL</div>
                </div>
              </div>
            </div>

            {/* Table list */}
            <div style={{ background: "#0d1117", border: "1px solid #1e293b", borderRadius: 8, maxHeight: 400, overflowY: "auto" }}>
              {result.tables.map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", padding: "8px 16px", borderBottom: "1px solid #131825", fontSize: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.status === "ok" ? "#22d3ee" : t.status === "empty" ? "#334155" : "#ef4444", marginRight: 10 }} />
                  <span style={{ flex: 1, color: t.status === "empty" ? "#475569" : "#e2e8f0" }}>{t.name}</span>
                  <span style={{ color: "#64748b" }}>{t.rows > 0 ? `${t.rows.toLocaleString()} rows` : t.status}</span>
                </div>
              ))}
            </div>

            {/* New extraction */}
            <button onClick={() => { setStatus("idle"); setFile(null); setResult(null); }}
              style={{ marginTop: 16, padding: "8px 16px", borderRadius: 6, border: "1px solid #1e293b", background: "#131825", color: "#94a3b8", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
              ← New Extraction
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
