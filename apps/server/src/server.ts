import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { readFileSync, existsSync, statSync } from "node:fs";
import type { ReviewSessionManager } from "./session-manager";
import { handleRequest } from "./router";

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
};

export interface ServerOptions {
  port: number;
  host: string;
  sessionManager: ReviewSessionManager;
  webDistDir: string;
  reviewDistDir: string;
}

function serveStaticFile(distDir: string, filePath: string, res: ServerResponse): boolean {
  const fullPath = resolve(distDir, filePath);
  // Prevent directory traversal
  if (!fullPath.startsWith(distDir)) return false;
  try {
    if (!existsSync(fullPath) || statSync(fullPath).isDirectory()) return false;
    const ext = fullPath.substring(fullPath.lastIndexOf("."));
    const content = readFileSync(fullPath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

function serveHTML(distDir: string, res: ServerResponse): boolean {
  const indexPath = resolve(distDir, "index.html");
  try {
    const html = readFileSync(indexPath, "utf-8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return true;
  } catch {
    return false;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

export function createServer(options: ServerOptions) {
  const { port, host, sessionManager, webDistDir, reviewDistDir } = options;
  const startTime = Date.now();

  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const pathname = url.pathname;
    const method = req.method || "GET";

    // Convert IncomingMessage to a minimal Request-like for the router
    if (pathname.startsWith("/api/") || method === "OPTIONS") {
      const body = ["POST", "PUT", "PATCH"].includes(method) ? await readBody(req) : undefined;
      const request = new Request(url.toString(), {
        method,
        headers: Object.fromEntries(
          Object.entries(req.headers)
            .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        ),
        body,
      });

      let response: Response | null;
      try {
        response = await handleRequest(request, sessionManager, startTime);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ error: msg }));
        return;
      }
      if (response) {
        // Check if it's an SSE response
        const contentType = response.headers.get("Content-Type");
        if (contentType === "text/event-stream") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
          });

          // Stream the response body
          const reader = response.body?.getReader();
          if (reader) {
            const pump = async () => {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
              }
              res.end();
            };
            req.on("close", () => reader.cancel());
            pump().catch(() => res.end());
          } else {
            res.end();
          }
          return;
        }

        // Regular response
        const responseBody = await response.text();
        const headers: Record<string, string> = {};
        response.headers.forEach((v, k) => { headers[k] = v; });
        res.writeHead(response.status, headers);
        res.end(responseBody);
        return;
      }
    }

    // ── Review app static assets ──
    if (pathname.startsWith("/review/assets/")) {
      const assetPath = pathname.slice("/review/".length);
      if (serveStaticFile(reviewDistDir, assetPath, res)) return;
    }

    // ── Review app SPA fallback ──
    if (pathname.match(/^\/review\/[^.]+/)) {
      if (serveHTML(reviewDistDir, res)) return;
      res.writeHead(503);
      res.end("Review app not built");
      return;
    }

    // ── Dashboard static assets ──
    if (pathname.startsWith("/assets/")) {
      if (serveStaticFile(webDistDir, pathname.slice(1), res)) return;
    }

    // ── Dashboard SPA fallback ──
    if (pathname === "/" || (!pathname.startsWith("/api/") && !pathname.includes("."))) {
      if (serveHTML(webDistDir, res)) return;
      res.writeHead(503);
      res.end("Dashboard not built");
      return;
    }

    // Fallback: try serving as static file from web dist
    if (serveStaticFile(webDistDir, pathname.slice(1), res)) return;

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(port, host);
  return server;
}
