import { useEffect, useCallback, useState, useRef } from "react";
import { useStore } from "./store";
import { useSSE } from "./hooks/useSSE";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { apiUrl } from "./api";
import PRBanner from "./components/PRBanner";
import FileTree from "./components/FileTree";
import DiffPane from "./components/DiffPane";
import ReviewPanel from "./components/ReviewPanel";
import VerdictBar from "./components/VerdictBar";
import SettingsDrawer from "./components/SettingsDrawer";
import type { SSEEvent } from "@reviewradar/shared";

function ResizeHandle({ onDrag }: { onDrag: (dx: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const dx = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      onDrag(dx);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        width: 6,
        cursor: "col-resize",
        background: "var(--border)",
        flexShrink: 0,
        position: "relative",
        zIndex: 10,
      }}
    >
      <div style={{
        position: "absolute",
        inset: "0 -4px",
        cursor: "col-resize",
      }}
        onMouseEnter={(e) => {
          const parent = e.currentTarget.parentElement;
          if (parent) parent.style.background = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          if (!dragging.current) {
            const parent = e.currentTarget.parentElement;
            if (parent) parent.style.background = "var(--border)";
          }
        }}
      />
    </div>
  );
}

export default function App() {
  const setPR = useStore((s) => s.setPR);
  const setDiff = useStore((s) => s.setDiff);
  const setGroups = useStore((s) => s.setGroups);
  const addFinding = useStore((s) => s.addFinding);
  const updateFindingScore = useStore((s) => s.updateFindingScore);
  const updateAgentJob = useStore((s) => s.updateAgentJob);
  const appendChatDelta = useStore((s) => s.appendChatDelta);
  const setConfig = useStore((s) => s.setConfig);
  const showShortcuts = useStore((s) => s.showShortcuts);
  const showSettings = useStore((s) => s.showSettings);

  useKeyboardShortcuts();

  const [leftWidth, setLeftWidth] = useState(340);
  const [rightWidth, setRightWidth] = useState(360);

  useEffect(() => {
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
        if (Array.isArray(data)) {
          data.forEach((f: any) => addFinding(f));
        }
      })
      .catch(console.error);

    fetch(apiUrl("/agents"))
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          data.forEach((j: any) => updateAgentJob(j));
        }
      })
      .catch(console.error);

    fetch(apiUrl("/config"))
      .then((r) => r.json())
      .then((data) => { if (data && !data.error) setConfig(data); })
      .catch(console.error);
  }, [setPR, setDiff, setGroups, addFinding, updateAgentJob, setConfig]);

  // Poll for groups until ready
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    let stopped = false;

    interval = setInterval(async () => {
      if (stopped) return;
      try {
        const res = await fetch(apiUrl("/groups"));
        const data = await res.json();
        if (data.groups?.length) {
          setGroups(data.groups, data.ready);
        }
        if (data.ready) {
          stopped = true;
          clearInterval(interval);
        }
      } catch {}
    }, 2000);

    return () => { stopped = true; clearInterval(interval); };
  }, [setGroups]);

  const handleSSE = useCallback((event: unknown) => {
    const e = event as SSEEvent;
    switch (e.type) {
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
      case "chat:done":
        useStore.setState({ chatStreaming: false });
        break;
      case "config:updated":
        setConfig(e.config);
        break;
    }
  }, [setGroups, addFinding, updateFindingScore, updateAgentJob, appendChatDelta, setConfig]);

  useSSE(apiUrl("/events"), handleSSE);

  return (
    <>
      <PRBanner />
      <div style={{
        display: "flex",
        flex: 1,
        overflow: "hidden",
        minHeight: 0,
      }}>
        <div style={{
          width: leftWidth,
          minWidth: 180,
          maxWidth: 600,
          overflow: "auto",
          flexShrink: 0,
        }}>
          <FileTree />
        </div>
        <ResizeHandle onDrag={(dx) => setLeftWidth((w) => Math.max(180, Math.min(600, w + dx)))} />
        <div style={{ flex: 1, overflow: "auto", minWidth: 0 }}>
          <DiffPane />
        </div>
        <ResizeHandle onDrag={(dx) => setRightWidth((w) => Math.max(240, Math.min(700, w - dx)))} />
        <div style={{
          width: rightWidth,
          minWidth: 240,
          maxWidth: 700,
          overflow: "auto",
          flexShrink: 0,
        }}>
          <ReviewPanel />
        </div>
      </div>
      <VerdictBar />
      {showShortcuts && <HelpOverlay />}
      {showSettings && <SettingsDrawer />}
    </>
  );
}

function HelpOverlay() {
  const close = () => useStore.setState({ showShortcuts: false });

  const shortcuts = [
    ["j / k", "Next / previous file"],
    ["1 / 2 / 3", "Comments / Analysis / Chat tab"],
    ["\u2318/Ctrl + Enter", "Add comment"],
    ["Esc", "Cancel / close"],
    ["?", "Toggle this help"],
  ];

  const sectionTitle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 8,
    color: "var(--text)",
  };

  const text: React.CSSProperties = {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
    marginBottom: 6,
  };

  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "24px 32px",
          minWidth: 420,
          maxWidth: 520,
          maxHeight: "80vh",
          overflow: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Help</h2>
          <button
            onClick={close}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--text-secondary)",
              fontSize: 18,
              cursor: "pointer",
              padding: "2px 6px",
              lineHeight: 1,
            }}
          >{"\u2715"}</button>
        </div>

        {/* How to use */}
        <div style={{ marginBottom: 20 }}>
          <div style={sectionTitle}>Getting started</div>
          <p style={text}>
            Browse files in the <strong>left panel</strong>, grouped by type. Click a file to view its diff in the <strong>center panel</strong>.
          </p>
          <p style={text}>
            Use the <strong>right panel</strong> tabs to manage comments, run AI analysis, or ask questions about the PR.
          </p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={sectionTitle}>Review workflow</div>
          <p style={text}><strong>Comments</strong> — Click any diff line to add a review comment. Comments are posted to GitHub when you submit.</p>
          <p style={text}><strong>Analysis</strong> — Click "Run Analysis" to launch AI agents that scan for bugs, architecture issues, and test gaps. Findings are scored by confidence.</p>
          <p style={text}><strong>Chat</strong> — Ask questions about the PR and get streaming AI responses.</p>
          <p style={text}><strong>Submit</strong> — Use the bottom bar to Approve, Comment, or Request Changes. This creates a GitHub PR review.</p>
        </div>

        {/* Shortcuts */}
        <div>
          <div style={sectionTitle}>Keyboard shortcuts</div>
          <table style={{ fontSize: 13, lineHeight: 2, width: "100%" }}>
            <tbody>
              {shortcuts.map(([key, desc]) => (
                <tr key={key}>
                  <td style={{ paddingRight: 20, whiteSpace: "nowrap" }}>
                    <kbd style={{
                      background: "var(--bg-tertiary)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: "2px 8px",
                      fontSize: 12,
                      fontFamily: "var(--font-mono)",
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
