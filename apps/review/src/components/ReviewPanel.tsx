import { apiUrl } from "../api";
import { useState, useEffect } from "react";
import { useStore } from "../store";
import FindingCard from "./FindingCard";
import ChatTab from "./ChatTab";
import type { AgentJob, Finding } from "@reviewradar/shared";

const tabs = [
  { id: "comments" as const, label: "Comments" },
  { id: "analysis" as const, label: "Analysis" },
  { id: "chat" as const, label: "Chat" },
];

const analysisAgentIds = new Set(["bug-hunter", "architecture", "test-coverage"]);

export default function ReviewPanel() {
  const rightTab = useStore((s) => s.rightTab);
  const setRightTab = useStore((s) => s.setRightTab);
  const findings = useStore((s) => s.findings);
  const reviewComments = useStore((s) => s.reviewComments);
  const agentJobs = useStore((s) => s.agentJobs);
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  const filter = useStore((s) => s.findingsFilter);
  const visibleFindings = Array.from(findings.values()).filter(
    (f) => f.status !== "dismissed" && f.confidence >= filter.minConfidence,
  );
  const mainJobs = Array.from(agentJobs.values()).filter((j) => analysisAgentIds.has(j.agentId));
  const hasRunning = mainJobs.some((j) => j.status === "running" || j.status === "starting");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        display: "flex",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-secondary)",
      }}>
        {tabs.map((tab) => {
          const count =
            tab.id === "analysis" ? (hasRunning ? undefined : visibleFindings.length || undefined) :
            tab.id === "comments" ? (reviewComments.size || undefined) :
            undefined;
          const isActive = rightTab === tab.id;
          const isHovered = hoveredTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setRightTab(tab.id)}
              onMouseEnter={() => setHoveredTab(tab.id)}
              onMouseLeave={() => setHoveredTab(null)}
              style={{
                flex: 1,
                padding: "10px 8px",
                border: "none",
                background: isHovered && !isActive ? "rgba(255,255,255,0.03)" : "transparent",
                color: isActive ? "var(--accent)" : "var(--text-secondary)",
                borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
                transition: "background 0.1s, color 0.1s",
              }}
            >
              {tab.label}
              {tab.id === "analysis" && hasRunning && (
                <span style={{ marginLeft: 4, fontSize: 12 }}>{"\u21BB"}</span>
              )}
              {count != null && count > 0 && (
                <span style={{
                  marginLeft: 4,
                  background: "var(--bg-tertiary)",
                  padding: "1px 6px",
                  borderRadius: 8,
                  fontSize: 11,
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {rightTab === "analysis" && <AnalysisPanel />}
        {rightTab === "comments" && <CommentsPanel />}
        {rightTab === "chat" && <ChatTab />}
      </div>
    </div>
  );
}

function AnalysisPanel() {
  const jobs = useStore((s) => s.agentJobs);
  const findings = useStore((s) => s.findings);
  const config = useStore((s) => s.config);
  const updateConfig = useStore((s) => s.updateConfig);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buttonHovered, setButtonHovered] = useState(false);

  const mainJobs = Array.from(jobs.values()).filter((j) => analysisAgentIds.has(j.agentId));
  const allFailed = mainJobs.length > 0 && mainJobs.every((j) => j.status === "failed");
  const showButton = mainJobs.length === 0 || allFailed;

  const allFindings = Array.from(findings.values());
  const dismissed = allFindings.filter((f) => f.status === "dismissed");

  const findingsByAgent = new Map<string, Finding[]>();
  for (const f of allFindings) {
    if (f.status === "dismissed" || f.confidence < config.confidenceThreshold) continue;
    const list = findingsByAgent.get(f.agentId) || [];
    list.push(f);
    findingsByAgent.set(f.agentId, list);
  }

  const sevOrder = { critical: 0, warning: 1, info: 2 };
  for (const list of findingsByAgent.values()) {
    list.sort((a, b) => {
      if (sevOrder[a.severity] !== sevOrder[b.severity]) return sevOrder[a.severity] - sevOrder[b.severity];
      return b.confidence - a.confidence;
    });
  }

  const updateAgentJob = useStore((s) => s.updateAgentJob);

  const startAnalysis = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/agents/start"), { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start");
      const agentsRes = await fetch(apiUrl("/agents"));
      const agents = await agentsRes.json();
      if (Array.isArray(agents)) {
        agents.forEach((j: AgentJob) => updateAgentJob(j));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  if (showButton) {
    return (
      <div style={{ textAlign: "center", paddingTop: mainJobs.length === 0 ? 30 : 12 }}>
        {mainJobs.length === 0 && (
          <div style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
            Run 3 parallel AI agents to analyze this PR for bugs, architecture issues, and test coverage gaps.
          </div>
        )}
        {allFailed && (
          <>
            <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 12 }}>
              All agents failed. Check that <code style={{ fontSize: 11 }}>claude</code> is installed and authenticated.
            </div>
            {mainJobs.map((job) => (
              <AgentJobCard key={job.id} job={job} findings={[]} />
            ))}
          </>
        )}
        <button
          onClick={startAnalysis}
          onMouseEnter={() => setButtonHovered(true)}
          onMouseLeave={() => setButtonHovered(false)}
          disabled={starting}
          style={{
            padding: "8px 20px",
            fontSize: 13,
            fontWeight: 600,
            border: "1px solid var(--accent)",
            background: buttonHovered && !starting ? "var(--accent-bg-hover)" : "var(--accent-bg)",
            color: "var(--accent)",
            borderRadius: 6,
            cursor: starting ? "wait" : "pointer",
            opacity: starting ? 0.6 : 1,
            transition: "background 0.15s",
          }}
        >
          {starting ? "Starting..." : allFailed ? "Retry Analysis" : "\u25B6 Run Analysis"}
        </button>
        {error && (
          <div style={{ color: "var(--red)", fontSize: 12, marginTop: 8 }}>{error}</div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
        <span>Confidence {"\u2265"}{config.confidenceThreshold}%</span>
        <input
          type="range"
          min={0}
          max={100}
          value={config.confidenceThreshold}
          onChange={(e) => updateConfig({ confidenceThreshold: parseInt(e.target.value) })}
          style={{ flex: 1, accentColor: "var(--accent)", height: 4 }}
        />
        {dismissed.length > 0 && <span>{dismissed.length} dismissed</span>}
      </div>
      {mainJobs.map((job) => (
        <AgentJobCard
          key={job.id}
          job={job}
          findings={findingsByAgent.get(job.agentId) || []}
        />
      ))}
    </div>
  );
}

function AgentJobCard({ job, findings }: { job: AgentJob; findings: Finding[] }) {
  const [elapsed, setElapsed] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (job.status !== "running" && job.status !== "starting") {
      if (job.endedAt) {
        const s = Math.round((job.endedAt - job.startedAt) / 1000);
        setElapsed(s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
      }
      return;
    }
    const tick = () => {
      const s = Math.round((Date.now() - job.startedAt) / 1000);
      setElapsed(s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [job.status, job.startedAt, job.endedAt]);

  const statusColor =
    job.status === "done" ? "var(--green)" :
    job.status === "failed" ? "var(--red)" :
    job.status === "running" ? "var(--yellow)" :
    "var(--text-secondary)";

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
          padding: "8px 10px",
          background: hovered ? "var(--bg-tertiary)" : "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: findings.length > 0 && expanded ? "6px 6px 0 0" : 6,
          cursor: "pointer",
          color: "var(--text)",
          fontSize: 13,
          transition: "background 0.1s",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 10,
            transition: "transform 0.15s",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            color: "var(--text-secondary)",
          }}>
            {"\u25B6"}
          </span>
          <span style={{ fontWeight: 600 }}>{job.label}</span>
          {findings.length > 0 && (
            <span style={{
              fontSize: 11,
              color: "var(--text-secondary)",
              background: "var(--bg-tertiary)",
              padding: "0 5px",
              borderRadius: 8,
            }}>
              {findings.length}
            </span>
          )}
        </span>
        <span style={{ color: statusColor, fontSize: 11, fontWeight: 500 }}>
          {job.status === "running" && "\u21BB "}
          {job.status}
          {elapsed && ` \u00b7 ${elapsed}`}
        </span>
      </button>

      {job.status === "running" && job.progress && (
        <div style={{
          fontSize: 11,
          color: "var(--text-secondary)",
          padding: "3px 10px 3px 28px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: "var(--font-mono)",
          background: "var(--bg-secondary)",
          borderLeft: "1px solid var(--border)",
          borderRight: "1px solid var(--border)",
        }}>
          {job.progress}
        </div>
      )}

      {job.status === "failed" && job.error && (
        <div style={{
          fontSize: 11,
          color: "var(--red)",
          padding: "4px 10px 4px 28px",
          wordBreak: "break-word",
          lineHeight: 1.4,
          background: "var(--bg-secondary)",
          borderLeft: "1px solid var(--border)",
          borderRight: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          borderRadius: "0 0 6px 6px",
        }}>
          {job.error.length > 200 ? job.error.slice(0, 200) + "..." : job.error}
        </div>
      )}

      {expanded && findings.length > 0 && (
        <div style={{
          borderLeft: "1px solid var(--border)",
          borderRight: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          borderRadius: "0 0 6px 6px",
          padding: "6px 6px",
        }}>
          {findings.map((f) => <FindingCard key={f.id} finding={f} />)}
        </div>
      )}

      {expanded && job.status === "done" && findings.length === 0 && (
        <div style={{
          fontSize: 12,
          color: "var(--text-secondary)",
          padding: "8px 10px 8px 28px",
          borderLeft: "1px solid var(--border)",
          borderRight: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          borderRadius: "0 0 6px 6px",
          fontStyle: "italic",
        }}>
          No findings above confidence threshold
        </div>
      )}
    </div>
  );
}

function CommentsPanel() {
  const reviewComments = useStore((s) => s.reviewComments);
  const setActiveFile = useStore((s) => s.setActiveFile);
  const files = useStore((s) => s.files);
  const removeReviewComment = useStore((s) => s.removeReviewComment);

  if (reviewComments.size === 0) {
    return (
      <div style={{ color: "var(--text-secondary)", fontSize: 13, textAlign: "center", paddingTop: 40, lineHeight: 1.6 }}>
        Click on any diff line to add a review comment.
        <br /><br />
        <span style={{ fontSize: 12 }}>
          Comments will be posted to GitHub when you submit your review.
        </span>
      </div>
    );
  }

  const typeColor = (type: string) =>
    type === "suggestion" ? "var(--green)" : "var(--accent)";

  return (
    <div>
      <div style={{
        fontSize: 11,
        color: "var(--text-secondary)",
        marginBottom: 8,
        padding: "0 2px",
      }}>
        {reviewComments.size} pending comment{reviewComments.size !== 1 ? "s" : ""} — will be posted on submit
      </div>
      {Array.from(reviewComments.values()).map((c) => {
        const fileIndex = files.findIndex((f) => f.path === c.filePath);
        return (
          <div key={c.id} style={{
            padding: 8,
            marginBottom: 8,
            background: "var(--bg-tertiary)",
            borderRadius: 6,
            fontSize: 13,
            borderLeft: `3px solid ${typeColor(c.type)}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                padding: "1px 5px",
                borderRadius: 2,
                background: typeColor(c.type) + "22",
                color: typeColor(c.type),
              }}>
                {c.type}
              </span>
              <button
                onClick={() => { if (fileIndex >= 0) setActiveFile(fileIndex); }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--accent)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  padding: 0,
                  textDecoration: "underline",
                }}
              >
                {c.filePath.split("/").pop()}:{c.line}
              </button>
              <button
                onClick={() => {
                  fetch(apiUrl(`/comments/${c.id}`), { method: "DELETE" }).catch(console.error);
                  removeReviewComment(c.id);
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  fontSize: 16,
                  padding: "0 2px",
                  marginLeft: "auto",
                  lineHeight: 1,
                }}
              >
                {"\u00d7"}
              </button>
            </div>
            <div style={{ lineHeight: 1.5 }}>{c.body}</div>
          </div>
        );
      })}
    </div>
  );
}

