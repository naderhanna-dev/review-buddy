#!/usr/bin/env node

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createServer } from "./server";
import { ReviewSessionManager } from "./session-manager";
import { loadConfig } from "./config";
import { MONOREPO_ROOT, WEB_DIST, REVIEW_DIST } from "./paths";

const DEFAULT_PORT = 7672;

function serve(portOverride?: number, hostOverride?: string) {
  const config = loadConfig();
  const port = portOverride ?? (parseInt(process.env.REVIEWRADAR_PORT || "") || DEFAULT_PORT);
  const host = hostOverride ?? "127.0.0.1";
  const sessionManager = new ReviewSessionManager(config);

  if (host !== "127.0.0.1" && host !== "localhost") {
    console.warn("WARNING: Server is binding to a non-loopback address.");
    console.warn("  This exposes gh and claude CLI access to your network.");
    console.warn("  Only use --host on trusted networks.\n");
  }

  const server = createServer({ port, host, sessionManager, webDistDir: WEB_DIST, reviewDistDir: REVIEW_DIST });

  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  const displayHost = host === "127.0.0.1" ? "localhost" : host;
  console.log(`ReviewRadar server running at http://${displayHost}:${actualPort}`);
  console.log(`  Dashboard: http://${displayHost}:${actualPort}`);
  console.log(`  Sessions:  ${sessionManager.size} active`);

  function shutdown() {
    console.log("\nShutting down...");
    sessionManager.dispose();
    server.close();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function installService(serveArgs: string[] = []) {
  const home = process.env.HOME || "~";
  const plistDir = resolve(home, "Library/LaunchAgents");
  const plistPath = resolve(plistDir, "com.reviewradar.server.plist");
  const logDir = resolve(home, "Library/Logs/ReviewRadar");
  const launcherPath = resolve(MONOREPO_ROOT, "apps/server/launcher.sh");

  mkdirSync(logDir, { recursive: true });

  // Detect which node version manager is in use
  const nvmDir = process.env.NVM_DIR || resolve(home, ".nvm");
  // fnm can be installed via Homebrew, cargo, or manually
  let fnmBin = "";
  try { fnmBin = execSync("which fnm", { encoding: "utf8" }).trim(); } catch {}

  const serveArgStr = serveArgs.length > 0 ? " " + serveArgs.join(" ") : "";

  const launcher = `#!/usr/bin/env bash
set -euo pipefail

# Ensure PATH includes common tool locations FIRST so we can find fnm/nvm
export HOME="${home}"
export PATH="/opt/homebrew/bin:/usr/local/bin:${home}/.local/bin:\$PATH"

# Source node version manager so we get the right node/pnpm on PATH
# Prefer fnm if available (installed via Homebrew), fall back to nvm
if command -v fnm &>/dev/null; then
  eval "$(fnm env)"
elif [ -s "${nvmDir}/nvm.sh" ]; then
  export NVM_DIR="${nvmDir}"
  source "$NVM_DIR/nvm.sh"
fi

cd "${MONOREPO_ROOT}"

# Auto-install if node_modules is missing (e.g. after a git pull)
if [ ! -d "node_modules" ] || [ ! -d "apps/server/node_modules" ]; then
  echo "Installing dependencies..."
  pnpm install --frozen-lockfile 2>&1 || pnpm install 2>&1
fi

exec pnpm --filter server run serve${serveArgStr}
`;

  writeFileSync(launcherPath, launcher, { mode: 0o755 });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.reviewradar.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>${launcherPath}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${MONOREPO_ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${home}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${logDir}/server.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/server.error.log</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>`;

  writeFileSync(plistPath, plist);
  execSync(`launchctl load ${plistPath}`);
  console.log(`Service installed: ${plistPath}`);
  console.log(`Launcher: ${launcherPath}`);
  console.log(`Logs: ${logDir}/server.log`);
}

function uninstallService() {
  const home = process.env.HOME || "~";
  const plistPath = resolve(home, "Library/LaunchAgents/com.reviewradar.server.plist");

  if (!existsSync(plistPath)) {
    console.error("Service not installed");
    process.exit(1);
  }

  try {
    execSync(`launchctl unload ${plistPath}`);
  } catch {}
  unlinkSync(plistPath);
  console.log("Service uninstalled");
}

// ── CLI dispatch ──

const args = process.argv.slice(2);
const command = args[0];

function preflight() {
  try {
    execSync("which gh", { stdio: "ignore" });
  } catch {
    console.error("Error: gh CLI not found. Install: https://cli.github.com");
    process.exit(1);
  }
  try {
    execSync("gh auth status", { stdio: "ignore" });
  } catch {
    console.error("Error: gh is not authenticated. Run: gh auth login");
    process.exit(1);
  }
  try {
    execSync("which claude", { stdio: "ignore" });
  } catch {
    console.warn("Warning: claude CLI not found. AI review features (analysis, chat, grouping) will not work.");
  }
}

switch (command) {
  case "serve": {
    preflight();
    const { values } = parseArgs({
      args: args.slice(1),
      options: {
        port: { type: "string", short: "p" },
        host: { type: "string", short: "H" },
      },
      allowPositionals: true,
    });
    serve(
      values.port ? parseInt(values.port) : undefined,
      values.host,
    );
    break;
  }
  case "install-service": {
    const { values: installValues } = parseArgs({
      args: args.slice(1),
      options: {
        port: { type: "string", short: "p" },
        host: { type: "string", short: "H" },
      },
      allowPositionals: true,
    });
    const serveArgs: string[] = [];
    if (installValues.host) serveArgs.push("--host", installValues.host);
    if (installValues.port) serveArgs.push("--port", installValues.port);
    installService(serveArgs);
    break;
  }
  case "uninstall-service":
    uninstallService();
    break;
  default:
    console.log("Usage: reviewradar <command>");
    console.log("");
    console.log("Commands:");
    console.log("  serve              Start the ReviewRadar server");
    console.log("    --port, -p       Port to listen on (default: 7672)");
    console.log("    --host, -H       Host to bind to (default: 127.0.0.1)");
    console.log("  install-service    Install launchd service (macOS)");
    console.log("    --port, -p       Port for the service (default: 7672)");
    console.log("    --host, -H       Host for the service (default: 127.0.0.1)");
    console.log("  uninstall-service  Remove launchd service");
    process.exit(command ? 1 : 0);
}
