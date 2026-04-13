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

function ViewedCheckbox({ checked, onClick }: { checked: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      onClick={onClick}
      title={checked ? "Mark as unviewed" : "Mark as viewed"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 14,
        height: 14,
        borderRadius: 3,
        border: checked ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
        background: checked ? "var(--accent)" : "transparent",
        cursor: "pointer",
        flexShrink: 0,
        transition: "all 0.15s",
      }}
    >
      {checked && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 5.5L4 7.5L8 3" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

function FileNode({ file, index, isActive, isGroupSibling }: { file: DiffFile; index: number; isActive: boolean; isGroupSibling?: boolean }) {
  const setActiveFile = useStore((s) => s.setActiveFile);
  const setCardIndex = useStore((s) => s.setCardIndex);
  const viewed = useStore((s) => s.viewedFiles.has(file.path));
  const [hovered, setHovered] = useState(false);

  const bg = isActive ? "var(--blue)"
    : hovered ? "var(--bg-tertiary)"
    : "transparent";
  const textColor = isActive ? "#fff" : "var(--text)";

  return (
    <button
      onClick={() => { setActiveFile(index); setCardIndex(index); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        width: "100%",
        padding: "5px 12px",
        border: "none",
        background: bg,
        color: textColor,
        cursor: "pointer",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        textAlign: "left",
        borderLeft: isActive ? "3px solid var(--text)" : "3px solid transparent",
        transition: "background 0.1s",
        opacity: viewed && !isActive ? 0.55 : 1,
      }}
    >
      {/* Colored dot indicator */}
      <span style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        flexShrink: 0,
        border: "1.5px solid var(--text)",
        background: statusColor(file.status),
      }} />
      <span style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: 1,
        color: isActive ? "#fff" : "var(--text)",
      }}>
        {fileName(file.path)}
      </span>
      <span style={{
        fontSize: 10,
        color: isActive ? "rgba(255,255,255,0.7)" : "var(--text)",
        opacity: isActive ? 0.8 : 0.4,
        whiteSpace: "nowrap",
      }}>
        {file.additions > 0 && `+${file.additions}`}
        {file.additions > 0 && file.deletions > 0 && " "}
        {file.deletions > 0 && `-${file.deletions}`}
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
  const viewedFiles = useStore((s) => s.viewedFiles);
  const viewedCount = files.filter((f) => viewedFiles.has(f.path)).length;

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
          {viewedCount > 0 && (
            <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
              {viewedCount}/{files.length} viewed
            </span>
          )}
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
        display: "flex",
        alignItems: "center",
      }}>
        Files ({files.length})
        {viewedCount > 0 && (
          <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
            {viewedCount}/{files.length} viewed
          </span>
        )}
      </div>
      {files.map((file, i) => (
        <FileNode key={file.path} file={file} index={i} isActive={i === activeFileIndex} />
      ))}
    </div>
  );
}
