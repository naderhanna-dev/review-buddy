import { apiUrl } from "../api";
import { useState } from "react";
import { useStore } from "../store";
import type { Finding, Severity } from "@reviewradar/shared";

const severityColors: Record<Severity, { color: string; bg: string; label: string }> = {
  critical: { color: "var(--red)", bg: "var(--red-bg)", label: "CRITICAL" },
  warning: { color: "var(--yellow)", bg: "var(--yellow-bg)", label: "WARNING" },
  info: { color: "var(--accent)", bg: "var(--accent-bg)", label: "INFO" },
};

const agentLabels: Record<string, string> = {
  "bug-hunter": "Bug",
  "architecture": "Arch",
  "test-coverage": "Test",
};

export default function FindingCard({ finding }: { finding: Finding }) {
  const setActiveFile = useStore((s) => s.setActiveFile);
  const files = useStore((s) => s.files);
  const dismissFinding = useStore((s) => s.dismissFinding);
  const acceptFinding = useStore((s) => s.acceptFinding);
  const [hovered, setHovered] = useState(false);

  const sev = severityColors[finding.severity];
  const fileIndex = files.findIndex((f) => f.path === finding.filePath);
  const isDismissed = finding.status === "dismissed";
  const isAccepted = finding.status === "accepted";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: 10,
        marginBottom: 8,
        background: isDismissed ? "var(--bg)" : hovered ? "var(--bg-secondary)" : "var(--bg-tertiary)",
        borderRadius: 6,
        fontSize: 13,
        borderLeft: `3px solid ${isDismissed ? "var(--border)" : sev.color}`,
        opacity: isDismissed ? 0.5 : 1,
        transition: "background 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          padding: "1px 5px",
          borderRadius: 2,
          background: sev.bg,
          color: sev.color,
        }}>
          {sev.label}
        </span>
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          padding: "1px 5px",
          borderRadius: 2,
          background: "var(--bg-secondary)",
          color: "var(--text-secondary)",
        }}>
          {agentLabels[finding.agentId] || finding.agentId}
        </span>
        {finding.confidence > 0 && (
          <span style={{
            fontSize: 11,
            color: finding.confidence >= 80 ? "var(--green)" :
                   finding.confidence >= 50 ? "var(--yellow)" :
                   "var(--text-secondary)",
            marginLeft: "auto",
            fontWeight: 500,
          }}>
            {finding.confidence}%
          </span>
        )}
      </div>

      <div style={{ fontWeight: 600, marginBottom: 2 }}>{finding.title}</div>

      <button
        onClick={() => { if (fileIndex >= 0) setActiveFile(fileIndex); }}
        style={{
          border: "none",
          background: "transparent",
          color: "var(--accent)",
          cursor: "pointer",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          padding: 0,
          textDecoration: "underline",
          marginBottom: 4,
          display: "block",
        }}
      >
        {finding.filePath.split("/").pop()}:{finding.lineStart}
        {finding.lineEnd > finding.lineStart ? `-${finding.lineEnd}` : ""}
      </button>

      <div style={{ color: "var(--text)", fontSize: 13, lineHeight: 1.5 }}>
        {finding.description}
      </div>

      {!isDismissed && !isAccepted && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button
            onClick={() => {
              acceptFinding(finding.id);
              fetch(apiUrl(`/findings/${finding.id}/accept`), { method: "POST" }).catch(console.error);
            }}
            style={{
              border: "1px solid var(--green)",
              background: "var(--green-bg)",
              color: "var(--green)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              padding: "4px 10px",
              borderRadius: 4,
            }}
          >
            Accept
          </button>
          <button
            onClick={() => {
              dismissFinding(finding.id);
              fetch(apiUrl(`/findings/${finding.id}/dismiss`), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              }).catch(console.error);
            }}
            style={{
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: 4,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {isDismissed && (
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4, fontStyle: "italic" }}>
          Dismissed
        </div>
      )}
      {isAccepted && (
        <div style={{ fontSize: 11, color: "var(--green)", marginTop: 4, fontStyle: "italic" }}>
          Accepted
        </div>
      )}
    </div>
  );
}
