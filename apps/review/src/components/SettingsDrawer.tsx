import { useStore } from "../store";
import type { ModelChoice, AgentId } from "@reviewradar/shared";
import { MODEL_CHOICES } from "@reviewradar/shared";

const AGENT_LABELS: Record<AgentId, string> = {
  "bug-hunter": "Bug Hunter",
  "architecture": "Architecture",
  "test-coverage": "Test Coverage",
  "scorer": "Scorer",
  "grouper": "Grouper",
};

const ANALYSIS_AGENTS: AgentId[] = ["bug-hunter", "architecture", "test-coverage"];
const SUPPORT_AGENTS: AgentId[] = ["scorer", "grouper"];

export default function SettingsDrawer() {
  const config = useStore((s) => s.config);
  const updateConfig = useStore((s) => s.updateConfig);
  const close = () => useStore.setState({ showSettings: false });

  const setAgentModel = (id: AgentId, model: ModelChoice) => {
    updateConfig({ agentModels: { [id]: model } as Record<AgentId, ModelChoice> });
  };

  const setAllAnalysisModels = (model: ModelChoice) => {
    const updates: Partial<Record<AgentId, ModelChoice>> = {};
    for (const id of ANALYSIS_AGENTS) updates[id] = model;
    updateConfig({ agentModels: updates as Record<AgentId, ModelChoice> });
  };

  const allSameAnalysis = ANALYSIS_AGENTS.every(
    (id) => config.agentModels[id] === config.agentModels["bug-hunter"],
  );

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 900,
        }}
      />
      {/* Drawer */}
      <div style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 360,
        background: "var(--bg-secondary)",
        borderLeft: "1px solid var(--border)",
        zIndex: 901,
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
      }}>
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Settings</h2>
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

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 24 }}>
          {/* General */}
          <Section title="General">
            <Field label="Theme">
              <Select
                value={config.theme}
                options={[
                  { value: "system", label: "System" },
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                ]}
                onChange={(v) => updateConfig({ theme: v as "light" | "dark" | "system" })}
              />
            </Field>
          </Section>

          {/* Analysis */}
          <Section title="Analysis">
            <Field label="Confidence threshold">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={config.confidenceThreshold}
                  onChange={(e) => updateConfig({ confidenceThreshold: parseInt(e.target.value) })}
                  style={{ flex: 1, accentColor: "var(--accent)" }}
                />
                <span style={{ fontSize: 12, color: "var(--text-secondary)", minWidth: 30, textAlign: "right" }}>
                  {config.confidenceThreshold}
                </span>
              </div>
            </Field>

            <Field label="All analysis agents">
              <Select
                value={allSameAnalysis ? config.agentModels["bug-hunter"] : "mixed"}
                options={[
                  ...MODEL_CHOICES.map((m) => ({ value: m, label: m })),
                  ...(!allSameAnalysis ? [{ value: "mixed", label: "Mixed" }] : []),
                ]}
                onChange={(v) => { if (v !== "mixed") setAllAnalysisModels(v as ModelChoice); }}
              />
            </Field>

            {ANALYSIS_AGENTS.map((id) => (
              <Field key={id} label={AGENT_LABELS[id]} indent>
                <Select
                  value={config.agentModels[id]}
                  options={MODEL_CHOICES.map((m) => ({ value: m, label: m }))}
                  onChange={(v) => setAgentModel(id, v as ModelChoice)}
                />
              </Field>
            ))}

            {SUPPORT_AGENTS.map((id) => (
              <Field key={id} label={AGENT_LABELS[id]}>
                <Select
                  value={config.agentModels[id]}
                  options={MODEL_CHOICES.map((m) => ({ value: m, label: m }))}
                  onChange={(v) => setAgentModel(id, v as ModelChoice)}
                />
              </Field>
            ))}
          </Section>

          {/* Chat */}
          <Section title="Chat">
            <Field label="Model">
              <Select
                value={config.chatModel}
                options={MODEL_CHOICES.map((m) => ({ value: m, label: m }))}
                onChange={(v) => updateConfig({ chatModel: v as ModelChoice })}
              />
            </Field>
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        color: "var(--text-secondary)",
        marginBottom: 10,
      }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children, indent }: { label: string; children: React.ReactNode; indent?: boolean }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingLeft: indent ? 16 : 0,
    }}>
      <label style={{ fontSize: 13, color: indent ? "var(--text-secondary)" : "var(--text)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Select({ value, options, onChange }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "4px 8px",
        fontSize: 12,
        border: "1px solid var(--border)",
        borderRadius: 4,
        background: "var(--bg)",
        color: "var(--text)",
        cursor: "pointer",
        minWidth: 90,
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
