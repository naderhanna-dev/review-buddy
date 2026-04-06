import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { useHighlightedCode } from "../hooks/useHighlightedCode";

function CodeBlock({ language, code }: { language?: string; code: string }) {
  const html = useHighlightedCode(code, language);

  if (html) {
    return (
      <div
        dangerouslySetInnerHTML={{ __html: html }}
        style={{
          fontSize: 12,
          borderRadius: 6,
          overflow: "auto",
          margin: "6px 0",
        }}
      />
    );
  }

  return (
    <pre style={{
      background: "var(--bg)",
      padding: "8px 10px",
      borderRadius: 6,
      overflow: "auto",
      fontSize: 12,
      margin: "6px 0",
    }}>
      <code>{code}</code>
    </pre>
  );
}

const components: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "");
    const code = String(children).replace(/\n$/, "");

    if (match) {
      return <CodeBlock language={match[1]} code={code} />;
    }

    return (
      <code
        style={{
          background: "var(--bg)",
          padding: "1px 4px",
          borderRadius: 3,
          fontSize: "0.9em",
          fontFamily: "var(--font-mono)",
        }}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <>{children}</>;
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--accent)" }}
      >
        {children}
      </a>
    );
  },
  p({ children }) {
    return <p style={{ margin: "4px 0" }}>{children}</p>;
  },
  ul({ children }) {
    return <ul style={{ margin: "4px 0", paddingLeft: 20 }}>{children}</ul>;
  },
  ol({ children }) {
    return <ol style={{ margin: "4px 0", paddingLeft: 20 }}>{children}</ol>;
  },
  li({ children }) {
    return <li style={{ marginBottom: 2 }}>{children}</li>;
  },
  h1({ children }) {
    return <div style={{ fontWeight: 700, fontSize: 16, margin: "8px 0 4px" }}>{children}</div>;
  },
  h2({ children }) {
    return <div style={{ fontWeight: 700, fontSize: 15, margin: "8px 0 4px" }}>{children}</div>;
  },
  h3({ children }) {
    return <div style={{ fontWeight: 600, fontSize: 14, margin: "6px 0 4px" }}>{children}</div>;
  },
  table({ children }) {
    return (
      <table style={{
        borderCollapse: "collapse",
        fontSize: 12,
        margin: "6px 0",
        width: "100%",
      }}>
        {children}
      </table>
    );
  },
  th({ children }) {
    return (
      <th style={{
        border: "1px solid var(--border)",
        padding: "4px 8px",
        textAlign: "left",
        fontWeight: 600,
        background: "var(--bg)",
      }}>
        {children}
      </th>
    );
  },
  td({ children }) {
    return (
      <td style={{
        border: "1px solid var(--border)",
        padding: "4px 8px",
      }}>
        {children}
      </td>
    );
  },
  blockquote({ children }) {
    return (
      <blockquote style={{
        borderLeft: "3px solid var(--border)",
        paddingLeft: 10,
        margin: "4px 0",
        color: "var(--text-secondary)",
      }}>
        {children}
      </blockquote>
    );
  },
  hr() {
    return <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "8px 0" }} />;
  },
};

export default function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
