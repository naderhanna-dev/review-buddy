import { useState, useEffect } from "react";
import { getHighlighter } from "./shikiHighlighter";

export function useHighlightedCode(code: string, lang?: string): string | null {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!lang) {
      setHtml(null);
      return;
    }

    let cancelled = false;
    getHighlighter().then((h) => {
      if (cancelled) return;
      try {
        setHtml(h.codeToHtml(code, { lang, theme: "github-dark" }));
      } catch {
        setHtml(null);
      }
    });
    return () => { cancelled = true; };
  }, [code, lang]);

  return html;
}
