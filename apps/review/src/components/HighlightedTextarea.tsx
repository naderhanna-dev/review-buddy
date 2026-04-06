import { useRef, useEffect, useState, useMemo } from "react";
import type { Highlighter } from "shiki";
import { langFromPath, getHighlighter } from "../hooks/shikiHighlighter";

const OVERLAY_STYLES = `
.shiki-overlay pre.shiki {
  margin: 0 !important;
  padding: 0 !important;
  background: transparent !important;
}
.shiki-overlay pre.shiki code {
  padding: 0 !important;
}
`;

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = OVERLAY_STYLES;
  document.head.appendChild(style);
}

/**
 * A textarea with syntax-highlighted overlay.
 *
 * Once the Shiki highlighter is loaded (one-time async), highlighting is
 * computed synchronously on every render — no debounce, no stale state,
 * no flicker. Before the highlighter loads, raw text is shown.
 */
export function HighlightedTextarea({ value, onChange, onKeyDown, filePath, autoFocus, placeholder, style }: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  filePath: string;
  autoFocus?: boolean;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  const lang = langFromPath(filePath);

  useEffect(() => { injectStyles(); }, []);

  // One-time async load of the highlighter instance
  useEffect(() => {
    getHighlighter().then(setHighlighter);
  }, []);

  // Synchronous highlight — runs in the same render as the value change
  const highlightedHtml = useMemo(() => {
    if (!highlighter || !lang || !value) return "";
    try {
      return highlighter.codeToHtml(value, { lang, theme: "github-dark" });
    } catch {
      return "";
    }
  }, [highlighter, lang, value]);

  // Auto-resize
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.max(60, el.scrollHeight) + "px";
    }
  }, [value]);

  const font: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    lineHeight: "1.5",
    padding: 8,
    whiteSpace: "pre-wrap",
    wordWrap: "break-word",
    overflowWrap: "break-word",
  };

  return (
    <div style={{ position: "relative", ...style }}>
      {/* Highlight underlay — always current, shown behind textarea */}
      {highlightedHtml && (
        <div
          aria-hidden
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          className="shiki-overlay"
          style={{
            ...font,
            position: "absolute", inset: 0, pointerEvents: "none",
            overflow: "hidden",
          }}
        />
      )}
      {/* Textarea on top — transparent text so highlight shows through, but caret is visible */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        placeholder={placeholder}
        style={{
          ...font,
          width: "100%", minHeight: 60, background: highlightedHtml ? "transparent" : undefined,
          color: highlightedHtml ? "transparent" : "var(--text)",
          caretColor: "var(--text)",
          border: "none", outline: "none", resize: "none",
          position: "relative", zIndex: 1,
        }}
      />
    </div>
  );
}
