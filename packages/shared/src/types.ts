export type Severity = "critical" | "warning" | "info";

export type AgentStatus = "starting" | "running" | "done" | "failed" | "killed";

export type DiffType = "pr" | "branch" | "uncommitted";

export type FindingStatus = "pending" | "accepted" | "dismissed";

export type ReviewCommentType = "comment" | "suggestion";

export type GroupCategory =
  | "types"
  | "core"
  | "api"
  | "infra"
  | "tests"
  | "docs"
  | "other";

export type VerdictRecommendation =
  | "approve"
  | "approve-with-nits"
  | "request-changes";

export interface PRMetadata {
  platform: "github" | "gitlab";
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  ciStatus?: "pending" | "success" | "failure";
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  patch: string;
}

export interface DiffData {
  files: DiffFile[];
  rawPatch: string;
  diffType: DiffType;
  baseSha: string;
  headSha: string;
}

export interface FileGroup {
  id: string;
  label: string;
  order: number;
  category: GroupCategory;
  summary: string;
  filePaths: string[];
  reviewed: boolean;
}

export interface Finding {
  id: string;
  agentId: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  severity: Severity;
  confidence: number;
  title: string;
  description: string;
  status: FindingStatus;
  dismissReason?: string;
}

export interface ReviewComment {
  id: string;
  filePath: string;
  line: number;
  endLine?: number;
  side: "RIGHT" | "LEFT";
  type: ReviewCommentType;
  body: string;
  suggestedCode?: string;
  createdAt: number;
}

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface ReviewSubmission {
  event: ReviewEvent;
  body: string;
  comments: ReviewComment[];
}

export interface AgentJob {
  id: string;
  agentId: string;
  label: string;
  status: AgentStatus;
  startedAt: number;
  endedAt?: number;
  findingsCount: number;
  error?: string;
  progress?: string;
}

export interface Verdict {
  recommendation: VerdictRecommendation;
  reasoning: string;
}

export type SSEEvent =
  | { type: "groups:ready"; groups: FileGroup[] }
  | { type: "finding:new"; finding: Finding }
  | { type: "finding:scored"; findingId: string; confidence: number }
  | { type: "agent:status"; job: AgentJob }
  | { type: "verdict:ready"; verdict: Verdict }
  | { type: "chat:chunk"; sessionId: string; delta: string }
  | { type: "chat:done"; sessionId: string }
  | { type: "config:updated"; config: ODRConfig }
  | { type: "session:status"; status: string; error?: string };

export type ModelChoice = "haiku" | "sonnet" | "opus";

export type AgentId = "bug-hunter" | "architecture" | "test-coverage" | "scorer" | "grouper";

export const MODEL_CHOICES: ModelChoice[] = ["haiku", "sonnet", "opus"];

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  context?: {
    filePath: string;
    lineRange: [number, number];
  };
  timestamp: number;
}

export interface ODRConfig {
  theme: "light" | "dark" | "system";
  confidenceThreshold: number;
  chatModel: ModelChoice;
  agentModels: Record<AgentId, ModelChoice>;
}

export const DEFAULT_CONFIG: ODRConfig = {
  theme: "system",
  confidenceThreshold: 80,
  chatModel: "sonnet",
  agentModels: {
    "bug-hunter": "sonnet",
    "architecture": "sonnet",
    "test-coverage": "sonnet",
    "scorer": "haiku",
    "grouper": "haiku",
  },
};
