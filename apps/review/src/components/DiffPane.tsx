import { apiUrl } from "../api";
import { useState, useCallback } from "react";
import { useStore } from "../store";
import { useHighlightedLines } from "../hooks/useHighlightedLines";
import type { ReviewComment } from "@reviewradar/shared";

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

function DiffLine({ line, lineNum, lineComments, highlightHtml, onClickLine, onDeleteComment }: {
  line: HunkLine;
  lineNum?: number;
  lineComments?: ReviewComment[];
  highlightHtml: string;
  onClickLine: () => void;
  onDeleteComment: (id: string) => void;
}) {
  const isClickable = line.type !== "header" && lineNum;
  const hoverClass = line.type !== "header" ? `diff-line-${line.type}` : "";

  return (
    <div>
      <div
        className={hoverClass}
        onClick={() => { if (isClickable) onClickLine(); }}
        style={{
          display: "flex",
          padding: "0 8px",
          minHeight: 20,
          cursor: isClickable ? "pointer" : "default",
          transition: "background 0.1s",
          color: line.type === "header" ? "var(--blue)" : "var(--text)",
          fontWeight: line.type === "header" ? 600 : "normal",
          ...LINE_BG[line.type],
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
      <span style={{ flex: 1 }}>{comment.body}</span>
      <button onClick={onDelete} title="Delete annotation" style={{
        border: "none", background: "transparent", color: "var(--text-secondary)",
        cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1,
      }}>{"\u00d7"}</button>
    </div>
  );
}

function CommentForm({ filePath, lineNum, onSubmit, onCancel }: {
  filePath: string;
  lineNum: number;
  onSubmit: (text: string, type: ReviewComment["type"]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [type, setType] = useState<ReviewComment["type"]>("comment");

  return (
    <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", borderLeft: "3px solid var(--accent)", margin: "2px 0" }}>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>
        Line {lineNum} — {filePath.split("/").pop()}
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
      <textarea
        value={text} onChange={(e) => setText(e.target.value)} autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) {
            e.preventDefault();
            onSubmit(text, type);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={type === "suggestion" ? "Describe the suggested change..." : "Add a comment..."}
        style={{
          width: "100%", minHeight: 60, padding: 8, background: "var(--bg)", color: "var(--text)",
          border: "1px solid var(--border)", borderRadius: 4, fontFamily: "var(--font-sans)", fontSize: 13, resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{
          padding: "4px 12px", fontSize: 12, border: "1px solid var(--border)",
          background: "transparent", color: "var(--text-secondary)", borderRadius: 4, cursor: "pointer",
        }}>Cancel</button>
        <button
          onClick={() => { if (text.trim()) onSubmit(text, type); }}
          disabled={!text.trim()}
          style={{
            padding: "4px 12px", fontSize: 12, border: "none",
            background: text.trim() ? "var(--accent)" : "var(--bg-tertiary)",
            color: text.trim() ? "#fff" : "var(--text-secondary)", borderRadius: 4,
            cursor: text.trim() ? "pointer" : "default",
          }}
        >Add</button>
      </div>
    </div>
  );
}

// --- Main ---

export default function DiffPane() {
  const files = useStore((s) => s.files);
  const activeFileIndex = useStore((s) => s.activeFileIndex);
  const reviewComments = useStore((s) => s.reviewComments);
  const addReviewComment = useStore((s) => s.addReviewComment);
  const removeReviewComment = useStore((s) => s.removeReviewComment);
  const file = files[activeFileIndex];

  const highlightedLines = useHighlightedLines(file?.path);
  const lines = file ? parseHunk(file.patch) : [];
  const [commentingIndex, setCommentingIndex] = useState<number | null>(null);

  const handleAddComment = useCallback((text: string, type: ReviewComment["type"]) => {
    if (!file) return;
    const commentLine = commentingIndex != null ? lines[commentingIndex] : null;
    const commentLineNum = commentLine
      ? (commentLine.type === "addition" ? commentLine.newNum : commentLine.type === "deletion" ? commentLine.oldNum : commentLine.newNum)
      : null;
    if (!commentLineNum) return;
    const comment: ReviewComment = {
      id: crypto.randomUUID(),
      filePath: file.path,
      line: commentLineNum,
      side: "RIGHT",
      type,
      body: text,
      createdAt: Date.now(),
    };
    fetch(apiUrl("/comments"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(comment),
    }).catch(console.error);
    addReviewComment(comment);
    setCommentingIndex(null);
  }, [file, commentingIndex, lines, addReviewComment]);

  const handleDeleteComment = useCallback((id: string) => {
    fetch(apiUrl(`/comments/${id}`), { method: "DELETE" }).catch(console.error);
    removeReviewComment(id);
  }, [removeReviewComment]);

  if (!file) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)", fontSize: 14 }}>
        Select a file to view changes
      </div>
    );
  }

  const commentsByLine = new Map<number, ReviewComment[]>();
  for (const c of Array.from(reviewComments.values()).filter((c) => c.filePath === file.path)) {
    const existing = commentsByLine.get(c.line) || [];
    existing.push(c);
    commentsByLine.set(c.line, existing);
  }

  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: "20px" }}>
      <style>{DIFF_STYLES}</style>
      <div style={{
        padding: "8px 16px", background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 600,
        position: "sticky", top: 0, zIndex: 1,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span>{file.path}</span>
        {file.oldPath && file.oldPath !== file.path && (
          <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}>
            (renamed from {file.oldPath})
          </span>
        )}
      </div>
      <div>
        {lines.map((line, i) => {
          const lineNum = line.type === "addition" ? line.newNum
            : line.type === "deletion" ? line.oldNum
            : line.newNum;
          const isCommenting = commentingIndex === i;

          return (
            <div key={i}>
              <DiffLine
                line={line}
                lineNum={lineNum}
                lineComments={lineNum ? commentsByLine.get(lineNum) : undefined}
                highlightHtml={lineContentHtml(line, highlightedLines)}
                onClickLine={() => { if (lineNum) setCommentingIndex(isCommenting ? null : i); }}
                onDeleteComment={handleDeleteComment}
              />
              {isCommenting && lineNum && (
                <CommentForm
                  filePath={file.path}
                  lineNum={lineNum}
                  onSubmit={handleAddComment}
                  onCancel={() => setCommentingIndex(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
