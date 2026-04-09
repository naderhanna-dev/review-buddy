import { useState, useEffect, useRef } from "react";
import { HighlightedTextarea } from "./HighlightedTextarea";
import type { ReviewComment } from "@reviewradar/shared";

export function CommentForm({ filePath, lineNum, endLineNum, lineContent, onSubmit, onCancel, initialBody, initialType, initialSuggestedCode, submitLabel }: {
  filePath: string;
  lineNum: number;
  endLineNum?: number;
  lineContent?: string;
  onSubmit: (body: string, type: ReviewComment["type"], suggestedCode?: string) => void;
  onCancel: () => void;
  initialBody?: string;
  initialType?: ReviewComment["type"];
  initialSuggestedCode?: string;
  submitLabel?: string;
}) {
  const [commentText, setCommentText] = useState(initialBody ?? "");
  const [suggestionCode, setSuggestionCode] = useState(initialSuggestedCode ?? "");
  const [type, setType] = useState<ReviewComment["type"]>(initialType ?? "comment");
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
        >{submitLabel ?? "Add"}</button>
      </div>
    </div>
  );
}
