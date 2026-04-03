function getSessionPath(): string {
  const parts = window.location.pathname.split("/").filter(Boolean);
  // URL: /review/:owner/:repo/:number
  const [, owner, repo, number] = parts;
  if (!owner || !repo || !number) {
    console.error("Invalid review URL — expected /review/:owner/:repo/:number");
    return "/api/reviews/_/_/0";
  }
  return `/api/reviews/${owner}/${repo}/${number}`;
}

export const SESSION_BASE = getSessionPath();

export function apiUrl(path: string): string {
  return `${SESSION_BASE}${path}`;
}
