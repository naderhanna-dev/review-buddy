import type { PRMetadata, DiffData, ReviewComment, Finding, AgentJob, FileGroup, SSEEvent, ODRConfig } from "@reviewradar/shared";
import { DEFAULT_CONFIG } from "@reviewradar/shared";
import { fetchPRMetadata, fetchPRDiff } from "@reviewradar/shared";
import { computeGroups, buildFallbackGroups } from "./grouping-engine";

export type SessionStatus = "initializing" | "ready" | "error" | "closed";

export class ReviewSession {
  readonly key: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly createdAt: number = Date.now();
  lastAccessedAt: number = Date.now();

  status: SessionStatus = "initializing";
  error?: string;

  pr: PRMetadata | null = null;
  diff: DiffData | null = null;
  groups: FileGroup[] = [];
  groupsReady = false;
  reviewComments = new Map<string, ReviewComment>();
  findings = new Map<string, Finding>();
  agentJobs = new Map<string, AgentJob>();
  sseClients = new Set<ReadableStreamDefaultController>();
  activeProcesses = new Map<string, { proc: { kill(signal?: NodeJS.Signals | number): boolean }; jobId: string }>();
  config: ODRConfig;

  constructor(owner: string, repo: string, number: number, config?: ODRConfig) {
    this.owner = owner;
    this.repo = repo;
    this.number = number;
    this.key = `${owner}/${repo}#${number}`;
    this.config = config ? { ...config } : { ...DEFAULT_CONFIG };
  }

  touch(): void {
    this.lastAccessedAt = Date.now();
  }

  broadcast(event: SSEEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    const encoded = new TextEncoder().encode(data);
    for (const controller of this.sseClients) {
      try {
        controller.enqueue(encoded);
      } catch {
        this.sseClients.delete(controller);
      }
    }
  }

  async initialize(): Promise<void> {
    if (this.status !== "initializing") return;
    try {
      const ref = { owner: this.owner, repo: this.repo, number: this.number };
      const [pr, diff] = await Promise.all([
        fetchPRMetadata(ref),
        fetchPRDiff(ref),
      ]);

      this.pr = pr;
      this.diff = diff;
      this.groups = buildFallbackGroups(diff);
      this.groupsReady = false;
      this.status = "ready";

      this.broadcast({ type: "session:status", status: "ready" });

      // AI grouping in background
      computeGroups(this, diff).then((groups) => {
        this.groups = groups;
        this.groupsReady = true;
      }).catch((err) => {
        console.error(`[${this.key}] Grouping failed, using fallback:`, err.message);
        this.groupsReady = true;
      });
    } catch (err) {
      this.status = "error";
      this.error = err instanceof Error ? err.message : String(err);
      this.broadcast({ type: "session:status", status: "error", error: this.error });
    }
  }

  cleanup(): void {
    for (const [procId, { proc, jobId }] of this.activeProcesses) {
      try {
        proc.kill();
      } catch {}
      const job = this.agentJobs.get(jobId);
      if (job && (job.status === "running" || job.status === "starting")) {
        job.status = "killed" as AgentJob["status"];
        job.endedAt = Date.now();
      }
    }
    this.activeProcesses.clear();

    for (const controller of this.sseClients) {
      try {
        controller.close();
      } catch {}
    }
    this.sseClients.clear();

    this.status = "closed";
  }
}
