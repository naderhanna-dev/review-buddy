import { useState } from "react";
import type { FileGroup } from "@reviewradar/shared";

interface Props {
  group: FileGroup;
  expanded: boolean;
  onToggle: () => void;
  fileCount: number;
}

export const categoryColors: Record<string, string> = {
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
        alignItems: "center",
        gap: 6,
        width: "100%",
        padding: "6px 12px",
        border: "none",
        background: hovered ? "var(--bg-tertiary)" : "transparent",
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
        borderBottom: "1px solid #C8C4BC",
        transition: "background 0.1s",
        fontFamily: "var(--font-sans)",
      }}
    >
      <span style={{
        fontSize: 9,
        transition: "transform 0.15s",
        transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
        color: "var(--text)",
        opacity: 0.4,
      }}>
        {"\u25B6"}
      </span>
      <span style={{
        fontSize: 9,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        padding: "1px 6px",
        borderRadius: 3,
        background: color + "22",
        color,
        flexShrink: 0,
      }}>
        {group.category}
      </span>
      <span style={{
        fontWeight: 600, fontSize: 11,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        flex: 1,
      }}>
        {group.label}
      </span>
      <span style={{
        color: "var(--text)", opacity: 0.35,
        fontSize: 10, flexShrink: 0,
      }}>
        {fileCount}
      </span>
    </button>
  );
}
