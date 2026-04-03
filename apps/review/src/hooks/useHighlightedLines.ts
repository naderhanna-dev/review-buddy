import { useState, useEffect, useRef } from "react";
import { createHighlighter, type Highlighter } from "shiki";

/**
 * Maps file extension to shiki language ID.
 * Returns undefined for unsupported extensions — caller falls back to plain text.
 */
function langFromPath(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    rb: "ruby",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    css: "css",
    scss: "scss",
    html: "html",
    vue: "vue",
    svelte: "svelte",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    sql: "sql",
    graphql: "graphql",
    dockerfile: "dockerfile",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
  };
  return ext ? map[ext] : undefined;
}

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark"],
      langs: [
        "typescript", "tsx", "javascript", "jsx", "json", "markdown",
        "python", "rust", "go", "ruby", "java", "kotlin", "swift",
        "css", "scss", "html", "vue", "svelte", "yaml", "toml",
        "bash", "sql", "graphql", "dockerfile", "c", "cpp",
      ],
    });
  }
  return highlighterPromise;
}

/**
 * Highlighted line: the inner HTML for a single line of source code.
 * Tokens are wrapped in <span> with inline color styles.
 */
export type HighlightedLine = string;

/**
 * Given a file path, fetches the source from the server,
 * highlights it with shiki, and returns an array of HTML strings
 * indexed by 1-based line number.
 *
 * Returns null while loading or if highlighting fails.
 */
export function useHighlightedLines(filePath: string | undefined): HighlightedLine[] | null {
  const [lines, setLines] = useState<HighlightedLine[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!filePath) {
      setLines(null);
      return;
    }

    const lang = langFromPath(filePath);
    if (!lang) {
      setLines(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLines(null);

    (async () => {
      try {
        const res = await fetch(`/api/file/${encodeURIComponent(filePath)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const source = await res.text();
        if (controller.signal.aborted) return;

        const highlighter = await getHighlighter();
        if (controller.signal.aborted) return;

        const html = highlighter.codeToHtml(source, {
          lang,
          theme: "github-dark",
        });

        // shiki wraps output in <pre><code>...lines...</code></pre>
        // Extract the inner HTML of each line.
        const lineHtmls = parseShikiOutput(html);
        setLines(lineHtmls);
      } catch {
        // Fetch aborted or highlight failed — leave as null (plain text fallback)
      }
    })();

    return () => controller.abort();
  }, [filePath]);

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
