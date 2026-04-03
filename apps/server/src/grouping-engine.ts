import type { FileGroup, DiffData } from "@reviewradar/shared";
import type { ReviewSession } from "./session";
import { spawnAgent } from "./agent-orchestrator";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENTS_DIR } from "./paths";

interface GroupsOutput {
  groups: Array<{
    label: string;
    category: string;
    summary: string;
    filePaths: string[];
  }>;
}

const CATEGORY_ORDER: Record<string, number> = {
  types: 0,
  core: 1,
  api: 2,
  infra: 3,
  tests: 4,
  docs: 5,
  other: 6,
};

function loadGrouperPrompt(): string {
  return readFileSync(resolve(AGENTS_DIR, "prompts/grouper.md"), "utf-8");
}

export function buildFallbackGroups(diff: DiffData): FileGroup[] {
  const groups = new Map<string, FileGroup>();

  for (const file of diff.files) {
    const path = file.path.toLowerCase();
    let category: FileGroup["category"] = "other";

    if (path.includes("test") || path.includes("spec") || path.includes("__tests__")) {
      category = "tests";
    } else if (path.includes("type") || path.includes("model") || path.includes("schema") || path.includes("interface")) {
      category = "types";
    } else if (path.includes("route") || path.includes("controller") || path.includes("endpoint") || path.includes("api")) {
      category = "api";
    } else if (path.includes("readme") || path.includes("doc") || path.includes(".md") || path.includes("config") || path.includes("package.json")) {
      category = "docs";
    } else if (path.includes("docker") || path.includes("ci") || path.includes("deploy") || path.includes("infra") || path.includes("migration")) {
      category = "infra";
    } else {
      category = "core";
    }

    if (!groups.has(category)) {
      groups.set(category, {
        id: crypto.randomUUID(),
        label: category.charAt(0).toUpperCase() + category.slice(1),
        order: CATEGORY_ORDER[category] ?? 99,
        category,
        summary: "",
        filePaths: [],
        reviewed: false,
      });
    }

    groups.get(category)!.filePaths.push(file.path);
  }

  return Array.from(groups.values()).sort((a, b) => a.order - b.order);
}

export async function computeGroups(
  session: ReviewSession,
  diff: DiffData,
): Promise<FileGroup[]> {
  const systemPrompt = loadGrouperPrompt();
  const fileSummary = diff.files
    .map((f) => `${f.status} ${f.path} (+${f.additions}/-${f.deletions})`)
    .join("\n");

  const prompt = `${systemPrompt}\n\n## Changed Files\n\n${fileSummary}\n\n## Diff\n\n\`\`\`\n${diff.rawPatch.slice(0, 50000)}\n\`\`\``;

  const groupsSchema = JSON.parse(readFileSync(resolve(AGENTS_DIR, "schemas/groups.schema.json"), "utf-8"));

  const { result } = spawnAgent<GroupsOutput>(session, {
    agentId: "grouper",
    label: "File Grouper",
    prompt,
    schema: groupsSchema,
    model: session.config.agentModels.grouper || "haiku",
  });

  try {
    const { structuredOutput, exitCode } = await result;

    if (exitCode === 0 && structuredOutput?.groups) {
      const groups: FileGroup[] = structuredOutput.groups.map((g, i) => ({
        id: crypto.randomUUID(),
        label: g.label,
        order: CATEGORY_ORDER[g.category] ?? i,
        category: (g.category as FileGroup["category"]) || "other",
        summary: g.summary,
        filePaths: g.filePaths,
        reviewed: false,
      }));

      groups.sort((a, b) => a.order - b.order);
      session.broadcast({ type: "groups:ready", groups });
      return groups;
    }
  } catch (err) {
    console.error("Grouper agent failed, using fallback:", err);
  }

  const fallback = buildFallbackGroups(diff);
  session.broadcast({ type: "groups:ready", groups: fallback });
  return fallback;
}
