import { useEffect, useCallback, useState } from "react";
import { useStore } from "./store";
import { useSSE } from "./hooks/useSSE";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { apiUrl } from "./api";
import FileTree from "./components/FileTree";
import CardStack from "./components/CardStack";
import ChatPanel from "./components/ChatPanel";
import BottomSheet from "./components/BottomSheet";
import VerdictBar from "./components/VerdictBar";
import SettingsDrawer from "./components/SettingsDrawer";
import type { SSEEvent } from "@reviewradar/shared";

// --- Injected styles for the new layout ---

const LAYOUT_STYLES = `
/* ── Shell ── */
.rb-shell {
  display: flex; flex-direction: column; height: 100vh;
  background: var(--background); color: var(--text);
  font-family: var(--font-sans);
}

/* ── Top bar ── */
.rb-topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; background: var(--topbar-bg);
  border-bottom: 2.5px solid var(--card-border);
  flex-shrink: 0;
}
.rb-pr-badge {
  font-size: 10px; font-weight: 500; padding: 3px 9px;
  border-radius: 20px; background: var(--yellow); color: var(--text);
  flex-shrink: 0;
}
.rb-pr-title { font-size: 13px; font-weight: 500; color: var(--topbar-text); }
.rb-pr-sub { font-size: 10px; color: var(--muted); }
.rb-progress-bar {
  width: 80px; height: 5px; background: #333;
  border-radius: 3px; overflow: hidden; border: 1px solid #444;
}
.rb-progress-fill { height: 100%; background: var(--green); transition: width 0.3s ease; }
.rb-progress-label { font-size: 10px; color: var(--muted); white-space: nowrap; }

/* ── Desktop body ── */
.rb-body { display: flex; flex: 1; overflow: hidden; min-height: 0; }

/* ── Left panel ── */
.rb-left-panel {
  width: 220px; flex-shrink: 0; background: var(--panel-bg);
  border-right: 2px solid var(--card-border);
  display: flex; flex-direction: column; overflow: hidden;
}
.rb-ai-summary {
  padding: 11px 13px; border-bottom: 1.5px solid var(--bg-tertiary);
}
.rb-ai-tag {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10px; font-weight: 500; color: var(--text);
  background: var(--yellow); padding: 3px 8px; border-radius: 20px;
  margin-bottom: 7px; border: 1.5px solid var(--text);
}
.rb-change-desc {
  font-size: 11px; color: var(--text); line-height: 1.6; opacity: 0.7;
}

/* ── Center stack area ── */
.rb-stack-area {
  flex: 1; min-width: 0; background: var(--bg-tertiary);
  display: flex; flex-direction: column; overflow: hidden;
}

/* ── Right chat panel (desktop) ── */
.rb-right-panel {
  width: 260px; flex-shrink: 0;
  border-left: 2px solid var(--card-border);
  overflow: hidden;
}

/* ── Icon button ── */
.rb-icon-btn {
  width: 32px; height: 32px; border-radius: 7px;
  border: 1.5px solid #444; background: #2a2a2a;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
}
.rb-icon-btn svg { width: 14px; height: 14px; stroke: var(--topbar-text); fill: none; stroke-width: 1.8; }
.rb-icon-btn.chat-btn { background: var(--blue); border-color: var(--blue); }

/* ── Mobile ── */
@media (max-width: 768px) {
  .rb-left-panel { display: none; }
  .rb-right-panel { display: none; }
  .rb-topbar { padding: 10px 12px; }
  .rb-pr-title { font-size: 12px; }
  .rb-progress-bar { display: none; }
}

/* ── Mobile sidebar ── */
.rb-mobile-sidebar {
  width: 0; overflow: hidden; background: var(--panel-bg);
  border-right: 2px solid var(--card-border);
  transition: width 0.2s ease; flex-shrink: 0;
}
.rb-mobile-sidebar.open { width: 200px; }
.rb-mobile-sidebar-inner { width: 200px; overflow-y: auto; height: 100%; }

/* ── Mobile chat ── */
.rb-mobile-chat {
  width: 0; overflow: hidden; background: var(--panel-bg);
  border-left: 2px solid var(--card-border);
  transition: width 0.2s ease; flex-shrink: 0;
}
.rb-mobile-chat.open { width: 220px; }
.rb-mobile-chat-inner { width: 220px; height: 100%; }

/* ── Mobile toggle buttons ── */
.rb-mobile-toggles { display: none; }
@media (max-width: 768px) {
  .rb-mobile-toggles { display: flex; }
  .rb-mobile-sidebar { display: flex; }
  .rb-mobile-chat { display: flex; }
  .rb-desktop-only { display: none !important; }
}
@media (min-width: 769px) {
  .rb-mobile-sidebar { display: none; }
  .rb-mobile-chat { display: none; }
  .rb-mobile-only { display: none !important; }
}
`;

