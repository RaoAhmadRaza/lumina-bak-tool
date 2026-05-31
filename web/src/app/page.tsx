"use client";
import { useState, useRef, useCallback } from "react";

type TableInfo = { name: string; rows: number; status: string; error?: string };
type Result = { jobId: string; database: string; tables: TableInfo[]; totalTables: number; exported: number; totalRows: number };

interface Warning {
  type?: string;
  message: string;
  count?: number;
  details?: unknown;
}
interface MappingPhaseTable {
  target: string;
  outputRows: number;
  warnings?: Warning[];
}
interface MappingPhase {
  name: string;
  tables: MappingPhaseTable[];
}
interface MappingResultData {
  detectedFormat: string;
  totalOutputRows: number;
  phases: MappingPhase[];
  warnings?: Warning[];
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#F8F9FA",
  surface: "#FFFFFF",
  surfaceSoft: "#F1F3F4",
  blue: "#1A73E8",
  blueHover: "#1669D9",
  blueSoft: "#E8F0FE",
  text: "#1A1A1A",
  textSec: "#616161",
  textTert: "#9E9E9E",
  success: "#34A853",
  successSoft: "#E6F4EA",
  warning: "#FB8C00",
  warningSoft: "#FEF3E2",
  danger: "#EA4335",
  dangerSoft: "#FCE8E6",
  border: "#E0E0E0",
  borderLight: "#EEEEEE",
};

const shadow = {
  card: "0 8px 24px rgba(0,0,0,0.06)",
  hover: "0 14px 40px rgba(0,0,0,0.12)",
  blue: "0 4px 12px rgba(26,115,232,0.28)",
  green: "0 4px 12px rgba(52,168,83,0.24)",
};

