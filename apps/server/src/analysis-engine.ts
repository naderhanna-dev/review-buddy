import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiffData, Finding } from "@reviewradar/shared";
import { spawnAgent } from "./agent-orchestrator";
import type { ReviewSession } from "./session";

const agentsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/agents/src");

interface AnalysisFindings {
  findings: Array<{
    filePath: string;
    lineStart: number;
    lineEnd?: number;
    severity: "critical" | "warning" | "info";
    title: string;
    description: string;
  }>;
}

interface ScoreResult {
  confidence: number;
  reasoning: string;
}

interface AgentDef {
  id: string;
  label: string;
  model: string;
  promptFile: string;
}

const ANALYSIS_AGENTS: AgentDef[] = [
  { id: "bug-hunter", label: "Bug Hunter", model: "sonnet", promptFile: "bug-hunter.md" },
  { id: "architecture", label: "Architecture Reviewer", model: "sonnet", promptFile: "architecture.md" },
  { id: "test-coverage", label: "Test Coverage Analyzer", model: "sonnet", promptFile: "test-coverage.md" },
];

function loadPrompt(filename: string): string {
  try {
    return readFileSync(resolve(agentsDir, "prompts", filename), "utf-8");
  } catch {
    return readFileSync(resolve(process.cwd(), "packages/agents/src/prompts", filename), "utf-8");
  }
}

function loadSchema(filename: string): object {
  try {
    return JSON.parse(readFileSync(resolve(agentsDir, "schemas", filename), "utf-8"));
  } catch {
    return JSON.parse(readFileSync(resolve(process.cwd(), "packages/agents/src/schemas", filename), "utf-8"));
  }
}

function buildAnalysisPrompt(basePrompt: string, diff: DiffData): string {
  const truncated = diff.rawPatch.length > 100_000
    ? diff.rawPatch.slice(0, 100_000) + "\n\n[... truncated]"
    : diff.rawPatch;

  return `${basePrompt}\n\n## Diff\n\n\`\`\`diff\n${truncated}\n\`\`\``;
}

function buildScorerPrompt(basePrompt: string, finding: Finding, diff: DiffData): string {
  const file = diff.files.find((f) => f.path === finding.filePath);
  const patch = file?.patch || "[patch not available]";

  return `${basePrompt}\n\n## Finding\n\n- **Title**: ${finding.title}\n- **Severity**: ${finding.severity}\n- **File**: ${finding.filePath}:${finding.lineStart}${finding.lineEnd ? `-${finding.lineEnd}` : ""}\n- **Description**: ${finding.description}\n\n## Relevant Diff\n\n\`\`\`diff\n${patch}\n\`\`\``;
}

async function scoreFinding(
  session: ReviewSession,
  finding: Finding,
  diff: DiffData,
  scorerPrompt: string,
  scoreSchema: object,
): Promise<void> {
  const prompt = buildScorerPrompt(scorerPrompt, finding, diff);

  const { result } = spawnAgent<ScoreResult>(session, {
    agentId: "scorer",
    label: `Scoring: ${finding.title.slice(0, 40)}`,
    prompt,
    schema: scoreSchema,
    model: session.config.agentModels.scorer || "haiku",
  });

  try {
    const { structuredOutput } = await result;
    if (structuredOutput) {
      finding.confidence = structuredOutput.confidence;
      session.findings.set(finding.id, finding);
      session.broadcast({
        type: "finding:scored",
        findingId: finding.id,
        confidence: structuredOutput.confidence,
      });
    }
  } catch {
    // Scoring failure is non-fatal
  }
}

export async function runAnalysis(session: ReviewSession, diff: DiffData): Promise<void> {
  const findingsSchema = loadSchema("findings.schema.json");
  const scoreSchema = loadSchema("score.schema.json");
  const scorerPrompt = loadPrompt("scorer.md");

  const agentPromises = ANALYSIS_AGENTS.map(async (agentDef) => {
    const basePrompt = loadPrompt(agentDef.promptFile);
    const prompt = buildAnalysisPrompt(basePrompt, diff);

    const { result } = spawnAgent<AnalysisFindings>(session, {
      agentId: agentDef.id,
      label: agentDef.label,
      prompt,
      schema: findingsSchema,
      model: session.config.agentModels[agentDef.id as keyof typeof session.config.agentModels] || agentDef.model,
    });

    try {
      const { structuredOutput } = await result;
      if (!structuredOutput?.findings) return;

      const agentJob = Array.from(session.agentJobs.values()).find(
        (j) => j.agentId === agentDef.id && j.status === "done",
      );
      if (agentJob) {
        agentJob.findingsCount = structuredOutput.findings.length;
        session.agentJobs.set(agentJob.id, { ...agentJob });
        session.broadcast({ type: "agent:status", job: { ...agentJob } });
      }

      const scoringPromises: Promise<void>[] = [];

      for (const raw of structuredOutput.findings) {
        const finding: Finding = {
          id: crypto.randomUUID(),
          agentId: agentDef.id,
          filePath: raw.filePath,
          lineStart: raw.lineStart,
          lineEnd: raw.lineEnd || raw.lineStart,
          severity: raw.severity,
          confidence: 50,
          title: raw.title,
          description: raw.description,
          status: "pending",
        };

        session.findings.set(finding.id, finding);
        session.broadcast({ type: "finding:new", finding });

        scoringPromises.push(scoreFinding(session, finding, diff, scorerPrompt, scoreSchema));
      }

      await Promise.allSettled(scoringPromises);
    } catch (err) {
      console.error(`Analysis agent ${agentDef.id} failed:`, err);
    }
  });

  await Promise.allSettled(agentPromises);
}