// --- Top Bar ---

function TopBar() {
  const pr = useStore((s) => s.pr);
  const files = useStore((s) => s.files);
  const fileVerdicts = useStore((s) => s.fileVerdicts);
  const toggleMobileSidebar = useStore((s) => s.toggleMobileSidebar);
  const toggleMobileChat = useStore((s) => s.toggleMobileChat);

  const reviewed = fileVerdicts.size;
  const total = files.length;
  const pct = total > 0 ? (reviewed / total) * 100 : 0;

  return (
    <div className="rb-topbar">
      {/* Mobile: hamburger */}
      <button className="rb-icon-btn rb-mobile-toggles" onClick={toggleMobileSidebar}>
        <svg viewBox="0 0 14 14">
          <line x1="1" y1="3.5" x2="13" y2="3.5" strokeLinecap="round" />
          <line x1="1" y1="7" x2="13" y2="7" strokeLinecap="round" />
          <line x1="1" y1="10.5" x2="13" y2="10.5" strokeLinecap="round" />
        </svg>
      </button>

      {/* PR info */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {pr && <span className="rb-pr-badge">PR #{pr.number}</span>}
        <div style={{ minWidth: 0 }}>
          <div className="rb-pr-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pr?.title || "Loading..."}
          </div>
          {pr && (
            <div className="rb-pr-sub">
              @{pr.author} · {pr.changedFiles} files changed
            </div>
          )}
        </div>
      </div>

      {/* Progress */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <div className="rb-progress-bar">
          <div className="rb-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="rb-progress-label">{reviewed} / {total}</span>

        {/* Mobile: chat toggle */}
        <button className="rb-icon-btn chat-btn rb-mobile-toggles" onClick={toggleMobileChat}>
          <svg viewBox="0 0 14 14">
            <path d="M1 1h12v9H8l-3 3V10H1z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// --- AI Summary panel section ---

function AISummary() {
  const pr = useStore((s) => s.pr);
  const groups = useStore((s) => s.groups);

  // Derive summary from first group or PR body
  const summary = groups.length > 0
    ? groups.map((g) => g.summary).filter(Boolean).join(" ")
    : pr?.body?.slice(0, 200) || "Analyzing PR...";

  return (
    <div className="rb-ai-summary">
      <div className="rb-ai-tag">
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "var(--text)", display: "inline-block",
        }} />
        AI summary
      </div>
      <div className="rb-change-desc">
        {summary.length > 200 ? summary.slice(0, 200) + "..." : summary}
      </div>
    </div>
  );
}

// --- Main App ---

export default function App() {
  const setPR = useStore((s) => s.setPR);
  const setDiff = useStore((s) => s.setDiff);
  const setGroups = useStore((s) => s.setGroups);
  const addFinding = useStore((s) => s.addFinding);
  const addReviewComment = useStore((s) => s.addReviewComment);
  const sessionError = useStore((s) => s.sessionError);
  const setSessionError = useStore((s) => s.setSessionError);
  const updateFindingScore = useStore((s) => s.updateFindingScore);
  const updateAgentJob = useStore((s) => s.updateAgentJob);
  const appendChatDelta = useStore((s) => s.appendChatDelta);
  const setConfig = useStore((s) => s.setConfig);
  const showShortcuts = useStore((s) => s.showShortcuts);
  const showSettings = useStore((s) => s.showSettings);
  const mobileSidebarOpen = useStore((s) => s.mobileSidebarOpen);
  const mobileChatOpen = useStore((s) => s.mobileChatOpen);

  useKeyboardShortcuts();

  // Fetch all session data on mount
  const fetchSessionData = useCallback(() => {
    fetch(apiUrl("/pr"))
      .then((r) => r.json())
      .then((data) => { if (!data.error) setPR(data); })
      .catch(console.error);

    fetch(apiUrl("/diff"))
      .then((r) => r.json())
      .then((data) => { if (!data.error) setDiff(data.files, data.rawPatch); })
      .catch(console.error);

    fetch(apiUrl("/groups"))
      .then((r) => r.json())
      .then((data) => {
        if (data.groups?.length) setGroups(data.groups, data.ready);
      })
      .catch(console.error);

    fetch(apiUrl("/findings"))
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) data.forEach((f: any) => addFinding(f));
      })
      .catch(console.error);

    fetch(apiUrl("/comments"))
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) data.forEach((c: any) => addReviewComment(c));
      })
      .catch(console.error);

    fetch(apiUrl("/agents"))
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) data.forEach((j: any) => updateAgentJob(j));
      })
      .catch(console.error);

    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => { if (data && !data.error) setConfig(data); })
      .catch(console.error);
  }, [setPR, setDiff, setGroups, addFinding, addReviewComment, updateAgentJob, setConfig]);

  useEffect(() => {
    fetchSessionData();
  }, [fetchSessionData]);

  // Poll for groups until ready
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    let stopped = false;
    interval = setInterval(async () => {
      if (stopped) return;
      try {
        const res = await fetch(apiUrl("/groups"));
        const data = await res.json();
        if (data.groups?.length) setGroups(data.groups, data.ready);
        if (data.ready) { stopped = true; clearInterval(interval); }
      } catch {}
    }, 2000);
    return () => { stopped = true; clearInterval(interval); };
  }, [setGroups]);

  // SSE handler
  const handleSSE = useCallback((event: unknown) => {
    const e = event as SSEEvent;
    switch (e.type) {
      case "session:status":
        if (e.status === "ready") fetchSessionData();
        if (e.status === "error") setSessionError(e.error || "Session failed to initialize");
        break;
      case "groups:ready":
        setGroups(e.groups, true);
        break;
      case "finding:new":
        addFinding(e.finding);
        break;
      case "finding:scored":
        updateFindingScore(e.findingId, e.confidence);
        break;
      case "agent:status":
        updateAgentJob(e.job);
        break;
      case "chat:chunk":
        appendChatDelta(e.delta);
        break;
      case "chat:thinking":
        useStore.getState().appendChatThinking(e.thinking);
        break;
      case "chat:tool_use":
        useStore.getState().setChatToolActivity(e.toolName);
        break;
      case "chat:done":
        useStore.setState({ chatStreaming: false });
        useStore.getState().resetChatTransient();
        break;
      case "config:updated":
        setConfig(e.config);
        break;
    }
  }, [fetchSessionData, setSessionError, setGroups, addFinding, updateFindingScore, updateAgentJob, appendChatDelta, setConfig]);

  useSSE(apiUrl("/events"), handleSSE);

  if (sessionError) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", flexDirection: "column", gap: 12, padding: 40,
        background: "var(--background)",
      }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: "var(--red)" }}>Session failed</div>
        <div style={{ fontSize: 14, color: "var(--text-secondary)", textAlign: "center", maxWidth: 500, lineHeight: 1.6 }}>
          {sessionError}
        </div>
        <a href="/" style={{
          marginTop: 12, padding: "8px 20px", borderRadius: 6,
          border: "2px solid var(--card-border)", color: "var(--text)",
          textDecoration: "none", fontSize: 13,
        }}>Back to dashboard</a>
      </div>
    );
  }

  return (
    <div className="rb-shell">
      <style>{LAYOUT_STYLES}</style>
      <TopBar />

      <div className="rb-body">
        {/* Desktop left panel */}
        <div className="rb-left-panel desktop-only">
          <AISummary />
          <div style={{ padding: "7px 12px 3px", borderBottom: "1px solid var(--bg-tertiary)" }}>
            <div style={{
              fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em",
              color: "var(--text)", fontWeight: 500, opacity: 0.45,
            }}>
              Change explorer
            </div>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            <FileTree />
          </div>
        </div>

        {/* Mobile sidebar (slide-out) */}
        <div className={`rb-mobile-sidebar rb-mobile-only ${mobileSidebarOpen ? "open" : ""}`}>
          <div className="rb-mobile-sidebar-inner">
            <div style={{ padding: "7px 12px 3px" }}>
              <div style={{
                fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em",
                color: "var(--text)", fontWeight: 500, opacity: 0.45,
              }}>
                Change explorer
              </div>
            </div>
            <FileTree />
          </div>
        </div>

        {/* Center: card stack */}
        <div className="rb-stack-area">
          <CardStack />
        </div>

        {/* Desktop right panel: chat */}
        <div className="rb-right-panel desktop-only">
          <ChatPanel />
        </div>

        {/* Mobile chat (slide-out) */}
        <div className={`rb-mobile-chat rb-mobile-only ${mobileChatOpen ? "open" : ""}`}>
          <div className="rb-mobile-chat-inner">
            <ChatPanel />
          </div>
        </div>
      </div>

      <VerdictBar />
      <BottomSheet />
      {showShortcuts && <HelpOverlay />}
      {showSettings && <SettingsDrawer />}
    </div>
  );
}

