import { spawn } from "node:child_process";
import type { PRMetadata, ReviewComment, ReviewSubmission } from "@reviewradar/shared";

function exec(cmd: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = cmd;
    const proc = spawn(bin, args, {
      env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` },
    });
    if (stdin) proc.stdin.end(stdin);
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => chunks.push(d));
    proc.stderr.on("data", (d: Buffer) => errChunks.push(d));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`gh failed (${code}): ${Buffer.concat(errChunks).toString().trim()}`));
      } else {
        resolve(Buffer.concat(chunks).toString().trim());
      }
    });
    proc.on("error", reject);
  });
}

function formatCommentBody(comment: ReviewComment): string {
  if (comment.type === "suggestion" && comment.suggestedCode) {
    return `${comment.body}\n\n\`\`\`suggestion\n${comment.suggestedCode}\n\`\`\``;
  }
  return comment.body;
}

export async function submitReview(
  pr: PRMetadata,
  submission: ReviewSubmission,
): Promise<{ url: string; commentCount: number }> {
  const repoArg = `${pr.owner}/${pr.repo}`;

  const payload: Record<string, unknown> = {
    commit_id: pr.headSha,
    event: submission.event,
    body: submission.body || "Review submitted via ReviewRadar",
  };

  if (submission.comments.length > 0) {
    payload.comments = submission.comments.map((c) => {
      const comment: Record<string, unknown> = {
        path: c.filePath,
        body: formatCommentBody(c),
        side: c.side || "RIGHT",
        line: c.endLine && c.endLine !== c.line ? c.endLine : c.line,
      };
      if (c.endLine && c.endLine !== c.line) {
        comment.start_line = c.line;
        comment.start_side = c.side || "RIGHT";
      }
      return comment;
    });
  }

  const json = JSON.stringify(payload);

  const result = await exec([
    "gh", "api",
    "--method", "POST",
    "-H", "Accept: application/vnd.github+json",
    `/repos/${repoArg}/pulls/${pr.number}/reviews`,
    "--input", "-",
  ], json);

  const parsed = JSON.parse(result);
  return {
    url: parsed.html_url || `https://github.com/${repoArg}/pull/${pr.number}`,
    commentCount: submission.comments.length,
  };
}
