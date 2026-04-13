import { useState } from "react";
import { useStore } from "../store";
import type { ReviewEvent } from "@reviewradar/shared";

const VERDICT_STYLES = `
.rb-verdict-bar {
  border-top: 2.5px solid var(--card-border);
  background: var(--panel-bg);
  padding: 8px 16px;
  display: flex; align-items: center; gap: 10px;
  flex-shrink: 0;
}
.rb-verdict-summary-toggle {
  border: none; background: transparent;
  color: var(--text); opacity: 0.5;
  cursor: pointer; font-size: 11px; padding: 4px 8px;
  font-family: var(--font-sans);
}
.rb-verdict-summary-toggle:hover { opacity: 0.8; }
.rb-verdict-textarea {
  width: 100%; min-height: 44px; padding: 8px 10px;
  background: var(--input-bg); color: var(--text);
  border: 1.5px solid var(--card-border); border-radius: 6px;
  font-family: var(--font-sans); font-size: 12px;
  resize: vertical; outline: none;
}
.rb-verdict-textarea:focus { border-color: var(--blue); }
.rb-verdict-btn {
  padding: 6px 14px; font-size: 11px; font-weight: 600;
  border-radius: 8px; cursor: pointer;
  border: 2px solid var(--card-border);
  transition: transform 0.08s, box-shadow 0.08s;
  font-family: var(--font-sans);
  white-space: nowrap;
}
@media (max-width: 768px) {
  .rb-verdict-bar { padding: 6px 10px; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  .rb-verdict-btn { padding: 5px 10px; font-size: 10px; }
  .rb-verdict-summary-toggle { display: none; }
}
.rb-verdict-btn:active {
  transform: translate(2px, 2px) !important;
  box-shadow: none !important;
}
.rb-verdict-btn:disabled {
  opacity: 0.5; cursor: wait;
}
.rb-verdict-btn.approve {
  background: var(--green); color: #fff;
  box-shadow: 2px 2px 0px var(--card-border);
}
.rb-verdict-btn.comment {
  background: var(--blue); color: #fff;
  box-shadow: 2px 2px 0px var(--card-border);
}
.rb-verdict-btn.request-changes {
  background: var(--orange); color: #fff;
  box-shadow: 2px 2px 0px var(--card-border);
}
.rb-verdict-success {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px; font-size: 12px;
  border-top: 2.5px solid var(--card-border);
  background: var(--panel-bg);
}
`;

const actions: { event: ReviewEvent; label: string; cls: string }[] = [
  { event: "APPROVE", label: "Approve", cls: "approve" },
  { event: "COMMENT", label: "Comment", cls: "comment" },
  { event: "REQUEST_CHANGES", label: "Request Changes", cls: "request-changes" },
];

export default function VerdictBar() {
  const pr = useStore((s) => s.pr);
  const reviewComments = useStore((s) => s.reviewComments);
  const submitting = useStore((s) => s.submitting);
  const submitted = useStore((s) => s.submitted);
  const submitResult = useStore((s) => s.submitResult);
  const submitError = useStore((s) => s.submitError);
  const submitReview = useStore((s) => s.submitReview);
  const fileVerdicts = useStore((s) => s.fileVerdicts);

  const [body, setBody] = useState("");
  const [showBody, setShowBody] = useState(false);

  if (!pr) return null;

  if (submitted && submitResult) {
    return (
      <div className="rb-verdict-success">
        <style>{VERDICT_STYLES}</style>
        <span style={{ color: "var(--green)", fontWeight: 600 }}>Review submitted</span>
        <span style={{ color: "var(--text)", opacity: 0.5 }}>
          {submitResult.commentCount} comment{submitResult.commentCount !== 1 ? "s" : ""}
        </span>
        <a
          href={submitResult.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--blue)", textDecoration: "underline", fontSize: 11 }}
        >
          View on GitHub
        </a>
      </div>
    );
  }

  const commentCount = reviewComments.size;
  const reviewedCount = fileVerdicts.size;

  return (
    <>
      <style>{VERDICT_STYLES}</style>
      {showBody && (
        <div style={{ padding: "8px 16px 0", background: "var(--panel-bg)", borderTop: "1px solid #C8C4BC" }}>
          <textarea
            className="rb-verdict-textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Review summary (optional)..."
          />
        </div>
      )}
      <div className="rb-verdict-bar">
        <button
          className="rb-verdict-summary-toggle"
          onClick={() => setShowBody(!showBody)}
        >
          {showBody ? "\u25BE Hide summary" : "\u25B8 Add summary"}
        </button>

        {commentCount > 0 && (
          <span style={{ fontSize: 11, color: "var(--text)", opacity: 0.4 }}>
            {commentCount} comment{commentCount !== 1 ? "s" : ""}
          </span>
        )}

        {reviewedCount > 0 && (
          <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 500 }}>
            {reviewedCount} file{reviewedCount !== 1 ? "s" : ""} reviewed
          </span>
        )}

        {submitError && (
          <span style={{ fontSize: 11, color: "var(--red)" }}>
            {submitError}
          </span>
        )}

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {actions.map((a) => (
            <button
              key={a.event}
              className={`rb-verdict-btn ${a.cls}`}
              disabled={submitting}
              onClick={() => submitReview(a.event, body)}
            >
              {submitting ? "..." : a.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
