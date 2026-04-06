import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DiffData, PRMetadata } from "@reviewradar/shared";
import { spawnAgent } from "./agent-orchestrator";
import type { ReviewSession } from "./session";
import { AGENTS_DIR } from "./paths";

function loadPrompt(): string {
  return readFileSync(resolve(AGENTS_DIR, "prompts/chat.md"), "utf-8");
}

function buildChatPrompt(
  pr: PRMetadata,
  diff: DiffData,
  question: string,
  context?: { filePath: string; lineRange: [number, number] },
): string {
  const basePrompt = loadPrompt();

  const prSection = `## PR #${pr.number}: ${pr.title}\n\n**Author**: ${pr.author}\n**Branch**: ${pr.headBranch} -> ${pr.baseBranch}\n\n${pr.body || "(no description)"}`;

  const truncated = diff.rawPatch.length > 80_000
    ? diff.rawPatch.slice(0, 80_000) + "\n\n[... truncated]"
    : diff.rawPatch;
  const diffSection = `## Diff\n\n\`\`\`diff\n${truncated}\n\`\`\``;

  let contextSection = "";
  if (context) {
    const file = diff.files.find((f) => f.path === context.filePath);
    if (file?.patch) {
      contextSection = `\n\n## Context: ${context.filePath} (lines ${context.lineRange[0]}-${context.lineRange[1]})\n\n\`\`\`diff\n${file.patch}\n\`\`\``;
    }
  }

  return `${basePrompt}\n\n${prSection}\n\n${diffSection}${contextSection}\n\n## Question\n\n${question}`;
}

export function startChatSession(
  session: ReviewSession,
  question: string,
  context?: { filePath: string; lineRange: [number, number] },
): string {
  const sessionId = crypto.randomUUID();

  if (!session.pr || !session.diff) {
    session.broadcast({ type: "chat:done", sessionId });
    return sessionId;
  }

  const prompt = buildChatPrompt(session.pr, session.diff, question, context);

  const { result } = spawnAgent(session, {
    agentId: "chat",
    label: `Chat: ${question.slice(0, 40)}`,
    prompt,
    model: session.config.chatModel || "sonnet",
    cwd: session.repoDir || undefined,
    allowedTools: ["WebSearch"],
    includePartialMessages: true,
    onStreamEvent: (event: unknown) => {
      const e = event as Record<string, unknown>;
      if (e.type === "stream_event" && e.event) {
        const inner = e.event as Record<string, unknown>;

        if (inner.type === "content_block_start") {
          const block = inner.content_block as { type?: string; name?: string } | undefined;
          if (block?.type === "tool_use" && block.name) {
            session.broadcast({
              type: "chat:tool_use",
              sessionId,
              toolName: block.name,
            });
          }
        }

        if (inner.type === "content_block_delta") {
          const delta = inner.delta as { type?: string; text?: string; thinking?: string } | undefined;
          if (delta?.type === "text_delta" && delta.text) {
            session.broadcast({
              type: "chat:chunk",
              sessionId,
              delta: delta.text,
            });
          } else if (delta?.type === "thinking_delta" && delta.thinking) {
            session.broadcast({
              type: "chat:thinking",
              sessionId,
              thinking: delta.thinking,
            });
          }
        }
      }
    },
  });

  result.then(() => {
    session.broadcast({ type: "chat:done", sessionId });
  }).catch(() => {
    session.broadcast({ type: "chat:done", sessionId });
  });

  return sessionId;
}
