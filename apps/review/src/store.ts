import { apiUrl } from "./api";
import { create } from "zustand";
import type {
  PRMetadata,
  DiffFile,
  FileGroup,
  Finding,
  ReviewComment,
  AgentJob,
  ChatMessage,
  Verdict,
  Severity,
  ReviewEvent,
  ODRConfig,
} from "@reviewradar/shared";
import { DEFAULT_CONFIG } from "@reviewradar/shared";

interface ODRStore {
  // PR
  pr: PRMetadata | null;
  setPR: (pr: PRMetadata) => void;

  // Diff
  files: DiffFile[];
  rawPatch: string;
  setDiff: (files: DiffFile[], rawPatch: string) => void;

  // Groups
  groups: FileGroup[];
  groupsLoading: boolean;
  groupsReady: boolean;
  setGroups: (groups: FileGroup[], ready?: boolean) => void;

  // Navigation
  activeFileIndex: number;
  activeGroupId: string | null;
  expandedGroups: Set<string>;
  setActiveFile: (index: number) => void;
  toggleGroup: (groupId: string) => void;

  // Findings
  findings: Map<string, Finding>;
  findingsFilter: { minConfidence: number; severities: Severity[] };
  addFinding: (finding: Finding) => void;
  updateFindingScore: (id: string, confidence: number) => void;
  dismissFinding: (id: string, reason?: string) => void;
  acceptFinding: (id: string) => void;

  // Review Comments (draft GitHub review)
  reviewComments: Map<string, ReviewComment>;
  addReviewComment: (c: ReviewComment) => void;
  removeReviewComment: (id: string) => void;

  // Chat
  chatMessages: ChatMessage[];
  chatStreaming: boolean;
  chatThinking: string;
  chatToolActivity: string | null;
  addChatMessage: (msg: ChatMessage) => void;
  appendChatDelta: (delta: string) => void;
  appendChatThinking: (delta: string) => void;
  setChatToolActivity: (toolName: string | null) => void;
  resetChatTransient: () => void;

  // Agents
  agentJobs: Map<string, AgentJob>;
  updateAgentJob: (job: AgentJob) => void;

  // Verdict
  verdict: Verdict | null;
  setVerdict: (v: Verdict) => void;

  // Submit
  submitting: boolean;
  submitted: boolean;
  submitResult: { url: string; commentCount: number } | null;
  submitError: string | null;
  submitReview: (event: ReviewEvent, body: string) => Promise<void>;

  // Config
  config: ODRConfig;
  setConfig: (config: ODRConfig) => void;
  updateConfig: (partial: Partial<ODRConfig>) => Promise<void>;

  // Session
  sessionError: string | null;
  setSessionError: (error: string | null) => void;

  // Viewed files
  viewedFiles: Set<string>;
  toggleFileViewed: (filePath: string) => void;

  // UI
  rightTab: "comments" | "analysis" | "chat";
  setRightTab: (tab: ODRStore["rightTab"]) => void;
  diffViewMode: "unified" | "split";
  setDiffViewMode: (mode: ODRStore["diffViewMode"]) => void;
  showShortcuts: boolean;
  showSettings: boolean;
}

