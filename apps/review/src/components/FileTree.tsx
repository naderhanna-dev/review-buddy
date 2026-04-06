import { useState } from "react";
import { useStore } from "../store";
import GroupHeader from "./GroupHeader";
import type { DiffFile, FileGroup } from "@reviewradar/shared";

const statusColor = (status: DiffFile["status"]) => {
  switch (status) {
    case "added": return "var(--green)";
    case "deleted": return "var(--red)";
    case "renamed": return "var(--blue)";
    default: return "var(--yellow)";
  }
};

const statusLabel = (status: DiffFile["status"]) => {
  switch (status) {
    case "added": return "A";
    case "deleted": return "D";
    case "renamed": return "R";
    default: return "M";
  }
};

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

function dirName(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function FileNode({ file, index, isActive, isGroupSibling }: { file: DiffFile; index: number; isActive: boolean; isGroupSibling?: boolean }) {
  const setActiveFile = useStore((s) => s.setActiveFile);
  const [hovered, setHovered] = useState(false);

  const bg = isActive ? "var(--bg-tertiary)"
    : isGroupSibling ? "rgba(88, 166, 255, 0.06)"
    : hovered ? "rgba(255,255,255,0.03)"
    : "transparent";

  return (
    <button
      onClick={() => setActiveFile(index)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "100%",
        padding: "4px 12px 4px 28px",
        border: "none",
        background: bg,
        color: "var(--text)",
        cursor: "pointer",
        fontSize: 13,
        fontFamily: "var(--font-mono)",
        textAlign: "left",
        borderLeft: isActive ? "2px solid var(--accent)" : isGroupSibling ? "2px solid rgba(88, 166, 255, 0.3)" : "2px solid transparent",
        transition: "background 0.1s",
      }}
    >
      <span style={{
        color: statusColor(file.status),
        fontWeight: 600,
        fontSize: 11,
        minWidth: 14,
      }}>
        {statusLabel(file.status)}
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, direction: "rtl", textAlign: "left" }}>
        <span style={{ color: "var(--text-secondary)" }}>
          {dirName(file.path) ? dirName(file.path) + "/" : ""}
        </span>
        {fileName(file.path)}
      </span>
      <span style={{ fontSize: 11, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
        <span style={{ color: "var(--green)" }}>+{file.additions}</span>
        {" "}
        <span style={{ color: "var(--red)" }}>-{file.deletions}</span>
      </span>
    </button>
  );
}

function Spinner() {
  return (
    <span style={{
      display: "inline-block",
      width: 12,
      height: 12,
      border: "2px solid var(--border)",
      borderTopColor: "var(--accent)",
      borderRadius: "50%",
      animation: "spin 0.8s linear infinite",
      verticalAlign: "middle",
      marginLeft: 6,
    }} />
  );
}

export default function FileTree() {
  const files = useStore((s) => s.files);
  const groups = useStore((s) => s.groups);
  const groupsReady = useStore((s) => s.groupsReady);
  const activeFileIndex = useStore((s) => s.activeFileIndex);
  const activeGroupId = useStore((s) => s.activeGroupId);
  const expandedGroups = useStore((s) => s.expandedGroups);
  const toggleGroup = useStore((s) => s.toggleGroup);

  if (files.length === 0) {
    return (
      <div style={{ padding: 16, color: "var(--text-secondary)", fontSize: 13 }}>
        Loading files...
      </div>
    );
  }

  const fileIndexMap = new Map<string, number>();
  files.forEach((f, i) => fileIndexMap.set(f.path, i));

  if (groups.length > 0) {
    const groupedPaths = new Set(groups.flatMap((g) => g.filePaths));
    const ungroupedFiles = files.filter((f) => !groupedPaths.has(f.path));

    return (
      <div style={{ paddingBottom: 8 }}>
        <div style={{
          padding: "6px 12px",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--text-secondary)",
          display: "flex",
          alignItems: "center",
        }}>
          Groups ({groups.length})
        </div>
        {!groupsReady && (
          <div style={{
            margin: "0 8px 6px",
            padding: "6px 10px",
            fontSize: 12,
            color: "var(--accent)",
            background: "var(--accent-bg)",
            border: "1px solid var(--accent)",
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            <Spinner />
            AI is analyzing file relationships — groups will update automatically
          </div>
        )}

        {groups.map((group) => {
          const expanded = expandedGroups.has(group.id);
          const groupFiles = group.filePaths
            .map((path) => {
              const idx = fileIndexMap.get(path);
              return idx !== undefined ? { file: files[idx], index: idx } : null;
            })
            .filter(Boolean) as { file: DiffFile; index: number }[];

          return (
            <div key={group.id}>
              <GroupHeader
                group={group}
                expanded={expanded}
                onToggle={() => toggleGroup(group.id)}
                fileCount={groupFiles.length}
              />
              {expanded && groupFiles.map(({ file, index }) => (
                <FileNode
                  key={file.path}
                  file={file}
                  index={index}
                  isActive={index === activeFileIndex}
                  isGroupSibling={activeGroupId === group.id && index !== activeFileIndex}
                />
              ))}
            </div>
          );
        })}

        {ungroupedFiles.length > 0 && (
          <div>
            <div style={{
              padding: "8px 12px 4px",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-secondary)",
            }}>
              Ungrouped
            </div>
            {ungroupedFiles.map((file) => {
              const index = fileIndexMap.get(file.path)!;
              return (
                <FileNode
                  key={file.path}
                  file={file}
                  index={index}
                  isActive={index === activeFileIndex}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{
        padding: "4px 12px 8px",
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "var(--text-secondary)",
      }}>
        Files ({files.length})
      </div>
      {files.map((file, i) => (
        <FileNode key={file.path} file={file} index={i} isActive={i === activeFileIndex} />
      ))}
    </div>
  );
}
