import { useEffect } from "react";
import { useHighlightedCode } from "../hooks/useHighlightedCode";
import { langFromPath } from "../hooks/shikiHighlighter";

const STYLES = `
.highlighted-suggestion pre.shiki {
  margin: 0 !important;
  padding: 0 !important;
  background: transparent !important;
}
.highlighted-suggestion pre.shiki code {
  padding: 0 !important;
  white-space: pre-wrap !important;
  word-break: break-all !important;
}
`;

let injected = false;
function injectStyles() {
  if (injected) return;
  injected = true;
  const s = document.createElement("style");
  s.textContent = STYLES;
  document.head.appendChild(s);
}

export default function HighlightedSuggestion({
  code,
  filePath,
  style,
}: {
  code: string;
  filePath: string;
  style?: React.CSSProperties;
}) {
  useEffect(injectStyles, []);
  const lang = langFromPath(filePath);
  const html = useHighlightedCode(code, lang);

  const base: React.CSSProperties = {
    margin: 0,
    padding: "2px 6px",
    background: "var(--bg)",
    borderRadius: 3,
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    ...style,
  };

  if (html) {
    return (
      <div
        dangerouslySetInnerHTML={{ __html: html }}
        className="highlighted-suggestion"
        style={base}
      />
    );
  }

  return <pre style={base}>{code}</pre>;
}
