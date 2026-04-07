import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const MONOREPO_ROOT = resolve(__dirname, "../../..");
export const AGENTS_DIR = resolve(MONOREPO_ROOT, "packages/agents/src");
export const WEB_DIST = resolve(MONOREPO_ROOT, "apps/web/dist");
export const REVIEW_DIST = resolve(MONOREPO_ROOT, "apps/review/dist");

export function augmentedEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    PATH: [
      process.env.PATH,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      `${process.env.HOME}/.local/bin`,
    ].filter(Boolean).join(":"),
  };
}

export interface SpawnExecOptions {
  stdin?: string;
  cwd?: string;
}

export function spawnExec(cmd: string[], opts?: SpawnExecOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = cmd;
    const proc = spawn(bin, args, {
      cwd: opts?.cwd,
      env: augmentedEnv(),
    });
    if (opts?.stdin) proc.stdin.end(opts.stdin);
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => chunks.push(d));
    proc.stderr.on("data", (d: Buffer) => errChunks.push(d));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed (${code}): ${cmd.join(" ")}\n${Buffer.concat(errChunks).toString().trim()}`));
      } else {
        resolve(Buffer.concat(chunks).toString().trim());
      }
    });
    proc.on("error", reject);
  });
}
