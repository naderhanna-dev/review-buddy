import { useState } from "react";
import { useStore } from "../store";

const BANNER_STYLES = `
.banner-btn {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.banner-btn:hover {
  background: var(--hover-overlay);
  border-color: var(--text-secondary);
  color: var(--text);
}
.banner-btn-done {
  margin-left: auto;
  border: 1px solid var(--red);
  background: var(--red-bg);
  color: var(--red);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 5px 12px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 5px;
  transition: background 0.15s;
}
.banner-btn-done:hover {
  background: var(--red-bg-hover);
}
`;

const CIIcon = ({ status }: { status?: "pending" | "success" | "failure" }) => {
  if (status === "success") return <span style={{ color: "var(--green)", fontSize: 11 }}>{"\u25CF"}</span>;
  if (status === "failure") return <span style={{ color: "var(--red)", fontSize: 11 }}>{"\u25CF"}</span>;
  if (status === "pending") return <span style={{ color: "var(--yellow)", fontSize: 11 }}>{"\u25CF"}</span>;
  return <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{"\u2014"}</span>;
};

export default function PRBanner() {
  const pr = useStore((s) => s.pr);
  const [shutdownState, setShutdownState] = useState<"idle" | "confirming">("idle");

  const handleDoneClick = () => setShutdownState("confirming");
  const handleCancel = () => setShutdownState("idle");
  const handleConfirm = async () => {
    // Close the review session and navigate back to dashboard
    const parts = window.location.pathname.split("/").filter(Boolean);
    const [, owner, repo, number] = parts;
    try {
      await fetch(`/api/reviews/${owner}/${repo}/${number}`, { method: "DELETE" });
    } catch {}
    window.location.href = "/";
  };

  if (!pr) {
    return (
      <div style={{
        padding: "12px 16px",
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border)",
        color: "var(--text-secondary)",
      }}>
        Loading PR...
      </div>
    );
  }

  return (
    <div style={{
      background: "var(--bg-secondary)",
      borderBottom: "1px solid var(--border)",
      padding: "12px 16px",
    }}>
      <style>{BANNER_STYLES}</style>
      {shutdownState === "confirming" && <ConfirmDialog onConfirm={handleConfirm} onCancel={handleCancel} />}

      {/* Row 1: title + done button */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          PR #{pr.number}: {pr.title}
        </span>
        <button
          className="banner-btn-done"
          onClick={handleDoneClick}
          title="End review session"
        >
          Done {"\u2715"}
        </button>
      </div>

      {/* Row 2: meta + branch + buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
        <span style={{ color: "var(--text-secondary)" }}>{pr.author}</span>
        <span style={{ color: "var(--green)" }}>+{pr.additions}</span>
        <span style={{ color: "var(--red)" }}>-{pr.deletions}</span>
        <span style={{ color: "var(--text-secondary)" }}>{pr.changedFiles} files</span>
        <CIIcon status={pr.ciStatus} />
        <span style={{ color: "var(--text-secondary)" }}>
          {pr.baseBranch} {"\u2190"} {pr.headBranch}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <ThemeToggle />
          <SettingsButton />
          <HelpButton />
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div
      onClick={onCancel}
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
          padding: "20px 28px",
          minWidth: 300,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>End review session?</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
          This will close the review session. Any unsaved comments will be lost.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "6px 16px",
              fontSize: 12,
              fontWeight: 600,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-secondary)",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "6px 16px",
              fontSize: 12,
              fontWeight: 600,
              border: "1px solid var(--red)",
              background: "var(--red-bg)",
              color: "var(--red)",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            End review
          </button>
        </div>
      </div>
    </div>
  );
}

function HelpButton() {
  return (
    <button
      className="banner-btn"
      onClick={() => useStore.setState((s) => ({ showShortcuts: !s.showShortcuts }))}
      title="Help"
      style={{ display: "flex", alignItems: "center", gap: 5 }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.92 6.085h.001a.749.749 0 1 1-1.342-.67c.169-.339.436-.62.762-.82a3 3 0 0 1 .924-.407 2.42 2.42 0 0 1 1.748.135 1.91 1.91 0 0 1 .962 1.622v.002a2.14 2.14 0 0 1-.467 1.386c-.245.296-.551.53-.89.691L8 8.347V9.5a.75.75 0 0 1-1.5 0V8a.75.75 0 0 1 .75-.75h.003l.291-.157a.964.964 0 0 0 .39-.318c.12-.163.18-.356.18-.554 0-.193-.08-.378-.227-.5a.736.736 0 0 0-.464-.159.86.86 0 0 0-.625.268ZM8 13.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/>
      </svg>
      Help
    </button>
  );
}

function ThemeToggle() {
  const theme = useStore((s) => s.config.theme);
  const updateConfig = useStore((s) => s.updateConfig);

  const cycle = () => {
    const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
    updateConfig({ theme: next });
  };

  const icon = theme === "dark" ? "\u263E" : theme === "light" ? "\u2600" : "\u25D1";
  const label = theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System";

  return (
    <button
      className="banner-btn"
      onClick={cycle}
      title={`Theme: ${label} (click to cycle)`}
      style={{ display: "flex", alignItems: "center", gap: 5 }}
    >
      {icon} {label}
    </button>
  );
}

function SettingsButton() {
  return (
    <button
      className="banner-btn"
      onClick={() => useStore.setState((s) => ({ showSettings: !s.showSettings }))}
      title="Settings"
      style={{ display: "flex", alignItems: "center", gap: 5 }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294a6.1 6.1 0 0 1 0 .772c-.01.147.04.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.103-.303c-.066-.019-.176-.011-.299.071a5.991 5.991 0 0 1-.668.386c-.133.066-.194.158-.212.224l-.288 1.107c-.17.645-.716 1.195-1.459 1.26a8.094 8.094 0 0 1-1.402 0c-.743-.065-1.289-.615-1.459-1.26l-.288-1.107a.352.352 0 0 0-.212-.224 5.994 5.994 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.049-.048.098-.147.088-.294a6.1 6.1 0 0 1 0-.772c.01-.147-.04-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.103.303c.066.019.176.011.299-.071.214-.143.437-.272.668-.386a.352.352 0 0 0 .212-.224l.288-1.107C5.9.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.046-.219.31-.41.641-.573.989-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.588 4.588 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.08.08-.073.159-.059.19.162.348.354.68.573.989.02.03.085.076.195.046l1.103-.303c.559-.153 1.112-.008 1.529.27.16.107.327.204.5.29.449.222.851.628.998 1.189l.289 1.105c.029.11.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.175-.016.195-.046.219-.31.41-.641.573-.989.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.6 4.6 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.08-.08.073-.159.059-.19a6.3 6.3 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.103.303c-.559.153-1.112.008-1.529-.27a4.4 4.4 0 0 0-.5-.29c-.449-.222-.851-.628-.998-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z"/>
      </svg>
      Settings
    </button>
  );
}
