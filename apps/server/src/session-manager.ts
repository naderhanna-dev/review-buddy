import type { ODRConfig } from "@reviewradar/shared";
import { ReviewSession } from "./session";

export interface SessionInfo {
  key: string;
  owner: string;
  repo: string;
  number: number;
  status: string;
  createdAt: number;
  lastAccessedAt: number;
}

const SESSION_TTL = 24 * 60 * 60_000; // 24 hours
const SWEEP_INTERVAL = 5 * 60_000; // 5 minutes

export class ReviewSessionManager {
  private sessions = new Map<string, ReviewSession>();
  private sweepTimer: ReturnType<typeof setInterval>;
  private config: ODRConfig;

  constructor(config: ODRConfig) {
    this.config = config;
    this.sweepTimer = setInterval(() => this.sweepExpired(), SWEEP_INTERVAL);
  }

  static sessionKey(owner: string, repo: string, number: number): string {
    return `${owner}/${repo}#${number}`;
  }

  get(owner: string, repo: string, number: number): ReviewSession | undefined {
    const key = ReviewSessionManager.sessionKey(owner, repo, number);
    const session = this.sessions.get(key);
    if (session) session.touch();
    return session;
  }

  getOrCreate(owner: string, repo: string, number: number): ReviewSession {
    const key = ReviewSessionManager.sessionKey(owner, repo, number);
    const existing = this.sessions.get(key);
    if (existing) {
      existing.touch();
      return existing;
    }

    const session = new ReviewSession(owner, repo, number, this.config);
    this.sessions.set(key, session);

    // Fire and forget — session streams progress via SSE
    session.initialize().catch((err) => {
      console.error(`[${key}] Session initialization failed:`, err);
    });

    return session;
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({
      key: s.key,
      owner: s.owner,
      repo: s.repo,
      number: s.number,
      status: s.status,
      createdAt: s.createdAt,
      lastAccessedAt: s.lastAccessedAt,
    }));
  }

  close(key: string): boolean {
    const session = this.sessions.get(key);
    if (!session) return false;
    session.cleanup();
    this.sessions.delete(key);
    return true;
  }

  closeAll(): void {
    for (const [key, session] of this.sessions) {
      session.cleanup();
    }
    this.sessions.clear();
  }

  dispose(): void {
    clearInterval(this.sweepTimer);
    this.closeAll();
  }

  get size(): number {
    return this.sessions.size;
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (now - session.lastAccessedAt > SESSION_TTL) {
        console.log(`[session] Expiring idle session: ${key}`);
        session.cleanup();
        this.sessions.delete(key);
      }
    }
  }
}
