import { createHighlighter, type Highlighter } from "shiki";

/**
 * Maps file extension to shiki language ID.
 * Returns undefined for unsupported extensions — caller falls back to plain text.
 */
export function langFromPath(path: string): string | undefined {
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
    cs: "csharp",
    csx: "csharp",
  };
  return ext ? map[ext] : undefined;
}

let highlighterPromise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: [
        "typescript", "tsx", "javascript", "jsx", "json", "markdown",
        "python", "rust", "go", "ruby", "java", "kotlin", "swift",
        "css", "scss", "html", "vue", "svelte", "yaml", "toml",
        "bash", "sql", "graphql", "dockerfile", "c", "cpp", "csharp",
      ],
    });
  }
  return highlighterPromise;
}
