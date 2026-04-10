#!/usr/bin/env node

import { resolve, dirname } from "node:path";
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

// ── Shared launcher helpers ──

function snapshotToolPaths(): string[] {
  const dirs = new Set<string>();

  dirs.add(dirname(process.execPath));

  for (const bin of ["pnpm", "gh", "claude"]) {
    try {
      const p = execSync(`which ${bin}`, { encoding: "utf8" }).trim();
      if (p) dirs.add(dirname(p));
    } catch {}
  }

  return [...dirs];
}

function buildLauncherScript(serveArgs: string[] = []): string {
  const home = process.env.HOME || "~";
  const nvmDir = process.env.NVM_DIR || resolve(home, ".nvm");
  const serveArgStr = serveArgs.length > 0 ? " " + serveArgs.join(" ") : "";

  const snapshotted = snapshotToolPaths();
  const extraPath = [
    ...snapshotted,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    `${home}/.local/bin`,
  ].join(":");

  return `#!/usr/bin/env bash
set -euo pipefail

export HOME="${home}"
export PATH="${extraPath}:\$PATH"

# Source node version manager if present (fnm or nvm)
if command -v fnm &>/dev/null; then
  eval "$(fnm env)"
elif [ -s "${nvmDir}/nvm.sh" ]; then
  export NVM_DIR="${nvmDir}"
  source "$NVM_DIR/nvm.sh"
fi

cd "${MONOREPO_ROOT}"

if [ ! -d "node_modules" ] || [ ! -d "apps/server/node_modules" ]; then
  echo "Installing dependencies..."
  pnpm install --frozen-lockfile 2>&1 || pnpm install 2>&1
fi

exec pnpm --filter server run serve${serveArgStr}
`;
}

// ── macOS (launchd) ──

function installServiceMacOS(serveArgs: string[] = []) {
  const home = process.env.HOME || "~";
  const plistPath = resolve(home, "Library/LaunchAgents/com.reviewradar.server.plist");
  const logDir = resolve(home, "Library/Logs/ReviewRadar");
  const launcherPath = resolve(MONOREPO_ROOT, "apps/server/launcher.sh");

  mkdirSync(logDir, { recursive: true });

  writeFileSync(launcherPath, buildLauncherScript(serveArgs), { mode: 0o755 });

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

function uninstallServiceMacOS() {
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
  const launcherPath = resolve(MONOREPO_ROOT, "apps/server/launcher.sh");
  if (existsSync(launcherPath)) unlinkSync(launcherPath);
  console.log("Service uninstalled");
}

// ── Linux (systemd user service) ──

function installServiceLinux(serveArgs: string[] = []) {
  const home = process.env.HOME || "~";
  const unitDir = resolve(home, ".config/systemd/user");
  const unitPath = resolve(unitDir, "reviewradar.service");
  const launcherPath = resolve(MONOREPO_ROOT, "apps/server/launcher.sh");

  mkdirSync(unitDir, { recursive: true });

  writeFileSync(launcherPath, buildLauncherScript(serveArgs), { mode: 0o755 });

  const unit = `[Unit]
Description=ReviewRadar server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${launcherPath}
WorkingDirectory=${MONOREPO_ROOT}
Restart=on-failure
RestartSec=10
Environment=HOME=${home}

[Install]
WantedBy=default.target
`;

  writeFileSync(unitPath, unit);
  execSync("systemctl --user daemon-reload");
  execSync("systemctl --user enable reviewradar.service");
  execSync("systemctl --user restart reviewradar.service");
  console.log(`Service installed: ${unitPath}`);
  console.log(`Launcher: ${launcherPath}`);
  console.log(`Logs: journalctl --user -u reviewradar`);
}

function uninstallServiceLinux() {
  const home = process.env.HOME || "~";
  const unitPath = resolve(home, ".config/systemd/user/reviewradar.service");

  if (!existsSync(unitPath)) {
    console.error("Service not installed");
    process.exit(1);
  }

  try {
    execSync("systemctl --user disable --now reviewradar.service");
  } catch {}
  unlinkSync(unitPath);
  const launcherPath = resolve(MONOREPO_ROOT, "apps/server/launcher.sh");
  if (existsSync(launcherPath)) unlinkSync(launcherPath);
  execSync("systemctl --user daemon-reload");
  console.log("Service uninstalled");
}

// ── Platform dispatch ──

function resolveServeAddr(serveArgs: string[]): { host: string; port: number } {
  let host = "127.0.0.1";
  let port = DEFAULT_PORT;
  for (let i = 0; i < serveArgs.length; i++) {
    if ((serveArgs[i] === "--host" || serveArgs[i] === "-H") && serveArgs[i + 1]) host = serveArgs[++i];
    else if ((serveArgs[i] === "--port" || serveArgs[i] === "-p") && serveArgs[i + 1]) port = parseInt(serveArgs[++i]) || DEFAULT_PORT;
  }
  return { host, port };
}

function installService(serveArgs: string[] = []) {
  if (process.platform === "darwin") {
    installServiceMacOS(serveArgs);
  } else if (process.platform === "linux") {
    installServiceLinux(serveArgs);
  } else {
    console.error(`Unsupported platform: ${process.platform}`);
    process.exit(1);
  }

  const { host, port } = resolveServeAddr(serveArgs);
  const displayHost = host === "127.0.0.1" ? "localhost" : host;
  console.log(`\nReviewRadar is running at http://${displayHost}:${port}`);
}

function uninstallService() {
  if (process.platform === "darwin") {
    uninstallServiceMacOS();
  } else if (process.platform === "linux") {
    uninstallServiceLinux();
  } else {
    console.error(`Unsupported platform: ${process.platform}`);
    process.exit(1);
  }
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
    console.log("  install-service    Install as a service (macOS launchd / Linux systemd)");
    console.log("    --port, -p       Port for the service (default: 7672)");
    console.log("    --host, -H       Host for the service (default: 127.0.0.1)");
    console.log("  uninstall-service  Remove the service");
    process.exit(command ? 1 : 0);
}
