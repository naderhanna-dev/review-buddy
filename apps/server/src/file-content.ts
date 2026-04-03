import { spawn } from "node:child_process";

const cache = new Map<string, string>();

function cacheKey(owner: string, repo: string, sha: string, path: string): string {
  return `${owner}/${repo}@${sha}:${path}`;
}

function ghExec(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("gh", args, {
      env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` },
    });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => chunks.push(d));
    proc.stderr.on("data", (d: Buffer) => errChunks.push(d));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`gh failed (${code}): ${Buffer.concat(errChunks).toString().trim()}`));
      } else {
        resolve(Buffer.concat(chunks).toString());
      }
    });
    proc.on("error", reject);
  });
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

  const content = await ghExec([
    "api",
    `repos/${owner}/${repo}/contents/${path}?ref=${sha}`,
    "--jq", ".content",
  ]);

  const decoded = Buffer.from(content.trim().replace(/\n/g, ""), "base64").toString("utf-8");
  cache.set(key, decoded);
  return decoded;
}
