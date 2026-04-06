import { apiUrl } from "../api";
import { useState, useCallback, useEffect, useRef } from "react";
import { useStore } from "../store";
import { useHighlightedLines } from "../hooks/useHighlightedLines";
import { categoryColors } from "./GroupHeader";
import { HighlightedTextarea } from "./HighlightedTextarea";
import type { ReviewComment, DiffFile } from "@reviewradar/shared";

// CSS hover styles injected once — avoids stale JS hover state from missed mouseLeave events
const DIFF_STYLES = `
.diff-line-context:hover { background: rgba(255,255,255,0.03) !important; }
.diff-line-addition:hover { background: rgba(63,185,80,0.18) !important; }
.diff-line-deletion:hover { background: rgba(248,81,73,0.18) !important; }
.diff-line-context:hover .diff-comment-btn,
.diff-line-addition:hover .diff-comment-btn,
.diff-line-deletion:hover .diff-comment-btn { opacity: 0.7 !important; }
`;

// --- Parsing ---

interface HunkLine {
  type: "context" | "addition" | "deletion" | "header";
  content: string;
  oldNum?: number;
  newNum?: number;
}

function parseHunk(patch: string): HunkLine[] {
  const lines: HunkLine[] = [];
  let oldNum = 0;
  let newNum = 0;

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) { oldNum = parseInt(match[1]); newNum = parseInt(match[2]); }
      lines.push({ type: "header", content: line });
    } else if (line.startsWith("+")) {
      lines.push({ type: "addition", content: line.slice(1), newNum });
      newNum++;
    } else if (line.startsWith("-")) {
      lines.push({ type: "deletion", content: line.slice(1), oldNum });
      oldNum++;
    } else if (line.startsWith("\\")) {
      // no newline at end of file — skip
    } else if (!line.startsWith("diff") && !line.startsWith("index") && !line.startsWith("---") && !line.startsWith("+++")) {
      lines.push({ type: "context", content: line.slice(1) || line, oldNum, newNum });
      oldNum++;
      newNum++;
    }
  }
  return lines;
}

// --- Rendering helpers ---

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Returns the inner HTML for a diff line's content.
 * If highlighted source is available for this line number, use it.
 * Otherwise, fall back to escaped plain text.
 */
function lineContentHtml(
  line: HunkLine,
  highlightedLines: string[] | null,
): string {
  if (!highlightedLines) return escapeHtml(line.content);

  // For additions and context lines, newNum maps to the highlighted source.
  // Deletions exist only in the old file — we don't have that highlighted.
  const sourceLineNum =
    (line.type === "addition" || line.type === "context") ? line.newNum : undefined;

  if (sourceLineNum === undefined) return escapeHtml(line.content);

  // highlightedLines is 0-indexed, source lines are 1-indexed
  const highlighted = highlightedLines[sourceLineNum - 1];
  return highlighted ?? escapeHtml(line.content);
}

const LINE_BG: Record<HunkLine["type"], React.CSSProperties> = {
  addition: { background: "rgba(63, 185, 80, 0.12)", borderLeft: "3px solid var(--green)" },
  deletion: { background: "rgba(248, 81, 73, 0.12)", borderLeft: "3px solid var(--red)" },
  context:  { background: "transparent", borderLeft: "3px solid transparent" },
  header:   { background: "rgba(88, 166, 255, 0.08)", borderLeft: "3px solid var(--blue)" },
};


// --- Components ---

function DiffLine({ line, lineNum, lineComments, highlightHtml, isInRange, onMouseDown, onDeleteComment }: {
  line: HunkLine;
  lineNum?: number;
  lineComments?: ReviewComment[];
  highlightHtml: string;
  isInRange: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onDeleteComment: (id: string) => void;
}) {
  const isClickable = line.type !== "header" && lineNum;
  const hoverClass = line.type !== "header" ? `diff-line-${line.type}` : "";
  const rangeBg = isInRange ? { background: "rgba(88, 166, 255, 0.15)" } : {};

  return (
    <div>
      <div
        className={hoverClass}
        onMouseDown={(e) => { if (isClickable) onMouseDown(e); }}
        style={{
          display: "flex",
          padding: "0 8px",
          minHeight: 20,
          cursor: isClickable ? "pointer" : "default",
          transition: "background 0.1s",
          color: line.type === "header" ? "var(--blue)" : "var(--text)",
          fontWeight: line.type === "header" ? 600 : "normal",
          ...LINE_BG[line.type],
          ...rangeBg,
        }}
      >
        <span style={gutterStyle}>
          {(line.type === "deletion" || line.type === "context") ? line.oldNum : ""}
        </span>
        <span style={gutterStyle}>
          {(line.type === "addition" || line.type === "context") ? line.newNum : ""}
        </span>
        <span
          style={contentStyle}
          dangerouslySetInnerHTML={{ __html: highlightHtml }}
        />
        {isClickable && (
          <span className="diff-comment-btn" style={{
            opacity: 0,
            fontSize: 14,
            userSelect: "none",
            paddingLeft: 4,
            transition: "opacity 0.15s",
            color: "var(--accent)",
          }}
            title="Add review comment"
          >+</span>
        )}
      </div>

      {lineComments?.map((c) => (
        <InlineComment key={c.id} comment={c} onDelete={() => onDeleteComment(c.id)} />
      ))}
    </div>
  );
}

