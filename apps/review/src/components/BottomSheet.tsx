import { useState, useRef, useEffect } from "react";
import { useStore } from "../store";
import { apiUrl } from "../api";
import type { ReviewComment } from "@reviewradar/shared";

const BS_STYLES = `
.rb-bs-overlay {
  position: fixed; inset: 0; z-index: 50;
  display: flex; align-items: flex-end; justify-content: center;
  background: rgba(26, 26, 26, 0);
  pointer-events: none;
  transition: background 0.25s ease;
}
.rb-bs-overlay.open {
  background: rgba(26, 26, 26, 0.45);
  pointer-events: all;
}
.rb-bottom-sheet {
  width: 100%; max-width: 700px;
  background: var(--card-bg);
  border-top: 2.5px solid var(--card-border);
  border-radius: 16px 16px 0 0;
  padding: 14px 16px 20px;
  transform: translateY(100%);
  transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}
.rb-bs-overlay.open .rb-bottom-sheet {
  transform: translateY(0);
}
.rb-bs-handle {
  width: 36px; height: 4px;
  background: var(--bg-tertiary); border-radius: 2px;
  margin: 0 auto 12px;
}
.rb-bs-context {
  font-size: 11px; font-family: var(--font-mono);
  color: var(--text); background: var(--diff-del-bg);
  padding: 6px 10px; border-radius: 6px; margin-bottom: 10px;
  border-left: 3px solid var(--red);
  border-top: 1.5px solid var(--bg-tertiary);
  border-right: 1.5px solid var(--bg-tertiary);
  border-bottom: 1.5px solid var(--bg-tertiary);
  white-space: pre; overflow-x: auto;
}
.rb-bs-textarea {
  width: 100%;
  border: 1.5px solid var(--card-border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  font-family: var(--font-sans);
  resize: none; height: 72px;
  background: var(--input-bg);
  color: var(--text); outline: none;
}
.rb-bs-textarea:focus {
  border-color: var(--blue);
}
.rb-bs-actions {
  display: flex; justify-content: flex-end; gap: 8px; margin-top: 9px;
}
.rb-bs-btn {
  padding: 7px 18px; font-size: 12px; font-weight: 500;
  border-radius: 8px; cursor: pointer;
  border: 2px solid var(--text);
  transition: transform 0.08s, box-shadow 0.08s;
}
.rb-bs-btn:active {
  transform: translate(2px, 2px); box-shadow: none !important;
}
.rb-bs-btn-cancel {
  background: var(--card-bg); color: var(--text);
  box-shadow: 2px 2px 0px var(--text);
}
.rb-bs-btn-post {
  background: var(--orange); color: #fff;
  box-shadow: 2px 2px 0px var(--text);
}
`;

export default function BottomSheet() {
  const open = useStore((s) => s.bottomSheetOpen);
  const context = useStore((s) => s.bottomSheetContext);
  const closeBottomSheet = useStore((s) => s.closeBottomSheet);
  const addReviewComment = useStore((s) => s.addReviewComment);
  const files = useStore((s) => s.files);
  const cardIndex = useStore((s) => s.cardIndex);

  const [comment, setComment] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 300);
    }
    if (!open) setComment("");
  }, [open]);

  const handlePost = async () => {
    if (!comment.trim()) return;

    const file = files[cardIndex];
    if (!file) return;

    const newComment: ReviewComment = {
      id: crypto.randomUUID(),
      filePath: file.path,
      line: 1,
      side: "RIGHT",
      body: comment.trim(),
      type: "comment",
      createdAt: Date.now(),
    };

    addReviewComment(newComment);

    // Persist to server
    try {
      await fetch(apiUrl("/comments"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newComment),
      });
    } catch {}

    setComment("");
    closeBottomSheet();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) closeBottomSheet();
  };

  return (
    <>
      <style>{BS_STYLES}</style>
      <div
        className={`rb-bs-overlay ${open ? "open" : ""}`}
        onClick={handleOverlayClick}
      >
        <div className="rb-bottom-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="rb-bs-handle" />
          {context && <div className="rb-bs-context">{context}</div>}
          <textarea
            ref={textareaRef}
            className="rb-bs-textarea"
            placeholder="Leave a comment on this line..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handlePost();
              }
            }}
          />
          <div className="rb-bs-actions">
            <button className="rb-bs-btn rb-bs-btn-cancel" onClick={closeBottomSheet}>
              Cancel
            </button>
            <button className="rb-bs-btn rb-bs-btn-post" onClick={handlePost}>
              Post comment
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
