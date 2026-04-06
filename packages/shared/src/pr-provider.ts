import { spawn } from "node:child_process";
import type { PRMetadata, DiffData, DiffFile } from "./types";

interface PRRef {
  owner: string;
  repo: string;
  number: number;
}

export function parsePRRef(input: string): PRRef | null {
  const urlMatch = input.match(
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/
  );
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2], number: parseInt(urlMatch[3]) };
  }

  const numMatch = input.match(/^#?(\d+)$/);
  if (numMatch) {
    return { owner: "", repo: "", number: parseInt(numMatch[1]) };
  }

  return null;
}

function exec(cmd: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = cmd;
    const proc = spawn(bin, args, {
      env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` },
    });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => chunks.push(d));
    proc.stderr.on("data", (d: Buffer) => errChunks.push(d));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed (${code}): ${cmd.join(" ")}\n${Buffer.concat(errChunks).toString()}`));
      } else {
        resolve(Buffer.concat(chunks).toString().trim());
      }
    });
    proc.on("error", reject);
  });
}

export async function fetchPRMetadata(ref: PRRef): Promise<PRMetadata> {
  const prArg = ref.owner
    ? `--repo ${ref.owner}/${ref.repo}`
    : "";

  const json = await exec([
    "gh", "pr", "view", String(ref.number),
    ...prArg.split(" ").filter(Boolean),
    "--json",
    "title,body,author,headRefName,baseRefName,headRefOid,additions,deletions,changedFiles,labels,state",
  ]);

  const pr = JSON.parse(json);

  let ciStatus: PRMetadata["ciStatus"];
  try {
    const checksJson = await exec([
      "gh", "pr", "checks", String(ref.number),
      ...prArg.split(" ").filter(Boolean),
      "--json", "state",
    ]);
    const checks = JSON.parse(checksJson);
    const states = checks.map((c: { state: string }) => c.state);
    if (states.some((s: string) => s === "FAILURE")) ciStatus = "failure";
    else if (states.some((s: string) => s === "PENDING")) ciStatus = "pending";
    else ciStatus = "success";
  } catch {
    ciStatus = undefined;
  }

  const remote = ref.owner
    ? { owner: ref.owner, repo: ref.repo }
    : await detectRemote();

  return {
    platform: "github",
    owner: remote.owner,
    repo: remote.repo,
    number: ref.number,
    title: pr.title,
    body: pr.body || "",
    author: pr.author?.login || "unknown",
    baseBranch: pr.baseRefName,
    headBranch: pr.headRefName,
    headSha: pr.headRefOid,
    ciStatus,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    labels: (pr.labels || []).map((l: { name: string }) => l.name),
  };
}

export async function fetchPRDiff(ref: PRRef): Promise<DiffData> {
  const prArg = ref.owner
    ? `--repo ${ref.owner}/${ref.repo}`
    : "";

  const rawPatch = await exec([
    "gh", "pr", "diff", String(ref.number),
    ...prArg.split(" ").filter(Boolean),
  ]);

  const metaJson = await exec([
    "gh", "pr", "view", String(ref.number),
    ...prArg.split(" ").filter(Boolean),
    "--json", "baseRefName,headRefName,headRefOid,commits",
  ]);
  const meta = JSON.parse(metaJson);

  const files = parsePatch(rawPatch);

  return {
    files,
    rawPatch,
    diffType: "pr",
    baseSha: meta.baseRefName,
    headSha: meta.headRefOid,
  };
}

export async function detectCurrentPR(): Promise<PRRef | null> {
  try {
    const json = await exec(["gh", "pr", "view", "--json", "number"]);
    const { number } = JSON.parse(json);
    const remote = await detectRemote();
    return { ...remote, number };
  } catch {
    return null;
  }
}

async function detectRemote(): Promise<{ owner: string; repo: string }> {
  const url = await exec(["git", "remote", "get-url", "origin"]);
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) throw new Error(`Cannot parse GitHub remote from: ${url}`);
  return { owner: match[1], repo: match[2] };
}

function parsePatch(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  const fileChunks = patch.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const headerMatch = chunk.match(/^a\/(.+?) b\/(.+?)$/m);
    if (!headerMatch) continue;

    const oldPath = headerMatch[1];
    const newPath = headerMatch[2];

    let status: DiffFile["status"] = "modified";
    if (chunk.includes("new file mode")) status = "added";
    else if (chunk.includes("deleted file mode")) status = "deleted";
    else if (chunk.includes("rename from")) status = "renamed";

    let additions = 0;
    let deletions = 0;
    for (const line of chunk.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }

    files.push({
      path: newPath,
      oldPath: status === "renamed" ? oldPath : undefined,
      status,
      additions,
      deletions,
      patch: "diff --git " + chunk,
    });
  }

  return files;
}