// --- Help overlay ---

function HelpOverlay() {
  const close = () => useStore.setState({ showShortcuts: false });

  const shortcuts = [
    ["j / k", "Next / previous file"],
    ["1 / 2 / 3", "Comments / Analysis / Chat tab"],
    ["\u2318/Ctrl + Enter", "Add comment"],
    ["Esc", "Cancel / close"],
    ["?", "Toggle this help"],
  ];

  return (
    <div
      onClick={close}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-secondary)",
          border: "2px solid var(--card-border)",
          borderRadius: 12,
          padding: "24px 32px",
          minWidth: 420, maxWidth: 520, maxHeight: "80vh", overflow: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Help</h2>
          <button
            onClick={close}
            style={{
              border: "none", background: "transparent",
              color: "var(--text-secondary)", fontSize: 18,
              cursor: "pointer", padding: "2px 6px", lineHeight: 1,
            }}
          >{"\u2715"}</button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Getting started</div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 6 }}>
            Swipe through files in the <strong>card stack</strong> — swipe right or tap the green button to approve, left or red to request changes.
          </p>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 6 }}>
            Tap any diff line to leave a comment. Use the <strong>chat panel</strong> to ask AI about the PR.
          </p>
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Keyboard shortcuts</div>
          <table style={{ fontSize: 13, lineHeight: 2, width: "100%" }}>
            <tbody>
              {shortcuts.map(([key, desc]) => (
                <tr key={key}>
                  <td style={{ paddingRight: 20, whiteSpace: "nowrap" }}>
                    <kbd style={{
                      background: "var(--bg-tertiary)",
                      border: "1px solid var(--card-border)",
                      borderRadius: 4, padding: "2px 8px",
                      fontSize: 12, fontFamily: "var(--font-mono)",
                    }}>{key}</kbd>
                  </td>
                  <td style={{ color: "var(--text-secondary)" }}>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
