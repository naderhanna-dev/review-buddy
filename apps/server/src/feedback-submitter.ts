import type { PRMetadata, ReviewComment, ReviewSubmission } from "@reviewradar/shared";
import { spawnExec } from "./paths";

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

  const result = await spawnExec([
    "gh", "api",
    "--method", "POST",
    "-H", "Accept: application/vnd.github+json",
    `/repos/${repoArg}/pulls/${pr.number}/reviews`,
    "--input", "-",
  ], { stdin: json });

  const parsed = JSON.parse(result);
  return {
    url: parsed.html_url || `https://github.com/${repoArg}/pull/${pr.number}`,
    commentCount: submission.comments.length,
  };
}