const gutterStyle: React.CSSProperties = {
  minWidth: 44,
  textAlign: "right",
  paddingRight: 8,
  color: "var(--text-secondary)",
  opacity: 0.6,
  userSelect: "none",
  fontSize: 12,
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  overflowWrap: "break-word",
  paddingRight: 16,
};

function InlineComment({ comment, onDelete }: { comment: ReviewComment; onDelete: () => void }) {
  const typeColor = comment.type === "suggestion" ? "var(--green)" : "var(--accent)";
  return (
    <div style={{
      padding: "6px 12px",
      background: "var(--bg-tertiary)",
      borderLeft: `3px solid ${typeColor}`,
      margin: "2px 0",
      fontSize: 13,
      display: "flex",
      alignItems: "flex-start",
      gap: 8,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        padding: "1px 4px", borderRadius: 2,
        background: typeColor + "22", color: typeColor,
        whiteSpace: "nowrap", marginTop: 2,
      }}>{comment.type}</span>
      <span style={{ flex: 1 }}>
        {comment.body && <span>{comment.body}</span>}
        {comment.type === "suggestion" && comment.suggestedCode && (
          <code style={{
            display: "block",
            marginTop: comment.body ? 4 : 0,
            padding: "2px 6px",
            background: "var(--bg)",
            borderRadius: 3,
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}>{comment.suggestedCode}</code>
        )}
      </span>
      <button onClick={onDelete} title="Delete annotation" style={{
        border: "none", background: "transparent", color: "var(--text-secondary)",
        cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1,
      }}>{"\u00d7"}</button>
    </div>
  );
}

function CommentForm({ filePath, lineNum, endLineNum, lineContent, onSubmit, onCancel }: {
  filePath: string;
  lineNum: number;
  endLineNum?: number;
  lineContent?: string;
  onSubmit: (body: string, type: ReviewComment["type"], suggestedCode?: string) => void;
  onCancel: () => void;
}) {
  const [commentText, setCommentText] = useState("");
  const [suggestionCode, setSuggestionCode] = useState("");
  const [type, setType] = useState<ReviewComment["type"]>("comment");
  const prevType = useRef(type);

  // Pre-populate with source line when switching to suggestion mode
  useEffect(() => {
    if (type === "suggestion" && prevType.current !== "suggestion" && !suggestionCode && lineContent) {
      setSuggestionCode(lineContent);
    }
    prevType.current = type;
  }, [type, lineContent, suggestionCode]);

  const canSubmit = type === "suggestion" ? !!suggestionCode.trim() : !!commentText.trim();

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (type === "suggestion") {
      onSubmit(commentText.trim(), type, suggestionCode);
    } else {
      onSubmit(commentText, type);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const fenceLabelStyle: React.CSSProperties = {
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    color: "var(--green)",
    padding: "2px 0",
    userSelect: "none",
  };

  return (
    <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", borderLeft: "3px solid var(--accent)", margin: "2px 0" }}>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>
        {endLineNum && endLineNum !== lineNum ? `Lines ${lineNum}-${endLineNum}` : `Line ${lineNum}`} — {filePath.split("/").pop()}
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        {(["comment", "suggestion"] as const).map((t) => (
          <button key={t} onClick={() => setType(t)} style={{
            padding: "2px 8px", fontSize: 11, border: "1px solid",
            borderColor: type === t ? "var(--accent)" : "var(--border)",
            background: type === t ? "var(--accent)22" : "transparent",
            color: type === t ? "var(--accent)" : "var(--text-secondary)",
            borderRadius: 4, cursor: "pointer",
          }}>{t}</button>
        ))}
      </div>
      {type === "suggestion" ? (
        <>
          <textarea
            value={commentText} onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a comment (optional)..."
            style={{
              width: "100%", minHeight: 40, padding: 8, background: "var(--bg)", color: "var(--text)",
              border: "1px solid var(--border)", borderRadius: 4, fontFamily: "var(--font-sans)", fontSize: 13, resize: "vertical",
              marginBottom: 6,
            }}
          />
          <div style={fenceLabelStyle}>```suggestion</div>
          <HighlightedTextarea
            value={suggestionCode}
            onChange={(e) => setSuggestionCode(e.target.value)}
            onKeyDown={handleKeyDown}
            filePath={filePath}
            autoFocus
            placeholder="Edit the code to suggest a change..."
            style={{
              background: "var(--bg)", border: "1px solid var(--border)",
              borderRadius: "0", borderLeft: "2px solid var(--green)",
            }}
          />
          <div style={fenceLabelStyle}>```</div>
        </>
      ) : (
        <textarea
          value={commentText} onChange={(e) => setCommentText(e.target.value)} autoFocus
          onKeyDown={handleKeyDown}
          placeholder="Add a comment..."
          style={{
            width: "100%", minHeight: 60, padding: 8, background: "var(--bg)", color: "var(--text)",
            border: "1px solid var(--border)", borderRadius: 4, fontFamily: "var(--font-sans)", fontSize: 13, resize: "vertical",
          }}
        />
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{
          padding: "4px 12px", fontSize: 12, border: "1px solid var(--border)",
          background: "transparent", color: "var(--text-secondary)", borderRadius: 4, cursor: "pointer",
        }}>Cancel</button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            padding: "4px 12px", fontSize: 12, border: "none",
            background: canSubmit ? "var(--accent)" : "var(--bg-tertiary)",
            color: canSubmit ? "#fff" : "var(--text-secondary)", borderRadius: 4,
            cursor: canSubmit ? "pointer" : "default",
          }}
        >Add</button>
      </div>
    </div>
  );
}

// --- Helpers ---

/** Line number for display in gutters — oldNum for deletions, newNum for others. */
function getLineNum(line: HunkLine): number | undefined {
  return line.type === "addition" ? line.newNum
    : line.type === "deletion" ? line.oldNum
    : line.newNum;
}

/**
 * Compute valid GitHub API line numbers for a range of diff lines.
 * Returns { line, endLine, side } where both numbers are on the same side.
 * Prefers RIGHT side (newNum) — falls back to LEFT (oldNum) if range is all deletions.
 */
function getCommentLineNums(lines: HunkLine[], startIdx: number, endIdx: number): {
  line: number; endLine?: number; side: "RIGHT" | "LEFT";
} | null {
  // Collect RIGHT-side (newNum) lines in range
  const rightNums: number[] = [];
  const leftNums: number[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const l = lines[i];
    if (l.newNum !== undefined) rightNums.push(l.newNum);
    if (l.oldNum !== undefined) leftNums.push(l.oldNum);
  }

  if (rightNums.length > 0) {
    const first = rightNums[0];
    const last = rightNums[rightNums.length - 1];
    return { line: first, endLine: last !== first ? last : undefined, side: "RIGHT" };
  }
  // All deletions — use LEFT side
  if (leftNums.length > 0) {
    const first = leftNums[0];
    const last = leftNums[leftNums.length - 1];
    return { line: first, endLine: last !== first ? last : undefined, side: "LEFT" };
  }
  return null;
}

/** Unique key for a line in the diff — prevents old:7 colliding with new:7. */
function lineKey(line: HunkLine): string | undefined {
  const num = getLineNum(line);
  if (num === undefined) return undefined;
  return line.type === "deletion" ? `L${num}` : `R${num}`;
}

function isSelectableLine(line: HunkLine): boolean {
  return line.type !== "header" && getLineNum(line) !== undefined;
}

// --- SingleFileDiff ---

function SingleFileDiff({ file, fileIndex, stickyTop = 0 }: {
  file: DiffFile;
  fileIndex: number;
  stickyTop?: number;
}) {
  const reviewComments = useStore((s) => s.reviewComments);
  const addReviewComment = useStore((s) => s.addReviewComment);
  const removeReviewComment = useStore((s) => s.removeReviewComment);

  const highlightedLines = useHighlightedLines(file.path);
  const lines = parseHunk(file.patch);

  // dragRange: live highlight during drag. formRange: finalized range that shows the comment form.
  const [dragRange, setDragRange] = useState<{ start: number; end: number } | null>(null);
  const [formRange, setFormRange] = useState<{ start: number; end: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<number | null>(null);

  const handleLineMouseDown = useCallback((i: number, e: React.MouseEvent) => {
    if (!isSelectableLine(lines[i])) return;
    e.preventDefault();

    if (e.shiftKey && formRange) {
      // Shift+click extends range immediately
      const newRange = {
        start: Math.min(formRange.start, i),
        end: Math.max(formRange.end, i),
      };
      setFormRange(newRange);
      setDragRange(null);
      return;
    }

    setIsDragging(true);
    dragStart.current = i;
    setDragRange({ start: i, end: i });
  }, [lines, formRange]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || dragStart.current === null) return;
    const container = e.currentTarget;
    const lineElements = container.querySelectorAll("[data-line-idx]");
    const y = e.clientY;
    let closest = dragStart.current;
    for (const el of lineElements) {
      const rect = el.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) {
        closest = parseInt(el.getAttribute("data-line-idx")!, 10);
        break;
      }
    }
    setDragRange({
      start: Math.min(dragStart.current, closest),
      end: Math.max(dragStart.current, closest),
    });
  }, [isDragging]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setIsDragging(false);

    // Find which line the mouseup landed on
    const container = e.currentTarget;
    const lineElements = container.querySelectorAll("[data-line-idx]");
    const y = e.clientY;
    let endIdx = dragStart.current ?? 0;
    for (const el of lineElements) {
      const rect = el.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) {
        endIdx = parseInt(el.getAttribute("data-line-idx")!, 10);
        break;
      }
    }

    const start = Math.min(dragStart.current ?? endIdx, endIdx);
    const end = Math.max(dragStart.current ?? endIdx, endIdx);
    setFormRange({ start, end });
    setDragRange(null);
    dragStart.current = null;
  }, [isDragging]);

  const normalize = (range: { start: number; end: number } | null) => {
    if (!range) return null;
    let { start, end } = range;
    while (start <= end && !isSelectableLine(lines[start])) start++;
    while (end >= start && !isSelectableLine(lines[end])) end--;
    return start <= end ? { start, end } : null;
  };

  // Highlight: drag range during drag, form range otherwise
  const highlightRange = normalize(isDragging ? dragRange : formRange);
  // Form always based on formRange — never hidden by drag
  const normalizedRange = normalize(formRange);

  const handleAddComment = useCallback((body: string, type: ReviewComment["type"], suggestedCode?: string) => {
    if (!normalizedRange) return;
    const lineNums = getCommentLineNums(lines, normalizedRange.start, normalizedRange.end);
    if (!lineNums) return;
    const comment: ReviewComment = {
      id: crypto.randomUUID(),
      filePath: file.path,
      line: lineNums.line,
      endLine: lineNums.endLine,
      side: lineNums.side,
      type,
      body,
      suggestedCode,
      createdAt: Date.now(),
    };
    fetch(apiUrl("/comments"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(comment),
    }).catch(console.error);
    addReviewComment(comment);
    setFormRange(null);
  }, [file.path, normalizedRange, lines, addReviewComment]);

  const handleDeleteComment = useCallback((id: string) => {
    fetch(apiUrl(`/comments/${id}`), { method: "DELETE" }).catch(console.error);
    removeReviewComment(id);
  }, [removeReviewComment]);

  // Display inline comments at the END of their range (endLine, or line if single-line).
  // Key includes side prefix to avoid old/new line number collisions.
  const commentsByKey = new Map<string, ReviewComment[]>();
  for (const c of Array.from(reviewComments.values()).filter((c) => c.filePath === file.path)) {
    const displayNum = c.endLine || c.line;
    const prefix = c.side === "LEFT" ? "L" : "R";
    const key = `${prefix}${displayNum}`;
    const existing = commentsByKey.get(key) || [];
    existing.push(c);
    commentsByKey.set(key, existing);
  }

  const rangeLineNums = normalizedRange ? getCommentLineNums(lines, normalizedRange.start, normalizedRange.end) : null;
  const rangeStartLineNum = rangeLineNums?.line;
  const rangeEndLineNum = rangeLineNums?.endLine;
  const rangeLineContent = normalizedRange
    ? lines.slice(normalizedRange.start, normalizedRange.end + 1)
        .filter((l) => isSelectableLine(l) && l.type !== "deletion")
        .map((l) => l.content)
        .join("\n")
    : undefined;

  return (
    <div
      style={{
        fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: "20px",
        userSelect: isDragging ? "none" : "auto",
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { if (isDragging) { setIsDragging(false); setDragRange(null); dragStart.current = null; } }}
    >
      <div style={{
        padding: "8px 16px", background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 600,
        position: "sticky", top: stickyTop, zIndex: 1,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>{file.path}</span>
        </div>
        {file.oldPath && file.oldPath !== file.path && (
          <div style={{ color: "var(--text-secondary)", fontWeight: 400, fontSize: 12, marginTop: 2 }}>
            renamed from {file.oldPath}
          </div>
        )}
      </div>
      <div>
        {lines.map((line, i) => {
          const lineNum = getLineNum(line);
          const isInRange = highlightRange != null && i >= highlightRange.start && i <= highlightRange.end && isSelectableLine(line);
          const showForm = normalizedRange != null && i === normalizedRange.end;

          return (
            <div key={i} data-line-idx={i}>
              <DiffLine
                line={line}
                lineNum={lineNum}
                lineComments={lineKey(line) ? commentsByKey.get(lineKey(line)!) : undefined}
                highlightHtml={lineContentHtml(line, highlightedLines)}
                isInRange={isInRange}
                onMouseDown={(e) => handleLineMouseDown(i, e)}
                onDeleteComment={handleDeleteComment}
              />
              {showForm && rangeStartLineNum && (
                <CommentForm
                  filePath={file.path}
                  lineNum={rangeStartLineNum}
                  endLineNum={rangeEndLineNum}
                  lineContent={rangeLineContent}
                  onSubmit={handleAddComment}
                  onCancel={() => setFormRange(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Main ---

export default function DiffPane() {
  const files = useStore((s) => s.files);
  const activeFileIndex = useStore((s) => s.activeFileIndex);
  const activeGroupId = useStore((s) => s.activeGroupId);
  const groups = useStore((s) => s.groups);
  const file = files[activeFileIndex];

  const activeGroup = activeGroupId ? groups.find((g) => g.id === activeGroupId) : null;

  // Build file list for group view
  const groupFiles = activeGroup
    ? activeGroup.filePaths
        .map((path) => {
          const idx = files.findIndex((f) => f.path === path);
          return idx >= 0 ? { file: files[idx], index: idx } : null;
        })
        .filter(Boolean) as { file: DiffFile; index: number }[]
    : null;

  // Group header height for sticky file headers
  const groupHeaderRef = useRef<HTMLDivElement | null>(null);
  const [groupHeaderHeight, setGroupHeaderHeight] = useState(0);
  useEffect(() => {
    if (groupHeaderRef.current) {
      const h = groupHeaderRef.current.getBoundingClientRect().height;
      if (h !== groupHeaderHeight) setGroupHeaderHeight(h);
    }
  });

  // Auto-scroll to clicked file in group view
  const fileRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const scrolledFor = useRef<number | null>(null);
  useEffect(() => {
    if (groupFiles && scrolledFor.current !== activeFileIndex) {
      scrolledFor.current = activeFileIndex;
      // Defer to allow render
      requestAnimationFrame(() => {
        const el = fileRefs.current.get(activeFileIndex);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [activeFileIndex, groupFiles]);

  if (!file) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)", fontSize: 14 }}>
        Select a file to view changes
      </div>
    );
  }

  // Group view: show all files in group with header
  if (activeGroup && groupFiles) {
    const color = categoryColors[activeGroup.category] || categoryColors.other;
    return (
      <div>
        <style>{DIFF_STYLES}</style>
        <div ref={groupHeaderRef} style={{
          padding: "12px 16px",
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border)",
          position: "sticky", top: 0, zIndex: 2,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.05em", padding: "1px 5px", borderRadius: 3,
              background: color + "22", color,
            }}>
              {activeGroup.category}
            </span>
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              {activeGroup.label}
            </span>
            <span style={{ color: "var(--text-secondary)", fontSize: 12, marginLeft: "auto" }}>
              {groupFiles.length} file{groupFiles.length !== 1 ? "s" : ""}
            </span>
          </div>
          {activeGroup.summary && (
            <div style={{
              fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5,
            }}>
              {activeGroup.summary}
            </div>
          )}
        </div>
        {groupFiles.map(({ file: gf, index }) => {
          const ref = (el: HTMLDivElement | null) => { fileRefs.current.set(index, el); };
          return (
            <div key={gf.path} ref={ref}>
              <SingleFileDiff file={gf} fileIndex={index} stickyTop={groupHeaderHeight} />
            </div>
          );
        })}
      </div>
    );
  }

  // Single file view
  return (
    <div>
      <style>{DIFF_STYLES}</style>
      <SingleFileDiff file={file} fileIndex={activeFileIndex} />
    </div>
  );
}