const font = "'SF Pro Display','SF Pro Text',Inter,'Helvetica Neue',system-ui,sans-serif";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [mapping, setMapping] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [mappingError, setMappingError] = useState("");
  const [mappingResult, setMappingResult] = useState<MappingResultData | null>(null);

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
    setMapping("idle");
    setMappingResult(null);

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

  const handleMap = async () => {
    if (!result?.jobId) return;
    setMapping("loading");
    setMappingError("");
    try {
      const res = await fetch("/api/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: result.jobId, format: "both" }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Mapping failed");
      setMappingResult(data.result);
      setMapping("done");
    } catch (e: any) {
      setMappingError(e.message);
      setMapping("error");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: font, color: C.text }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .l-fade { animation: fadeUp 0.25s cubic-bezier(0.4,0,0.2,1) both; }
        .l-btn-primary { transition: all 0.15s cubic-bezier(0.4,0,0.2,1); }
        .l-btn-primary:hover { background: ${C.blueHover} !important; box-shadow: ${shadow.hover} !important; transform: translateY(-1px); }
        .l-btn-primary:active { transform: translateY(0) scale(0.98); }
        .l-btn-success { transition: all 0.15s cubic-bezier(0.4,0,0.2,1); }
        .l-btn-success:hover { background: #2D9748 !important; box-shadow: ${shadow.hover} !important; transform: translateY(-1px); }
        .l-btn-success:active { transform: translateY(0) scale(0.98); }
        .l-btn-ghost { transition: all 0.15s cubic-bezier(0.4,0,0.2,1); }
        .l-btn-ghost:hover { background: ${C.surfaceSoft} !important; }
        .l-dropzone { transition: all 0.2s cubic-bezier(0.4,0,0.2,1); }
        .l-dropzone:hover { border-color: ${C.blue} !important; background: ${C.blueSoft} !important; }
        .l-row { transition: background 0.1s; }
        .l-row:hover { background: ${C.surfaceSoft} !important; }
        .l-phase-chip { transition: all 0.15s cubic-bezier(0.4,0,0.2,1); }
        .l-phase-chip:hover { box-shadow: ${shadow.card} !important; transform: translateY(-1px); }
        .l-link { transition: all 0.15s cubic-bezier(0.4,0,0.2,1); }
        .l-link:hover { opacity: 0.88; transform: translateY(-1px); }
      `}</style>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 24px" }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 48 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            background: `linear-gradient(135deg, ${C.blue} 0%, #6366f1 100%)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: shadow.blue,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.3px", lineHeight: 1.2 }}>LUMINA POS</div>
            <div style={{ fontSize: 11, color: C.textTert, letterSpacing: "0.09em", marginTop: 2, fontWeight: 500 }}>
              BAK EXTRACTION SERVICE
            </div>
          </div>
        </div>

        {/* ── Idle: Drop zone ─────────────────────────────────────────────── */}
        {status === "idle" && (
          <div className="l-fade">
            <div
              className="l-dropzone"
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${C.border}`,
                borderRadius: 20, padding: "56px 32px",
                textAlign: "center", cursor: "pointer",
                background: C.surface, boxShadow: shadow.card,
              }}
            >
              <div style={{
                width: 56, height: 56, borderRadius: 16,
                background: C.blueSoft,
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 20px",
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 6 }}>
                Drop your .bak file here
              </div>
              <div style={{ fontSize: 13, color: C.textSec }}>
                or <span style={{ color: C.blue, fontWeight: 600 }}>click to browse</span>
              </div>
              <div style={{ fontSize: 12, color: C.textTert, marginTop: 6 }}>
                SQL Server backup files · up to 500 MB
              </div>
              <input
                ref={fileRef} type="file" accept=".bak,.Bak"
                onChange={e => setFile(e.target.files?.[0] || null)}
                style={{ display: "none" }}
              />
            </div>

            {/* File selected strip */}
            {file && (
              <div className="l-fade" style={{
                marginTop: 12, background: C.surface,
                border: `1px solid ${C.borderLight}`, borderRadius: 16,
                padding: "14px 20px",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                boxShadow: shadow.card,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: C.blueSoft, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{file.name}</div>
                    <div style={{ fontSize: 11, color: C.textTert, marginTop: 1 }}>
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </div>
                  </div>
                </div>
                <button
                  className="l-btn-primary"
                  onClick={handleSubmit}
                  style={{
                    padding: "10px 22px", borderRadius: 12, border: "none",
                    background: C.blue, color: "#fff",
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 7,
                    fontFamily: font, boxShadow: shadow.blue,
                  }}
                >
                  Extract Tables
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Processing ─────────────────────────────────────────────────── */}
        {status === "uploading" && (
          <div className="l-fade" style={{
            background: C.surface, borderRadius: 20,
            padding: "60px 32px", textAlign: "center",
            boxShadow: shadow.card,
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: "50%",
              border: `3px solid ${C.blueSoft}`, borderTopColor: C.blue,
              animation: "spin 0.85s linear infinite",
              margin: "0 auto 24px",
            }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 8 }}>
              Processing Backup
            </div>
            <div style={{ fontSize: 13, color: C.textSec, maxWidth: 340, margin: "0 auto", lineHeight: 1.65 }}>
              {progress}
            </div>
          </div>
        )}

        {/* ── Error ──────────────────────────────────────────────────────── */}
        {status === "error" && (
          <div className="l-fade" style={{
            background: C.surface, borderRadius: 20, padding: 24,
            boxShadow: shadow.card, border: `1px solid rgba(234,67,53,0.18)`,
          }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: C.dangerSoft,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.danger} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.danger, marginBottom: 4 }}>Extraction Failed</div>
                <div style={{ fontSize: 13, color: C.textSec, lineHeight: 1.55 }}>{error}</div>
              </div>
            </div>
            <button
              className="l-btn-ghost"
              onClick={() => { setStatus("idle"); setFile(null); setError(""); }}
              style={{
                marginTop: 16, padding: "9px 18px",
                borderRadius: 10, border: `1px solid ${C.borderLight}`,
                background: C.surface, color: C.textSec,
                fontSize: 13, fontWeight: 500, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6,
                fontFamily: font,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
              </svg>
              Try Again
            </button>
          </div>
        )}

        {/* ── Results ────────────────────────────────────────────────────── */}
        {status === "done" && result && (
          <div className="l-fade" style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Summary card */}
            <div style={{ background: C.surface, borderRadius: 20, padding: 24, boxShadow: shadow.card }}>
              <div style={{
                display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                gap: 12, flexWrap: "wrap" as const, marginBottom: 20,
              }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 8,
                      background: C.successSoft,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.success} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Extraction Complete</span>
                  </div>
                  <div style={{ fontSize: 12, color: C.textTert, marginTop: 4, paddingLeft: 36 }}>
                    {result.database}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                  {mapping !== "loading" && (
                    <button
                      className="l-btn-success"
                      onClick={handleMap}
                      style={{
                        padding: "10px 18px", borderRadius: 12, border: "none",
                        background: C.success, color: "#fff",
                        fontSize: 13, fontWeight: 600, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 6,
                        fontFamily: font, boxShadow: shadow.green,
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1 4 1 10 7 10"/>
                        <path d="M3.51 15a9 9 0 1 0 .49-4.9"/>
                      </svg>
                      Map to LUMINA
                    </button>
                  )}
                  <a
                    className="l-link"
                    href={`/api/download?jobId=${result.jobId}`}
                    style={{
                      padding: "10px 18px", borderRadius: 12,
                      background: C.blue, color: "#fff",
                      fontSize: 13, fontWeight: 600, textDecoration: "none",
                      display: "flex", alignItems: "center", gap: 6,
                      boxShadow: shadow.blue,
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download ZIP
                  </a>
                </div>
              </div>

              {/* Stat chips */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                {[
                  { label: "EXPORTED", value: result.exported },
                  { label: "TOTAL ROWS", value: result.totalRows.toLocaleString() },
                  { label: "ALL TABLES", value: result.totalTables },
                ].map(s => (
                  <div key={s.label} style={{
                    background: C.surfaceSoft, borderRadius: 14,
                    padding: "14px 16px", textAlign: "center" as const,
                  }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: C.blue, lineHeight: 1.2 }}>{s.value}</div>
                    <div style={{ fontSize: 10, color: C.textTert, marginTop: 3, fontWeight: 600, letterSpacing: "0.07em" }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Mapping — loading */}
            {mapping === "loading" && (
              <div className="l-fade" style={{
                background: C.surface, borderRadius: 20,
                padding: "28px 24px", textAlign: "center" as const,
                boxShadow: shadow.card,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  border: `3px solid ${C.successSoft}`, borderTopColor: C.success,
                  animation: "spin 0.85s linear infinite",
                  margin: "0 auto 16px",
                }} />
                <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                  Mapping to LUMINA POS Schema
                </div>
                <div style={{ fontSize: 12, color: C.textTert }}>Running 5-phase migration pipeline…</div>
              </div>
            )}

            {/* Mapping — error */}
            {mapping === "error" && (
              <div className="l-fade" style={{
                background: C.surface, borderRadius: 20, padding: "18px 20px",
                boxShadow: shadow.card, border: `1px solid rgba(234,67,53,0.18)`,
              }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    background: C.dangerSoft,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.danger} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="8" x2="12" y2="12"/>
                      <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.danger }}>Mapping Failed</div>
                    <div style={{ fontSize: 12, color: C.textSec, marginTop: 2 }}>{mappingError}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Mapping — done */}
            {mapping === "done" && mappingResult && (
              <div className="l-fade" style={{
                background: C.surface, borderRadius: 20, padding: 24,
                boxShadow: shadow.card,
              }}>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 12, flexWrap: "wrap" as const, marginBottom: 14,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 8,
                      background: C.successSoft,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.success} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Mapping Complete</span>
                  </div>
                  <a
                    className="l-link"
                    href={`/api/download-mapped?jobId=${result.jobId}`}
                    style={{
                      padding: "9px 16px", borderRadius: 10,
                      background: C.success, color: "#fff",
                      fontSize: 12, fontWeight: 600, textDecoration: "none",
                      display: "flex", alignItems: "center", gap: 5,
                      boxShadow: shadow.green,
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download Mapped
                  </a>
                </div>

                <div style={{ fontSize: 12, color: C.textSec, marginBottom: 18, display: "flex", gap: 16 }}>
                  <span>
                    Format: <span style={{ color: C.blue, fontWeight: 600 }}>{mappingResult.detectedFormat}</span>
                  </span>
                  <span>
                    Rows: <span style={{ color: C.blue, fontWeight: 600 }}>{mappingResult.totalOutputRows.toLocaleString()}</span>
                  </span>
                </div>

                {mappingResult.phases.map((phase, idx) => (
                  <div key={idx} style={{ marginBottom: idx < mappingResult.phases.length - 1 ? 18 : 0 }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, color: C.textTert,
                      letterSpacing: "0.08em", marginBottom: 8,
                      textTransform: "uppercase" as const,
                    }}>
                      {phase.name}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
                      {phase.tables.map(t => (
                        <div key={t.target} className="l-phase-chip" style={{
                          background: C.surfaceSoft, borderRadius: 12,
                          padding: "10px 14px",
                        }}>
                          <div style={{ fontSize: 11, color: C.textSec, fontWeight: 500, marginBottom: 2 }}>{t.target}</div>
                          <div style={{ fontSize: 16, color: C.blue, fontWeight: 700, lineHeight: 1.2 }}>
                            {t.outputRows.toLocaleString()}
                          </div>
                          {t.warnings?.map((w, i) => (
                            <div key={i} style={{ fontSize: 10, color: C.warning, marginTop: 4, lineHeight: 1.4 }}>
                              {w.message || String(w)}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {mappingResult.warnings?.length ? (
                  <div style={{
                    marginTop: 16, background: C.warningSoft,
                    border: `1px solid rgba(251,140,0,0.2)`,
                    borderRadius: 12, padding: "12px 16px",
                  }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, color: C.warning,
                      letterSpacing: "0.07em", marginBottom: 6,
                    }}>
                      GLOBAL WARNINGS
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 14, fontSize: 12, color: C.warning, lineHeight: 1.7 }}>
                      {mappingResult.warnings.map((w, i) => (
                        <li key={i}>{w.message || String(w)}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}

            {/* Table list */}
            <div style={{ background: C.surface, borderRadius: 20, boxShadow: shadow.card, overflow: "hidden" }}>
              <div style={{
                padding: "16px 20px 14px",
                borderBottom: `1px solid ${C.borderLight}`,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Extracted Tables</span>
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  background: C.blueSoft, color: C.blue,
                  padding: "2px 9px", borderRadius: 999,
                }}>
                  {result.tables.length}
                </span>
              </div>
              <div style={{ maxHeight: 360, overflowY: "auto" }}>
                {result.tables.map((t, i) => (
                  <div
                    key={i}
                    className="l-row"
                    style={{
                      display: "flex", alignItems: "center",
                      padding: "10px 20px",
                      borderBottom: i < result.tables.length - 1 ? `1px solid ${C.borderLight}` : "none",
                    }}
                  >
                    <div style={{
                      width: 7, height: 7, borderRadius: "50%", flexShrink: 0, marginRight: 12,
                      background: t.status === "ok" ? C.success : t.status === "empty" ? C.border : C.danger,
                    }} />
                    <span style={{
                      flex: 1, fontSize: 13,
                      color: t.status === "empty" ? C.textTert : C.text,
                    }}>
                      {t.name}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 500,
                      background: t.status === "ok" ? C.surfaceSoft : "transparent",
                      color: t.status === "ok" ? C.textSec : C.textTert,
                      padding: t.status === "ok" ? "2px 9px" : "0",
                      borderRadius: 999,
                    }}>
                      {t.rows > 0 ? `${t.rows.toLocaleString()} rows` : t.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* New extraction */}
            <button
              className="l-btn-ghost"
              onClick={() => {
                setStatus("idle"); setFile(null); setResult(null);
                setMapping("idle"); setMappingResult(null);
              }}
              style={{
                padding: "10px 16px", borderRadius: 12,
                border: `1px solid ${C.borderLight}`,
                background: C.surface, color: C.textSec,
                fontSize: 13, fontWeight: 500, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6,
                alignSelf: "flex-start", fontFamily: font,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
              </svg>
              New Extraction
            </button>

          </div>
        )}

      </div>
    </div>
  );
}
