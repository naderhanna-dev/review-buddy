import { spawnExec } from "./paths";

const cache = new Map<string, string>();

function cacheKey(owner: string, repo: string, sha: string, path: string): string {
  return `${owner}/${repo}@${sha}:${path}`;
}

export async function fetchFileContent(
  owner: string,
  repo: string,
  sha: string,
  path: string,
): Promise<string> {
  const key = cacheKey(owner, repo, sha, path);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const content = await spawnExec([
    "gh", "api",
    `repos/${owner}/${repo}/contents/${path}?ref=${sha}`,
    "--jq", ".content",
  ]);

  const decoded = Buffer.from(content.trim().replace(/\n/g, ""), "base64").toString("utf-8");
  cache.set(key, decoded);
  return decoded;
}
