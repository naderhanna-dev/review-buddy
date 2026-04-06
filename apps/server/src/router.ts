import type { ODRConfig, ReviewComment, ReviewSubmission } from "@reviewradar/shared";
import type { ReviewSessionManager } from "./session-manager";
import type { ReviewSession } from "./session";
import { createSSEStream } from "./sse";
import { runAnalysis } from "./analysis-engine";
import { fetchFileContent } from "./file-content";
import { startChatSession } from "./chat-handler";
import { submitReview } from "./feedback-submitter";
import { mergeConfig, saveConfig } from "./config";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function cors(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

interface ParsedSessionPath {
  owner: string;
  repo: string;
  number: number;
  rest: string;
}

function parseSessionPath(pathname: string): ParsedSessionPath | null {
  const match = pathname.match(/^\/api\/reviews\/([^/]+)\/([^/]+)\/(\d+)(\/.*)?$/);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    number: parseInt(match[3]),
    rest: match[4] || "",
  };
}

export async function handleRequest(
  req: Request,
  sessionManager: ReviewSessionManager,
  startTime: number,
): Promise<Response | null> {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") return cors();

  // ── Top-level routes ──

  if (url.pathname === "/api/health") {
    return json({ ok: true, sessions: sessionManager.size, uptime: Date.now() - startTime });
  }

  if (url.pathname === "/api/reviews" && req.method === "GET") {
    return json(sessionManager.list());
  }

  if (url.pathname === "/api/config") {
    // Global config — shared across sessions
    // We need access to the config, load it fresh for GET
    if (req.method === "GET") {
      const { loadConfig } = await import("./config");
      return json(loadConfig());
    }
    if (req.method === "PUT") {
      const { loadConfig } = await import("./config");
      const current = loadConfig();
      const partial = await req.json() as Partial<ODRConfig>;
      const merged = mergeConfig(current, partial);
      saveConfig(merged);
      return json(merged);
    }
  }

  // ── Session-scoped routes ──

  const parsed = parseSessionPath(url.pathname);
  if (!parsed) return null; // Not an API route — let static serving handle it

  const { owner, repo, number, rest } = parsed;

  // Create session
  if (!rest && req.method === "POST") {
    const session = sessionManager.getOrCreate(owner, repo, number);
    return json({ key: session.key, status: session.status }, 201);
  }

  // Delete session
  if (!rest && req.method === "DELETE") {
    const key = `${owner}/${repo}#${number}`;
    const closed = sessionManager.close(key);
    return closed ? json({ ok: true }) : json({ error: "Session not found" }, 404);
  }

  // All other session routes require the session to exist (auto-create on GET)
  const session = sessionManager.getOrCreate(owner, repo, number);

  return handleSessionRoute(req, session, rest);
}

