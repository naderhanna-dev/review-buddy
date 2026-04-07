import { apiUrl } from "../api";
import { useState, useRef, useEffect, useCallback } from "react";
import { useStore } from "../store";
import type { ModelChoice } from "@reviewradar/shared";
import { MODEL_CHOICES } from "@reviewradar/shared";
import MarkdownMessage from "./MarkdownMessage";

export default function ChatTab() {
  const chatMessages = useStore((s) => s.chatMessages);
  const chatStreaming = useStore((s) => s.chatStreaming);
  const addChatMessage = useStore((s) => s.addChatMessage);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [inputHovered, setInputHovered] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const send = async () => {
    const question = input.trim();
    if (!question || chatStreaming) return;

    setInput("");
    setSending(true);

    addChatMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      timestamp: Date.now(),
    });

    // Create placeholder assistant message for streaming
    addChatMessage({
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    });

    useStore.setState({ chatStreaming: true });

    try {
      const res = await fetch(apiUrl("/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Chat request failed");
      }
    } catch (err) {
      // Update the last assistant message with error
      useStore.setState((s) => {
        const msgs = [...s.chatMessages];
        const last = msgs[msgs.length - 1];
        if (last?.role === "assistant" && !last.content) {
          msgs[msgs.length - 1] = {
            ...last,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
        return { chatMessages: msgs };
      });
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (chatMessages.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <div style={{
            color: "var(--text-secondary)",
            fontSize: 13,
            textAlign: "center",
            lineHeight: 1.6,
          }}>
            Ask questions about this PR.
            <br />
            <span style={{ fontSize: 12 }}>
              e.g. "What does this PR change?" or "Are there any missing tests?"
            </span>
          </div>
        </div>
        <ChatInput
          input={input}
          setInput={setInput}
          onKeyDown={onKeyDown}
          send={send}
          disabled={chatStreaming || sending}
          inputRef={inputRef}
          inputHovered={inputHovered}
          setInputHovered={setInputHovered}
        />
      </div>
    );
  }

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      marginLeft: -12,
      marginRight: -12,
      marginBottom: -12,
    }}>
      <div style={{
        flex: 1,
        overflow: "auto",
        padding: "8px 12px",
      }}>
        {chatMessages.map((msg) => (
          <div
            key={msg.id}
            style={{
              marginBottom: 12,
              display: "flex",
              flexDirection: "column",
              alignItems: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div style={{
              maxWidth: "90%",
              padding: "8px 12px",
              borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
              background: msg.role === "user" ? "var(--accent)" : "var(--bg-secondary)",
              color: msg.role === "user" ? "#fff" : "var(--text)",
              fontSize: 13,
              lineHeight: 1.5,
              ...(msg.role === "user" ? { whiteSpace: "pre-wrap" as const } : {}),
              wordBreak: "break-word",
            }}>
              {msg.role === "assistant" && msg.content
                ? <MarkdownMessage content={msg.content} />
                : msg.content || (chatStreaming ? <TypingIndicator /> : "")}
            </div>
          </div>
        ))}
        {chatStreaming && <ChatActivityIndicator />}
        <div ref={bottomRef} />
      </div>
      <ChatInput
        input={input}
        setInput={setInput}
        onKeyDown={onKeyDown}
        send={send}
        disabled={chatStreaming || sending}
        inputRef={inputRef}
        inputHovered={inputHovered}
        setInputHovered={setInputHovered}
      />
    </div>
  );
}

function ChatInput({
  input,
  setInput,
  onKeyDown,
  send,
  disabled,
  inputRef,
  inputHovered,
  setInputHovered,
}: {
  input: string;
  setInput: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  send: () => void;
  disabled: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  inputHovered: boolean;
  setInputHovered: (v: boolean) => void;
}) {
  const chatModel = useStore((s) => s.config.chatModel);
  const updateConfig = useStore((s) => s.updateConfig);
  const [height, setHeight] = useState(96);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startH.current = height;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startY.current - ev.clientY;
      setHeight(Math.max(72, Math.min(400, startH.current + delta)));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [height]);

  return (
    <div style={{
      borderTop: "1px solid var(--border)",
      background: "var(--bg-secondary)",
    }}>
      <div
        onMouseDown={onDragStart}
        style={{
          height: 6,
          cursor: "row-resize",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{
          width: 32,
          height: 3,
          borderRadius: 2,
          background: "var(--border)",
        }} />
      </div>
      <div style={{ padding: "0 12px 0", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Model:</span>
        <select
          value={chatModel}
          onChange={(e) => updateConfig({ chatModel: e.target.value as ModelChoice })}
          style={{
            padding: "2px 6px",
            fontSize: 11,
            border: "1px solid var(--border)",
            borderRadius: 4,
            background: "var(--bg)",
            color: "var(--text-secondary)",
            cursor: "pointer",
          }}
        >
          {MODEL_CHOICES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div style={{ padding: "6px 12px 8px", display: "flex", gap: 8, alignItems: "flex-end" }}>
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask about this PR..."
        disabled={disabled}
        style={{
          flex: 1,
          padding: "8px 10px",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          color: "var(--text)",
          fontSize: 13,
          fontFamily: "inherit",
          resize: "none",
          outline: "none",
          height,
          overflow: "auto",
        }}
      />
      <button
        onClick={send}
        onMouseEnter={() => setInputHovered(true)}
        onMouseLeave={() => setInputHovered(false)}
        disabled={disabled || !input.trim()}
        style={{
          padding: "8px 14px",
          border: "1px solid var(--accent)",
          borderRadius: 8,
          background: inputHovered && !disabled ? "var(--accent-bg-hover)" : "var(--accent-bg)",
          color: "var(--accent)",
          fontSize: 13,
          fontWeight: 600,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled || !input.trim() ? 0.5 : 1,
          transition: "background 0.15s",
          whiteSpace: "nowrap",
        }}
      >
        Send
      </button>
      </div>
    </div>
  );
}

function ChatActivityIndicator() {
  const thinking = useStore((s) => s.chatThinking);
  const toolActivity = useStore((s) => s.chatToolActivity);
  const [expanded, setExpanded] = useState(false);

  if (!thinking && !toolActivity) return null;

  return (
    <div style={{
      fontSize: 12,
      color: "var(--text-secondary)",
      padding: "2px 0 8px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }}>
      {toolActivity ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            display: "inline-block",
            width: 12,
            height: 12,
            border: "2px solid var(--border)",
            borderTopColor: "var(--text-secondary)",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }} />
          <span>
            {toolActivity === "WebSearch" ? "Searching the web..." : `Using ${toolActivity}...`}
          </span>
        </div>
      ) : thinking && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              padding: 0,
              fontSize: 12,
              fontFamily: "inherit",
            }}
          >
            {expanded ? "\u25BE" : "\u25B8"} Thinking...
          </button>
          {expanded && (
            <div style={{
              marginTop: 4,
              padding: "6px 8px",
              background: "var(--bg)",
              borderRadius: 6,
              fontSize: 11,
              maxHeight: 120,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              opacity: 0.7,
              lineHeight: 1.4,
            }}>
              {thinking}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center", height: 16 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "var(--text-secondary)",
            animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`@keyframes pulse { 0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); } 30% { opacity: 1; transform: scale(1); } }`}</style>
    </span>
  );
}
