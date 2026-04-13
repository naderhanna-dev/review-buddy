import { useState, useRef, useEffect, useCallback } from "react";
import { useStore } from "../store";
import { apiUrl } from "../api";
import MarkdownMessage from "./MarkdownMessage";

const CHAT_STYLES = `
.rb-chat-panel {
  display: flex; flex-direction: column; height: 100%;
  background: var(--panel-bg);
}
.rb-chat-header {
  padding: 9px 13px; background: var(--blue);
  border-bottom: 2px solid var(--card-border);
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
}
.rb-chat-header-title { font-size: 12px; font-weight: 500; color: #fff; }
.rb-chat-ai-badge {
  font-size: 9px; font-weight: 600; padding: 2px 7px;
  border-radius: 20px; background: var(--yellow); color: var(--text);
  border: 1.5px solid var(--text);
}
.rb-chat-messages {
  flex: 1; overflow-y: auto; padding: 11px;
  display: flex; flex-direction: column; gap: 8px;
}
.rb-chat-msg { max-width: 87%; }
.rb-chat-msg.user { align-self: flex-end; }
.rb-chat-msg.ai { align-self: flex-start; }
.rb-chat-bubble {
  padding: 7px 10px; font-size: 11px; line-height: 1.5;
  border: 1.5px solid var(--card-border); border-radius: 10px;
}
.rb-chat-msg.ai .rb-chat-bubble {
  background: var(--input-bg); color: var(--text);
  border-radius: 2px 10px 10px 10px;
}
.rb-chat-msg.user .rb-chat-bubble {
  background: var(--blue); color: #fff;
  border-radius: 10px 2px 10px 10px;
}
.rb-chat-sender {
  font-size: 9px; color: var(--text); opacity: 0.4;
  margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.05em;
}
.rb-chat-input-area {
  padding: 9px 11px; border-top: 1.5px solid var(--bg-tertiary);
  display: flex; gap: 6px; align-items: center; flex-shrink: 0;
}
.rb-chat-input {
  flex: 1; border: 1.5px solid var(--card-border);
  border-radius: 6px; padding: 6px 9px; font-size: 11px;
  background: var(--input-bg); color: var(--text);
  outline: none; height: 30px; font-family: var(--font-sans);
}
.rb-chat-input:focus { border-color: var(--blue); }
.rb-chat-send {
  width: 30px; height: 30px; border-radius: 6px;
  background: var(--blue); border: 1.5px solid var(--card-border);
  cursor: pointer; display: flex; align-items: center;
  justify-content: center; flex-shrink: 0;
}
.rb-chat-send:hover { opacity: 0.9; }
.rb-chat-send:disabled { opacity: 0.5; cursor: not-allowed; }
`;

export default function ChatPanel() {
  const chatMessages = useStore((s) => s.chatMessages);
  const chatStreaming = useStore((s) => s.chatStreaming);
  const addChatMessage = useStore((s) => s.addChatMessage);

  const [input, setInput] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || chatStreaming) return;

    addChatMessage({ id: crypto.randomUUID(), role: "user", content: text });
    setInput("");

    // Create a placeholder assistant message for streaming
    addChatMessage({ id: crypto.randomUUID(), role: "assistant", content: "" });
    useStore.setState({ chatStreaming: true });

    try {
      await fetch(apiUrl("/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
    } catch {
      useStore.setState({ chatStreaming: false });
    }
  }, [input, chatStreaming, addChatMessage]);

  return (
    <div className="rb-chat-panel">
      <style>{CHAT_STYLES}</style>

      <div className="rb-chat-header">
        <div className="rb-chat-header-title">Ask about this PR</div>
        <div className="rb-chat-ai-badge">AI</div>
      </div>

      <div className="rb-chat-messages" ref={messagesRef}>
        {chatMessages.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", padding: 20 }}>
            Ask anything about this PR...
          </div>
        )}
        {chatMessages.map((msg, i) => (
          <div key={i} className={`rb-chat-msg ${msg.role === "user" ? "user" : "ai"}`}>
            {msg.role === "assistant" && <div className="rb-chat-sender">PR assistant</div>}
            <div className="rb-chat-bubble">
              {msg.role === "assistant" ? (
                msg.content ? (
                  <MarkdownMessage content={msg.content} />
                ) : chatStreaming && i === chatMessages.length - 1 ? (
                  <span style={{ opacity: 0.5 }}>Thinking...</span>
                ) : null
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="rb-chat-input-area">
        <input
          className="rb-chat-input"
          placeholder="Ask anything..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          disabled={chatStreaming}
        />
        <button
          className="rb-chat-send"
          onClick={sendMessage}
          disabled={chatStreaming || !input.trim()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 6h10M6 1l5 5-5 5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
