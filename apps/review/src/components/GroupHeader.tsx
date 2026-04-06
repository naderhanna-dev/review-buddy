import { useState } from "react";
import type { FileGroup } from "@reviewradar/shared";

interface Props {
  group: FileGroup;
  expanded: boolean;
  onToggle: () => void;
  fileCount: number;
}

const categoryColors: Record<string, string> = {
  types: "#a78bfa",
  core: "#60a5fa",
  api: "#34d399",
  infra: "#fbbf24",
  tests: "#f87171",
  docs: "#94a3b8",
  other: "#6b7280",
};

export default function GroupHeader({ group, expanded, onToggle, fileCount }: Props) {
  const color = categoryColors[group.category] || categoryColors.other;
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        width: "100%",
        padding: "8px 12px",
        border: "none",
        background: hovered ? "var(--bg-tertiary)" : "var(--bg-secondary)",
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
        borderBottom: "1px solid var(--border)",
        transition: "background 0.1s",
      }}
    >
      <span style={{
        fontSize: 11,
        transition: "transform 0.15s",
        transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
        marginTop: 2,
        color: "var(--text-secondary)",
      }}>
        {"\u25B6"}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "1px 5px",
            borderRadius: 3,
            background: color + "22",
            color,
          }}>
            {group.category}
          </span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>
            {group.label}
          </span>
          <span style={{ color: "var(--text-secondary)", fontSize: 12, marginLeft: "auto", flexShrink: 0 }}>
            {fileCount} file{fileCount !== 1 ? "s" : ""}
          </span>
        </div>
        {group.summary && (
          <div
            title={group.summary}
            style={{
              fontSize: 11,
              color: "var(--text-secondary)",
              marginTop: 2,
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {group.summary}
          </div>
        )}
      </div>
    </button>
  );
}
