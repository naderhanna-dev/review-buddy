import { apiUrl } from "../api";
import { useState, useCallback, useEffect, useRef } from "react";
import { useStore } from "../store";
import { useHighlightedLines } from "../hooks/useHighlightedLines";
import { categoryColors } from "./GroupHeader";
import { HighlightedTextarea } from "./HighlightedTextarea";
import type { ReviewComment, DiffFile } from "@reviewradar/shared";

// CSS hover styles injected once — avoids stale JS hover state from missed mouseLeave events
const DIFF_STYLES = `
.diff-line-context:hover { background: var(--diff-ctx-hover) !important; }
.diff-line-addition:hover { background: var(--diff-add-hover) !important; }
.diff-line-deletion:hover { background: var(--diff-del-hover) !important; }
.diff-line-context:hover .diff-comment-btn,
.diff-line-addition:hover .diff-comment-btn,
.diff-line-deletion:hover .diff-comment-btn { opacity: 0.7 !important; }
.split-left .diff-line-deletion:hover { background: var(--diff-del-hover) !important; }
.split-right .diff-line-addition:hover { background: var(--diff-add-hover) !important; }
.split-left .diff-line-context:hover,
.split-right .diff-line-context:hover { background: var(--diff-ctx-hover) !important; }
.split-left .diff-line-deletion:hover .diff-comment-btn,
.split-left .diff-line-context:hover .diff-comment-btn,
.split-right .diff-line-addition:hover .diff-comment-btn,
.split-right .diff-line-context:hover .diff-comment-btn { opacity: 0.7 !important; }
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
  addition: { background: "var(--diff-add-bg)", borderLeft: "3px solid var(--green)" },
  deletion: { background: "var(--diff-del-bg)", borderLeft: "3px solid var(--red)" },
  context:  { background: "transparent", borderLeft: "3px solid transparent" },
  header:   { background: "var(--diff-hdr-bg)", borderLeft: "3px solid var(--blue)" },
};

// --- Collapsed range detection ---

interface CollapsedRange {
  headerIndex: number;
  startLine: number;
  endLine: number;
  startOld: number;
  endOld: number;
}

function computeCollapsedRanges(lines: HunkLine[], totalLines?: number) {
  const rangeByHeader = new Map<number, CollapsedRange>();
  let prevEndNew = 0;
  let prevEndOld = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.type === "header") {
      const match = line.content.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        const hunkOldStart = parseInt(match[1]);
        const hunkNewStart = parseInt(match[2]);

        const gapStart = prevEndNew + 1;
        const gapEnd = hunkNewStart - 1;
        const gapStartOld = prevEndOld + 1;
        const gapEndOld = hunkOldStart - 1;

        if (gapEnd >= gapStart) {
          rangeByHeader.set(i, {
            headerIndex: i,
            startLine: gapStart,
            endLine: gapEnd,
            startOld: gapStartOld,
            endOld: gapEndOld,
          });
        }
      }
    } else {
      if (line.newNum !== undefined) prevEndNew = line.newNum;
      if (line.oldNum !== undefined) prevEndOld = line.oldNum;
    }
  }

  // Trailing range (lines after last hunk)
  let trailingRange: CollapsedRange | undefined;
  if (totalLines && prevEndNew > 0 && prevEndNew < totalLines) {
    trailingRange = {
      headerIndex: lines.length,
      startLine: prevEndNew + 1,
      endLine: totalLines,
      startOld: prevEndOld + 1,
      endOld: prevEndOld + (totalLines - prevEndNew),
    };
  }

  return { rangeByHeader, trailingRange };
}

// --- Side-by-side line pairing ---

interface SplitRow {
  left: HunkLine | null;
  right: HunkLine | null;
  type: "context" | "change" | "header";
}

/**
 * Pair unified diff lines into side-by-side rows.
 * Context lines appear on both sides. Consecutive deletion+addition
 * blocks are zipped together; the shorter side gets null filler rows.
 */
function pairLines(lines: HunkLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.type === "header") {
      rows.push({ left: line, right: line, type: "header" });
      i++;
      continue;
    }

    if (line.type === "context") {
      rows.push({ left: line, right: line, type: "context" });
      i++;
      continue;
    }

    // Collect consecutive deletions then additions
    const deletions: HunkLine[] = [];
    const additions: HunkLine[] = [];

    while (i < lines.length && lines[i].type === "deletion") {
      deletions.push(lines[i]);
      i++;
    }
    while (i < lines.length && lines[i].type === "addition") {
      additions.push(lines[i]);
      i++;
    }

    const maxLen = Math.max(deletions.length, additions.length);
    for (let j = 0; j < maxLen; j++) {
      rows.push({
        left: j < deletions.length ? deletions[j] : null,
        right: j < additions.length ? additions[j] : null,
        type: "change",
      });
    }
  }

  return rows;
}


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

// --- Expand components ---

function ExpandableHeader({ line, count, isExpanded, onToggle }: {
  line: HunkLine;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex",
        padding: "0 8px",
        minHeight: 24,
        cursor: "pointer",
        background: "var(--diff-expand-bg)",
        borderLeft: "3px solid var(--blue)",
        color: "var(--blue)",
        fontSize: 12,
        alignItems: "center",
        userSelect: "none",
        transition: "background 0.1s",
      }}
    >
      <span style={{ ...gutterStyle, opacity: 1 }}>{isExpanded ? "\u25be" : "\u25b8"}</span>
      <span style={gutterStyle} />
      <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
        <span>
          {isExpanded ? "Hide" : "Show"} {count} unchanged line{count !== 1 ? "s" : ""}
        </span>
        {line.content && (
          <span style={{ opacity: 0.4 }}>{line.content}</span>
        )}
      </span>
    </div>
  );
}

function ExpandedLines({ range, highlightedLines }: {
  range: CollapsedRange;
  highlightedLines: string[] | null;
}) {
  const result = [];
  for (let n = range.startLine; n <= range.endLine; n++) {
    const oldN = range.startOld + (n - range.startLine);
    const html = highlightedLines?.[n - 1] ?? "";
    result.push(
      <div
        key={n}
        className="diff-line-context"
        style={{
          display: "flex",
          padding: "0 8px",
          minHeight: 20,
          background: "var(--diff-expand-bg)",
          borderLeft: "3px solid transparent",
          transition: "background 0.1s",
          color: "var(--text)",
        }}
      >
        <span style={gutterStyle}>{oldN}</span>
        <span style={gutterStyle}>{n}</span>
        <span style={contentStyle} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }
  return <>{result}</>;
}

// --- Split-view components ---

const splitGutterStyle: React.CSSProperties = {
  minWidth: 40,
  textAlign: "right",
  paddingRight: 6,
  color: "var(--text-secondary)",
  opacity: 0.6,
  userSelect: "none",
  fontSize: 12,
};

const splitContentStyle: React.CSSProperties = {
  flex: 1,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  overflowWrap: "break-word",
  paddingRight: 8,
};

const SPLIT_LINE_BG: Record<string, React.CSSProperties> = {
  addition: { background: "var(--diff-add-bg)" },
  deletion: { background: "var(--diff-del-bg)" },
  context: { background: "transparent" },
  filler: { background: "var(--diff-filler-bg)" },
};

function SplitDiffLine({ line, lineNum, highlightHtml, isInRange, onMouseDown, side }: {
  line: HunkLine | null;
  lineNum?: number;
  highlightHtml: string;
  isInRange: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  side: "left" | "right";
}) {
  if (!line) {
    // Filler row — the other side has content, this side is empty
    return (
      <div style={{
        display: "flex",
        padding: "0 6px",
        minHeight: 20,
        ...SPLIT_LINE_BG.filler,
      }}>
        <span style={splitGutterStyle} />
        <span style={splitContentStyle} />
      </div>
    );
  }

  const isClickable = line.type !== "header" && lineNum !== undefined;
  const hoverClass = line.type !== "header" ? `diff-line-${line.type}` : "";
  const rangeBg = isInRange ? { background: "rgba(88, 166, 255, 0.15)" } : {};
  const bgKey = line.type === "addition" || line.type === "deletion" ? line.type : "context";

  return (
    <div
      className={hoverClass}
      onMouseDown={(e) => { if (isClickable) onMouseDown(e); }}
      style={{
        display: "flex",
        padding: "0 6px",
        minHeight: 20,
        cursor: isClickable ? "pointer" : "default",
        transition: "background 0.1s",
        color: line.type === "header" ? "var(--blue)" : "var(--text)",
        fontWeight: line.type === "header" ? 600 : "normal",
        ...SPLIT_LINE_BG[bgKey],
        ...rangeBg,
      }}
    >
      <span style={splitGutterStyle}>{lineNum ?? ""}</span>
      <span
        style={splitContentStyle}
        dangerouslySetInnerHTML={{ __html: highlightHtml }}
      />
      {isClickable && (
        <span className="diff-comment-btn" style={{
          opacity: 0,
          fontSize: 14,
          userSelect: "none",
          paddingLeft: 2,
          transition: "opacity 0.15s",
          color: "var(--accent)",
        }} title="Add review comment">+</span>
      )}
    </div>
  );
}

function SplitFileDiff({ file, fileIndex, stickyTop = 0, showViewToggle = true }: {
  file: DiffFile;
  fileIndex: number;
  stickyTop?: number;
  showViewToggle?: boolean;
}) {
  const reviewComments = useStore((s) => s.reviewComments);
  const addReviewComment = useStore((s) => s.addReviewComment);
  const removeReviewComment = useStore((s) => s.removeReviewComment);
  const diffViewMode = useStore((s) => s.diffViewMode);
  const setDiffViewMode = useStore((s) => s.setDiffViewMode);

  const theme = useStore((s) => s.config.theme);
  const resolvedTheme: "light" | "dark" = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : theme as "light" | "dark";

  // Highlight new file (right pane) and old file (left pane)
  const highlightedNew = useHighlightedLines(file.path, resolvedTheme, "head");
  const oldPath = file.oldPath ?? file.path;
  const highlightedOld = useHighlightedLines(
    file.status === "added" ? undefined : oldPath,
    resolvedTheme,
    "base",
  );

  const lines = parseHunk(file.patch);
  const splitRows = pairLines(lines);

  // Drag-select state (simplified for split view — selects on one side at a time)
  const [formRange, setFormRange] = useState<{ startRow: number; endRow: number; side: "LEFT" | "RIGHT" } | null>(null);
  const [dragRange, setDragRange] = useState<{ startRow: number; endRow: number; side: "LEFT" | "RIGHT" } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ row: number; side: "LEFT" | "RIGHT" } | null>(null);

  const handleLineMouseDown = useCallback((rowIdx: number, side: "LEFT" | "RIGHT", e: React.MouseEvent) => {
    e.preventDefault();

    if (e.shiftKey && formRange && formRange.side === side) {
      setFormRange({
        startRow: Math.min(formRange.startRow, rowIdx),
        endRow: Math.max(formRange.endRow, rowIdx),
        side,
      });
      setDragRange(null);
      return;
    }

    setIsDragging(true);
    dragStart.current = { row: rowIdx, side };
    setDragRange({ startRow: rowIdx, endRow: rowIdx, side });
  }, [formRange]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !dragStart.current) return;
    const container = e.currentTarget;
    const sideClass = dragStart.current.side === "LEFT" ? "split-left" : "split-right";
    const sideEl = container.querySelector(`.${sideClass}`);
    if (!sideEl) return;

    const rowEls = sideEl.querySelectorAll("[data-row-idx]");
    const y = e.clientY;
    let closest = dragStart.current.row;
    for (const el of rowEls) {
      const rect = el.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) {
        closest = parseInt(el.getAttribute("data-row-idx")!, 10);
        break;
      }
    }
    setDragRange({
      startRow: Math.min(dragStart.current.row, closest),
      endRow: Math.max(dragStart.current.row, closest),
      side: dragStart.current.side,
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    if (!isDragging || !dragStart.current) return;
    setIsDragging(false);
    if (dragRange) {
      setFormRange(dragRange);
    }
    setDragRange(null);
    dragStart.current = null;
  }, [isDragging, dragRange]);

  const activeRange = isDragging ? dragRange : formRange;

  // Comment anchoring — key comments by side+lineNum
  const commentsByKey = new Map<string, ReviewComment[]>();
  for (const c of Array.from(reviewComments.values()).filter((c) => c.filePath === file.path)) {
    const displayNum = c.endLine || c.line;
    const prefix = c.side === "LEFT" ? "L" : "R";
    const key = `${prefix}${displayNum}`;
    const existing = commentsByKey.get(key) || [];
    existing.push(c);
    commentsByKey.set(key, existing);
  }

  const handleAddComment = useCallback((body: string, type: ReviewComment["type"], suggestedCode?: string) => {
    if (!formRange) return;

    // Collect line numbers from the selected rows on the active side
    const nums: number[] = [];
    for (let r = formRange.startRow; r <= formRange.endRow; r++) {
      const row = splitRows[r];
      if (!row) continue;
      const line = formRange.side === "LEFT" ? row.left : row.right;
      if (!line) continue;
      const num = formRange.side === "LEFT" ? line.oldNum : line.newNum;
      if (num !== undefined) nums.push(num);
    }

    if (nums.length === 0) return;

    const first = nums[0];
    const last = nums[nums.length - 1];
    const comment: ReviewComment = {
      id: crypto.randomUUID(),
      filePath: file.path,
      line: first,
      endLine: last !== first ? last : undefined,
      side: formRange.side,
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
  }, [file.path, formRange, splitRows, addReviewComment]);

  const handleDeleteComment = useCallback((id: string) => {
    fetch(apiUrl(`/comments/${id}`), { method: "DELETE" }).catch(console.error);
    removeReviewComment(id);
  }, [removeReviewComment]);

  // Get content for suggestion pre-fill
  const rangeLineContent = formRange
    ? (() => {
        const contentLines: string[] = [];
        for (let r = formRange.startRow; r <= formRange.endRow; r++) {
          const row = splitRows[r];
          if (!row) continue;
          const line = formRange.side === "RIGHT" ? row.right : row.left;
          if (line && line.type !== "deletion") contentLines.push(line.content);
        }
        return contentLines.join("\n");
      })()
    : undefined;

  // Line nums for the form
  const formLineNums = formRange
    ? (() => {
        const nums: number[] = [];
        for (let r = formRange.startRow; r <= formRange.endRow; r++) {
          const row = splitRows[r];
          if (!row) continue;
          const line = formRange.side === "LEFT" ? row.left : row.right;
          if (!line) continue;
          const num = formRange.side === "LEFT" ? line.oldNum : line.newNum;
          if (num !== undefined) nums.push(num);
        }
        return nums.length > 0 ? { start: nums[0], end: nums[nums.length - 1] } : null;
      })()
    : null;

  function lineHtml(
    line: HunkLine | null,
    side: "left" | "right",
  ): string {
    if (!line) return "";
    const highlighted = side === "left" ? highlightedOld : highlightedNew;
    if (!highlighted) return escapeHtml(line.content);
    const lineNum = side === "left" ? line.oldNum : line.newNum;
    if (lineNum === undefined) return escapeHtml(line.content);
    const html = highlighted[lineNum - 1];
    return html ?? escapeHtml(line.content);
  }

  return (
    <div
      style={{
        fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: "20px",
        userSelect: isDragging ? "none" : "auto",
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        if (isDragging) {
          setIsDragging(false);
          setDragRange(null);
          dragStart.current = null;
        }
      }}
    >
      {/* Sticky file header */}
      <div style={{
        padding: "8px 16px", background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 600,
        position: "sticky", top: stickyTop, zIndex: 1,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1 }}>{file.path}</span>
          {showViewToggle && <ViewModeToggle mode={diffViewMode} onChange={setDiffViewMode} />}
        </div>
        {file.oldPath && file.oldPath !== file.path && (
          <div style={{ color: "var(--text-secondary)", fontWeight: 400, fontSize: 12, marginTop: 2 }}>
            renamed from {file.oldPath}
          </div>
        )}
      </div>

      {/* Two-column diff */}
      <div style={{ display: "flex" }}>
        {/* Left pane (old/deletions) */}
        <div className="split-left" style={{ flex: 1, borderRight: "1px solid var(--diff-split-border)", overflow: "hidden" }}>
          {splitRows.map((row, rowIdx) => {
            const line = row.left;
            const lineNum = line ? line.oldNum : undefined;
            const isInRange = activeRange !== null
              && activeRange.side === "LEFT"
              && rowIdx >= activeRange.startRow
              && rowIdx <= activeRange.endRow
              && line !== null;

            // Check for comments on the left side at this row
            const leftKey = line?.oldNum !== undefined ? `L${line.oldNum}` : undefined;
            const leftComments = leftKey ? commentsByKey.get(leftKey) : undefined;

            return (
              <div key={rowIdx} data-row-idx={rowIdx}>
                {row.type === "header" && line ? (
                  <div style={{
                    display: "flex", padding: "0 6px", minHeight: 24,
                    background: "var(--diff-hdr-bg)", color: "var(--blue)",
                    fontSize: 12, alignItems: "center",
                  }}>
                    <span style={splitGutterStyle} />
                    <span style={{ flex: 1, opacity: 0.6 }}>{line.content}</span>
                  </div>
                ) : (
                  <SplitDiffLine
                    line={line}
                    lineNum={lineNum}
                    highlightHtml={lineHtml(line, "left")}
                    isInRange={isInRange}
                    onMouseDown={(e) => handleLineMouseDown(rowIdx, "LEFT", e)}
                    side="left"
                  />
                )}
                {leftComments?.map((c) => (
                  <InlineComment key={c.id} comment={c} onDelete={() => handleDeleteComment(c.id)} />
                ))}
              </div>
            );
          })}
        </div>

        {/* Right pane (new/additions) */}
        <div className="split-right" style={{ flex: 1, overflow: "hidden" }}>
          {splitRows.map((row, rowIdx) => {
            const line = row.right;
            const lineNum = line ? line.newNum : undefined;
            const isInRange = activeRange !== null
              && activeRange.side === "RIGHT"
              && rowIdx >= activeRange.startRow
              && rowIdx <= activeRange.endRow
              && line !== null;

            // Check for comments on the right side at this row
            const rightKey = line?.newNum !== undefined ? `R${line.newNum}` : undefined;
            const rightComments = rightKey ? commentsByKey.get(rightKey) : undefined;

            // Show comment form after the last row in the selected range
            const showForm = formRange !== null
              && formRange.side === "RIGHT"
              && rowIdx === formRange.endRow;
            const showFormLeft = formRange !== null
              && formRange.side === "LEFT"
              && rowIdx === formRange.endRow;

            return (
              <div key={rowIdx} data-row-idx={rowIdx}>
                {row.type === "header" && line ? (
                  <div style={{
                    display: "flex", padding: "0 6px", minHeight: 24,
                    background: "var(--diff-hdr-bg)", color: "var(--blue)",
                    fontSize: 12, alignItems: "center",
                  }}>
                    <span style={splitGutterStyle} />
                    <span style={{ flex: 1, opacity: 0.6 }}>{line.content}</span>
                  </div>
                ) : (
                  <SplitDiffLine
                    line={line}
                    lineNum={lineNum}
                    highlightHtml={lineHtml(line, "right")}
                    isInRange={isInRange}
                    onMouseDown={(e) => handleLineMouseDown(rowIdx, "RIGHT", e)}
                    side="right"
                  />
                )}
                {rightComments?.map((c) => (
                  <InlineComment key={c.id} comment={c} onDelete={() => handleDeleteComment(c.id)} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Comment form — rendered full-width below the split panes */}
      {formRange && formLineNums && (
        <CommentForm
          filePath={file.path}
          lineNum={formLineNums.start}
          endLineNum={formLineNums.end !== formLineNums.start ? formLineNums.end : undefined}
          lineContent={rangeLineContent}
          onSubmit={handleAddComment}
          onCancel={() => setFormRange(null)}
        />
      )}
    </div>
  );
}


// --- View mode toggle ---

function ViewModeToggle({ mode, onChange }: {
  mode: "unified" | "split";
  onChange: (mode: "unified" | "split") => void;
}) {
  const buttonStyle = (active: boolean): React.CSSProperties => ({
    padding: "2px 6px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    border: "1px solid var(--border)",
    background: active ? "var(--accent-bg)" : "transparent",
    color: active ? "var(--accent)" : "var(--text-secondary)",
    transition: "all 0.15s",
    lineHeight: 1.4,
  });

  return (
    <div style={{ display: "inline-flex", borderRadius: 4, overflow: "hidden" }}>
      <button
        onClick={() => onChange("unified")}
        style={{ ...buttonStyle(mode === "unified"), borderRadius: "4px 0 0 4px", borderRight: "none" }}
        title="Unified view"
      >
        Unified
      </button>
      <button
        onClick={() => onChange("split")}
        style={{ ...buttonStyle(mode === "split"), borderRadius: "0 4px 4px 0" }}
        title="Side-by-side view"
      >
        Split
      </button>
    </div>
  );
}


function GroupViewModeToggle() {
  const mode = useStore((s) => s.diffViewMode);
  const setMode = useStore((s) => s.setDiffViewMode);
  return <ViewModeToggle mode={mode} onChange={setMode} />;
}


// --- SingleFileDiff ---

function SingleFileDiff({ file, fileIndex, stickyTop = 0, showViewToggle = true }: {
  file: DiffFile;
  fileIndex: number;
  stickyTop?: number;
  showViewToggle?: boolean;
}) {
  const reviewComments = useStore((s) => s.reviewComments);
  const addReviewComment = useStore((s) => s.addReviewComment);
  const removeReviewComment = useStore((s) => s.removeReviewComment);
  const diffViewMode = useStore((s) => s.diffViewMode);
  const setDiffViewMode = useStore((s) => s.setDiffViewMode);

  const theme = useStore((s) => s.config.theme);
  const resolvedTheme: "light" | "dark" = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : theme as "light" | "dark";

  const highlightedLines = useHighlightedLines(file.path, resolvedTheme);
  const lines = parseHunk(file.patch);

  // Expand collapsed lines
  const [expandedHeaders, setExpandedHeaders] = useState<Set<number>>(new Set());
  const { rangeByHeader, trailingRange } = computeCollapsedRanges(lines, highlightedLines?.length);

  const toggleExpand = useCallback((key: number) => {
    setExpandedHeaders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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
          <span style={{ flex: 1 }}>{file.path}</span>
          {showViewToggle && <ViewModeToggle mode={diffViewMode} onChange={setDiffViewMode} />}
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
          const range = rangeByHeader.get(i);

          return (
            <div key={i} data-line-idx={i}>
              {/* Expanded lines appear before header */}
              {range && expandedHeaders.has(i) && (
                <ExpandedLines range={range} highlightedLines={highlightedLines} />
              )}

              {line.type === "header" && range ? (
                <ExpandableHeader
                  line={line}
                  count={range.endLine - range.startLine + 1}
                  isExpanded={expandedHeaders.has(i)}
                  onToggle={() => toggleExpand(i)}
                />
              ) : (
                <DiffLine
                  line={line}
                  lineNum={lineNum}
                  lineComments={lineKey(line) ? commentsByKey.get(lineKey(line)!) : undefined}
                  highlightHtml={lineContentHtml(line, highlightedLines)}
                  isInRange={isInRange}
                  onMouseDown={(e) => handleLineMouseDown(i, e)}
                  onDeleteComment={handleDeleteComment}
                />
              )}

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

        {/* Trailing expand for lines after last hunk */}
        {trailingRange && (
          <div>
            {expandedHeaders.has(trailingRange.headerIndex) && (
              <ExpandedLines range={trailingRange} highlightedLines={highlightedLines} />
            )}
            <ExpandableHeader
              line={{ type: "header", content: "" }}
              count={trailingRange.endLine - trailingRange.startLine + 1}
              isExpanded={expandedHeaders.has(trailingRange.headerIndex)}
              onToggle={() => toggleExpand(trailingRange.headerIndex)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// --- Main ---

function FileDiff({ file, fileIndex, stickyTop, showViewToggle = true }: {
  file: DiffFile; fileIndex: number; stickyTop?: number; showViewToggle?: boolean;
}) {
  const diffViewMode = useStore((s) => s.diffViewMode);
  return diffViewMode === "split"
    ? <SplitFileDiff file={file} fileIndex={fileIndex} stickyTop={stickyTop} showViewToggle={showViewToggle} />
    : <SingleFileDiff file={file} fileIndex={fileIndex} stickyTop={stickyTop} showViewToggle={showViewToggle} />;
}

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
            <GroupViewModeToggle />
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
              <FileDiff file={gf} fileIndex={index} stickyTop={groupHeaderHeight} showViewToggle={false} />
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
      <FileDiff file={file} fileIndex={activeFileIndex} />
    </div>
  );
}
