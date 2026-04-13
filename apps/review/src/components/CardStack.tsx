import { useRef, useState, useCallback } from "react";
import { useStore } from "../store";
import { useHighlightedLines } from "../hooks/useHighlightedLines";
import type { DiffFile } from "@reviewradar/shared";

// --- Diff parsing (reused from DiffPane) ---

interface HunkLine {
  type: "context" | "addition" | "deletion" | "header";
  content: string;
  newNum?: number;
  oldNum?: number;
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
      // no newline marker
    } else if (!line.startsWith("diff") && !line.startsWith("index") && !line.startsWith("---") && !line.startsWith("+++")) {
      lines.push({ type: "context", content: line.slice(1) || line, oldNum, newNum });
      oldNum++;
      newNum++;
    }
  }
  return lines;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- Resolve theme for syntax highlighting ---

function useResolvedTheme(): "light" | "dark" {
  const theme = useStore((s) => s.config.theme);
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return theme as "light" | "dark";
}

// --- Styles ---

const CARD_STYLES = `
.rb-card-stack { position: relative; flex: 1; min-height: 0; }

/* --- Stacked cards: visible behind top card --- */
.rb-card {
  position: absolute; top: 10px; left: 10px; right: 20px; bottom: 10px;
  background: var(--card-bg); border: 2.5px solid var(--card-border);
  border-radius: var(--card-radius); overflow: hidden;
  display: flex; flex-direction: column;
  transform-origin: top center;
  transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.35s ease;
  will-change: transform, opacity;
  touch-action: pan-y;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}
.rb-card.swiping { transition: none; }
.rb-card-0 { z-index: 4; }
.rb-card-1 { z-index: 3; transform: translate(7px, 7px); }
.rb-card-2 { z-index: 2; transform: translate(14px, 14px); }
.rb-card-3 { z-index: 1; transform: translate(21px, 21px); }
/* Behind cards: hide content, just show card edge */
.rb-card-1 > *, .rb-card-2 > *, .rb-card-3 > * { visibility: hidden; }
.rb-card-1 .rb-card-overlay, .rb-card-2 .rb-card-overlay, .rb-card-3 .rb-card-overlay { visibility: hidden; }

/* --- Swipe overlays --- */
.rb-card-overlay {
  position: absolute; inset: 0; z-index: 10;
  border-radius: calc(var(--card-radius) - 2px);
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 0.12s; pointer-events: none;
}
.rb-card-overlay.approve { border: 3px solid var(--green); }
.rb-card-overlay.reject { border: 3px solid var(--red); }
.rb-overlay-stamp {
  font-size: 20px; font-weight: 600; letter-spacing: 0.08em;
  border: 3px solid; border-radius: 8px; padding: 5px 14px;
  font-family: var(--font-sans);
}
.rb-overlay-stamp.approve { color: var(--green); border-color: var(--green); }
.rb-overlay-stamp.reject { color: var(--red); border-color: var(--red); }

/* --- Card file tab --- */
.rb-card-tab {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; background: var(--bg-tertiary);
  border-bottom: 2px solid var(--card-border); flex-shrink: 0;
}
.rb-card-tab-name {
  font-size: 11px; font-family: var(--font-mono);
  color: var(--text); font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* --- Diff content --- */
.rb-diff-content {
  font-family: var(--font-mono); font-size: 11.5px; line-height: 1.7;
  flex: 1; overflow-y: auto;
}
.rb-diff-line { display: flex; align-items: stretch; cursor: pointer; }
.rb-diff-line:hover { outline: 1.5px solid var(--blue); outline-offset: -1px; }
.rb-dl-num {
  width: 30px; text-align: right; padding: 0 7px 0 0;
  font-size: 10px; color: var(--text); opacity: 0.3; flex-shrink: 0;
  display: flex; align-items: center; justify-content: flex-end;
  border-right: 1px solid var(--bg-tertiary); margin-right: 8px;
}
.rb-dl-sign { width: 11px; flex-shrink: 0; display: flex; align-items: center; font-size: 12px; font-weight: 600; }
.rb-dl-code {
  white-space: pre; overflow: hidden; text-overflow: ellipsis;
  color: var(--text); font-size: 11px; padding-right: 8px;
}
/* Force syntax-highlighted token spans to inherit text color when
   shiki returns dark-theme tokens in a light UI (or vice-versa).
   This is the safety net — the real fix is passing the correct theme
   to useHighlightedLines, but token leaks still happen on theme switch. */
.rb-dl-code span[style] { color: inherit !important; }

.rb-diff-line.addition { background: var(--diff-add-bg); }
.rb-diff-line.addition .rb-dl-sign { color: var(--green); }
.rb-diff-line.deletion { background: var(--diff-del-bg); }
.rb-diff-line.deletion .rb-dl-sign { color: var(--red); }
.rb-diff-line.context { background: transparent; }
.rb-diff-line.header { background: var(--diff-hdr-bg); }
.rb-diff-line.header .rb-dl-code { color: var(--text); opacity: 0.4; font-size: 10px; }

/* --- Button row --- */
.rb-btn-row {
  flex-shrink: 0; height: 68px; background: var(--bg-tertiary);
  border-top: 2.5px solid var(--card-border);
  display: flex; align-items: center; justify-content: center; gap: 16px;
}
.rb-action-btn {
  width: 48px; height: 48px; border-radius: 10px; cursor: pointer;
  border: 2.5px solid var(--text); display: flex; align-items: center;
  justify-content: center; flex-shrink: 0;
  transition: transform 0.08s, box-shadow 0.08s;
}
.rb-action-btn:active {
  transform: translate(4px, 4px) !important;
  box-shadow: none !important;
}
.rb-action-btn.reject-btn {
  background: var(--red);
  box-shadow: 4px 4px 0px var(--text);
}
.rb-action-btn.approve-btn {
  background: var(--green);
  box-shadow: 4px 4px 0px var(--text);
}

/* --- Progress dots --- */
.rb-dot-row { display: flex; gap: 5px; padding: 8px 12px; justify-content: center; flex-wrap: wrap; }
.rb-dot {
  width: 8px; height: 8px; border-radius: 50%;
  border: 1.5px solid var(--card-border); background: transparent;
  transition: background 0.2s, border-color 0.2s;
}
.rb-dot.done { background: var(--green); border-color: var(--green); }
.rb-dot.active { background: var(--yellow); border-color: var(--text); }
.rb-dot.rejected { background: var(--red); border-color: var(--red); }

/* --- Mobile --- */
@media (max-width: 768px) {
  .rb-card { top: 8px; left: 8px; right: 16px; bottom: 8px; }
  .rb-card-1 { transform: translate(5px, 5px); }
  .rb-card-2 { transform: translate(10px, 10px); }
  .rb-card-3 { transform: translate(15px, 15px); }
  .rb-action-btn { width: 44px; height: 44px; }
  .rb-btn-row { height: 62px; gap: 14px; }
}
`;

