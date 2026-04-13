import { useRef, useState, useCallback } from "react";
import { useStore } from "../store";
import { useHighlightedLines } from "../hooks/useHighlightedLines";
import type { DiffFile } from "@reviewradar/shared";

// --- Diff parsing ---

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
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (match) { oldNum = parseInt(match[1]); newNum = parseInt(match[2]); }
      // Show just the hunk range, plus any trailing function context
      const label = match ? `@@ -${match[1]} +${match[2]} @@${match[3] || ""}` : line;
      lines.push({ type: "header", content: label });
    } else if (line.startsWith("---") || line.startsWith("+++")) {
      // Skip file-level diff headers (--- a/file, +++ b/file)
    } else if (line.startsWith("+")) {
      lines.push({ type: "addition", content: line.slice(1), newNum });
      newNum++;
    } else if (line.startsWith("-")) {
      lines.push({ type: "deletion", content: line.slice(1), oldNum });
      oldNum++;
    } else if (line.startsWith("\\")) {
      // no newline marker
    } else if (!line.startsWith("diff") && !line.startsWith("index")) {
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

function useResolvedTheme(): "light" | "dark" {
  const theme = useStore((s) => s.config.theme);
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return theme as "light" | "dark";
}

// --- Styles ---

const CARD_STYLES = `
.rb-card-stack { position: relative; flex: 1; min-height: 0; padding: 12px 12px 8px 12px; }

.rb-card {
  position: absolute; top: 12px; left: 12px; right: 24px; bottom: 8px;
  background: var(--card-bg);
  border: 2.5px solid var(--card-border);
  border-radius: var(--card-radius);
  overflow: hidden;
  display: flex; flex-direction: column;
  transform-origin: top center;
  transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.35s ease;
  will-change: transform, opacity;
  touch-action: pan-y;
}
/* Top card gets a subtle lift shadow */
.rb-card-0 {
  z-index: 4;
  box-shadow: 0 2px 12px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06);
}
.rb-card-1 { z-index: 3; transform: translate(6px, 6px); }
.rb-card-2 { z-index: 2; transform: translate(12px, 12px); }
.rb-card-3 { z-index: 1; transform: translate(18px, 18px); }
.rb-card-1 > *, .rb-card-2 > *, .rb-card-3 > * { visibility: hidden; }
.rb-card.swiping { transition: none; }

/* --- Swipe overlays --- */
.rb-card-overlay {
  position: absolute; inset: 0; z-index: 10;
  border-radius: calc(var(--card-radius) - 2px);
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 0.15s; pointer-events: none;
}
.rb-card-overlay.approve { background: rgba(0, 176, 80, 0.08); border: 3.5px solid var(--green); }
.rb-card-overlay.reject { background: rgba(232, 32, 10, 0.08); border: 3.5px solid var(--red); }
.rb-overlay-stamp {
  font-size: 22px; font-weight: 700; letter-spacing: 0.1em;
  border: 3.5px solid; border-radius: 10px; padding: 6px 18px;
  font-family: var(--font-sans);
  transform: rotate(-8deg);
}
.rb-overlay-stamp.approve { color: var(--green); border-color: var(--green); }
.rb-overlay-stamp.reject { color: var(--red); border-color: var(--red); }

/* --- Card file tab --- */
.rb-card-tab {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 14px;
  background: var(--card-bg);
  border-bottom: 1.5px solid #C8C4BC;
  flex-shrink: 0;
}
.rb-card-tab-name {
  font-size: 12px; font-family: var(--font-mono);
  color: var(--text); font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* --- Diff content --- */
.rb-diff-content {
  font-family: var(--font-mono); font-size: 12px; line-height: 1.75;
  flex: 1; overflow-y: auto;
  background: var(--card-bg);
}
.rb-diff-line {
  display: flex; align-items: stretch;
  padding: 0 4px;
  min-height: 22px;
}
.rb-diff-line.addition, .rb-diff-line.deletion {
  cursor: pointer;
}
.rb-diff-line.addition:hover, .rb-diff-line.deletion:hover {
  outline: 1.5px solid var(--blue); outline-offset: -1px;
}
.rb-dl-num {
  width: 36px; text-align: right; padding: 0 8px 0 0;
  font-size: 11px; color: var(--text); opacity: 0.25; flex-shrink: 0;
  display: flex; align-items: center; justify-content: flex-end;
  user-select: none;
}
.rb-dl-sign {
  width: 14px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600;
  user-select: none;
}
.rb-dl-code {
  white-space: pre; overflow: hidden; text-overflow: ellipsis;
  color: var(--text); font-size: 12px; padding: 0 10px 0 4px;
  flex: 1;
}
.rb-dl-code span[style] { color: inherit !important; }

.rb-diff-line.addition { background: var(--diff-add-bg); }
.rb-diff-line.addition .rb-dl-sign { color: var(--green); }
.rb-diff-line.deletion { background: var(--diff-del-bg); }
.rb-diff-line.deletion .rb-dl-sign { color: var(--red); }
.rb-diff-line.context { background: var(--card-bg); }
.rb-diff-line.header {
  background: var(--bg-tertiary);
  border-top: 1px solid #C8C4BC;
  border-bottom: 1px solid #C8C4BC;
  margin-top: 2px;
}
.rb-diff-line.header .rb-dl-code {
  color: var(--text); opacity: 0.4; font-size: 11px; font-style: italic;
}

/* --- Button row --- */
.rb-btn-row {
  flex-shrink: 0; height: 72px;
  background: var(--bg-tertiary);
  border-top: 2px solid var(--card-border);
  display: flex; align-items: center; justify-content: center; gap: 20px;
}
.rb-action-btn {
  width: 52px; height: 52px; border-radius: 12px; cursor: pointer;
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

/* --- Progress --- */
.rb-dot-row { display: flex; gap: 5px; padding: 6px 16px; justify-content: center; flex-wrap: wrap; }
.rb-dot {
  width: 8px; height: 8px; border-radius: 50%;
  border: 1.5px solid var(--card-border); background: transparent;
  transition: background 0.2s, border-color 0.2s;
}
.rb-dot.done { background: var(--green); border-color: var(--green); }
.rb-dot.active { background: var(--yellow); border-color: var(--text); }
.rb-dot.rejected { background: var(--red); border-color: var(--red); }

@media (max-width: 768px) {
  .rb-card-stack { padding: 8px 8px 6px 8px; }
  .rb-card { top: 8px; left: 8px; right: 18px; bottom: 6px; }
  .rb-card-1 { transform: translate(5px, 5px); }
  .rb-card-2 { transform: translate(10px, 10px); }
  .rb-card-3 { transform: translate(15px, 15px); }
  .rb-action-btn { width: 46px; height: 46px; }
  .rb-btn-row { height: 64px; gap: 16px; }
}
`;

// --- Components ---

function DiffCard({
  file, slot, swipeState, onLineClick,
}: {
  file: DiffFile;
  slot: number;
  swipeState: "none" | "approve" | "reject";
  onLineClick: (content: string) => void;
}) {
  const lines = parseHunk(file.patch);
  const resolvedTheme = useResolvedTheme();
  const highlightedLines = useHighlightedLines(file.path, resolvedTheme);

  // Show just filename, not full path
  const shortName = file.path.includes("/") ? file.path.split("/").pop() : file.path;

  return (
    <div className={`rb-card rb-card-${slot}`}>
      <div className="rb-card-overlay approve" style={{ opacity: swipeState === "approve" ? 1 : 0 }}>
        <div className="rb-overlay-stamp approve">APPROVED</div>
      </div>
      <div className="rb-card-overlay reject" style={{ opacity: swipeState === "reject" ? 1 : 0 }}>
        <div className="rb-overlay-stamp reject">CHANGES</div>
      </div>

      <div className="rb-card-tab">
        <span className="rb-card-tab-name" title={file.path}>{shortName}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 8 }}>
          {file.additions > 0 && <span style={{ color: "var(--green)", fontSize: 11, fontWeight: 600 }}>+{file.additions}</span>}
          {file.deletions > 0 && <span style={{ color: "var(--red)", fontSize: 11, fontWeight: 600 }}>-{file.deletions}</span>}
        </div>
      </div>

      <div className="rb-diff-content">
        {lines.map((line, i) => {
          const num = line.newNum ?? line.oldNum ?? "";
          const sign = line.type === "addition" ? "+" : line.type === "deletion" ? "\u2212" : "";
          const clickable = line.type === "addition" || line.type === "deletion";

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
                dangerouslySetInnerHTML={{ __html: getLineHtml(line, highlightedLines) }}
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
  return (
    <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)", padding: "8px 0" }}>
      {fileVerdicts.size} / {files.length} reviewed
    </div>
  );
}

// --- Main ---

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
    setSwipeTransform(`translateX(${dx}px) rotate(${dx * 0.04}deg)`);
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
      setSwipeTransform(`translateX(${dx > 0 ? "120%" : "-120%"}) rotate(${dx * 0.08}deg)`);
      setSwipeState(verdict === "approved" ? "approve" : "reject");
      setTimeout(() => {
        swipeFile(files[cardIndex].path, verdict);
        setSwipeTransform("");
        setSwipeState("none");
      }, 280);
    } else {
      setSwipeTransform("");
      setSwipeState("none");
    }
  }, [files, cardIndex, swipeFile]);

  const handleButtonSwipe = useCallback((direction: "approve" | "reject") => {
    if (!files[cardIndex]) return;
    setSwipeState(direction);
    setSwipeTransform(`translateX(${direction === "approve" ? "120%" : "-120%"}) rotate(${direction === "approve" ? 12 : -12}deg)`);
    setTimeout(() => {
      swipeFile(files[cardIndex].path, direction === "approve" ? "approved" : "rejected");
      setSwipeTransform("");
      setSwipeState("none");
    }, 280);
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
            height: "100%", flexDirection: "column", gap: 16, color: "var(--text)",
          }}>
            <div style={{ fontSize: 28, fontWeight: 600 }}>All files reviewed</div>
            <div style={{ fontSize: 13, opacity: 0.5 }}>
              {fileVerdicts.size} file{fileVerdicts.size !== 1 ? "s" : ""} reviewed. Submit your review below.
            </div>
            <button
              onClick={() => setCardIndex(0)}
              style={{
                marginTop: 8, padding: "8px 20px", fontSize: 12, fontWeight: 600,
                border: "2px solid var(--card-border)", borderRadius: 8,
                background: "var(--card-bg)", color: "var(--text)", cursor: "pointer",
                boxShadow: "3px 3px 0px var(--card-border)",
              }}
            >
              Review again
            </button>
          </div>
        ) : (
          [...Array(Math.min(4, files.length - cardIndex))].map((_, slot) => {
            const file = files[cardIndex + slot];
            if (!file) return null;
            const isTop = slot === 0;
            return (
              <div
                key={file.path}
                style={isTop && swipeTransform ? { transform: swipeTransform, transition: "none" } : undefined}
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
          <button className="rb-action-btn reject-btn" onClick={() => handleButtonSwipe("reject")}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <line x1="5" y1="5" x2="17" y2="17" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
              <line x1="17" y1="5" x2="5" y2="17" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </button>
          <button className="rb-action-btn approve-btn" onClick={() => handleButtonSwipe("approve")}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <polyline points="3,11 9,17 19,5" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