async function handleSessionRoute(
  req: Request,
  session: ReviewSession,
  rest: string,
): Promise<Response> {
  // Status
  if (rest === "/status" && req.method === "GET") {
    return json({
      key: session.key,
      status: session.status,
      error: session.error,
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
    });
  }

  // SSE — unified event stream
  if (rest === "/events" && req.method === "GET") {
    return createSSEStream(session);
  }

  // PR metadata
  if (rest === "/pr" && req.method === "GET") {
    if (!session.pr) return json({ error: "PR not loaded yet", status: session.status }, 202);
    return json(session.pr);
  }

  // Diff
  if (rest === "/diff" && req.method === "GET") {
    if (!session.diff) return json({ error: "Diff not loaded yet", status: session.status }, 202);
    return json(session.diff);
  }

  // Groups
  if (rest === "/groups" && req.method === "GET") {
    return json({ groups: session.groups, ready: session.groupsReady });
  }

  // Findings
  if (rest === "/findings" && req.method === "GET") {
    return json(Array.from(session.findings.values()));
  }

  // Finding actions
  const findingDismissMatch = rest.match(/^\/findings\/(.+)\/dismiss$/);
  if (findingDismissMatch && req.method === "POST") {
    const id = findingDismissMatch[1];
    const finding = session.findings.get(id);
    if (!finding) return json({ error: "Not found" }, 404);
    const { reason } = await req.json() as { reason?: string };
    finding.status = "dismissed";
    finding.dismissReason = reason;
    return json(finding);
  }

  const findingAcceptMatch = rest.match(/^\/findings\/(.+)\/accept$/);
  if (findingAcceptMatch && req.method === "POST") {
    const id = findingAcceptMatch[1];
    const finding = session.findings.get(id);
    if (!finding) return json({ error: "Not found" }, 404);
    finding.status = "accepted";
    return json(finding);
  }

  // Agents
  if (rest === "/agents" && req.method === "GET") {
    return json(Array.from(session.agentJobs.values()));
  }

  if (rest === "/agents/start" && req.method === "POST") {
    if (!session.diff) return json({ error: "No diff loaded" }, 400);
    const analysisIds = new Set(["bug-hunter", "architecture", "test-coverage"]);
    const running = Array.from(session.agentJobs.values()).some(
      (j) => analysisIds.has(j.agentId) && (j.status === "running" || j.status === "starting"),
    );
    if (running) return json({ error: "Analysis already running" }, 409);

    // Clear previous analysis + scorer jobs
    for (const [id, job] of session.agentJobs) {
      if (analysisIds.has(job.agentId) || job.agentId === "scorer") {
        session.agentJobs.delete(id);
      }
    }
    session.findings.clear();

    runAnalysis(session, session.diff).catch((err) => {
      console.error(`[${session.key}] Analysis failed:`, err);
    });
    return json({ started: true });
  }

  // Comments CRUD
  if (rest === "/comments") {
    if (req.method === "GET") {
      return json(Array.from(session.reviewComments.values()));
    }
    if (req.method === "POST") {
      const body = await req.json() as ReviewComment;
      const comment: ReviewComment = {
        ...body,
        id: body.id || crypto.randomUUID(),
        createdAt: body.createdAt || Date.now(),
      };
      session.reviewComments.set(comment.id, comment);
      return json(comment, 201);
    }
  }

  const commentMatch = rest.match(/^\/comments\/(.+)$/);
  if (commentMatch) {
    const id = commentMatch[1];
    if (req.method === "PUT") {
      const existing = session.reviewComments.get(id);
      if (!existing) return json({ error: "Not found" }, 404);
      const updates = await req.json() as Partial<ReviewComment>;
      const updated = { ...existing, ...updates, id };
      session.reviewComments.set(id, updated);
      return json(updated);
    }
    if (req.method === "DELETE") {
      session.reviewComments.delete(id);
      return json({ ok: true });
    }
  }

  // Submit review to GitHub
  if (rest === "/submit" && req.method === "POST") {
    if (!session.pr) return json({ error: "No PR loaded" }, 400);
    const body = await req.json() as { event: ReviewSubmission["event"]; body: string };
    const comments = Array.from(session.reviewComments.values());
    try {
      const result = await submitReview(session.pr, {
        event: body.event,
        body: body.body,
        comments,
      });
      return json(result);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // File content
  if (rest.startsWith("/file/") && req.method === "GET") {
    if (!session.pr || !session.diff) return json({ error: "No PR loaded" }, 400);
    const filePath = decodeURIComponent(rest.slice("/file/".length));
    try {
      const content = await fetchFileContent(
        session.pr.owner,
        session.pr.repo,
        session.pr.headSha,
        filePath,
      );
      return new Response(content, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch {
      return json({ error: "File not found" }, 404);
    }
  }

  // Chat
  if (rest === "/chat" && req.method === "POST") {
    if (!session.pr || !session.diff) return json({ error: "No PR loaded" }, 400);
    const body = await req.json() as {
      question: string;
      context?: { filePath: string; lineRange: [number, number] };
    };
    if (!body.question?.trim()) return json({ error: "Question required" }, 400);
    const sessionId = startChatSession(session, body.question, body.context);
    return json({ sessionId });
  }

  return json({ error: "Not found" }, 404);
}
