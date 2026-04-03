import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import type { AgentJob } from "@reviewradar/shared";
import type { ReviewSession } from "./session";
import { augmentedEnv } from "./paths";

interface AgentSpawnOptions {
  agentId: string;
  label: string;
  prompt: string;
  schema?: object;
  model?: string;
  cwd?: string;
  onStreamEvent?: (event: unknown) => void;
  includePartialMessages?: boolean;
}

interface AgentResult<T = unknown> {
  structuredOutput: T | null;
  rawOutput: string;
  exitCode: number;
}

function findClaude(): string {
  const locations = [
    process.env.CLAUDE_PATH,
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    `${process.env.HOME}/.local/bin/claude`,
    `${process.env.HOME}/.claude/local/claude`,
  ].filter(Boolean) as string[];

  for (const loc of locations) {
    try {
      if (existsSync(loc)) return loc;
    } catch {}
  }

  return "claude";
}

const CLAUDE_BIN = findClaude();

export function spawnAgent<T = unknown>(
  session: ReviewSession,
  options: AgentSpawnOptions,
): { job: AgentJob; result: Promise<AgentResult<T>> } {
  const jobId = crypto.randomUUID();
  const now = Date.now();

  const job: AgentJob = {
    id: jobId,
    agentId: options.agentId,
    label: options.label,
    status: "starting",
    startedAt: now,
    findingsCount: 0,
  };

  session.agentJobs.set(jobId, job);
  session.broadcast({ type: "agent:status", job });

  const args = [
    "--print",
    "--output-format", "stream-json",
    "--verbose",
  ];

  if (options.schema) {
    args.push("--json-schema", JSON.stringify(options.schema));
  }

  if (options.includePartialMessages) {
    args.push("--include-partial-messages");
  }

  if (options.model) {
    args.push("--model", options.model);
  }

  args.push("-p", options.prompt);

  let proc: ChildProcess;
  try {
    proc = spawn(CLAUDE_BIN, args, {
      cwd: options.cwd || process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: augmentedEnv(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[agent:${options.agentId}] spawn failed: ${msg}`);
    job.status = "failed";
    job.endedAt = Date.now();
    job.error = msg;
    session.agentJobs.set(jobId, { ...job });
    session.broadcast({ type: "agent:status", job: { ...job } });
    return {
      job,
      result: Promise.resolve({ structuredOutput: null, rawOutput: "", exitCode: 1 }),
    };
  }

  const procId = crypto.randomUUID();
  session.activeProcesses.set(procId, { proc, jobId });

  const result = new Promise<AgentResult<T>>((resolve) => {
    job.status = "running";
    session.agentJobs.set(jobId, { ...job });
    session.broadcast({ type: "agent:status", job: { ...job } });

    let rawOutput = "";
    let structuredOutput: T | null = null;
    let settled = false;
    const errChunks: Buffer[] = [];

    const rl = createInterface({ input: proc.stdout! });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      rawOutput += line + "\n";

      try {
        const event = JSON.parse(line);

        if (options.onStreamEvent) {
          options.onStreamEvent(event);
        }

        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "tool_use" && block.name) {
              job.progress = `Using ${block.name}`;
              session.agentJobs.set(jobId, { ...job });
              session.broadcast({ type: "agent:status", job: { ...job } });
            } else if (block.type === "text" && block.text) {
              const snippet = block.text.slice(0, 80).replace(/\n/g, " ");
              job.progress = snippet;
              session.agentJobs.set(jobId, { ...job });
              session.broadcast({ type: "agent:status", job: { ...job } });
            }
          }
        }

        if (event.type === "result" && event.structured_output) {
          structuredOutput = event.structured_output as T;
        }
      } catch {
        // Non-JSON line, skip
      }
    });

    proc.stderr?.on("data", (d: Buffer) => errChunks.push(d));

    function settle(exitCode: number, error?: string) {
      if (settled) return;
      settled = true;

      session.activeProcesses.delete(procId);

      // Don't write to a cleaned-up session
      if (session.status === "closed") {
        resolve({ structuredOutput: null, rawOutput, exitCode });
        return;
      }

      job.status = exitCode === 0 ? "done" : "failed";
      job.endedAt = Date.now();
      if (error) job.error = error;
      else if (exitCode !== 0) job.error = Buffer.concat(errChunks).toString().slice(-500);

      session.agentJobs.set(jobId, { ...job });
      session.broadcast({ type: "agent:status", job: { ...job } });

      resolve({ structuredOutput, rawOutput, exitCode });
    }

    proc.on("close", (code) => settle(code ?? 1));
    proc.on("error", (err) => settle(1, err.message));
  });

  return { job, result };
}