export const useStore = create<ODRStore>((set, get) => ({
  pr: null,
  setPR: (pr) => set({ pr }),

  files: [],
  rawPatch: "",
  setDiff: (files, rawPatch) => set({ files, rawPatch }),

  groups: [],
  groupsLoading: true,
  groupsReady: false,
  setGroups: (groups, ready) => set((s) => ({
    groups,
    groupsLoading: false,
    groupsReady: ready ?? s.groupsReady,
    expandedGroups: s.expandedGroups.size === 0
      ? new Set(groups.map((g) => g.id))
      : s.expandedGroups,
  })),

  activeFileIndex: 0,
  activeGroupId: null,
  expandedGroups: new Set(),
  setActiveFile: (index) => set((s) => {
    const filePath = s.files[index]?.path;
    const group = s.groups.find((g) => g.filePaths.includes(filePath));
    return { activeFileIndex: index, activeGroupId: group?.id ?? null };
  }),
  toggleGroup: (groupId) =>
    set((s) => {
      const next = new Set(s.expandedGroups);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return { expandedGroups: next };
    }),

  findings: new Map(),
  findingsFilter: { minConfidence: 80, severities: ["critical", "warning", "info"] },
  addFinding: (f) =>
    set((s) => {
      const next = new Map(s.findings);
      next.set(f.id, f);
      return { findings: next };
    }),
  updateFindingScore: (id, confidence) =>
    set((s) => {
      const next = new Map(s.findings);
      const f = next.get(id);
      if (f) next.set(id, { ...f, confidence });
      return { findings: next };
    }),
  dismissFinding: (id, reason) =>
    set((s) => {
      const next = new Map(s.findings);
      const f = next.get(id);
      if (f) next.set(id, { ...f, status: "dismissed", dismissReason: reason });
      return { findings: next };
    }),
  acceptFinding: (id) =>
    set((s) => {
      const next = new Map(s.findings);
      const f = next.get(id);
      if (f) next.set(id, { ...f, status: "accepted" });
      return { findings: next };
    }),

  reviewComments: new Map(),
  addReviewComment: (c) =>
    set((s) => {
      const next = new Map(s.reviewComments);
      next.set(c.id, c);
      return { reviewComments: next };
    }),
  removeReviewComment: (id) =>
    set((s) => {
      const next = new Map(s.reviewComments);
      next.delete(id);
      return { reviewComments: next };
    }),

  chatMessages: [],
  chatStreaming: false,
  chatThinking: "",
  chatToolActivity: null,
  addChatMessage: (msg) =>
    set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
  appendChatDelta: (delta) =>
    set((s) => {
      const msgs = [...s.chatMessages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, content: last.content + delta };
      }
      return { chatMessages: msgs };
    }),
  appendChatThinking: (delta) =>
    set((s) => ({ chatThinking: s.chatThinking + delta })),
  setChatToolActivity: (toolName) =>
    set({ chatToolActivity: toolName }),
  resetChatTransient: () =>
    set({ chatThinking: "", chatToolActivity: null }),

  agentJobs: new Map(),
  updateAgentJob: (job) =>
    set((s) => {
      const next = new Map(s.agentJobs);
      next.set(job.id, job);
      return { agentJobs: next };
    }),

  verdict: null,
  setVerdict: (v) => set({ verdict: v }),

  submitting: false,
  submitted: false,
  submitResult: null,
  submitError: null,
  submitReview: async (event, body) => {
    set({ submitting: true, submitError: null });
    try {
      const res = await fetch(apiUrl("/submit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submit failed");
      set({ submitting: false, submitted: true, submitResult: data });
    } catch (err) {
      set({
        submitting: false,
        submitError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  config: { ...DEFAULT_CONFIG },
  setConfig: (config) => {
    applyTheme(config.theme);
    set({ config });
  },
  updateConfig: async (partial) => {
    const current = get().config;
    const merged = {
      ...current,
      ...partial,
      agentModels: { ...current.agentModels, ...(partial.agentModels || {}) },
    };
    applyTheme(merged.theme);
    set({ config: merged });
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
    } catch {}
  },

  sessionError: null,
  setSessionError: (error) => set({ sessionError: error }),

  viewedFiles: new Set(),
  toggleFileViewed: (filePath) =>
    set((s) => {
      const next = new Set(s.viewedFiles);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return { viewedFiles: next };
    }),

  rightTab: "comments",
  setRightTab: (tab) => set({ rightTab: tab }),

  diffViewMode: (localStorage.getItem("review-radar.diffViewMode") as "unified" | "split") || "unified",
  setDiffViewMode: (mode) => {
    localStorage.setItem("review-radar.diffViewMode", mode);
    set({ diffViewMode: mode });
  },

  showShortcuts: false,
  showSettings: false,
}));

function applyTheme(theme: string) {
  const resolved = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : theme;
  document.documentElement.setAttribute("data-theme", resolved);
}
