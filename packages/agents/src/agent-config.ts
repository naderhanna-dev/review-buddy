import findingsSchema from "./schemas/findings.schema.json";
import groupsSchema from "./schemas/groups.schema.json";
import scoreSchema from "./schemas/score.schema.json";
import verdictSchema from "./schemas/verdict.schema.json";

export interface AgentDefinition {
  id: string;
  label: string;
  model: string;
  promptFile: string;
  schema?: object;
  phase: "grouping" | "analysis" | "scoring" | "verdict" | "chat";
}

export const AGENTS: AgentDefinition[] = [
  {
    id: "grouper",
    label: "File Grouper",
    model: "sonnet",
    promptFile: "grouper.md",
    schema: groupsSchema,
    phase: "grouping",
  },
  {
    id: "bug-hunter",
    label: "Bug Hunter",
    model: "sonnet",
    promptFile: "bug-hunter.md",
    schema: findingsSchema,
    phase: "analysis",
  },
  {
    id: "architecture",
    label: "Architecture Reviewer",
    model: "sonnet",
    promptFile: "architecture.md",
    schema: findingsSchema,
    phase: "analysis",
  },
  {
    id: "test-coverage",
    label: "Test Coverage Analyzer",
    model: "sonnet",
    promptFile: "test-coverage.md",
    schema: findingsSchema,
    phase: "analysis",
  },
  {
    id: "scorer",
    label: "Finding Scorer",
    model: "haiku",
    promptFile: "scorer.md",
    schema: scoreSchema,
    phase: "scoring",
  },
  {
    id: "chat",
    label: "PR Chat Assistant",
    model: "sonnet",
    promptFile: "chat.md",
    phase: "chat",
  },
];

export function getAgent(id: string): AgentDefinition | undefined {
  return AGENTS.find((a) => a.id === id);
}

export function getAgentsByPhase(phase: AgentDefinition["phase"]): AgentDefinition[] {
  return AGENTS.filter((a) => a.phase === phase);
}

export { findingsSchema, groupsSchema, scoreSchema, verdictSchema };