// --- Subcomponents ---

function DiffCard({
  file,
  slot,
  swipeState,
  onLineClick,
}: {
  file: DiffFile;
  slot: number;
  swipeState: "none" | "approve" | "reject";
  onLineClick: (content: string) => void;
}) {
  const lines = parseHunk(file.patch);
  const resolvedTheme = useResolvedTheme();
  const highlightedLines = useHighlightedLines(file.path, resolvedTheme);

  const addStat = file.additions > 0 ? (
    <span style={{ color: "var(--green)", fontSize: 10, fontWeight: 500 }}>+{file.additions}</span>
  ) : null;
  const delStat = file.deletions > 0 ? (
    <span style={{ color: "var(--red)", fontSize: 10, fontWeight: 500 }}>-{file.deletions}</span>
  ) : null;

  return (
    <div className={`rb-card rb-card-${slot}`}>
      {/* Approve overlay */}
      <div
        className="rb-card-overlay approve"
        style={{ opacity: swipeState === "approve" ? 1 : 0 }}
      >
        <div className="rb-overlay-stamp approve">APPROVED</div>
      </div>
      {/* Reject overlay */}
      <div
        className="rb-card-overlay reject"
        style={{ opacity: swipeState === "reject" ? 1 : 0 }}
      >
        <div className="rb-overlay-stamp reject">CHANGES</div>
      </div>

      {/* File tab */}
      <div className="rb-card-tab">
        <span className="rb-card-tab-name">{file.path}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {addStat}
          {addStat && delStat && <span style={{ color: "var(--muted)", fontSize: 10 }}>·</span>}
          {delStat}
        </div>
      </div>

      {/* Diff content */}
      <div className="rb-diff-content">
        {lines.map((line, i) => {
          const num = line.newNum ?? line.oldNum ?? "";
          const sign = line.type === "addition" ? "+" : line.type === "deletion" ? "-" : "";
          const clickable = line.type === "addition" || line.type === "deletion";
          const contentHtml = getLineHtml(line, highlightedLines);

          return (
            <div
              key={i}
              className={`rb-diff-line ${line.type}`}
              onClick={clickable ? () => onLineClick(line.content) : undefined}
            >
              <div className="rb-dl-num">{num}</div>
              <div className="rb-dl-sign">{sign}</div>
              <div
                className="rb-dl-code"
                dangerouslySetInnerHTML={{ __html: contentHtml }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getLineHtml(line: HunkLine, highlightedLines: string[] | null): string {
  if (!highlightedLines) return escapeHtml(line.content);
  const lineNum = line.type === "deletion" ? line.oldNum : line.newNum;
  if (lineNum != null && lineNum > 0 && lineNum <= highlightedLines.length) {
    return highlightedLines[lineNum - 1];
  }
  return escapeHtml(line.content);
}

// --- Progress dots ---

function ProgressDots({ files, fileVerdicts, currentIndex }: {
  files: DiffFile[];
  fileVerdicts: Map<string, "approved" | "rejected">;
  currentIndex: number;
}) {
  const maxDots = 20;
  if (files.length <= maxDots) {
    return (
      <div className="rb-dot-row">
        {files.map((f, i) => {
          const verdict = fileVerdicts.get(f.path);
          let cls = "rb-dot";
          if (verdict === "approved") cls += " done";
          else if (verdict === "rejected") cls += " rejected";
          else if (i === currentIndex) cls += " active";
          return <div key={f.path} className={cls} />;
        })}
      </div>
    );
  }
  const reviewed = fileVerdicts.size;
  return (
    <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)", padding: "6px 0" }}>
      {reviewed} / {files.length} reviewed
    </div>
  );
}

// --- Main export ---

export default function CardStack() {
  const files = useStore((s) => s.files);
  const cardIndex = useStore((s) => s.cardIndex);
  const fileVerdicts = useStore((s) => s.fileVerdicts);
  const swipeFile = useStore((s) => s.swipeFile);
  const setCardIndex = useStore((s) => s.setCardIndex);
  const openBottomSheet = useStore((s) => s.openBottomSheet);

  const [swipeState, setSwipeState] = useState<"none" | "approve" | "reject">("none");
  const [swipeTransform, setSwipeTransform] = useState("");
  const swiping = useRef(false);
  const startX = useRef(0);
  const currentX = useRef(0);

  const SWIPE_THRESHOLD = 80;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    swiping.current = true;
    startX.current = e.clientX;
    currentX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!swiping.current) return;
    currentX.current = e.clientX;
    const dx = currentX.current - startX.current;
    const rotation = dx * 0.05;
    setSwipeTransform(`translateX(${dx}px) rotate(${rotation}deg)`);
    if (dx > SWIPE_THRESHOLD) setSwipeState("approve");
    else if (dx < -SWIPE_THRESHOLD) setSwipeState("reject");
    else setSwipeState("none");
  }, []);

  const handlePointerUp = useCallback(() => {
    if (!swiping.current) return;
    swiping.current = false;
    const dx = currentX.current - startX.current;

    if (Math.abs(dx) > SWIPE_THRESHOLD && files[cardIndex]) {
      const verdict = dx > 0 ? "approved" : "rejected";
      const flyOut = dx > 0 ? "115%" : "-115%";
      setSwipeTransform(`translateX(${flyOut}) rotate(${dx * 0.1}deg)`);
      setSwipeState(verdict === "approved" ? "approve" : "reject");
      setTimeout(() => {
        swipeFile(files[cardIndex].path, verdict);
        setSwipeTransform("");
        setSwipeState("none");
      }, 300);
    } else {
      setSwipeTransform("");
      setSwipeState("none");
    }
  }, [files, cardIndex, swipeFile]);

  const handleButtonSwipe = useCallback((direction: "approve" | "reject") => {
    if (!files[cardIndex]) return;
    const flyOut = direction === "approve" ? "115%" : "-115%";
    setSwipeState(direction);
    setSwipeTransform(`translateX(${flyOut}) rotate(${direction === "approve" ? 15 : -15}deg)`);
    setTimeout(() => {
      swipeFile(files[cardIndex].path, direction === "approve" ? "approved" : "rejected");
      setSwipeTransform("");
      setSwipeState("none");
    }, 300);
  }, [files, cardIndex, swipeFile]);

  const allReviewed = cardIndex >= files.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <style>{CARD_STYLES}</style>

      <ProgressDots files={files} fileVerdicts={fileVerdicts} currentIndex={cardIndex} />

      <div className="rb-card-stack">
        {allReviewed ? (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100%", flexDirection: "column", gap: 12, color: "var(--muted)",
          }}>
            <div style={{ fontSize: 32 }}>All files reviewed</div>
            <div style={{ fontSize: 13 }}>
              {fileVerdicts.size} file{fileVerdicts.size !== 1 ? "s" : ""} reviewed.
              Submit your review below.
            </div>
            <button
              onClick={() => { setCardIndex(0); }}
              style={{
                marginTop: 8, padding: "8px 20px", fontSize: 12, fontWeight: 600,
                border: "2px solid var(--text)", borderRadius: 8,
                background: "var(--card-bg)", color: "var(--text)", cursor: "pointer",
              }}
            >
              Review again
            </button>
          </div>
        ) : (
          /* Render bottom cards first so top card is last in DOM (painter's order) */
          [...Array(Math.min(4, files.length - cardIndex))].map((_, slot) => {
            const fileIndex = cardIndex + slot;
            const file = files[fileIndex];
            if (!file) return null;

            const isTop = slot === 0;
            return (
              <div
                key={file.path}
                style={isTop && swipeTransform ? {
                  transform: swipeTransform,
                  transition: "none",
                } : undefined}
                onPointerDown={isTop ? handlePointerDown : undefined}
                onPointerMove={isTop ? handlePointerMove : undefined}
                onPointerUp={isTop ? handlePointerUp : undefined}
              >
                <DiffCard
                  file={file}
                  slot={slot}
                  swipeState={isTop ? swipeState : "none"}
                  onLineClick={openBottomSheet}
                />
              </div>
            );
          }).reverse()
        )}
      </div>

      {!allReviewed && (
        <div className="rb-btn-row">
          <button
            className="rb-action-btn reject-btn"
            onClick={() => handleButtonSwipe("reject")}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <line x1="5" y1="5" x2="17" y2="17" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
              <line x1="17" y1="5" x2="5" y2="17" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="rb-action-btn approve-btn"
            onClick={() => handleButtonSwipe("approve")}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <polyline points="3,11 9,17 19,5" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
