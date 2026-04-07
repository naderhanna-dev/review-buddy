import { useState } from "react";
import { useStore } from "../store";
import type { ReviewEvent } from "@reviewradar/shared";

const actions: { event: ReviewEvent; label: string; color: string; bg: string; hoverBg: string }[] = [
  { event: "APPROVE", label: "Approve", color: "var(--green)", bg: "var(--green-bg)", hoverBg: "var(--green-bg-hover)" },
  { event: "COMMENT", label: "Comment", color: "var(--accent)", bg: "var(--accent-bg)", hoverBg: "var(--accent-bg-hover)" },
  { event: "REQUEST_CHANGES", label: "Request Changes", color: "var(--yellow)", bg: "var(--yellow-bg)", hoverBg: "var(--yellow-bg-hover)" },
];

const VERDICT_STYLES = `
.verdict-btn {
  transition: background 0.15s;
}
.verdict-btn:hover:not(:disabled) {
  background: var(--hover-bg) !important;
}
`;

export default function VerdictBar() {
  const pr = useStore((s) => s.pr);
  const reviewComments = useStore((s) => s.reviewComments);
  const submitting = useStore((s) => s.submitting);
  const submitted = useStore((s) => s.submitted);
  const submitResult = useStore((s) => s.submitResult);
  const submitError = useStore((s) => s.submitError);
  const submitReview = useStore((s) => s.submitReview);

  const [body, setBody] = useState("");
  const [showBody, setShowBody] = useState(false);

  if (!pr) return null;

  if (submitted && submitResult) {
    return (
      <div style={{
        padding: "10px 20px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-secondary)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 13,
      }}>
        <span style={{ color: "var(--green)", fontWeight: 600 }}>✓ Review submitted</span>
        <span style={{ color: "var(--text-secondary)" }}>
          {submitResult.commentCount} comment{submitResult.commentCount !== 1 ? "s" : ""}
        </span>
        <a
          href={submitResult.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)", textDecoration: "underline", fontSize: 12 }}
        >
          View on GitHub
        </a>
      </div>
    );
  }

  const commentCount = reviewComments.size;

  return (
    <div style={{
      borderTop: "1px solid var(--border)",
      background: "var(--bg-secondary)",
    }}>
      <style>{VERDICT_STYLES}</style>
      {showBody && (
        <div style={{ padding: "8px 20px 0" }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Review summary (optional)..."
            style={{
              width: "100%",
              minHeight: 48,
              padding: 8,
              background: "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              resize: "vertical",
            }}
          />
        </div>
      )}
      <div style={{
        padding: "8px 20px",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}>
        <button
          onClick={() => setShowBody(!showBody)}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--text-secondary)",
            cursor: "pointer",
            fontSize: 12,
            padding: "4px 8px",
          }}
        >
          {showBody ? "▾ Hide summary" : "▸ Add summary"}
        </button>

        {commentCount > 0 && (
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {commentCount} comment{commentCount !== 1 ? "s" : ""} pending
          </span>
        )}

        {submitError && (
          <span style={{ fontSize: 12, color: "var(--red)", marginLeft: 4 }}>
            {submitError}
          </span>
        )}

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {actions.map((a) => (
            <button
              key={a.event}
              className="verdict-btn"
              disabled={submitting}
              onClick={() => submitReview(a.event, body)}
              style={{
                "--hover-bg": a.hoverBg,
                padding: "6px 14px",
                fontSize: 12,
                fontWeight: 600,
                border: `1px solid ${a.color}`,
                background: a.bg,
                color: a.color,
                borderRadius: 6,
                cursor: submitting ? "wait" : "pointer",
                opacity: submitting ? 0.6 : 1,
              } as React.CSSProperties}
            >
              {submitting ? "Submitting…" : a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

