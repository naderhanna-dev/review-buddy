import { useState, useEffect, useRef } from "react";
import { apiUrl } from "../api";
import { langFromPath, getHighlighter } from "./shikiHighlighter";

/**
 * Highlighted line: the inner HTML for a single line of source code.
 * Tokens are wrapped in <span> with inline color styles.
 */
export type HighlightedLine = string;

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function highlightSource(
  source: string,
  lang: string | undefined,
  theme: "light" | "dark",
): Promise<HighlightedLine[]> {
  if (!lang) {
    return source.split("\n").map(escapeHtml);
  }

  const highlighter = await getHighlighter();
  const shikiTheme = theme === "light" ? "github-light" : "github-dark";
  const html = highlighter.codeToHtml(source, { lang, theme: shikiTheme });
  return parseShikiOutput(html);
}

/**
 * Given a file path, fetches the source from the server,
 * highlights it with shiki, and returns an array of HTML strings
 * indexed by 1-based line number.
 *
 * Pass `ref` to control which version is fetched:
 *   - `"head"` (default) — the PR head version
 *   - `"base"` — the base/old version (for split-view left pane)
 *
 * Returns null while loading or if highlighting fails.
 */
export function useHighlightedLines(
  filePath: string | undefined,
  theme: "light" | "dark" = "dark",
  ref: "head" | "base" = "head",
): HighlightedLine[] | null {
  const [lines, setLines] = useState<HighlightedLine[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheKeyRef = useRef<string | null>(null);
  const sourceRef = useRef<{ cacheKey: string; source: string; lang: string | undefined } | null>(null);

  useEffect(() => {
    if (!filePath) {
      setLines(null);
      sourceRef.current = null;
      cacheKeyRef.current = null;
      return;
    }

    const cacheKey = `${ref}:${filePath}`;

    // If we already have the source cached for this path+ref, just re-highlight with new theme
    if (sourceRef.current?.cacheKey === cacheKey) {
      const { source, lang } = sourceRef.current;
      highlightSource(source, lang, theme).then(setLines);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    cacheKeyRef.current = cacheKey;

    setLines(null);

    (async () => {
      try {
        const queryParam = ref === "base" ? "?ref=base" : "";
        const res = await fetch(apiUrl(`/file/${encodeURIComponent(filePath)}${queryParam}`), {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const source = await res.text();
        if (controller.signal.aborted) return;

        const lang = langFromPath(filePath);
        sourceRef.current = { cacheKey, source, lang };

        const result = await highlightSource(source, lang, theme);
        if (!controller.signal.aborted) setLines(result);
      } catch {
        // Fetch aborted or highlight failed — leave as null (plain text fallback)
      }
    })();

    return () => controller.abort();
  }, [filePath, theme, ref]);

  return lines;
}

/**
 * Parses shiki's HTML output into per-line HTML strings.
 * Each line is wrapped in `<span class="line">...tokens...</span>`.
 * Tokens are nested `<span style="color:...">` elements.
 *
 * We can't use a simple non-greedy regex because nested spans
 * cause premature matching. Instead, we find each line-open tag
 * and manually balance the span nesting to find the true close.
 */
function parseShikiOutput(html: string): HighlightedLine[] {
  const result: HighlightedLine[] = [];
  const marker = '<span class="line">';
  let pos = 0;

  while (true) {
    const start = html.indexOf(marker, pos);
    if (start === -1) break;

    const contentStart = start + marker.length;
    // Walk forward, counting span depth to find the matching </span>
    let depth = 1;
    let i = contentStart;
    while (i < html.length && depth > 0) {
      if (html.startsWith("<span", i)) {
        depth++;
        i = html.indexOf(">", i) + 1;
      } else if (html.startsWith("</span>", i)) {
        depth--;
        if (depth === 0) break;
        i += 7; // length of "</span>"
      } else {
        i++;
      }
    }

    result.push(html.slice(contentStart, i));
    pos = i + 7; // skip past "</span>"
  }

  return result;
}
